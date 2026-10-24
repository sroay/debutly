import type { Page } from "playwright";
import type { InteractiveElement, Observation } from "../types";
import { accessibleNames } from "./ax";
import { SCAN_SCRIPT } from "./scan-script";

// The page's language, how much of its visible text is Arabic and the direction that Arabic is
// laid out in, and whether it lets people zoom. The direction is measured where the Arabic is, as
// an app may turn its own container right to left rather than <body>: one that did was reported
// as showing Arabic left to right. A string, like SCAN_SCRIPT: tsx injects helpers into functions
// the page lacks.
const LANGUAGE_SCRIPT = `(() => {
  const body = document.body;
  const text = (body && body.innerText) || '';
  const letters = (text.match(/\\p{L}/gu) || []).length;
  const arabic = (text.match(/\\p{Script=Arabic}/gu) || []).length;
  let dir = body ? getComputedStyle(body).direction : 'ltr';
  if (arabic && body) {
    let rtl = 0, ltr = 0;
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(), seen = 0; node && seen < 5000; node = walker.nextNode(), seen++) {
      const count = (node.nodeValue.match(/\\p{Script=Arabic}/gu) || []).length;
      if (!count || !node.parentElement) continue;
      if (getComputedStyle(node.parentElement).direction === 'rtl') rtl += count;
      else ltr += count;
    }
    if (rtl + ltr) dir = rtl >= ltr ? 'rtl' : 'ltr';
  }
  // Pinch-zoom, which people with low vision rely on on phones (WCAG 1.4.4 asks for 200%).
  const meta = document.querySelector('meta[name="viewport"]');
  const viewport = meta ? meta.getAttribute('content') || '' : '';
  const setting = {};
  for (const part of viewport.split(/[,;]/)) {
    const [key, value] = part.split('=').map((s) => s.trim().toLowerCase());
    if (key) setting[key] = value || '';
  }
  const noScaling = setting['user-scalable'] === 'no' || setting['user-scalable'] === '0';
  const maxScale = parseFloat(setting['maximum-scale']);
  return {
    lang: document.documentElement.getAttribute('lang') || '',
    dir,
    arabicShare: letters ? Math.round((arabic / letters) * 100) / 100 : 0,
    zoomBlocked: noScaling || maxScale < 2 ? viewport : '',
  };
})()`;

export async function observe(page: Page): Promise<Observation> {
  const elements = (await page.evaluate(SCAN_SCRIPT)) as InteractiveElement[];
  const names = await accessibleNames(page);
  if (names) for (const el of elements) {
    const ax = names.get(el.id);
    if (ax) el.ax = ax;
  }
  // Line by line, as it reads on screen, so what changed after an action can be told line by line.
  const text = (await page.locator("body").innerText())
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .slice(0, 2000);
  const language = (await page.evaluate(LANGUAGE_SCRIPT)) as Pick<Observation, "lang" | "dir" | "arabicShare" | "zoomBlocked">;
  return { url: page.url(), title: await page.title(), elements, text, ...language };
}
