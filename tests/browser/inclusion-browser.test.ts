import { afterAll, beforeAll, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import { startFixture, type RunningFixture } from "../../fixture/server";
import { openAgentPage } from "../../src/persona/inclusion";

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

it("gives a low-vision agent a zoomed-in (smaller) viewport", async () => {
  const { page, context } = await openAgentPage(browser, "low_vision");
  expect(page.viewportSize()).toEqual({ width: 640, height: 400 });
  await context.close();
});

it("slows every request down on a slow connection", async () => {
  const { page, context } = await openAgentPage(browser, "slow_connection");
  const started = Date.now();
  await page.goto(fx.url);
  expect(Date.now() - started).toBeGreaterThanOrEqual(400);
  await context.close();
});

it("leaves everyone else with a normal browser", async () => {
  const { page, context } = await openAgentPage(browser, undefined);
  expect(page.viewportSize()).toEqual({ width: 1280, height: 720 });
  await context.close();
});
