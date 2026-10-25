import { COVERED, NOT_BY_KEYBOARD } from "../browser/execute";
import type { BlockedCall } from "../sandbox/outbox";
import type { Confidence, Finding, FindingKind, InclusionNeed, InteractiveElement, Observation, Session, Severity, Signal, Step } from "../types";
import { unlabeledCriteria } from "./wcag";

const CRITICAL_PATH = /(sign-?up|sign-?in|log-?in|register|onboarding|auth|pricing|checkout|billing|payment|invite)/i;
const BASE_SEVERITY: Record<FindingKind, Severity> = {
  http_error: "minor",
  page_error: "major",
  console_error: "minor",
  a11y_unlabeled: "minor",
  stuck: "major",
  slow_load: "minor",
  covered: "major",
  keyboard: "major",
  focus_obscured: "minor",
  reflow: "minor",
  language: "minor",
  zoom: "major",
};
// What the browser measures, not what an agent made of the page: one measurement is enough.
export const MEASURED: ReadonlySet<FindingKind> = new Set(["a11y_unlabeled", "covered", "keyboard", "focus_obscured", "reflow", "language", "zoom"]);
/** Sideways overflow this small is reported, but never raised above minor. */
const SLIGHT_OVERFLOW_PX = 20;
/** A page whose letters are at least this share Arabic is an Arabic page. */
const ARABIC_PAGE = 0.5;
/** Clicks on one control that something else covered, in one session, before it is a finding. */
const COVERED_REPEATS = 2;
/** A page this slow, or one still not in when the agent stopped waiting, is a major finding. */
const VERY_SLOW_MS = 30_000;
// How an app says it lacks a key or setting. A test environment leaves every secret out on
// purpose, so there a server error saying this is the environment's doing, not a bug.
// "No Gemini API key configured. Set GEMINI_API_KEY…" (2026-10-20) names the provider between
// "no" and "API key", and the variable it wants.
const MISSING_KEY =
  /no (?:[\w-]+ ){0,2}api[ _-]?key|api[ _-]?key (?:is )?(?:not set|missing|not configured|required)|no ai api configured|not configured|configure [a-z0-9_]*key\b|\bset [a-z0-9]+_[a-z0-9_]*key\b|\b[a-z0-9]+_api_key (?:is )?(?:not set|missing|undefined)/i;
// A web address typed in on its own, as an agent gives its company's site ("https://www.pulsehr.io/").
const TYPED_SITE = /^(?:https?:\/\/)?(?:www\.)?((?:[a-z0-9-]+\.)+[a-z]{2,})(?:[/?#]\S*)?$/i;
// How an app says it couldn't get at a site: "Could not read that website", "DNS lookup failed".
const UNREACHABLE =
  /\b(?:could ?n[o']t|cannot|can't|unable to|failed to) (?:read|reach|fetch|load|access|scrape|crawl|connect|resolve)\b|\bdns\b|enotfound|getaddrinfo|econnrefused|unreachable|timed? ?out\b/i;
const QUOTE_CHARS = 160;
const SEVERITY_RANK: Record<Severity, number> = { blocker: 0, major: 1, minor: 2 };
const CONFIDENCE_RANK: Record<Confidence, number> = { high: 0, medium: 1, low: 2 };
const STUCK_REPEATS = 3;
// Server and browser share a clock in a throwaway environment; allow for background work finishing late.
const SANDBOX_SLACK_MS = 2000;

// Pages that differ only by a record's id are one page: every new customer of one app landed on
// /app/accounts/<their account>/onboarding, which listed the same unlabeled button once per agent.
const ID_SEGMENT = /^(?:\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{16,}|(?=[a-z0-9]*\d)[a-z0-9]{20,})$/i;

const pathOf = (url: string) => {
  try {
    return new URL(url).pathname
      .split("/")
      .map((segment) => (ID_SEGMENT.test(segment) ? ":id" : segment))
      .join("/");
  } catch {
    return url;
  }
};

function severityFor(kind: FindingKind, paths: string[], status?: number): Severity {
  let severity: Severity = kind === "http_error" && status !== undefined && status >= 500 ? "major" : BASE_SEVERITY[kind];
  if (paths.some((p) => CRITICAL_PATH.test(p))) severity = severity === "minor" ? "major" : "blocker";
  return severity;
}

// Hits as a share of the agents that reached that page: 1 of 1 visitors is solid; 1 of 10 is likely agent error.
function confidenceFor(ratio: number): Confidence {
  if (ratio >= 0.5) return "high";
  if (ratio >= 0.25) return "medium";
  return "low";
}

interface Candidate {
  signature: string;
  kind: FindingKind;
  title: string;
  detail: string;
  pagePath: string;
  severity: Severity;
  wcag?: string[];
  control?: Finding["control"];
}

function fromSignal(signal: Signal): Candidate | null {
  const pagePath = pathOf(signal.url);
  switch (signal.kind) {
    case "http_error": {
      const target = pathOf(signal.requestUrl);
      if (target === "/favicon.ico") return null;
      return {
        signature: `http:${signal.status}:${target}`,
        kind: "http_error",
        title: `HTTP ${signal.status} from ${target}`,
        detail: `Request ${signal.requestUrl} returned ${signal.status} while on ${pagePath}.`,
        pagePath,
        severity: severityFor("http_error", [target, pagePath], signal.status),
      };
    }
    case "page_error":
      return {
        signature: `page:${pagePath}:${signal.message}`,
        kind: "page_error",
        title: `JavaScript error on ${pagePath}`,
        detail: signal.message,
        pagePath,
        severity: severityFor("page_error", [pagePath]),
      };
    case "console_error":
      // The browser echoes every failed request to the console; the http_error already covers it.
      if (signal.message.startsWith("Failed to load resource")) return null;
      return {
        signature: `console:${pagePath}:${signal.message.slice(0, 120)}`,
        kind: "console_error",
        title: `Console error on ${pagePath}`,
        detail: signal.message,
        pagePath,
        severity: severityFor("console_error", [pagePath]),
      };
    case "dialog":
    case "download":
      // An app asking a question, or handing over a file, is not a defect; the agent is told instead.
      return null;
    case "slow_load": {
      const seconds = Math.round(signal.ms / 1000);
      const connection = signal.slowNetwork ? " on a slow connection" : "";
      return {
        signature: `slow:${signal.slowNetwork ? "slow" : "normal"}:${pagePath}`,
        kind: "slow_load",
        title: signal.finished ? `${pagePath} took ${seconds} s to load${connection}` : `${pagePath} still hadn't loaded after ${seconds} s${connection}`,
        detail: `${signal.slowNetwork ? "On a slow connection (500 kbit/s, 400 ms round trips, like weak mobile data)" : "On a normal connection"}, ${pagePath} ${signal.finished ? `took ${seconds} s before the page arrived` : `had not arrived after ${seconds} s, so the agent went on with whatever was on screen`}. Until then a visitor sees a blank or half-drawn page, and many leave.${weightNote(signal.assets)}`,
        pagePath,
        severity: !signal.finished || signal.ms >= VERY_SLOW_MS ? "major" : BASE_SEVERITY.slow_load,
      };
    }
  }
}

// Controls that need a name, as people call them. Unlabeled radio buttons in one app's
// questionnaire went unreported: agents clicked them by position, again and again.
const NAMED_CONTROLS: Record<string, string> = {
  button: "button",
  link: "link",
  select: "dropdown",
  combobox: "dropdown",
  textarea: "text box",
  checkbox: "checkbox",
  radio: "radio button",
  switch: "switch",
  "input:radio": "radio button",
  "input:checkbox": "checkbox",
  "input:text": "text field",
  "input:email": "email field",
  "input:password": "password field",
  "input:number": "number field",
  "input:search": "search field",
  "input:tel": "phone field",
  "input:url": "web address field",
};

/** Said of a slow page whose scripts and styles came mostly uncompressed; the report's next step looks for it. */
export const UNCOMPRESSED = "came uncompressed";
const kb = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`);

// What the scripts and styles that had arrived weighed. Mostly uncompressed, it may be the test
// copy's doing (served straight from a container) rather than the real site's.
function weightNote(assets: Extract<Signal, { kind: "slow_load" }>["assets"]): string {
  if (!assets || assets.bytes < 100 * 1024) return "";
  if (assets.uncompressedBytes >= assets.bytes / 2) {
    return ` By then it had received ${kb(assets.bytes)} of scripts and styles, and ${kb(assets.uncompressedBytes)} of that ${UNCOMPRESSED}. Compressed (gzip or Brotli, which most hosting turns on), scripts are often a quarter of the size. If the real site compresses them, it is lighter than this test copy.`;
  }
  return ` By then it had received ${kb(assets.bytes)} of scripts and styles, compressed.`;
}

/** What to call a control that has no name, or undefined when it doesn't need one. */
function unlabeledControl(role: string): string | undefined {
  return NAMED_CONTROLS[role];
}

// Checked against what NVDA itself said on three open-source apps: an unnamed control Tab never
// reaches, or one a screen reader reads a description for, is a smaller problem than one a
// keyboard user lands on and hears only "button"; and a field named only by its placeholder
// (a password read as "13 bullet") was missed, because the browser counts a placeholder as a name.
type Unnamed = "unnamed" | "described" | "unreached" | "placeholder";
const MAX_PLACES = 3;

/** What's wrong with a control's name, as a screen reader meets it; undefined when nothing is. */
export function nameProblem(el: InteractiveElement): Unnamed | undefined {
  // The browser's own name when there is one (an icon named by its SVG title has a name
  // there); a control hidden from assistive technology isn't announced at all.
  if (el.ax?.hidden || !unlabeledControl(el.role)) return undefined;
  const name = el.ax ? el.ax.name : el.name;
  if (name === "") return el.ax?.description ? "described" : el.disabled || el.tabbable === false ? "unreached" : "unnamed";
  if (el.nameFrom === "placeholder" && el.role !== "input:search") return "placeholder";
  return undefined;
}

/** Where a control sits, by the named controls around it: 'after "Search..." and before "My Inbox"'. */
function placeOf(elements: InteractiveElement[], i: number): string {
  const nameAt = (j: number) => (elements[j].ax ? elements[j].ax!.name : elements[j].name);
  let before = "";
  for (let j = i - 1; j >= 0 && !before; j--) before = nameAt(j);
  let after = "";
  for (let j = i + 1; j < elements.length && !after; j++) after = nameAt(j);
  const q = (s: string) => `"${s.slice(0, 40)}"`;
  if (before && after) return `after ${q(before)} and before ${q(after)}`;
  if (before) return `after ${q(before)}`;
  return after ? `before ${q(after)}` : "";
}

/** One finding per page, kind of control and kind of problem, naming up to three places. */
function unnamedControls(elements: InteractiveElement[], pagePath: string): Candidate[] {
  const groups = new Map<string, { control: string; role: string; problem: Unnamed; places: string[]; said: string; count: number }>();
  elements.forEach((el, i) => {
    const problem = nameProblem(el);
    if (!problem) return;
    const control = unlabeledControl(el.role)!;
    const name = el.ax ? el.ax.name : el.name;
    const key = `${problem}:${el.role}`;
    const g = groups.get(key) ?? { control, role: el.role, problem, places: [] as string[], said: problem === "placeholder" ? name : (el.ax?.description ?? ""), count: 0 };
    g.count++;
    // The icon it shows, when its markup names one, is how a founder spots it on the page.
    const place = [el.icon ? `the ${el.icon} icon` : "", placeOf(elements, i)].filter(Boolean).join(" ");
    if (place && g.places.length < MAX_PLACES) g.places.push(place);
    groups.set(key, g);
  });
  return [...groups.values()].map((g) => {
    const where = g.places.length ? ` ${g.count > 1 ? `${g.count} of them, e.g. ` : "It is "}${g.places.join("; ")}.` : "";
    const does = g.control === "button" || g.control === "link" ? "does" : "is for";
    const an = /^[aeiou]/.test(g.control) ? "An" : "A";
    switch (g.problem) {
      case "unnamed":
        return {
          control: { role: g.role, problem: "unnamed" as const },
          signature: `a11y:${pagePath}:${g.role}`,
          kind: "a11y_unlabeled" as const,
          title: `Unlabeled ${g.control} on ${pagePath}`,
          detail: `${an} ${g.control} has no accessible name; screen-reader users cannot tell what it ${does}.${where}`,
          pagePath,
          severity: severityFor("a11y_unlabeled", [pagePath]),
          wcag: unlabeledCriteria(g.control),
        };
      case "described":
        return {
          control: { role: g.role, problem: "described" as const },
          signature: `a11y:described:${pagePath}:${g.role}`,
          kind: "a11y_unlabeled" as const,
          title: `${capitalize(g.control)} on ${pagePath} has a description but no name`,
          detail: `${an} ${g.control} has no accessible name, only a description ("${g.said.slice(0, 60)}"). A screen reader says "${g.control}" and then the description, so the purpose comes through, but the control itself is unnamed.${where}`,
          pagePath,
          severity: "minor" as const,
          wcag: ["4.1.2"],
        };
      case "unreached":
        return {
          control: { role: g.role, problem: "unreached" as const },
          signature: `a11y:unreached:${pagePath}:${g.role}`,
          kind: "a11y_unlabeled" as const,
          title: `Unlabeled ${g.control} on ${pagePath}, which Tab doesn't reach`,
          detail: `${an} ${g.control} has no accessible name, but it is disabled or outside the tab order, so a keyboard user never lands on it. A screen-reader user reading the page line by line still meets an unnamed ${g.control}.${where}`,
          pagePath,
          severity: "minor" as const,
          wcag: unlabeledCriteria(g.control),
        };
      case "placeholder":
        return {
          control: { role: g.role, problem: "placeholder" as const },
          signature: `a11y:placeholder:${pagePath}:${g.role}`,
          kind: "a11y_unlabeled" as const,
          title: `${capitalize(g.control)} on ${pagePath} is named only by its placeholder`,
          detail: `${an} ${g.control} has no label: a screen reader reads its placeholder ("${g.said.slice(0, 40)}") as its name${/^[•·*●]+$/.test(g.said) ? ", here as a count of bullets" : ""}, and the placeholder disappears once someone types, leaving nothing to say what the field is.${where}`,
          pagePath,
          severity: severityFor("a11y_unlabeled", [pagePath]),
          wcag: ["1.3.1", "3.3.2"],
        };
    }
  });
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** What a server error said, for quoting: its JSON `error` or `message` if it has one. */
function said(body: string): string {
  let text = body;
  try {
    const parsed = JSON.parse(body) as { error?: unknown; message?: unknown };
    const field = parsed.error ?? parsed.message;
    if (typeof field === "string") text = field;
  } catch {
    // not JSON: quote it as it is
  }
  text = text.replace(/\s+/g, " ").trim();
  return text.length > QUOTE_CHARS ? `${text.slice(0, QUOTE_CHARS)}…` : text;
}

/** In a test environment, the app's own words when a server error says a key is missing. */
function missingKey(signal: Signal, sandbox: boolean): string | undefined {
  if (!sandbox || signal.kind !== "http_error" || signal.status < 500 || !signal.body || !MISSING_KEY.test(signal.body)) return undefined;
  return said(signal.body);
}

/** The site an agent typed in for its company, which is made up like the company. */
function typedSite(step: Step): string | undefined {
  return step.action.type === "fill" ? step.action.text.trim().match(TYPED_SITE)?.[1]?.toLowerCase() : undefined;
}

/**
 * In a test environment, the made-up site a server error says it couldn't reach. The site doesn't
 * exist, or the environment won't let the app out to it; a real customer's would load.
 */
function madeUpSite(signal: Signal, sites: Set<string>, sandbox: boolean): string | undefined {
  if (!sandbox || signal.kind !== "http_error" || signal.status < 500 || !signal.body || !UNREACHABLE.test(signal.body)) return undefined;
  const body = signal.body.toLowerCase();
  return [...sites].find((site) => body.includes(site));
}

/**
 * What a page says about its language and direction. A missing lang is site-wide, so it is one
 * finding; Arabic marked as another language, or laid out left to right, is per page. Pages
 * recorded before these checks carry none of it and are skipped.
 */
function languageFindings(obs: Observation, pagePath: string): Candidate[] {
  if (obs.lang === undefined) return [];
  const out: Candidate[] = [];
  const arabic = (obs.arabicShare ?? 0) >= ARABIC_PAGE;
  if (arabic && obs.dir === "ltr") {
    out.push({
      signature: `dir:ltr:${pagePath}`,
      kind: "language",
      title: `${pagePath} shows Arabic text left to right`,
      detail: `Most of its text is Arabic, but the page is laid out left to right (no dir="rtl"), so alignment, punctuation and numbers come out in the wrong places for Arabic readers.`,
      pagePath,
      severity: "major",
    });
  }
  if (obs.lang === "") {
    out.push({
      signature: "lang:missing",
      kind: "language",
      title: `Pages don't say what language they're in`,
      detail: `The page's <html> element has no lang attribute (first seen on ${pagePath}), so a screen reader may read it with the wrong voice and pronunciation.`,
      pagePath,
      severity: BASE_SEVERITY.language,
      wcag: ["3.1.1"],
    });
  } else if (arabic && !/^ar(-|$)/i.test(obs.lang)) {
    out.push({
      signature: `lang:mismatch:${pagePath}`,
      kind: "language",
      title: `${pagePath} is in Arabic but says it is "${obs.lang}"`,
      detail: `Most of its text is Arabic but its lang attribute says "${obs.lang}", so a screen reader may read Arabic with the wrong voice.`,
      pagePath,
      severity: BASE_SEVERITY.language,
      wcag: ["3.1.1"],
    });
  }
  // Like a missing lang, a viewport setting is usually the same on every page: one finding.
  if (obs.zoomBlocked) {
    out.push({
      signature: "zoom:blocked",
      kind: "zoom",
      title: "Pages stop people zooming in",
      detail: `The page's viewport setting ("${obs.zoomBlocked}") stops pinch-zoom on phones and tablets (first seen on ${pagePath}), so someone with low vision can't enlarge the text. Remove user-scalable=no, and any maximum-scale under 2.`,
      pagePath,
      severity: BASE_SEVERITY.zoom,
      wcag: ["1.4.4"],
    });
  }
  return out;
}

// An address the agent made up that does not exist (e.g. /settings when the app has
// /dashboard/settings) is the agent's guess, not a broken link. Links from emails still count.
function guessedMissing(step: Step, signal: Signal): boolean {
  if (!step.guessedUrl || step.action.type !== "goto" || signal.kind !== "http_error" || signal.status !== 404) return false;
  try {
    return pathOf(new URL(step.action.path, signal.requestUrl).href) === pathOf(signal.requestUrl);
  } catch {
    return false;
  }
}

export interface DetectOptions {
  /** Outbound calls the test environment blocked; failures that coincide with them are attributed to it. */
  blocked?: BlockedCall[];
  /**
   * The run is against a test environment, which has none of the app's secret keys: server errors
   * saying a key is missing are attributed to it. Off against a real deployment, where the same
   * error is the app's bug.
   */
  sandbox?: boolean;
}

// Arabic input a form may refuse: digits as an Arabic phone keyboard types them (٠–٩, and the
// Persian/Urdu ۰–۹), and names in Arabic script. Gulf sign-up forms often reject both.
const ARABIC_DIGITS = /[٠-٩۰-۹]/;
const ARABIC_SCRIPT = /[ء-يٱ-ۓ]/;
const REFUSED_INPUT = new Set([400, 422]);

interface ArabicField {
  field: string;
  text: string;
  digits: boolean;
}

function arabicField(field: string, text: string): ArabicField | undefined {
  if (ARABIC_DIGITS.test(text)) return { field, text, digits: true };
  if (ARABIC_SCRIPT.test(text)) return { field, text, digits: false };
  return undefined;
}

/** "1 of the 2 agents who got this error had just typed Arabic-Indic digits into "Phone" ("٠٥٠…")…" */
function arabicInputNote(fields: ArabicField[], agents: number, refused: number): string {
  const quote = (f: ArabicField) => `"${f.field}" ("${f.text.slice(0, 40)}")`;
  const digits = fields.filter((f) => f.digits).map(quote);
  const script = fields.filter((f) => !f.digits).map(quote);
  const typed = [
    ...(digits.length ? [`Arabic-Indic digits into ${digits.join(" and ")}`] : []),
    ...(script.length ? [`Arabic script into ${script.join(" and ")}`] : []),
  ].join(" and ");
  const who = refused === 1 ? "The agent who got this error" : `${agents} of the ${refused} agents who got this error`;
  return ` ${who} had just typed ${typed}. People type this way on an Arabic keyboard. Check that the form accepts them, and converts the digits to 0–9 where it needs to.`;
}

function blockedDuring(signal: Signal, blocked: BlockedCall[]): string[] {
  if (signal.kind !== "http_error" || signal.startedAt === undefined || signal.at === undefined) return [];
  const from = signal.startedAt - SANDBOX_SLACK_MS;
  const to = signal.at + SANDBOX_SLACK_MS;
  return blocked.filter((b) => b.at >= from && b.at <= to).map((b) => b.host);
}

export function detectFindings(sessions: Session[], opts: DetectOptions = {}): Finding[] {
  const visitors = new Map<string, Set<string>>();
  const found = new Map<string, Finding>();
  // Per HTTP-error signature: how often it happened, and how often the test environment explains
  // it (it was blocking an outbound call at the time, the app said a key was missing, or it
  // couldn't reach the site the agent made up).
  const sandbox = new Map<string, { occurrences: number; explained: number; causes: Set<string> }>();
  // Per refused-request signature: the Arabic each agent had typed into the form just before.
  const arabicInput = new Map<string, Map<string, ArabicField[]>>();

  const record = (c: Candidate, agentId: string, stepIndex: number) => {
    let f = found.get(c.signature);
    if (!f) {
      f = { ...c, hitBy: [], visitors: 0, confidence: "low", evidence: [] };
      found.set(c.signature, f);
    }
    if (!f.hitBy.includes(agentId)) {
      f.hitBy.push(agentId);
      f.evidence.push({ agentId, stepIndex });
    }
  };

  for (const s of sessions) {
    let repeatKey = "";
    let repeats = 0;
    // Per control: how often a click on it was refused because another element lay on top.
    const covered = new Map<string, number>();
    // Websites this agent gave for its company so far.
    const sites = new Set<string>();
    // What the agent has typed into each field on the page it is on.
    let typedOn = "";
    const typed = new Map<string, string>();
    for (const step of s.steps) {
      const pagePath = pathOf(step.observation.url);
      const site = typedSite(step);
      if (site) sites.add(site);
      if (pagePath !== typedOn) {
        typed.clear();
        typedOn = pagePath;
      }
      if (step.action.type === "fill") {
        const id = step.action.id;
        const el = step.observation.elements.find((e) => e.id === id);
        typed.set(el?.ax?.name || el?.name || el?.role || `field ${id}`, step.action.text);
      }
      if (!visitors.has(pagePath)) visitors.set(pagePath, new Set());
      visitors.get(pagePath)!.add(s.agentId);

      for (const signal of step.signals) {
        if (guessedMissing(step, signal)) continue;
        const c = fromSignal(signal);
        if (!c) continue;
        record(c, s.agentId, step.index);
        if (c.kind === "http_error") {
          const tally = sandbox.get(c.signature) ?? { occurrences: 0, explained: 0, causes: new Set<string>() };
          const hosts = blockedDuring(signal, opts.blocked ?? []);
          const missing = missingKey(signal, opts.sandbox ?? false);
          const madeUp = madeUpSite(signal, sites, opts.sandbox ?? false);
          tally.occurrences++;
          if (hosts.length || missing || madeUp) tally.explained++;
          for (const h of hosts) tally.causes.add(h);
          if (missing) tally.causes.add(`missing key: ${missing}`);
          if (madeUp) tally.causes.add(`made-up site: ${madeUp}`);
          sandbox.set(c.signature, tally);
          const arabic = [...typed].map(([field, text]) => arabicField(field, text)).filter((f) => f !== undefined);
          if (signal.kind === "http_error" && REFUSED_INPUT.has(signal.status) && arabic.length) {
            const byAgent = arabicInput.get(c.signature) ?? new Map<string, ArabicField[]>();
            if (!byAgent.has(s.agentId)) byAgent.set(s.agentId, arabic);
            arabicInput.set(c.signature, byAgent);
          }
        }
      }

      for (const c of unnamedControls(step.observation.elements, pagePath)) record(c, s.agentId, step.index);

      for (const c of languageFindings(step.observation, pagePath)) record(c, s.agentId, step.index);

      // Keyboard only (the screen-reader agent): a control Tab never reaches, and focus that
      // something entirely hides.
      const acted = "id" in step.action ? step.observation.elements.find((e) => e.id === (step.action as { id: number }).id) : undefined;
      if (acted && step.error?.startsWith(NOT_BY_KEYBOARD)) {
        const control = `${acted.role} "${acted.name}"`;
        record(
          {
            signature: `keyboard:${pagePath}:${control}`,
            kind: "keyboard",
            title: `Can't reach ${control} on ${pagePath} with the keyboard`,
            control: { role: acted.role, name: acted.name, problem: "keyboard" },
            detail: `It isn't in the tab order, so someone who uses a keyboard or a screen reader can't get to it. A mouse can still click it.`,
            pagePath,
            severity: severityFor("keyboard", [pagePath]),
            wcag: ["2.1.1"],
          },
          s.agentId,
          step.index,
        );
      }
      // A button that takes Space but not Enter: most keyboard users press Enter, and stop there.
      if (acted && step.enterIgnored) {
        const control = `${acted.role} "${acted.ax?.name || acted.name}"`;
        record(
          {
            signature: `enter:${pagePath}:${control}`,
            kind: "keyboard",
            title: `Enter doesn't press ${control} on ${pagePath}`,
            detail: `With keyboard focus on it, Enter did nothing (no request, no change on the page), and Space pressed it. Buttons take both, and most keyboard and screen-reader users press Enter, so they get no further here.`,
            pagePath,
            severity: severityFor("keyboard", [pagePath]),
            wcag: ["2.1.1"],
          },
          s.agentId,
          step.index,
        );
      }
      if (acted && step.focusObscured) {
        const control = `${acted.role} "${acted.name}"`;
        record(
          {
            signature: `focus:${pagePath}:${control}`,
            kind: "focus_obscured",
            title: `Keyboard focus on ${control} on ${pagePath} is hidden`,
            detail: `With keyboard focus on it, it is entirely covered by ${step.focusObscured}, so someone using the keyboard can't see where they are.`,
            pagePath,
            severity: severityFor("focus_obscured", [pagePath]),
            wcag: ["2.4.11"],
          },
          s.agentId,
          step.index,
        );
      }

      // A control something else keeps covering: the person can't press it either. The agent
      // works round it in other ways (keys, closing things), so this is not always "stuck".
      const target = step.action.type === "click" && step.error?.startsWith(COVERED) ? step.observation.elements.find((e) => e.id === (step.action as { id: number }).id) : undefined;
      if (target) {
        const control = `${target.role} "${target.name}"`;
        const times = (covered.get(control) ?? 0) + 1;
        covered.set(control, times);
        if (times === COVERED_REPEATS) {
          const by = step.error!.slice(COVERED.length).replace(/^:\s*/, "");
          record(
            {
              signature: `covered:${pagePath}:${control}`,
              kind: "covered",
              title: `Can't click ${control} on ${pagePath}: something covers it`,
              detail: `Every click on the ${control} landed on another element${by ? ` (${by})` : ""} lying over it, so a person can't press it either.`,
              pagePath,
              severity: severityFor("covered", [pagePath]),
            },
            s.agentId,
            step.index,
          );
        }
      }

      const key = `${pagePath}|${JSON.stringify(step.action)}`;
      repeats = key === repeatKey ? repeats + 1 : 1;
      repeatKey = key;
      // Waiting while the app works ("Creating…") is patience, not going round in circles; an
      // agent waiting out an image upload was reported stuck.
      if (repeats === STUCK_REPEATS && step.action.type !== "done" && step.action.type !== "wait") {
        record(
          {
            signature: `stuck:${pagePath}`,
            kind: "stuck",
            title: `Agent stuck on ${pagePath}`,
            detail: `Repeated the same action ${STUCK_REPEATS} times without progress.`,
            pagePath,
            severity: severityFor("stuck", [pagePath]),
          },
          s.agentId,
          step.index,
        );
      }
    }

    // The low-vision agent's pages, measured again at 320 CSS pixels wide (WCAG 1.4.10).
    for (const check of s.reflow ?? []) {
      if (check.overflowPx <= 2) continue;
      const pagePath = pathOf(check.url);
      const lastVisit = [...s.steps].reverse().find((st) => st.observation.url.split("#")[0] === check.url) ?? s.steps.at(-1);
      record(
        {
          signature: `reflow:${pagePath}`,
          kind: "reflow",
          title: `${pagePath} scrolls sideways at ${check.widthPx} pixels wide`,
          detail: `At ${check.widthPx} CSS pixels wide (a 1280-pixel screen zoomed to 400%), the page is ${check.overflowPx < SLIGHT_OVERFLOW_PX ? `only ${check.overflowPx} px` : `${check.overflowPx} px`} wider than the window, so reading it means scrolling both ways.${check.widest ? ` Widest: ${check.widest}.` : ""}${check.exception ? ` It may be allowed: ${check.exception}.` : ""}`,
          pagePath,
          // A few pixels still scrolls, but hardly hides anything: not raised on critical pages.
          severity: check.overflowPx < SLIGHT_OVERFLOW_PX ? "minor" : severityFor("reflow", [pagePath]),
          wcag: ["1.4.10"],
        },
        s.agentId,
        lastVisit?.index ?? 0,
      );
    }
  }

  const needOf = new Map<string, InclusionNeed | undefined>(sessions.map((s) => [s.agentId, s.inclusion]));
  const findings = [...found.values()].map((f) => {
    const pageVisitors = Math.max(visitors.get(f.pagePath)?.size ?? 0, f.hitBy.length);
    const tally = sandbox.get(f.signature);
    const sandboxCause = tally && tally.explained === tally.occurrences ? [...tally.causes].sort() : undefined;
    const confidence = MEASURED.has(f.kind) ? "high" : confidenceFor(f.hitBy.length / pageVisitors);
    // Covered only for the agent at 200% zoom: the layout at that size is the problem.
    const wcag = f.kind === "covered" && f.hitBy.every((a) => needOf.get(a) === "low_vision") ? ["1.4.4", "1.4.10"] : f.wcag;
    const arabic = arabicInput.get(f.signature);
    const detail = arabic ? f.detail + arabicInputNote([...arabic.values()][0], arabic.size, f.hitBy.length) : f.detail;
    return { ...f, detail, visitors: pageVisitors, confidence, ...(sandboxCause ? { sandboxCause } : {}), ...(wcag ? { wcag } : {}) };
  });

  return findings.sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || CONFIDENCE_RANK[a.confidence] - CONFIDENCE_RANK[b.confidence],
  );
}
