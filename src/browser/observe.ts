import type { Page } from "playwright";
import type { InteractiveElement, Observation } from "../types";
import { accessibleNames } from "./ax";
import { SCAN_SCRIPT } from "./scan-script";

// The page's language and direction, and how much of its visible text is Arabic. A string, like
// SCAN_SCRIPT: tsx injects helpers into functions the page lacks.
const LANGUAGE_SCRIPT = `(() => {
  const text = (document.body && document.body.innerText) || '';
  const letters = (text.match(/\\p{L}/gu) || []).length;
  const arabic = (text.match(/\\p{Script=Arabic}/gu) || []).length;
  return {
    lang: document.documentElement.getAttribute('lang') || '',
    dir: document.body ? getComputedStyle(document.body).direction : 'ltr',
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
