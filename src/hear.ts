import { existsSync } from "node:fs";
import { appendFile, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Browser, Page } from "playwright";
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
  /** Tab presses per page at most; the walk stops sooner when focus comes round to the start. */
  tabs?: number;
  /** Opens the browser. A real screen reader needs a visible one in front. */
  launch: () => Promise<Browser>;
}

const ACTIVE_ID = `(() => { const el = document.activeElement; return el ? el.getAttribute('data-debutly-id') : null; })()`;
const BLUR = `(() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); })()`;
const SETTLE_MS = 2500;

// The words a screen reader adds about a control's role and state. What's left once they're
// gone is its name: nothing left means the control was announced without one.
const ROLE_AND_STATE =
  /\b(button|toggle button|menu button|link|visited|same page|current page|combo box|edit|multi line|blank|read only|protected|collapsed|expanded|has auto complete|editable|check box|not checked|half checked|checked|switch|on|off|radio button|sub ?menu|opens dialog|opens list|selected|clickable|unavailable|required|invalid entry|pressed|not pressed|section|grouping|region|landmark|navigation|main|form|list|with \d+ items|out of list|graphic|heading|level \d+|\d+ of \d+|text field|secure text field|text area|pop-?up button|dimmed)\b/gi;

/** True when nothing but role and state words was said. */
export function saidNoName(said: string): boolean {
  return said.replace(ROLE_AND_STATE, " ").replace(/[^\p{L}\p{N}]+/gu, "") === "";
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

/** Tab through the page from the top, noting what was said and which control had focus. */
async function tabThrough(page: Page, reader: ScreenReader, tabs: number): Promise<Stop[]> {
  await page.evaluate(BLUR);
  await reader.focus(page);
  await reader.said();
  const stops: Stop[] = [];
  let first: string | null = null;
  for (let i = 0; i < tabs; i++) {
    await reader.press("Tab");
    const said = await reader.said();
    const id = (await page.evaluate(ACTIVE_ID).catch(() => null)) as string | null;
    if (id !== null && id === first) break; // round to the start again
    if (first === null) first = id;
    stops.push({ id, said });
  }
  return stops;
}

function judge(f: Finding, page: string, elements: InteractiveElement[], stops: Stop[], readerName: string): Heard {
  const control = f.control!;
  const targets = elements.filter((el) => matches(control, el));
  const base = { title: f.title, page };
  if (!targets.length) return { ...base, verdict: "not on the page", said: [], note: "No such control was on the page when it was opened again." };
  const said = targets.map((t) => stops.find((s) => s.id === String(t.id))?.said).filter((s): s is string => s !== undefined);
  const presses = stops.length;
  switch (control.problem) {
    case "keyboard":
    case "unreached":
      return said.length
        ? { ...base, verdict: "not confirmed", said, note: `Tab did reach it: ${readerName} said "${said[0]}".` }
        : { ...base, verdict: "confirmed", said, note: `Tab never reached it in ${presses} presses.` };
    case "unnamed":
      if (!said.length) return { ...base, verdict: "not confirmed", said, note: `Tab never reached it in ${presses} presses; a screen-reader user meets it only reading line by line.` };
      return said.some(saidNoName)
        ? { ...base, verdict: "confirmed", said, note: `${readerName} said "${said.find(saidNoName)}", with no name.` }
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
      const state = o.browserStateDir ? join(o.browserStateDir, `${visit.agentId}.json`) : undefined;
      const context = await browser.newContext(state && existsSync(state) ? { storageState: state } : {});
      const page = await context.newPage();
      const path = new URL(visit.url).pathname;
      try {
        await page.goto(visit.url);
        await page.waitForTimeout(SETTLE_MS);
        if (new URL(page.url()).pathname !== path) {
          const note = `Opening ${path} led to ${new URL(page.url()).pathname}${state && existsSync(state) ? "" : "; keep the agents' browser state with debutly run --browser-state <dir> to open pages behind sign-in"}.`;
          for (const f of visit.findings) heard.push({ title: f.title, page: path, verdict: "not on the page", said: [], note });
          continue;
        }
        const elements = (await page.evaluate(SCAN_SCRIPT)) as InteractiveElement[];
        const names = await accessibleNames(page);
        if (names) for (const el of elements) if (names.get(el.id)) el.ax = names.get(el.id);
        const stops = await tabThrough(page, o.reader, o.tabs ?? 60);
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
    `${readerName} went through each page with a screen-reader finding, pressing Tab from the top. "Confirmed" means it said what the finding says; "check by ear" means a person should judge what it said.`,
    "",
    `${count("confirmed")} confirmed, ${count("not confirmed")} not confirmed, ${count("check by ear")} to check by ear, ${count("not on the page")} not on the page when opened again.`,
    "",
    ...heard.map((h) => `- **${h.verdict}**: ${h.title}. ${h.note}`),
    "",
  ];
  return lines.join("\n");
}
