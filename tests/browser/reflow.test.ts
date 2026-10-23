import { afterAll, beforeAll, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import { startFixture, type RunningFixture } from "../../fixture/server";
import { pagesToProbe, probeReflow } from "../../src/browser/reflow";
import type { Step } from "../../src/types";

let fx: RunningFixture;
let browser: Browser;
beforeAll(async () => {
  fx = await startFixture();
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser.close();
  await fx.close();
});

const visit = (url: string): Step => ({ index: 0, observation: { url, title: "", text: "", elements: [] }, action: { type: "wait" }, reasoning: "", signals: [] });

it("measures each page at 320 pixels wide, and says what sticks out", async () => {
  const context = await browser.newContext({ viewport: { width: 640, height: 400 } });
  const checks = await probeReflow(context, [`${fx.url}/team`, `${fx.url}/usage`, `${fx.url}/features`]);
  await context.close();
  expect(checks).toEqual([
    { url: `${fx.url}/team`, widthPx: 320, overflowPx: expect.any(Number), widest: expect.stringMatching(/^div\.banner \("Invite your whole team and save 20%"\), 900 px wide$/), exception: "" },
    { url: `${fx.url}/usage`, widthPx: 320, overflowPx: expect.any(Number), widest: expect.stringMatching(/^table/), exception: "it is inside a data table, which may scroll" },
    { url: `${fx.url}/features`, widthPx: 320, overflowPx: 0, widest: "", exception: "" },
  ]);
  expect(checks[0].overflowPx).toBeGreaterThan(500);
});

it("picks each same-origin page once, and never opens a one-time link again", () => {
  const steps = [
    "http://app.test/pricing",
    "http://app.test/pricing#plans",
    "http://app.test/auth/confirm?token=abc",
    "http://app.test/join?invite=xyz",
    "https://elsewhere.test/help",
    "http://app.test/dashboard?plan=solo",
  ].map(visit);
  expect(pagesToProbe(steps, "http://app.test")).toEqual(["http://app.test/pricing", "http://app.test/dashboard?plan=solo"]);
});
