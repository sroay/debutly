import { UNCOMPRESSED } from "../detect/findings";
import type { Finding, Session } from "../types";

/** At most this many items, so the section reads in a couple of minutes. */
const MAX_ITEMS = 5;
const MAX_QUOTE = 200;
const RANK: Record<Finding["severity"], number> = { blocker: 0, major: 1, minor: 2 };

// Agents that didn't reach the goal because of the app, or seemingly so. An engine error or a
// cancelled run says nothing about the app; a run cut short for credit has its own section.
const STOPPED: Partial<Record<Session["outcome"], string>> = {
  gave_up: "gave up",
  budget_exhausted: "ran out of steps",
  not_invited: "never got an invite",
};

/** What to do about a finding, in a line. */
export function nextStep(f: Finding): string {
  switch (f.kind) {
    case "http_error": {
      const status = Number(/^HTTP (\d{3})/.exec(f.title)?.[1] ?? 0);
      return status >= 500
        ? "The server failed: its log for this request says why."
        : "The server refused the request: compare what the page sent with what the server expects.";
    }
    case "page_error":
      return "Fix the JavaScript error; the reproduction below shows the step that sets it off.";
    case "console_error":
      return "Read the error in the browser console on that page.";
    case "a11y_unlabeled":
      if (f.control?.problem === "placeholder") return "Give the field a visible <label>, and keep the placeholder as an example.";
      if (f.control?.problem === "described") return "Name it: visible text or an aria-label, with the description kept as a hint.";
      if (f.control && !/^(button|link|menuitem|tab|summary)/.test(f.control.role)) return "Give each one a <label> (or an aria-label) that says what goes in it.";
      return 'Give each one visible text, or an aria-label that says what it does (aria-label="Open menu" on a menu icon).';
    case "stuck":
      return "Watch the reproduction below: the agent repeated an action that seemed to do nothing. Make the page show that it worked, or why it didn't.";
    case "slow_load":
      return f.detail.includes(UNCOMPRESSED)
        ? "Turn on compression (gzip or Brotli) for scripts and styles, or check that the real site has it."
        : "Find what holds the page up: the agents sat waiting for it.";
    case "covered":
      return "Move or close whatever lies over the control, so it can be clicked.";
    case "keyboard":
      if (f.signature.startsWith("enter:")) return "Let Enter press it too: look for a key handler that catches Enter and stops it (a page-wide shortcut, a form's own Enter handling).";
      return 'Use a real <button> or <a>, or add tabindex="0" and handle Enter and Space.';
    case "focus_obscured":
      return "Keep the control with keyboard focus in view: move or shrink what covers it.";
    case "reflow":
      return "Let the page wrap at narrow widths instead of scrolling sideways: look for fixed widths.";
    case "language":
      if (f.signature.startsWith("dir:")) return 'Set dir="rtl" on Arabic pages (on <html>, or on the part that holds the Arabic).';
      if (f.signature === "lang:missing") return 'Add a lang attribute to the <html> element, e.g. lang="en".';
      return 'Set lang="ar" on Arabic pages.';
    case "zoom":
      return "Remove user-scalable=no and maximum-scale from the page's viewport meta tag.";
  }
}

const lastPath = (s: Session) => {
  try {
    return new URL(s.steps.at(-1)?.observation.url ?? "").pathname;
  } catch {
    return "";
  }
};

const quote = (s: string) => `"${s.length > MAX_QUOTE ? `${s.slice(0, MAX_QUOTE)}…` : s}"`;

/** A screenshot as the report's reader finds it: next to the report, not on the machine that ran it. */
export function shotPath(path: string): string {
  if (/^https?:/.test(path)) return path;
  const at = path.replace(/\\/g, "/").lastIndexOf("/screenshots/");
  return at >= 0 ? path.replace(/\\/g, "/").slice(at + 1) : path;
}

function stoppedItem(s: Session, needs: string, environment: boolean): string {
  const who = [s.role, needs !== "—" ? needs : ""].filter(Boolean).join("; ");
  const where = lastPath(s) ? ` on ${lastPath(s)}` : "";
  const shot = [...s.steps].reverse().find((st) => st.screenshotPath)?.screenshotPath;
  // Out of steps, the note only says so; the agent's last thought says where it was.
  const said = s.outcome === "budget_exhausted" && s.steps.at(-1)?.reasoning ? `Its last thought: ${quote(s.steps.at(-1)!.reasoning)}` : `In the agent's words: ${quote(s.outcomeNote)}`;
  return [
    `**${s.personaName}${who ? ` (${who})` : ""} ${STOPPED[s.outcome]}${where}.** ${said}`,
    environment ? "Part of it may be the test environment: see the end of the report." : "",
    shot ? `Start with the last screenshot, ${shotPath(shot)}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * The few things to look at first: agents the app seemingly stopped, in their own words, then the
 * blocker and major findings, those that stopped an agent first, each with what to do.
 */
export function renderFixFirst(sessions: Session[], findings: Finding[], needLabel: (s: Session) => string): string[] {
  const stopped = sessions.filter((s) => STOPPED[s.outcome]);
  const failed = new Set(stopped.map((s) => s.agentId));
  const caused = findings.filter((f) => f.sandboxCause);
  const serious = findings
    .filter((f) => !f.sandboxCause && f.confidence !== "low" && f.severity !== "minor")
    .map((f, order) => ({ f, order, stoppedSome: f.hitBy.some((id) => failed.has(id)) }))
    // Most severe first; within that, one an agent didn't get past.
    .sort((a, b) => RANK[a.f.severity] - RANK[b.f.severity] || Number(b.stoppedSome) - Number(a.stoppedSome) || a.order - b.order)
    .map(({ f }) => f);
  const reached = sessions.filter((s) => s.outcome === "success").length;
  const stops = stopped.slice(0, MAX_ITEMS).map((s) => stoppedItem(s, needLabel(s), caused.some((f) => f.hitBy.includes(s.agentId))));
  const fixes = serious.slice(0, MAX_ITEMS - stops.length).map((f) => `**${f.title}** (${f.severity}). ${nextStep(f)}`);
  const shown = [...stops, ...fixes];
  const rest = findings.filter((f) => !f.sandboxCause).length - fixes.length;
  return [
    `## Fix these first`,
    "",
    `${reached} of ${sessions.length} agents reached the goal.`,
    "",
    ...(shown.length
      ? shown.map((item, i) => `${i + 1}. ${item}`)
      : ["Nothing stopped an agent, and nothing serious was found."]),
    ...(rest > 0 ? ["", `${rest === 1 ? "One" : rest}${fixes.length ? " more" : ""} ${rest === 1 ? "finding is" : "findings are"} below.`] : []),
    "",
  ];
}
