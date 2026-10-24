import { screenReaderTest as test } from "@guidepup/playwright";
import { expect } from "@playwright/test";
import { hear } from "./hear";

test.use({ screenReaderStartOptions: { capture: "initial" } });

// The screen reader itself (NVDA on Windows, VoiceOver on macOS), before any app: a named button
// is announced by name, an icon button without one as just "button".
test("the screen reader announces a named button by its name, and an unnamed one as just a button", async ({ page, screenReader }) => {
  await page.setContent(`<h1>Check</h1><button>Save settings</button><button><svg width="12" height="12"></svg></button>`);
  const heard = await hear(page, screenReader, 2);
  expect(heard[0]).toMatch(/Save settings/);
  expect(heard[1]).toMatch(/^button\b/);
});
