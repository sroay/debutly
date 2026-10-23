import { randomBytes } from "node:crypto";
import { nvdaTest as test } from "@guidepup/playwright";
import { expect } from "@playwright/test";
import { hear } from "./hear";
import { mailLink } from "./mail";
import { finishSetup } from "./setup";

const APP = process.env.APP_URL!;

test.use({ nvdaStartOptions: { capture: "initial" } });

// Checklist items 16–19: what NVDA says on the sign-up form, the "about you" set-up screen, a
// schedule's weekly hours, and the public booking page a client uses.
test("Cal.diy: sign-up, set-up, weekly hours and the public booking page", async ({ page, nvda }) => {
  await page.goto(`${APP}/signup`);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: /continue with email/i }).click();
  await page.waitForTimeout(1500);
  await hear(page, nvda, 14, "caldiy-1-signup-form");

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

  await test.step("go through set-up, hearing the screen about the person", async () => {
    await finishSetup(
      page,
      (url) => !url.pathname.startsWith("/onboarding") && !url.pathname.startsWith("/getting-started"),
      /^(continue|next|next step|skip|finish|finish setup|set up later|i'll connect later|connect later)$/i,
      async (url) => {
        if (/personal|user-settings|settings/.test(url.pathname)) await hear(page, nvda, 12, "caldiy-2-setup-about-you");
      },
      12,
    );
  });

  await test.step("open the first schedule's weekly hours", async () => {
    await page.goto(`${APP}/availability`);
    await page.locator("a[href^='/availability/']").first().click();
    await page.waitForURL(/\/availability\/\d+/, { timeout: 60_000 });
    await page.waitForLoadState("networkidle");
  });
  await hear(page, nvda, 40, "caldiy-3-weekly-hours");

  await page.goto(`${APP}/${username}/30min`);
  await page.waitForLoadState("networkidle");
  await hear(page, nvda, 30, "caldiy-4-booking-page");
});
