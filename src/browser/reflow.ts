import type { Page } from "playwright";
import type { ReflowCheck } from "../types";

// WCAG 1.4.10 Reflow: at 320 CSS pixels wide (a 1280-pixel screen zoomed to 400%) a page should
// read without scrolling sideways. Each page the low-vision agent arrives on is measured where it
// is: its window is narrowed to that width, measured and widened again before the agent looks.
// Nothing is requested twice, so no link or form is ever replayed to measure it.

export const REFLOW_WIDTH = 320;
const MAX_PAGES = 12;
/** Time for the page to lay itself out after each change of width. */
const LAYOUT_MS = 300;

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
  // Past the right edge, or on a right-to-left page past the left one. (A left-to-right page
  // can't scroll left, so menus parked off its left edge don't count.)
  const rtl = getComputedStyle(document.body).direction === 'rtl';
  let widest = null, furthest = 2;
  for (const el of document.body.querySelectorAll('*')) {
    const r = el.getBoundingClientRect();
    const out = rtl ? -r.left : r.right - view;
    if (r.width > 0 && out > furthest && !inScroller(el)) { widest = el; furthest = out; }
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

export class ReflowMeter {
  private readonly seen = new Set<string>();
  readonly checks: ReflowCheck[] = [];

  /** Measures the page the agent is on, the first time it arrives at each address. */
  async measure(page: Page): Promise<void> {
    const url = page.url().split("#")[0];
    const size = page.viewportSize();
    if (!size || !/^https?:/.test(url) || this.seen.has(url) || this.seen.size >= MAX_PAGES) return;
    this.seen.add(url);
    try {
      await page.setViewportSize({ width: REFLOW_WIDTH, height: size.height });
      await page.waitForTimeout(LAYOUT_MS);
      const measured = (await page.evaluate(MEASURE_SCRIPT)) as Omit<ReflowCheck, "url" | "widthPx">;
      this.checks.push({ url, widthPx: REFLOW_WIDTH, ...measured });
    } catch {
      // The page changed under the measurement: this one goes without it.
    } finally {
      await page.setViewportSize(size).catch(() => {});
      await page.waitForTimeout(LAYOUT_MS);
    }
  }
}
