import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import type { Browser, Page } from "playwright";
import { observe } from "../browser/observe";
import type { Session } from "../types";

export type ExhibitKind = "landing" | "pricing" | "signup" | "onboarding" | "dashboard" | "checkout" | "pitch" | "other";

/** What an evaluator is shown: a page (or pitch) as copy and controls, no browser needed. */
export interface Exhibit {
  id: string;
  kind: ExhibitKind;
  title: string;
  url?: string;
  text: string;
  elements: string[];
}

// Pages most telling for a buying decision come first when exhibits are capped.
const PRIORITY: ExhibitKind[] = ["pricing", "landing", "signup", "onboarding", "checkout", "dashboard", "pitch", "other"];
const MAX_TEXT = 8000;

const pathOf = (url: string) => {
  try {
    return new URL(url).pathname.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
};

export function kindOf(url: string, title: string, text: string): ExhibitKind {
  const path = pathOf(url);
  const words = `${title} ${text.slice(0, 1500)}`.toLowerCase();
  if (/\/(pricing|plans?|price)(\/|$)/.test(path) || /per month|\/mo(nth)?\b|billed (monthly|annually)/.test(words)) return "pricing";
  if (/\/(sign-?up|register|join|get-started|start)(\/|$)/.test(path)) return "signup";
  if (/\/(checkout|billing\/checkout|upgrade)(\/|$)/.test(path)) return "checkout";
  if (/\/(onboarding|welcome|setup)(\/|$)/.test(path)) return "onboarding";
  if (/\/(dashboard|app|home)(\/|$)/.test(path)) return "dashboard";
  if (path === "/" || path === "") return "landing";
  return "other";
}

const byPriority = (a: Exhibit, b: Exhibit) => PRIORITY.indexOf(a.kind) - PRIORITY.indexOf(b.kind);

/** The last snapshot of each page the depth agents saw, key pages first. */
export function exhibitsFromSessions(sessions: Session[], max = 8): Exhibit[] {
  const latest = new Map<string, Exhibit>();
  for (const s of sessions) {
    for (const step of s.steps) {
      const o = step.observation;
      const path = pathOf(o.url);
      latest.set(path, {
        id: path,
        kind: kindOf(o.url, o.title, o.text),
        title: o.title,
        url: o.url,
        text: o.text,
        elements: o.elements.filter((e) => e.name).map((e) => `${e.role}: ${e.name}`),
      });
    }
  }
  return [...latest.values()].sort(byPriority).slice(0, max);
}

/**
 * A person reading a pricing page opens the FAQ; answers hidden in accordions would otherwise
 * read as unanswered questions. Opens <details> and question-shaped collapsed buttons only.
 */
async function openFaqAnswers(page: Page): Promise<void> {
  await page.evaluate(() => document.querySelectorAll("details").forEach((d) => (d.open = true)));
  const questions = page.locator('button[aria-expanded="false"]').filter({ hasText: /\?\s*$/ });
  const n = Math.min(await questions.count(), 30);
  for (let i = 0; i < n; i++) await questions.nth(i).click({ timeout: 1000 }).catch(() => {});
  if (n) await page.waitForTimeout(300);
}

/** Visits each URL and reads it: nothing is typed or submitted; only FAQ answers are opened. */
export async function captureExhibits(browser: Browser, urls: string[]): Promise<Exhibit[]> {
  const context = await browser.newContext();
  try {
    const out: Exhibit[] = [];
    for (const url of urls) {
      const page = await context.newPage();
      await page.goto(url, { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
      await openFaqAnswers(page);
      const o = await observe(page);
      const text = (await page.locator("body").innerText()).replace(/\s+/g, " ").trim().slice(0, MAX_TEXT);
      out.push({
        id: pathOf(o.url) || url,
        kind: kindOf(o.url, o.title, text),
        title: o.title,
        url: o.url,
        text,
        elements: o.elements.filter((e) => e.name).map((e) => `${e.role}: ${e.name}`),
      });
      await page.close();
    }
    return out;
  } finally {
    await context.close();
  }
}

/**
 * An idea-stage artifact or variant: a pitch, pricing sketch or copy draft as text, read as a
 * buyer would see it (HTML comments are authors' notes and are dropped).
 */
export async function exhibitFromFile(path: string): Promise<Exhibit> {
  const text = (await readFile(path, "utf8")).replace(/<!--[\s\S]*?-->/g, "").trim().slice(0, MAX_TEXT);
  const name = basename(path);
  const heading = text.match(/^#\s+(.+)$/m)?.[1]?.trim();
  const kind = kindOf("file", heading ?? name, text);
  return { id: name, kind: kind === "other" ? "pitch" : kind, title: heading ?? name, text, elements: [] };
}

/** Exhibits as prompt text. */
export function renderExhibits(exhibits: Exhibit[]): string {
  return exhibits
    .map(
      (e) =>
        `### Exhibit ${e.id} (${e.kind})${e.url ? ` ${e.url}` : ""}\nTitle: ${e.title}\n${e.elements.length ? `Controls: ${e.elements.slice(0, 40).join("; ")}\n` : ""}Copy:\n${e.text}`,
    )
    .join("\n\n");
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\/+$/, "") || "/";

/** Evaluators name pages loosely ("landing", "/pricing/", a full URL, the title); map that back to an exhibit id. */
export function canonicalExhibitId(ref: string | undefined, exhibits: Exhibit[]): string | undefined {
  if (!ref) return undefined;
  const r = norm(ref);
  const path = (() => {
    try {
      return norm(new URL(ref).pathname);
    } catch {
      return r;
    }
  })();
  const hit =
    exhibits.find((e) => norm(e.id) === r || norm(e.id) === path) ??
    exhibits.find((e) => e.url && (norm(e.url) === r || norm(pathOf(e.url)) === path)) ??
    exhibits.find((e) => e.kind === r) ??
    exhibits.find((e) => norm(e.title) === r);
  return hit?.id;
}
