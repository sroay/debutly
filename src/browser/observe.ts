import type { Page } from "playwright";
import type { InteractiveElement, Observation } from "../types";
import { SCAN_SCRIPT } from "./scan-script";

export async function observe(page: Page): Promise<Observation> {
  const elements = (await page.evaluate(SCAN_SCRIPT)) as InteractiveElement[];
  const text = (await page.locator("body").innerText()).replace(/\s+/g, " ").trim().slice(0, 2000);
  return { url: page.url(), title: await page.title(), elements, text };
}
