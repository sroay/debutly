import type { Page } from "playwright";
import type { InteractiveElement, Observation } from "../types";
import { accessibleNames } from "./ax";
import { SCAN_SCRIPT } from "./scan-script";

// The page's language and direction, and how much of its visible text is Arabic. A string, like
// SCAN_SCRIPT: tsx injects helpers into functions the page lacks.
// The direction is the one the page's Arabic is laid out in, which an app may set on its own
// container rather than on <body>: an app that did was reported as showing Arabic left to right.
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
  return {
    lang: document.documentElement.getAttribute('lang') || '',
    dir,
    arabicShare: letters ? Math.round((arabic / letters) * 100) / 100 : 0,
  };
})()`;

export async function observe(page: Page): Promise<Observation> {
  const elements = (await page.evaluate(SCAN_SCRIPT)) as InteractiveElement[];
  const names = await accessibleNames(page);
  if (names) for (const el of elements) {
    const ax = names.get(el.id);
    if (ax) el.ax = ax;
  }
  const text = (await page.locator("body").innerText()).replace(/\s+/g, " ").trim().slice(0, 2000);
  const language = (await page.evaluate(LANGUAGE_SCRIPT)) as Pick<Observation, "lang" | "dir" | "arabicShare">;
  return { url: page.url(), title: await page.title(), elements, text, ...language };
}
