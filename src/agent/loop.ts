import type { Page } from "playwright";
import type { ArtifactStore } from "../artifacts/store";
import { execute } from "../browser/execute";
import { observe } from "../browser/observe";
import { settle, type SettleOptions } from "../browser/settle";
import { SignalCollector } from "../browser/signals";
import type { EmailMessage, Inbox } from "../inbox/types";
import { Meter, type ModelPrice } from "../llm/meter";
import type { LlmClient, LlmMessage } from "../llm/types";
import type { ActionResult, Persona, Session, Step } from "../types";
import { describeAction } from "./describe";
import { describeEffect } from "./effect";
import { parseAgentReply } from "./parse-reply";
import { buildStepMessage, buildSystemPrompt, type AgentIdentity } from "./prompt";

const MAX_REPLY_ATTEMPTS = 3;
const LINKS_PER_EMAIL = 3;
/** How long the first page may take to arrive; a slow-connection agent needs more than 30 s. */
const FIRST_LOAD_MS = 90_000;
/** A first page slower than this is reported. */
const SLOW_LOAD_MS = 10_000;
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
  try {
    await page.goto(origin, { waitUntil: "domcontentloaded", timeout: timeoutMs });
  } catch (err) {
    if (!(err instanceof Error && err.name === "TimeoutError")) throw err;
    finished = false;
  }
  const ms = Date.now() - startedAt;
  if (!finished || ms >= slowMs) signals.note({ kind: "slow_load", url: origin, ms, finished, slowNetwork });
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
  // Every way out of the session carries what it spent.
  const end = (outcome: Session["outcome"], outcomeNote: string): Session => ({
    ...base,
    outcome,
    outcomeNote,
    usage: { ...meter.total, costUsd: meter.costUsd(o.price) },
  });

  await openFirstPage(o.page, o.origin, signals, o.persona.inclusion === "slow_connection", o.firstLoad);

  // A failure part-way (the provider out of credits, the browser gone) still ends the session
  // with the steps it took: they hold findings, and they were paid for.
  try {
    return await takeSteps(o, { signals, system, steps, history, emailedLinks, meter, startedAt, end });
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
}

async function takeSteps(o: RunSessionOptions, { signals, system, steps, history, emailedLinks, meter, startedAt, end }: SessionState): Promise<Session> {
  // The screen-reader agent hears what the browser tells assistive technology and works by keyboard.
  const screenReader = o.persona.inclusion === "screen_reader";
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
    const observation = await observe(o.page);
    // Now that we can see the page after the previous action, tell the agent what it did.
    const prev = steps.at(-1);
    if (prev) {
      const effect = describeEffect(prev.action, prev.observation, observation, prev.signals, prev);
      if (effect) history[history.length - 1] += ` → ${effect}`;
    }
    const messages: LlmMessage[] = [{ role: "user", content: buildStepMessage(observation, history, { screenReader }) }];
    let reply: ReturnType<typeof parseAgentReply> | undefined;
    let raw = "";
    let problem = "";
    // Real models occasionally send prose, an empty reply or malformed JSON; say what was wrong and ask again.
    for (let attempt = 0; attempt < MAX_REPLY_ATTEMPTS && !reply; attempt++) {
      raw = await o.llm.complete({ system, messages: [...messages], maxTokens: 4096, onUsage: meter.add });
      try {
        reply = parseAgentReply(raw);
      } catch (err) {
        problem = err instanceof Error ? err.message : String(err);
        messages.push(
          { role: "assistant", content: raw || "(empty reply)" },
          {
            role: "user",
            content: `Your last reply was not valid: ${problem.slice(0, 300)}\nReply with only one JSON object: {"reasoning": string, "action": Action}.`,
          },
        );
      }
    }
    if (!reply) {
      return end("error", `${problem} | last reply: ${raw.slice(0, 300) || "(empty)"}`);
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
