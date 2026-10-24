import { existsSync } from "node:fs";
import { appendFile, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Browser, BrowserContext, Page } from "playwright";
import { accessibleNames } from "./browser/ax";
import { SCAN_SCRIPT } from "./browser/scan-script";
import { nameProblem } from "./detect/findings";
import type { Finding, InteractiveElement, Session } from "./types";

// `debutly hear`: a run's screen-reader findings, checked with a real screen reader. Each page a
// finding is about is opened again (signed in, with the agent's kept browser state), the screen
// reader is put on it, and Tab is pressed through it. Debutly knows which control has focus at
// each press, so it can say what the screen reader said for the very control a finding is about.
// Checked by hand against NVDA on three open-source apps first, where about a third of
// unnamed-control findings didn't hold up: this is how a report can tell those apart.

/** What Debutly needs from a screen reader: NVDA through Guidepup, or a stand-in in tests. */
export interface ScreenReader {
  /** e.g. "NVDA 2026.2" */
  name: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  /** Puts the screen reader on the page, ready for Tab. */
  focus(page: Page): Promise<void>;
  press(key: string): Promise<void>;
  /** What it has said since the last call. */
  said(): Promise<string>;
}

export type Verdict = "confirmed" | "not confirmed" | "check by ear" | "not on the page";

export interface Heard {
  title: string;
  page: string;
  verdict: Verdict;
  /** What the screen reader said on reaching each such control; empty when Tab never reached one. */
  said: string[];
  note: string;
}

export interface HearOptions {
  reportDir: string;
  reader: ScreenReader;
  /** Where `debutly run --browser-state` kept each agent's browser, to open pages behind sign-in. */
  browserStateDir?: string;
  /** Tab presses per page at most; the walk stops sooner, once focus has come round twice. */
  tabs?: number;
  /** Opens the browser. A real screen reader needs a visible one in front. */
  launch: () => Promise<Browser>;
}

const ACTIVE_ID = `(() => { const el = document.activeElement; return el ? el.getAttribute('data-debutly-id') : null; })()`;
const BLUR = `(() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); })()`;
const SETTLE_MS = 2500;

// The words a screen reader adds about a control's role and state, NVDA's and VoiceOver's. What's
// left once they're gone is its name: nothing left means the control was announced without one.
// Longest first, so "edit text" goes as a whole before "edit" would.
const ROLE_AND_STATE_WORDS = [
  // NVDA
  "button", "toggle button", "menu button", "link", "visited", "same page", "current page", "combo box", "edit",
  "multi line", "blank", "read only", "protected", "collapsed", "expanded", "has auto complete", "editable",
  "check box", "not checked", "half checked", "checked", "switch", "on", "off", "radio button", "sub ?menu",
  "opens dialog", "opens list", "selected", "clickable", "unavailable", "required", "invalid entry", "pressed",
  "not pressed", "section", "grouping", "region", "landmark", "navigation", "main", "form", "list",
  "with \\d+ items", "out of list", "graphic", "heading", "level \\d+", "\\d+ of \\d+",
  // VoiceOver
  "text field", "secure text field", "text area", "pop[- ]?up button", "dimmed", "edit text", "secure edit text",
  "unchecked", "group", "web content", "has keyboard focus", "image", "invalid data", "you are currently on an?",
];
const ROLE_AND_STATE = new RegExp(`\\b(${[...ROLE_AND_STATE_WORDS].sort((a, b) => b.length - a.length).join("|")})\\b`, "gi");

/** True when a role was said with nothing but state words around it: silence isn't "no name". */
export function saidNoName(said: string): boolean {
  return /[\p{L}\p{N}]/u.test(said) && said.replace(ROLE_AND_STATE, " ").replace(/[^\p{L}\p{N}]+/gu, "") === "";
}

export interface SpeechLog {
  spokenPhraseLog(): Promise<string[]>;
  clearSpokenPhraseLog(): Promise<void>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * What a screen reader says after a key press: it waits for speech to start (VoiceOver can take
 * a second, and what it says late was being credited to the next control), then for a pause.
 */
export async function nextUtterance(log: SpeechLog, { startWithinMs = 2500, pauseMs = 500, stepMs = 100 } = {}): Promise<string> {
  const parts: string[] = [];
  const take = async () => {
    const said = await log.spokenPhraseLog();
    if (said.length) await log.clearSpokenPhraseLog();
    return said;
  };
  for (let waited = 0; waited < startWithinMs && !parts.length; waited += stepMs) {
    await sleep(stepMs);
    parts.push(...(await take()));
  }
  for (let quiet = 0; parts.length && quiet < pauseMs && parts.length < 30; ) {
    await sleep(stepMs);
    const said = await take();
    parts.push(...said);
    quiet = said.length ? 0 : quiet + stepMs;
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

/** How a screen reader says a placeholder: "john@doe.com" as "john at doe dot com", dots as "13 bullet". */
export function spoken(text: string): string {
  return text
    .replace(/[•●·*]{2,}/g, (dots) => ` ${dots.length} bullet `)
    .replace(/@/g, " at ")
    .replace(/\./g, " dot ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .toLowerCase();
}

// The same reading of a control as the finding's, so only controls with that very problem count.
const matches = (control: NonNullable<Finding["control"]>, el: InteractiveElement): boolean =>
  el.role === control.role && (control.problem === "keyboard" ? el.name === control.name : nameProblem(el) === control.problem);

interface Stop {
  id: string | null;
  said: string;
}

/**
 * Tab through the page from the top, twice round, noting which control had focus and everything
 * said while it did. Arriving on a page, NVDA can say only where focus went ("form landmark",
 * "Chatwoot, document") and not name the first field; on the way round again it does.
 */
async function tabThrough(page: Page, reader: ScreenReader, tabs: number): Promise<Stop[]> {
  await page.evaluate(BLUR);
  await reader.focus(page);
  await reader.said();
  const stops: Stop[] = [];
  let first: string | null = null;
  let arrivals = 0;
  let previousId: string | null | undefined;
  for (let i = 0; i < tabs; i++) {
    await reader.press("Tab");
    const said = await reader.said();
    const id = (await page.evaluate(ACTIVE_ID).catch(() => null)) as string | null;
    if (id !== null && id === first && previousId !== first && ++arrivals === 2) break; // round twice
    if (first === null) first = id;
    previousId = id;
    const known = id === null ? undefined : stops.find((s) => s.id === id);
    if (known) {
      if (said && !known.said.includes(said)) known.said = `${known.said} ${said}`.trim();
    }
    else stops.push({ id, said });
  }
  return stops;
}

const FOCUS = (id: string) => `(() => { const el = document.querySelector('[data-debutly-id="${id}"]'); if (el) el.focus(); })()`;

/**
 * What the screen reader says about each control a finding is about, heard again on its own: focus
 * moves to another control on the page and back, as Shift+Tab would. On the walk, a field reached
 * from the browser's toolbar was announced only as where focus went ("Chatwoot, document", "form
 * landmark"), and VoiceOver could still be speaking about one control when focus reached the next.
 * Tab still decides what can be reached; this decides what is said about it.
 */
async function hearAgain(page: Page, reader: ScreenReader, stops: Stop[], ids: Set<string>): Promise<void> {
  for (const [i, stop] of stops.entries()) {
    if (stop.id === null || !ids.has(stop.id)) continue;
    const neighbour = [...stops.slice(i + 1), ...stops.slice(0, i).reverse()].find((s) => s.id !== null && s.id !== stop.id);
    if (!neighbour) continue;
    await page.evaluate(FOCUS(neighbour.id!));
    await reader.said();
    await page.evaluate(FOCUS(stop.id));
    const said = await reader.said();
    if (said) stop.said = said;
  }
}

function judge(f: Finding, page: string, elements: InteractiveElement[], stops: Stop[], readerName: string): Heard {
  const control = f.control!;
  const targets = elements.filter((el) => matches(control, el));
  const base = { title: f.title, page };
  if (!targets.length) return { ...base, verdict: "not on the page", said: [], note: "No such control was on the page when it was opened again." };
  const reached = targets
    .map((t) => ({ t, said: stops.find((s) => s.id === String(t.id))?.said }))
    .filter((r): r is { t: InteractiveElement; said: string } => r.said !== undefined);
  const said = reached.map((r) => r.said);
  // A dropdown announces its current choice ("combo box, English (en)"): that is its value, not a name.
  const nameless = reached.find((r) => saidNoName(r.t.value ? r.said.split(r.t.value).join(" ") : r.said));
  const presses = stops.length;
  switch (control.problem) {
    case "keyboard":
    case "unreached":
      return said.length
        ? { ...base, verdict: "not confirmed", said, note: `Tab did reach it: ${readerName} said "${said[0]}".` }
        : { ...base, verdict: "confirmed", said, note: `Tab never reached it in ${presses} presses.` };
    case "unnamed":
      if (!said.length) return { ...base, verdict: "not confirmed", said, note: `Tab never reached it in ${presses} presses; a screen-reader user meets it only reading line by line.` };
      return nameless
        ? { ...base, verdict: "confirmed", said, note: `${readerName} said "${nameless.said}", with no name.` }
        : { ...base, verdict: "check by ear", said, note: `${readerName} said "${said[0]}".` };
    case "described":
      return said.length
        ? { ...base, verdict: "check by ear", said, note: `${readerName} said "${said[0]}": a description after the role, but no name.` }
        : { ...base, verdict: "not confirmed", said, note: `Tab never reached it in ${presses} presses.` };
    case "placeholder": {
      if (!said.length) return { ...base, verdict: "not confirmed", said, note: `Tab never reached it in ${presses} presses.` };
      const placeholders = targets.map((t) => spoken(t.name)).filter(Boolean);
      const hit = said.find((s) => placeholders.some((p) => spoken(s).includes(p)));
      return hit
        ? { ...base, verdict: "confirmed", said, note: `${readerName} named it by its placeholder: "${hit}".` }
        : { ...base, verdict: "check by ear", said, note: `${readerName} said "${said[0]}".` };
    }
  }
}

/** Hears each screen-reader finding of a run, and adds what was heard to its report. */
export async function hearFindings(o: HearOptions): Promise<Heard[]> {
  const findings = JSON.parse(await readFile(join(o.reportDir, "findings.json"), "utf8")) as Finding[];
  const sessions = JSON.parse(await readFile(join(o.reportDir, "sessions.json"), "utf8")) as Session[];
  // One visit per page and agent: the agent whose browser state opens it signed in.
  const visits = new Map<string, { agentId: string; url: string; findings: Finding[] }>();
  for (const f of findings) {
    if (!f.control) continue;
    const e = f.evidence[0];
    const step = sessions.find((s) => s.agentId === e?.agentId)?.steps.find((st) => st.index === e.stepIndex);
    if (!step) continue;
    const key = `${e.agentId} ${step.observation.url}`;
    const visit = visits.get(key) ?? { agentId: e.agentId, url: step.observation.url, findings: [] };
    visit.findings.push(f);
    visits.set(key, visit);
  }
  const heard: Heard[] = [];
  if (!visits.size) return heard;

  const browser = await o.launch();
  await o.reader.start();
  try {
    for (const visit of visits.values()) {
      const path = new URL(visit.url).pathname;
      const stateFile = o.browserStateDir ? join(o.browserStateDir, `${visit.agentId}.json`) : undefined;
      const state = stateFile && existsSync(stateFile) ? stateFile : undefined;
      // Signed in first, as the agent ended; a page from before sign-in (sign-up, log in) sends a
      // signed-in browser on, so it is opened again signed out.
      const tries = state ? [state, undefined] : [undefined];
      const landed: string[] = [];
      let context: BrowserContext | undefined;
      let page: Page | undefined;
      for (const tryState of tries) {
        context = await browser.newContext(tryState ? { storageState: tryState } : {});
        page = await context.newPage();
        await page.goto(visit.url).catch(() => {});
        await page.waitForTimeout(SETTLE_MS);
        if (new URL(page.url()).pathname === path) break;
        landed.push(new URL(page.url()).pathname);
        await context.close();
        context = undefined;
      }
      if (!context || !page) {
        const note = state
          ? `Opening ${path} led to ${landed[0]} signed in and to ${landed[1]} signed out: it may be a step shown only once, such as set-up after sign-up.`
          : `Opening ${path} led to ${landed[0]}; keep the agents' browser state with debutly run --browser-state <dir> to open pages behind sign-in.`;
        for (const f of visit.findings) heard.push({ title: f.title, page: path, verdict: "not on the page", said: [], note });
        continue;
      }
      try {
        const elements = (await page.evaluate(SCAN_SCRIPT)) as InteractiveElement[];
        const names = await accessibleNames(page);
        if (names) for (const el of elements) if (names.get(el.id)) el.ax = names.get(el.id);
        const stops = await tabThrough(page, o.reader, o.tabs ?? 120);
        const ids = new Set(visit.findings.flatMap((f) => elements.filter((el) => matches(f.control!, el)).map((el) => String(el.id))));
        await hearAgain(page, o.reader, stops, ids);
        for (const f of visit.findings) heard.push(judge(f, path, elements, stops, o.reader.name.split(" ")[0]));
      } finally {
        await context.close();
      }
    }
  } finally {
    await o.reader.stop().catch(() => {});
    await browser.close();
  }

  await writeFile(join(o.reportDir, "heard.json"), JSON.stringify({ reader: o.reader.name, heard }, null, 2));
  await appendFile(join(o.reportDir, "report.md"), renderHeard(o.reader.name, heard));
  return heard;
}

export function renderHeard(readerName: string, heard: Heard[]): string {
  const count = (v: Verdict) => heard.filter((h) => h.verdict === v).length;
  const lines = [
    "",
    "## Heard with a screen reader",
    "",
    `${readerName} went through each page with a screen-reader finding, pressing Tab from the top until it had been round twice. "Confirmed" means it said what the finding says; "check by ear" means a person should judge what it said.`,
    "",
    `${count("confirmed")} confirmed, ${count("not confirmed")} not confirmed, ${count("check by ear")} to check by ear, ${count("not on the page")} not on the page when opened again.`,
    "",
    ...heard.map((h) => `- **${h.verdict}**: ${h.title}. ${h.note}`),
    "",
  ];
  return lines.join("\n");
}
