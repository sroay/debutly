import { randomBytes } from "node:crypto";
import { nvdaTest as test } from "@guidepup/playwright";
import { expect } from "@playwright/test";
import { hear } from "./hear";
import { mailLink } from "./mail";

const APP = process.env.APP_URL!;

test.use({ nvdaStartOptions: { capture: "initial" } });

// Checklist items 1–4: what NVDA says on the setup form after sign-up, on the dashboard, and on
// the dashboard zoomed in (where its menu sits behind one button).
test("Chatwoot: the setup form, the dashboard, and the dashboard zoomed in", async ({ page, nvda }) => {
  const email = `screen-reader-${Date.now()}@example.test`;
  const password = `Aa1!${randomBytes(8).toString("hex")}`;
  const signUp = await fetch(`${APP}/api/v1/accounts`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ account_name: "Screen reader check", user_full_name: "Screen Reader", email, password }),
  });
  expect(signUp.ok).toBe(true);
  await page.goto(await mailLink(email, /confirmation_token=/));
  await page.waitForURL(/\/onboarding/, { timeout: 60_000 });
  await page.waitForTimeout(3000); // Chatwoot keeps a live connection open, so the network never goes quiet
  await hear(page, nvda, 14, "chatwoot-1-setup-form");

  await test.step("finish the setup form as a sighted person would", async () => {
    const selects = page.locator("select");
    await selects.nth(0).selectOption({ index: 1 });
    for (const n of [2, 3, 4, 5]) await selects.nth(n).selectOption({ index: 1 });
    const website = page.locator("input[placeholder='www.example.com']");
    await website.locator("xpath=following::button[1]").click();
    await website.fill("www.example.test");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.waitForURL(/\/dashboard/, { timeout: 60_000 });
    await page.waitForTimeout(3000); // Chatwoot keeps a live connection open, so the network never goes quiet
  });
  await hear(page, nvda, 30, "chatwoot-2-dashboard");

  // 200% zoom on a 1280-pixel laptop lays the page out like a 640-pixel window.
  await page.setViewportSize({ width: 640, height: 400 });
  await page.reload();
  await page.waitForTimeout(3000); // Chatwoot keeps a live connection open, so the network never goes quiet
  await hear(page, nvda, 30, "chatwoot-3-dashboard-zoomed");
});
