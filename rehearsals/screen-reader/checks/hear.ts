import { appendFileSync, mkdirSync } from "node:fs";
import type { Page } from "@playwright/test";

type Nvda = {
  navigateToWebContent(): Promise<void>;
  press(key: string): Promise<void>;
  clearSpokenPhraseLog(): Promise<void>;
  spokenPhraseLog(): Promise<string[]>;
};

/**
 * What NVDA says at each of the next `tabs` presses of Tab, from the top of the page: one entry
 * per press, the phrases joined. Each is also written to transcripts/<test>.txt for a person to read.
 */
export async function hear(page: Page, nvda: Nvda, tabs: number, label = "page"): Promise<string[]> {
  await page.bringToFront();
  await nvda.navigateToWebContent();
  const heard: string[] = [];
  for (let i = 0; i < tabs; i++) {
    await nvda.clearSpokenPhraseLog();
    await nvda.press("Tab");
    heard.push((await nvda.spokenPhraseLog()).join(" ").trim());
  }
  mkdirSync("transcripts", { recursive: true });
  appendFileSync(`transcripts/${label}.txt`, `${page.url()}\n${heard.map((h, i) => `Tab ${i + 1}: ${h}`).join("\n")}\n\n`);
  return heard;
}
