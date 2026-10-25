import type { Action, ActionResult, InteractiveElement, Observation, Signal } from "../types";
import { controlLabel, type StepView } from "./label";

const pathOf = (url: string) => {
  try {
    const u = new URL(url);
    return u.pathname;
  } catch {
    return url;
  }
};

const MAX_LISTED = 4;
const MAX_LINE = 80;

type Label = (e: InteractiveElement) => string;

/** Controls in `a` beyond those in `b`, counting copies: a second "Untitled" row is new. */
function beyond(a: InteractiveElement[], b: InteractiveElement[], controlOf: Label): InteractiveElement[] {
  const left = new Map<string, number>();
  for (const e of b) left.set(controlOf(e), (left.get(controlOf(e)) ?? 0) + 1);
  return a.filter((e) => {
    const n = left.get(controlOf(e)) ?? 0;
    if (n > 0) left.set(controlOf(e), n - 1);
    return n === 0;
  });
}

/** Controls still there whose state changed: a Save button now enabled, a box now checked. */
function stateChanges(before: InteractiveElement[], after: InteractiveElement[], controlOf: Label): string[] {
  const out: string[] = [];
  for (const a of after) {
    const b = before.find((e) => controlOf(e) === controlOf(a));
    if (!b) continue;
    if (!!b.disabled !== !!a.disabled) out.push(`now ${a.disabled ? "disabled" : "enabled"} ${controlOf(a)}`);
    if (b.checked !== undefined && a.checked !== undefined && b.checked !== a.checked) out.push(`now ${a.checked ? "checked" : "unchecked"} ${controlOf(a)}`);
    if (b.expanded !== undefined && a.expanded !== undefined && b.expanded !== a.expanded) out.push(`now ${a.expanded ? "open" : "closed"} ${controlOf(a)}`);
  }
  return out;
}

const listed = (items: string[]) => items.slice(0, MAX_LISTED).join(", ") + (items.length > MAX_LISTED ? `, and ${items.length - MAX_LISTED} more` : "");

/**
 * What changed on the page, as a person would notice it: controls that appeared or went, state
 * that changed, and new lines of text. Told only "the page changed", agents missed a password
 * field that had appeared, pressed "Create company" seven times without seeing seven new rows,
 * and kept retyping values while waiting for a Save button to wake up.
 */
function whatChanged(before: Observation, after: Observation, controlOf: Label): string {
  const appeared = beyond(after.elements, before.elements, controlOf);
  const gone = beyond(before.elements, after.elements, controlOf);
  const names = new Set(after.elements.map((e) => e.name));
  const had = new Set(before.text.split("\n").map((l) => l.trim()));
  const newText = [...new Set(after.text.split("\n").map((l) => l.trim()))].filter((l) => l && !had.has(l) && !names.has(l)).map((l) => `"${l.slice(0, MAX_LINE)}"`);
  const parts = [
    appeared.length ? `new ${listed(appeared.map(controlOf))}` : "",
    gone.length ? `gone ${listed(gone.map(controlOf))}` : "",
    ...stateChanges(before.elements, after.elements, controlOf).slice(0, MAX_LISTED),
    newText.length ? `new text ${listed(newText)}` : "",
  ].filter(Boolean);
  return parts.length ? `the page changed: ${parts.join("; ")}` : "";
}

// What a person would notice after acting: where they are now, whether anything changed,
// and whether something visibly broke. Without this, agents retry dead buttons forever.
// Controls are named as the agent meets them, as in its step message.
export function describeEffect(action: Action, before: Observation, after: Observation, signals: Signal[], result: ActionResult, view: StepView = {}): string {
  if (result.blocked) return `blocked: ${result.blocked}`;
  if (result.error) return `failed: ${result.error}`;
  // check_email reports its own result; done ends the session.
  if (action.type === "done" || action.type === "check_email") return "";

  const parts: string[] = [];
  const changed = whatChanged(before, after, (e) => controlLabel(e, view.screenReader));
  if (pathOf(after.url) !== pathOf(before.url)) parts.push(`now on ${pathOf(after.url)}`);
  else if (changed) parts.push(changed);
  else if (after.text !== before.text) parts.push("the page changed");
  else if (action.type !== "fill" && !signals.some((s) => s.kind === "download")) parts.push("nothing visibly changed");

  for (const s of signals) if (s.kind === "download") parts.push(`a file downloaded: ${s.filename}`);

  for (const s of signals) if (s.kind === "dialog") parts.push(`a ${s.dialogType} dialog said "${s.message}" (answered OK)`);
  if (signals.some((s) => s.kind === "page_error")) parts.push("a JavaScript error occurred");
  const failed = [
    ...new Set(
      signals.filter((s) => s.kind === "http_error" && pathOf(s.requestUrl) !== "/favicon.ico").map((s) => (s.kind === "http_error" ? s.status : 0)),
    ),
  ];
  for (const status of failed) parts.push(`a request failed (HTTP ${status})`);

  return parts.join("; ");
}
