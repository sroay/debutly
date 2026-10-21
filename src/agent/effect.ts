import type { Action, ActionResult, Observation, Signal } from "../types";

const pathOf = (url: string) => {
  try {
    const u = new URL(url);
    return u.pathname;
  } catch {
    return url;
  }
};

// What a person would notice after acting: where they are now, whether anything changed,
// and whether something visibly broke. Without this, agents retry dead buttons forever.
export function describeEffect(action: Action, before: Observation, after: Observation, signals: Signal[], result: ActionResult): string {
  if (result.blocked) return `blocked: ${result.blocked}`;
  if (result.error) return `failed: ${result.error}`;
  // check_email reports its own result; done ends the session.
  if (action.type === "done" || action.type === "check_email") return "";

  const parts: string[] = [];
  if (pathOf(after.url) !== pathOf(before.url)) parts.push(`now on ${pathOf(after.url)}`);
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
