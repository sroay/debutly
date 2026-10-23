import { randomBytes } from "node:crypto";
import { nvdaTest as test } from "@guidepup/playwright";
import { expect } from "@playwright/test";
import { hear } from "./hear";
import { mailLink } from "./mail";

const APP = process.env.APP_URL!;

test.use({ nvdaStartOptions: { capture: "initial" } });

// Checklist items 16, 17 and 19: what NVDA says on the sign-up page, on a schedule's weekly hours,
// and on the public booking page a client uses.
test("Cal.diy: sign-up, weekly hours and the public booking page", async ({ page, nvda }) => {
  await page.goto(`${APP}/signup`);
  await page.waitForLoadState("networkidle");
  await hear(page, nvda, 12, "caldiy-1-signup");

  const username = `screenreader${Date.now()}`;
  const email = `${username}@example.test`;
  const password = `Aa1!${randomBytes(8).toString("hex")}`;
  const signUp = await fetch(`${APP}/api/auth/signup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, email, password, language: "en" }),
  });
  expect(signUp.status).toBeLessThan(300);

  await test.step("confirm the email and sign in", async () => {
    await page.goto(await mailLink(email, /verify-email|token=/));
    await page.goto(`${APP}/auth/login`);
    await page.locator("input[name='email']").fill(email);
    await page.locator("input[name='password']").fill(password);
    await page.locator("button[type='submit']").click();
    await page.waitForURL((url) => !url.pathname.startsWith("/auth/login"), { timeout: 60_000 });
  });

  await test.step("open the first schedule's weekly hours", async () => {
    await page.goto(`${APP}/availability`);
    await page.locator("a[href^='/availability/']").first().click();
    await page.waitForURL(/\/availability\/\d+/, { timeout: 60_000 });
    await page.waitForLoadState("networkidle");
  });
  await hear(page, nvda, 40, "caldiy-2-weekly-hours");

  await page.goto(`${APP}/${username}/30min`);
  await page.waitForLoadState("networkidle");
  await hear(page, nvda, 30, "caldiy-3-booking-page");
});
