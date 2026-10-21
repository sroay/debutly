import { COVERED } from "../browser/execute";
import type { BlockedCall } from "../sandbox/outbox";
import type { Confidence, Finding, FindingKind, Session, Severity, Signal, Step } from "../types";

const CRITICAL_PATH = /(sign-?up|sign-?in|log-?in|register|onboarding|auth|pricing|checkout|billing|payment|invite)/i;
const BASE_SEVERITY: Record<FindingKind, Severity> = {
  http_error: "minor",
  page_error: "major",
  console_error: "minor",
  a11y_unlabeled: "minor",
  stuck: "major",
  slow_load: "minor",
  covered: "major",
};
/** Clicks on one control that something else covered, in one session, before it is a finding. */
const COVERED_REPEATS = 2;
/** A page this slow, or one still not in when the agent stopped waiting, is a major finding. */
const VERY_SLOW_MS = 30_000;
// How an app says it lacks a key or setting. A test environment leaves every secret out on
// purpose, so there a server error saying this is the environment's doing, not a bug.
const MISSING_KEY = /no (?:ai |llm )?api[ _]?key|api[ _]?key (?:is )?(?:not set|missing)|no ai api configured|not configured|configure [a-z0-9_]*key\b/i;
const QUOTE_CHARS = 160;
const SEVERITY_RANK: Record<Severity, number> = { blocker: 0, major: 1, minor: 2 };
const CONFIDENCE_RANK: Record<Confidence, number> = { high: 0, medium: 1, low: 2 };
const STUCK_REPEATS = 3;
// Server and browser share a clock in a throwaway environment; allow for background work finishing late.
const SANDBOX_SLACK_MS = 2000;

const pathOf = (url: string) => {
  try {
    return new URL(url).pathname;
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
        detail: `${signal.slowNetwork ? "On a slow connection (500 kbit/s, 400 ms round trips, like weak mobile data)" : "On a normal connection"}, ${pagePath} ${signal.finished ? `took ${seconds} s before the page arrived` : `had not arrived after ${seconds} s, so the agent went on with whatever was on screen`}. Until then a visitor sees a blank or half-drawn page, and many leave.`,
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

/** What to call a control that has no name, or undefined when it doesn't need one. */
function unlabeledControl(role: string): string | undefined {
  return NAMED_CONTROLS[role];
}

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
  // it (it was blocking an outbound call at the time, or the app said a key was missing).
  const sandbox = new Map<string, { occurrences: number; explained: number; causes: Set<string> }>();

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
    for (const step of s.steps) {
      const pagePath = pathOf(step.observation.url);
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
          tally.occurrences++;
          if (hosts.length || missing) tally.explained++;
          for (const h of hosts) tally.causes.add(h);
          if (missing) tally.causes.add(`missing key: ${missing}`);
          sandbox.set(c.signature, tally);
        }
      }

      for (const el of step.observation.elements) {
        const control = el.name === "" ? unlabeledControl(el.role) : undefined;
        if (control) {
          record(
            {
              signature: `a11y:${pagePath}:${el.role}`,
              kind: "a11y_unlabeled",
              title: `Unlabeled ${control} on ${pagePath}`,
              detail: `A ${control} has no accessible name; screen-reader users cannot tell what it ${control === "button" || control === "link" ? "does" : "is for"}.`,
              pagePath,
              severity: severityFor("a11y_unlabeled", [pagePath]),
            },
            s.agentId,
            step.index,
          );
        }
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
  }

  const findings = [...found.values()].map((f) => {
    const pageVisitors = Math.max(visitors.get(f.pagePath)?.size ?? 0, f.hitBy.length);
    const tally = sandbox.get(f.signature);
    const sandboxCause = tally && tally.explained === tally.occurrences ? [...tally.causes].sort() : undefined;
    return { ...f, visitors: pageVisitors, confidence: confidenceFor(f.hitBy.length / pageVisitors), ...(sandboxCause ? { sandboxCause } : {}) };
  });

  return findings.sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || CONFIDENCE_RANK[a.confidence] - CONFIDENCE_RANK[b.confidence],
  );
}
