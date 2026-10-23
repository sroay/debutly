import type { BrowserContext } from "playwright";
import type { ReflowCheck, Step } from "../types";
import { settle } from "./settle";

// WCAG 1.4.10 Reflow: at 320 CSS pixels wide (a 1280-pixel screen zoomed to 400%) a page should
// read without scrolling sideways. After the low-vision agent's run, each page it visited is
// opened again at that width, signed in as it was, and measured. Pages are only read.

export const REFLOW_WIDTH = 320;
const MAX_PAGES = 8;
// Links that do something when opened (confirm an email, accept an invite, sign out) are not
// opened twice.
const ONE_TIME = /token|code=|key=|signature|invite|confirm|verif|reset|callback|magic|logout|log-out|sign-?out|unsubscribe/i;

// The page's sideways overflow, and the element reaching furthest right outside any scrolling
// box. A string, like SCAN_SCRIPT: tsx injects helpers into functions the page lacks.
const MEASURE_SCRIPT = `(() => {
  const doc = document.documentElement;
  const view = doc.clientWidth;
  const overflowPx = Math.max(doc.scrollWidth, document.body ? document.body.scrollWidth : 0) - view;
  if (overflowPx <= 2) return { overflowPx: 0, widest: '', exception: '' };
  const inScroller = (el) => {
    for (let p = el.parentElement; p && p !== document.body && p !== doc; p = p.parentElement) {
      const x = getComputedStyle(p).overflowX;
      if (x !== 'visible') return true;
    }
    return false;
  };
  let widest = null, right = view + 2;
  for (const el of document.body.querySelectorAll('*')) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.right > right && !inScroller(el)) { widest = el; right = r.right; }
  }
  // WCAG lets content that needs two dimensions scroll: data tables, maps, diagrams, video, code.
  const twoD = widest && widest.closest('table, [role="grid"], [role="table"], pre, canvas, video, iframe, svg, map');
  const name = (el) => {
    const classes = typeof el.className === 'string' ? el.className.trim().split(/\\s+/).filter(Boolean).slice(0, 2) : [];
    const text = (el.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 50);
    return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + classes.map((c) => '.' + c).join('') + (text ? ' ("' + text + '")' : '');
  };
  return {
    overflowPx: Math.round(overflowPx),
    widest: widest ? name(widest) + ', ' + Math.round(widest.getBoundingClientRect().width) + ' px wide' : '',
    exception: twoD ? 'it is inside ' + (twoD.tagName === 'TABLE' || /grid|table/.test(twoD.getAttribute('role') || '') ? 'a data table' : 'a ' + twoD.tagName.toLowerCase()) + ', which may scroll' : '',
  };
})()`;

/** The pages to measure: each same-origin page the agent was on, once, leaving out one-time links. */
export function pagesToProbe(steps: Step[], origin: string): string[] {
  const pages: string[] = [];
  for (const step of steps) {
    let url: URL;
    try {
      url = new URL(step.observation.url);
    } catch {
      continue;
    }
    url.hash = "";
    if (url.origin !== new URL(origin).origin || ONE_TIME.test(url.pathname + url.search)) continue;
    if (!pages.includes(url.href)) pages.push(url.href);
    if (pages.length === MAX_PAGES) break;
  }
  return pages;
}

/** Opens each page at 320 CSS pixels wide in the agent's own browser context and measures it. */
export async function probeReflow(context: BrowserContext, urls: string[]): Promise<ReflowCheck[]> {
  if (!urls.length) return [];
  const page = await context.newPage();
  const checks: ReflowCheck[] = [];
  try {
    await page.setViewportSize({ width: REFLOW_WIDTH, height: 640 });
    for (const url of urls) {
      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
        await settle(page, { idleMs: 3_000, busyMs: 3_000 });
        const measured = (await page.evaluate(MEASURE_SCRIPT)) as Omit<ReflowCheck, "url" | "widthPx">;
        checks.push({ url, widthPx: REFLOW_WIDTH, ...measured });
      } catch {
        // A page that won't load again is left out, not reported.
      }
    }
  } finally {
    await page.close();
  }
  return checks;
}
