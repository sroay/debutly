import type { LlmClient } from "../llm/types";
import type { GoalPart, Session } from "../types";
import { extractJsonObject } from "../util/json";
import { describeAction } from "./describe";
import { describeEffect } from "./effect";

const MAX_PARTS = 6;
const MAX_PART = 80;
const MAX_THOUGHT = 200;
const MAX_EFFECT = 240;
/** Room for a reasoning model to think before it answers: with 1,024 tokens one answered nothing. */
const REPLY_TOKENS = 8_000;
/** Fewer steps than this after the last part done say nothing about where it got stuck. */
const MIN_TAIL = 3;

const pathOf = (url: string) => {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
};

/** One record's page stands for all of its kind: /object/person/358db0e0-… and /object/person/5772de69-… are the same page. */
export const pageKind = (path: string) =>
  path
    .split("/")
    .map((seg) => (/^[0-9a-f]{8}-[0-9a-f]{4}-|^\d+$|^[0-9a-z]{20,}$/i.test(seg) ? "…" : seg))
    .join("/");

/** The session as a person reading it over the agent's shoulder would retell it, a step a line. */
export function retell(s: Session): string {
  const view = { screenReader: s.inclusion === "screen_reader" };
  return s.steps
    .map((st, i) => {
      const next = s.steps[i + 1];
      const effect = next ? describeEffect(st.action, st.observation, next.observation, st.signals, st, view) : "";
      const thought = st.reasoning.replace(/\s+/g, " ").trim().slice(0, MAX_THOUGHT);
      return `${i + 1}. ${pathOf(st.observation.url)}: ${describeAction(st.action, st.observation)}${effect ? ` → ${effect.slice(0, MAX_EFFECT)}` : ""}${thought ? ` | thought: "${thought}"` : ""}`;
    })
    .join("\n");
}

const ENDED: Partial<Record<Session["outcome"], string>> = {
  gave_up: "It gave up",
  budget_exhausted: "It ran out of steps",
};

const SYSTEM = "You read the record of a test user's session with a web product and say how far it got with its goal. You judge by what happened on screen, not by what the user believed.";

function question(s: Session): string {
  return `Goal: ${s.goal}

The session, a step a line (page: what the user did → what happened | what it was thinking):
${retell(s)}

${ENDED[s.outcome] ?? "It stopped"}: "${s.outcomeNote}"

Split the goal into the parts a person would tick off as they went (2 to ${MAX_PARTS}, in order, each a few words such as "create the workspace"). Leave out instructions on how to report. For each part, say whether the steps show it done, and the number of the step that finished it. A part the user believed done but the screen never showed is not done.
Reply with only one JSON object: {"parts":[{"part":string,"done":boolean,"step":number|null}]}`;
}

function readParts(raw: string, steps: number): GoalPart[] | undefined {
  let parsed: unknown;
  try {
    parsed = extractJsonObject(raw);
  } catch {
    return undefined;
  }
  const parts = (parsed as { parts?: unknown }).parts;
  if (!Array.isArray(parts) || parts.length < 1 || parts.length > MAX_PARTS + 2) return undefined;
  const out: GoalPart[] = [];
  for (const p of parts) {
    const { part, done, step } = (p ?? {}) as Record<string, unknown>;
    if (typeof part !== "string" || !part.trim() || typeof done !== "boolean") return undefined;
    // A step it names that the session never took is dropped; the part stands.
    const index = typeof step === "number" && Number.isInteger(step) && step >= 1 && step <= steps ? step - 1 : undefined;
    out.push({ part: part.trim().slice(0, MAX_PART), done, ...(done && index !== undefined ? { stepIndex: index } : {}) });
  }
  return out.slice(0, MAX_PARTS);
}

/**
 * How far an agent that didn't reach its goal got: the goal's parts, each done or not, by the step
 * that finished it. "Ran out of steps" said nothing of an owner who had made the workspace, invited
 * the team and added three companies, and was stuck naming the contacts (2026-11-04). One judge
 * call per agent; a reply it can't read leaves the session as it was.
 */
export async function goalProgress(judge: LlmClient, s: Session): Promise<GoalPart[] | undefined> {
  if (!ENDED[s.outcome] || !s.steps.length) return undefined;
  const raw = await judge.complete({ system: SYSTEM, messages: [{ role: "user", content: question(s) }], maxTokens: REPLY_TOKENS });
  return readParts(raw, s.steps.length);
}

/** Where the steps after its last part done went: the page most of them were on, when most were. */
export function stuckOn(s: Session): { page: string; steps: number; of: number } | undefined {
  if (!s.progress) return undefined;
  const lastDone = Math.max(-1, ...s.progress.filter((p) => p.done && p.stepIndex !== undefined).map((p) => p.stepIndex!));
  const tail = s.steps.slice(lastDone + 1);
  if (tail.length < MIN_TAIL) return undefined;
  const counts = new Map<string, number>();
  for (const st of tail) counts.set(pageKind(pathOf(st.observation.url)), (counts.get(pageKind(pathOf(st.observation.url))) ?? 0) + 1);
  const [page, steps] = [...counts].sort((a, b) => b[1] - a[1])[0];
  return steps * 2 > tail.length ? { page, steps, of: tail.length } : undefined;
}

/** "3 of 4 parts done: create the workspace (step 8), …; not done: give each a contact person." */
export function describeProgress(s: Session): string {
  if (!s.progress?.length) return "";
  const done = s.progress.filter((p) => p.done);
  const left = s.progress.filter((p) => !p.done);
  const list = (ps: GoalPart[], steps: boolean) => ps.map((p) => `${p.part}${steps && p.stepIndex !== undefined ? ` (step ${p.stepIndex + 1})` : ""}`).join(", ");
  const stuck = stuckOn(s);
  return [
    `${done.length} of ${s.progress.length} parts of the goal done${done.length ? `: ${list(done, true)}` : ""}.`,
    left.length ? `Not done: ${list(left, false)}.` : "",
    stuck ? `${stuck.steps} of its last ${stuck.of} steps were on ${stuck.page}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}
