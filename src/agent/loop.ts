import type { Page, Request } from "playwright";
import type { ArtifactStore } from "../artifacts/store";
import { execute } from "../browser/execute";
import { observe } from "../browser/observe";
import { ReflowMeter } from "../browser/reflow";
import { settle, type SettleOptions } from "../browser/settle";
import { SignalCollector } from "../browser/signals";
import type { EmailMessage, Inbox } from "../inbox/types";
import { Meter, type ModelPrice } from "../llm/meter";
import type { LlmClient, LlmMessage } from "../llm/types";
import type { ActionResult, Persona, Session, Step } from "../types";
import { describeAction } from "./describe";
import { describeEffect } from "./effect";
import { nothingToPressYet, untriedWaysOn } from "./give-up";
import { NoActionError, parseAgentReply } from "./parse-reply";
import { buildStepMessage, buildSystemPrompt, type AgentIdentity } from "./prompt";

const MAX_REPLY_ATTEMPTS = 3;
/** Steps a session may wait for want of an action in the reply, before that is an engine error. */
const MAX_NO_ACTION_WAITS = 3;
const LINKS_PER_EMAIL = 3;
/** How long the first page may take to arrive; a slow-connection agent needs more than 30 s. */
const FIRST_LOAD_MS = 90_000;
/** A first page slower than this is reported. */
const SLOW_LOAD_MS = 10_000;
/** How long a slow first page's scripts and styles may take to be weighed before it is reported without. */
const WEIGH_MS = 2_000;
/** How long a step's screenshot may take before the step goes without one. */
const SCREENSHOT_MS = 15_000;

export interface RunSessionOptions {
  page: Page;
  llm: LlmClient;
  persona: Persona;
  goal: string;
  origin: string;
  maxSteps: number;
  /** Where step screenshots go (a local folder, or S3); none means no screenshots. */
  artifacts?: ArtifactStore;
  identity?: AgentIdentity;
  inbox?: Inbox;
  /** Shared context for the system prompt, e.g. a crew member's company. */
  brief?: string;
  /** Per-agent limits on top of maxSteps. */
  caps?: { maxTokens?: number; maxMs?: number };
  /** The run's kill switch, checked before every step. */
  shouldStop?: () => Promise<boolean> | boolean;
  /** Prices the session's usage; omitted or null leaves the cost unknown. */
  price?: ModelPrice | null;
  /** Called with each step as it completes, e.g. to record it for live views. */
  onStep?: (step: Step) => Promise<void> | void;
  /** How long to let each page finish loading before the agent reads it. */
  settle?: SettleOptions;
  /** How long the first page may take, and from when it counts as slow (defaults: 90 s, 10 s). */
  firstLoad?: { timeoutMs?: number; slowMs?: number };
}

function describeInbox(messages: EmailMessage[]): string {
  if (!messages.length) return "checked email → no emails yet";
  const items = messages.map((m) => `"${m.subject}"${m.links.length ? ` links: ${m.links.slice(0, LINKS_PER_EMAIL).join(" ")}` : ""}`);
  return `checked email → ${messages.length} email${messages.length === 1 ? "" : "s"}: ${items.join("; ")}`;
}

/**
 * Open the app the way a person does: wait for the page, but never fail the session because it
 * is slow. Waiting for every image and font ("load") within Playwright's 30 s ended the
 * slow-connection agents on a test app's home page before their first step, two nights running.
 * Now the agent starts once the document is in (settle() waits for the rest), with up to
 * FIRST_LOAD_MS for that; whatever has arrived by then is what it sees, and it can wait or give up.
 * A slow start is itself a finding.
 */
async function openFirstPage(
  page: Page,
  origin: string,
  signals: SignalCollector,
  slowNetwork: boolean,
  { timeoutMs = FIRST_LOAD_MS, slowMs = SLOW_LOAD_MS }: RunSessionOptions["firstLoad"] = {},
): Promise<void> {
  const startedAt = Date.now();
  let finished = true;
  // What its scripts and styles weigh as sent, and how much came uncompressed: a test copy served
  // straight from its container may skip the compression its real hosting does (Twenty's sent
  // 10 MB uncompressed, 2026-10-24), and then a slow page says more about the copy than the app.
  const assets = { files: 0, bytes: 0, uncompressedBytes: 0 };
  const weighing = new Set<Promise<void>>();
  const weigh = (request: Request) => {
    if (request.resourceType() !== "script" && request.resourceType() !== "stylesheet") return;
    const done = (async () => {
      const [{ responseBodySize }, encoding] = await Promise.all([request.sizes(), request.response().then((r) => r?.headerValue("content-encoding"))]);
      assets.files++;
      assets.bytes += responseBodySize;
      if (!encoding || encoding === "identity") assets.uncompressedBytes += responseBodySize;
    })()
      .catch(() => {}) // the page moved on before it could be weighed
      .finally(() => weighing.delete(done));
    weighing.add(done);
  };
  page.on("requestfinished", weigh);
  try {
    await page.goto(origin, { waitUntil: "domcontentloaded", timeout: timeoutMs });
  } catch (err) {
    if (!(err instanceof Error && err.name === "TimeoutError")) throw err;
    finished = false;
  } finally {
    page.off("requestfinished", weigh);
  }
  const ms = Date.now() - startedAt;
  if (!finished || ms >= slowMs) {
    await Promise.race([Promise.allSettled([...weighing]), new Promise((resolve) => setTimeout(resolve, WEIGH_MS))]);
    signals.note({ kind: "slow_load", url: origin, ms, finished, slowNetwork, ...(assets.files ? { assets: { ...assets } } : {}) });
  }
}

export async function runSession(o: RunSessionOptions): Promise<Session> {
  const signals = new SignalCollector(o.page);
  const system = buildSystemPrompt(o.persona, o.goal, o.inbox ? o.identity : undefined, o.brief);
  const steps: Step[] = [];
  const history: string[] = [];
  const emailedLinks = new Set<string>();
  const meter = new Meter();
  const startedAt = Date.now();
  const base = { agentId: o.persona.id, personaName: o.persona.name, goal: o.goal, steps };
  // The low-vision agent's pages, each measured at 320 CSS pixels wide as it arrives (WCAG 1.4.10).
  const reflow = o.persona.inclusion === "low_vision" ? new ReflowMeter() : undefined;
  // Every way out of the session carries what it spent, and what it measured.
  const end = (outcome: Session["outcome"], outcomeNote: string): Session => ({
    ...base,
    outcome,
    outcomeNote,
    usage: { ...meter.total, costUsd: meter.costUsd(o.price) },
    ...(reflow?.checks.length ? { reflow: [...reflow.checks] } : {}),
  });

  await openFirstPage(o.page, o.origin, signals, o.persona.inclusion === "slow_connection", o.firstLoad);

  // A failure part-way (the provider out of credits, the browser gone) still ends the session
  // with the steps it took: they hold findings, and they were paid for.
  try {
    return await takeSteps(o, { signals, system, steps, history, emailedLinks, meter, startedAt, end, reflow });
  } catch (err) {
    return end("error", err instanceof Error ? err.message : String(err));
  }
}

interface SessionState {
  signals: SignalCollector;
  system: string;
  steps: Step[];
  history: string[];
  emailedLinks: Set<string>;
  meter: Meter;
  startedAt: number;
  end: (outcome: Session["outcome"], outcomeNote: string) => Session;
  reflow?: ReflowMeter;
}

async function takeSteps(o: RunSessionOptions, { signals, system, steps, history, emailedLinks, meter, startedAt, end, reflow }: SessionState): Promise<Session> {
  // The screen-reader agent hears what the browser tells assistive technology and works by keyboard.
  const screenReader = o.persona.inclusion === "screen_reader";
  let noActionWaits = 0;
  const askedBeforeGivingUp = new Set<string>();
  for (let index = 0; index < o.maxSteps; index++) {
    if (o.shouldStop && (await o.shouldStop())) return end("cancelled", "run cancelled");
    const { inputTokens, outputTokens } = meter.total;
    if (o.caps?.maxTokens !== undefined && inputTokens + outputTokens >= o.caps.maxTokens) {
      return end("budget_exhausted", `stopped at the token cap (${o.caps.maxTokens} tokens)`);
    }
    if (o.caps?.maxMs !== undefined && Date.now() - startedAt >= o.caps.maxMs) {
      return end("budget_exhausted", `stopped at the time cap (${Math.round(o.caps.maxMs / 1000)}s)`);
    }
    await settle(o.page, o.settle);
    await reflow?.measure(o.page);
    const observation = await observe(o.page);
    // Now that we can see the page after the previous action, tell the agent what it did.
    const prev = steps.at(-1);
    if (prev) {
      const effect = describeEffect(prev.action, prev.observation, observation, prev.signals, prev, { screenReader });
      if (effect) history[history.length - 1] += ` → ${effect}`;
    }
    const messages: LlmMessage[] = [{ role: "user", content: buildStepMessage(observation, history, { screenReader }) }];
    let reply: ReturnType<typeof parseAgentReply> | undefined;
    let raw = "";
    let problem = "";
    let noAction: NoActionError | undefined;
    // Real models occasionally send prose, an empty reply or malformed JSON; say what was wrong and ask again.
    for (let attempt = 0; attempt < MAX_REPLY_ATTEMPTS && !reply; attempt++) {
      raw = await o.llm.complete({ system, messages: [...messages], maxTokens: 4096, onUsage: meter.add });
      try {
        reply = parseAgentReply(raw);
      } catch (err) {
        problem = err instanceof Error ? err.message : String(err);
        noAction = err instanceof NoActionError ? err : undefined;
        messages.push(
          { role: "assistant", content: raw || "(empty reply)" },
          {
            role: "user",
            content: `Your last reply was not valid: ${problem.slice(0, 300)}\nReply with only one JSON object: {"reasoning": string, "action": Action}.`,
          },
        );
      }
    }
    // Asked three times, GLM 5.3 Flash went on sending only its reasoning, often "I will wait", and
    // the agent ended on an engine error (2026-10-24). It waits instead, as someone unsure what to
    // do next would; not for ever.
    if (!reply && noAction && noActionWaits < MAX_NO_ACTION_WAITS) {
      noActionWaits++;
      reply = { reasoning: noAction.reasoning, action: { type: "wait" } };
    }
    if (!reply) {
      return end("error", `${problem} | last reply: ${raw.slice(0, 300) || "(empty)"}`);
    }
    // Giving up with a way on in plain sight that it never pressed here, or on a page with nothing
    // to press yet: asked once per page. Still giving up, it gives up.
    if (reply.action.type === "done" && !reply.action.success && !askedBeforeGivingUp.has(observation.url)) {
      const wayOn = untriedWaysOn(observation, steps, screenReader);
      const ask = wayOn.length
        ? `Before you give up: on this page you haven't tried ${wayOn.map((n) => `"${n}"`).join(", ")}. Someone who wanted to get on would try that first.`
        : nothingToPressYet(observation)
          ? "Before you give up: nothing on this page can be pressed yet, so it may still be loading. Someone who wanted to get on would wait a little first."
          : "";
      if (ask) {
        askedBeforeGivingUp.add(observation.url);
        const again = await o.llm.complete({
          system,
          messages: [
            ...messages,
            { role: "assistant", content: raw },
            {
              role: "user",
              content: `${ask} Reply again with one JSON object: go on, or give up if you are sure.`,
            },
          ],
          maxTokens: 4096,
          onUsage: meter.add,
        });
        try {
          reply = parseAgentReply(again);
        } catch {
          // an unreadable second answer leaves the first one standing
        }
      }
    }

    let result: ActionResult;
    let historyLine = describeAction(reply.action, observation);
    if (reply.action.type === "check_email") {
      if (!o.inbox || !o.identity) {
        result = { error: "this agent has no inbox" };
      } else {
        try {
          const mail = await o.inbox.latest(o.identity.email);
          for (const m of mail) for (const link of m.links) emailedLinks.add(link);
          historyLine = describeInbox(mail);
          result = {};
        } catch (err) {
          result = { error: err instanceof Error ? err.message : String(err) };
        }
      }
    } else {
      result = await execute(o.page, reply.action, observation, o.origin, (href) => emailedLinks.has(href), { keyboard: screenReader });
    }

    let screenshotPath: string | undefined;
    if (o.artifacts) {
      // JPEG where the store asks for it (the database keeps them small); PNG otherwise. A
      // screenshot that fails (one timed out on a slow page) costs this step
      // its picture, not the agent its session.
      const format = o.artifacts.screenshotFormat;
      try {
        const shot = await o.page.screenshot({ ...(format ?? {}), timeout: SCREENSHOT_MS });
        const name = `${o.persona.id}-${String(index).padStart(3, "0")}`;
        screenshotPath = format
          ? await o.artifacts.put(`${name}.jpg`, shot, "image/jpeg")
          : await o.artifacts.put(`${name}.png`, shot, "image/png");
      } catch (err) {
        console.warn(`[${o.persona.name}] no screenshot for step ${index}: ${err instanceof Error ? err.message.split("\n")[0] : err}`);
      }
    }

    const guessedUrl = reply.action.type === "goto" && !emailedLinks.has(reply.action.path);
    await signals.settle();
    const step: Step = {
      index,
      observation,
      action: reply.action,
      reasoning: reply.reasoning,
      signals: signals.drain(),
      screenshotPath,
      ...result,
      ...(guessedUrl ? { guessedUrl } : {}),
    };
    steps.push(step);
    await o.onStep?.(step);
    history.push(historyLine);

    if (reply.action.type === "done") {
      return end(reply.action.success ? "success" : "gave_up", reply.action.note);
    }
  }

  return end("budget_exhausted", `stopped after ${o.maxSteps} steps`);
}
