import { appendFileSync, mkdirSync } from "node:fs";
import type { Page } from "@playwright/test";

type Reader = {
  navigateToWebContent(): Promise<void>;
  press(key: string): Promise<void>;
  clearSpokenPhraseLog(): Promise<void>;
  spokenPhraseLog(): Promise<string[]>;
};

/**
 * What the screen reader says at each of the next `tabs` presses of Tab, from the top of the page:
 * one entry per press, the phrases joined. Each is also written to transcripts/<test>.txt for a
 * person to read.
 */
export async function hear(page: Page, reader: Reader, tabs: number, label = "page"): Promise<string[]> {
  await page.bringToFront();
  await reader.navigateToWebContent();
  const heard: string[] = [];
  for (let i = 0; i < tabs; i++) {
    await reader.clearSpokenPhraseLog();
    await reader.press("Tab");
    heard.push((await reader.spokenPhraseLog()).join(" ").trim());
  }
  mkdirSync("transcripts", { recursive: true });
  appendFileSync(`transcripts/${label}.txt`, `${page.url()}\n${heard.map((h, i) => `Tab ${i + 1}: ${h}`).join("\n")}\n\n`);
  return heard;
}
