import type { Page } from "playwright";

export interface SettleOptions {
  /** Longest wait for the network to go quiet (ms). */
  idleMs?: number;
  /** Longest extra wait while the page still says it is loading (ms). */
  busyMs?: number;
}

/**
 * Waits, as a person would, until the page has finished loading before it is read: the network
 * goes quiet, and no "Loading…" placeholder or aria-busy region is left. Client-rendered apps show
 * a spinner or an empty shell at DOMContentLoaded; on a slow connection agents otherwise judge (and
 * navigate away from) pages that were only still loading. Bounded, so a page that never settles
 * (polling, a stuck spinner) is read as it is.
 */
export async function settle(page: Page, o: SettleOptions = {}): Promise<void> {
  const { idleMs = 5_000, busyMs = 10_000 } = o;
  await page.waitForLoadState("networkidle", { timeout: idleMs }).catch(() => {});
  const deadline = Date.now() + busyMs;
  while (Date.now() < deadline) {
    const busy = await page
      .evaluate(() => {
        if (document.querySelector('[aria-busy="true"]')) return true;
        const text = (document.body?.innerText ?? "").trim();
        return text.length < 300 && /\b(loading|please wait)\b/i.test(text);
      })
      .catch(() => false);
    if (!busy) return;
    await page.waitForTimeout(500);
  }
}
