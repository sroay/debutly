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

  await test.step("go through set-up as the agents did, hearing the screen about the person", async () => {
    await page.getByRole("radio", { name: /personal use/i }).click();
    await page.getByRole("button", { name: /^continue$/i }).click();
    await page.waitForURL(/\/onboarding\/personal\/settings/, { timeout: 60_000 });
    await page.waitForLoadState("networkidle");
    await hear(page, nvda, 12, "caldiy-2-setup-about-you");
    await finishSetup(page, (url) => !url.pathname.startsWith("/onboarding"), /^(continue|skip for now|skip|finish)$/i);
  });

  await test.step("open the first schedule's weekly hours", async () => {
    await page.goto(`${APP}/availability`);
    await page.waitForTimeout(3000);
    // New people are asked whether to update their timezone, in a dialog over the page.
    await page.keyboard.press("Escape");
    await page.locator("a[href^='/availability/']").first().click();
    await page.waitForURL(/\/availability\/\d+/, { timeout: 60_000 });
    await page.waitForLoadState("networkidle");
  });
  await hear(page, nvda, 40, "caldiy-3-weekly-hours");

  await test.step("make a 30-minute appointment type, as the agents did", async () => {
    await page.goto(`${APP}/event-types`);
    await page.getByRole("link", { name: /^new$/i }).or(page.getByRole("button", { name: /^new$/i })).first().click();
    await page.getByLabel(/^title$/i).fill("Consultation");
    await page.getByRole("button", { name: /^continue$/i }).click();
    await page.waitForURL(/\/event-types\/\d+/, { timeout: 60_000 });
  });
  await page.goto(`${APP}/${username}/consultation`);
  await page.waitForLoadState("networkidle");
  // Only this app's own page: a missing one must not send NVDA off to another site.
  expect(new URL(page.url()).origin).toBe(new URL(APP).origin);
  await hear(page, nvda, 30, "caldiy-4-booking-page");
});
