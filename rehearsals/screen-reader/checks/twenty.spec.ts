import { randomBytes } from "node:crypto";
import { nvdaTest as test } from "@guidepup/playwright";
import { hear } from "./hear";

const APP = process.env.APP_URL!;

test.use({ nvdaStartOptions: { capture: "initial" } });

// Checklist items 10 and 11: what NVDA says on the sign-in page, and on the Companies table once
// a workspace exists. Twenty's first sign-up creates the only workspace.
test("Twenty: the sign-in page and the Companies table", async ({ page, nvda }) => {
  await page.goto(`${APP}/welcome`);
  await page.waitForLoadState("networkidle");
  await hear(page, nvda, 6, "twenty-1-sign-in");

  await test.step("sign up and create the workspace as a sighted person would", async () => {
    await page.getByRole("button", { name: /continue with email/i }).click().catch(() => {});
    await page.getByPlaceholder(/email/i).fill(`screen-reader-${Date.now()}@example.test`);
    await page.getByRole("button", { name: /^continue$/i }).click();
    await page.getByPlaceholder(/password/i).fill(`Aa1!${randomBytes(8).toString("hex")}`);
    await page.getByRole("button", { name: /sign up/i }).click();
    // Then however many set-up screens this version shows: a name for the workspace and for
    // the person, and screens that can be skipped.
    for (let screen = 0; screen < 8 && !/\/objects\//.test(page.url()); screen++) {
      await page.waitForTimeout(2500);
      for (const field of await page.locator("input:visible").all()) {
        if (!(await field.inputValue().catch(() => "x"))) await field.fill("Screen Reader Check").catch(() => {});
      }
      const next = page.getByRole("button", { name: /^(continue|skip|finish|get started)$/i }).first();
      if (await next.isVisible().catch(() => false)) await next.click().catch(() => {});
    }
    await page.goto(`${APP}/objects/companies`);
    await page.waitForTimeout(5000);
  });
  await hear(page, nvda, 40, "twenty-2-companies");
});
