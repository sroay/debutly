import type { Page } from "@playwright/test";

/**
 * Goes through an app's set-up screens as a sighted person would: fills empty text fields with a
 * plain value and presses the button that moves on, until `done(url)` or `screens` run out.
 * `onScreen` runs on each new screen first, e.g. to hear one with the screen reader.
 */
export async function finishSetup(
  page: Page,
  done: (url: URL) => boolean,
  moveOn: RegExp,
  onScreen?: (url: URL) => Promise<void>,
  screens = 10,
): Promise<void> {
  let last = "";
  for (let screen = 0; screen < screens && !done(new URL(page.url())); screen++) {
    await page.waitForTimeout(2500);
    const url = new URL(page.url());
    if (url.pathname !== last) {
      last = url.pathname;
      if (onScreen) await onScreen(url);
    }
    for (const field of await page.locator("input[type='text']:visible, input:not([type]):visible, textarea:visible").all()) {
      if (!(await field.inputValue().catch(() => "x"))) await field.fill("Screen Reader Check").catch(() => {});
    }
    // The first one a person could press: a page may keep hidden copies of its buttons.
    for (const next of await page.getByRole("button", { name: moveOn }).all()) {
      if ((await next.isVisible().catch(() => false)) && (await next.isEnabled().catch(() => false))) {
        await next.click().catch(() => {});
        break;
      }
    }
  }
}
