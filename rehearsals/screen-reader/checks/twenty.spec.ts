import { randomBytes } from "node:crypto";
import { nvdaTest as test } from "@guidepup/playwright";
import { hear } from "./hear";
import { finishSetup } from "./setup";

const APP = process.env.APP_URL!;

test.use({ nvdaStartOptions: { capture: "initial" } });

// Checklist items 10 and 11: what NVDA says on the sign-in page (enough Tabs to come round to the
// top again), and on the Companies table once a workspace exists. Twenty's first sign-up creates
// the only workspace.
test("Twenty: the sign-in page and the Companies table", async ({ page, nvda }) => {
  await page.goto(`${APP}/welcome`);
  await page.waitForLoadState("networkidle");
  await hear(page, nvda, 12, "twenty-1-sign-in");

  await test.step("sign up and create the workspace as a sighted person would", async () => {
    await page.getByRole("button", { name: /continue with email/i }).click().catch(() => {});
    await page.getByPlaceholder(/email/i).fill(`screen-reader-${Date.now()}@example.test`);
    await page.getByRole("button", { name: /^continue$/i }).click();
    await page.getByPlaceholder(/password/i).fill(`Aa1!${randomBytes(8).toString("hex")}`);
    await page.getByRole("button", { name: /sign up/i }).click();
    await finishSetup(
      page,
      (url) => url.pathname.startsWith("/objects/"),
      /^(create workspace|continue|continue without sync|skip|finish|get started)$/i,
      undefined,
      20,
    );
    await page.goto(`${APP}/objects/companies`);
    await page.waitForTimeout(5000);
  });
  await hear(page, nvda, 40, "twenty-2-companies");
});
