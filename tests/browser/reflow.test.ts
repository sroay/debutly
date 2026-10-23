import { afterAll, beforeAll, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import { startFixture, type RunningFixture } from "../../fixture/server";
import { ReflowMeter } from "../../src/browser/reflow";

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

it("measures each page at 320 pixels wide where it is, says what sticks out, and gives the window back", async () => {
  const context = await browser.newContext({ viewport: { width: 640, height: 400 } });
  const page = await context.newPage();
  const meter = new ReflowMeter();
  let requests = 0;
  page.on("request", (r) => {
    if (r.isNavigationRequest()) requests++;
  });
  for (const path of ["/team", "/usage", "/features"]) {
    await page.goto(fx.url + path);
    await meter.measure(page);
    await meter.measure(page); // once per page
  }
  expect(page.viewportSize()).toEqual({ width: 640, height: 400 });
  // Only the agent's own three visits: measuring opens nothing.
  expect(requests).toBe(3);
  await context.close();
  expect(meter.checks).toEqual([
    { url: `${fx.url}/team`, widthPx: 320, overflowPx: expect.any(Number), widest: expect.stringMatching(/^div\.banner \("Invite your whole team and save 20%"\), 900 px wide$/), exception: "" },
    { url: `${fx.url}/usage`, widthPx: 320, overflowPx: expect.any(Number), widest: expect.stringMatching(/^table/), exception: "it is inside a data table, which may scroll" },
    { url: `${fx.url}/features`, widthPx: 320, overflowPx: 0, widest: "", exception: "" },
  ]);
  expect(meter.checks[0].overflowPx).toBeGreaterThan(500);
});
