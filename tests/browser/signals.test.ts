import { afterAll, beforeAll, expect, it } from "vitest";
import { chromium, type Browser, type Route } from "playwright";
import { startFixture, type RunningFixture } from "../../fixture/server";
import { apiErrorIn, SignalCollector } from "../../src/browser/signals";
import type { Signal } from "../../src/types";

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

it("captures navigation 404s against the requested page", async () => {
  const page = await browser.newPage();
  const signals = new SignalCollector(page);
  await page.goto(`${fx.url}/docs`);
  const drained = signals.drain();
  expect(drained).toContainEqual(expect.objectContaining({ kind: "http_error", status: 404, url: `${fx.url}/docs` }));
  const miss = drained.find((s) => s.kind === "http_error");
  // Timed, so a failure can be matched against what a sandbox blocked meanwhile.
  expect(miss?.kind === "http_error" && miss.startedAt! <= miss.at!).toBe(true);
  expect(signals.drain()).toEqual([]);
});

it("captures uncaught page errors", async () => {
  const page = await browser.newPage();
  const signals = new SignalCollector(page);
  await page.goto(`${fx.url}/pricing`);
  await page.getByRole("button", { name: "Choose Studio" }).click();
  await page.waitForTimeout(200);
  expect(signals.drain()).toContainEqual(
    expect.objectContaining({ kind: "page_error", message: expect.stringContaining("startCheckout") }),
  );
});

it("answers browser dialogs with OK, like a person would, and records what they said", async () => {
  const page = await browser.newPage();
  const signals = new SignalCollector(page);
  await page.setContent(`<button onclick="document.body.dataset.answer = String(confirm('Import this CV?'))">Upload</button>`);
  await page.getByRole("button", { name: "Upload" }).click();
  expect(await page.evaluate(() => document.body.dataset.answer)).toBe("true");
  expect(signals.drain()).toContainEqual(expect.objectContaining({ kind: "dialog", dialogType: "confirm", message: "Import this CV?" }));
});

it("hears the error in a reply that says 200 OK but has no result, and not in one with a result (2026-11-04)", async () => {
  const page = await browser.newPage();
  const signals = new SignalCollector(page);
  await page.goto(`${fx.url}/dashboard`);
  const graphql = (body: unknown) => (r: Route) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  await page.route("**/api/no-result", graphql({ data: null, errors: [{ message: "User does not have access to this workspace" }] }));
  await page.route("**/api/partial", graphql({ data: { name: "Acme" }, errors: [{ message: "Field secret is restricted" }] }));
  await page.route("**/api/not-json", (r) => r.fulfill({ status: 200, contentType: "text/plain", body: '{"data":null,"errors":[{"message":"x"}]}' }));
  await page.evaluate(() => Promise.all(["no-result", "partial", "not-json"].map((p) => fetch(`/api/${p}`).then((r) => r.text()))));
  const seen: Signal[] = [];
  await expect.poll(() => (seen.push(...signals.drain()), seen.some((s) => s.kind === "api_error"))).toBe(true);
  await signals.settle();
  seen.push(...signals.drain());
  expect(seen.filter((s) => s.kind === "api_error")).toEqual([
    { kind: "api_error", message: "User does not have access to this workspace", requestUrl: `${fx.url}/api/no-result`, url: `${fx.url}/dashboard` },
  ]);
});

it("reads the message of a GraphQL error, and nothing from a reply that is not an error", () => {
  expect(apiErrorIn('{"data":null,"errors":[{"message":"  Too   many\\nrequests "}]}')).toBe("Too many requests");
  expect(apiErrorIn('{"data":{"a":1},"errors":[{"message":"partial"}]}')).toBeUndefined();
  expect(apiErrorIn('{"errors":[]}')).toBeUndefined();
  expect(apiErrorIn('{"errors":[{"code":"X"}]}')).toBeUndefined();
  expect(apiErrorIn("not json")).toBeUndefined();
});

it("keeps the start of a server error's response, which can say why it failed", async () => {
  const page = await browser.newPage();
  const signals = new SignalCollector(page);
  await page.goto(`${fx.url}/dashboard`);
  await page.evaluate(() => fetch("/api/invite", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }));
  const seen: Signal[] = [];
  const serverError = () => seen.find((s) => s.kind === "http_error" && s.status === 500);
  await expect.poll(() => (seen.push(...signals.drain()), serverError())).toBeDefined();
  const error = serverError();
  // The response is read after the signal is recorded; it lands on the same signal.
  await expect.poll(() => (error?.kind === "http_error" ? error.body : undefined)).toBe('{"error":"internal"}');
});

it("waits for a server error's response before the step is stored (2026-10-17)", async () => {
  const page = await browser.newPage();
  const signals = new SignalCollector(page);
  await page.goto(`${fx.url}/dashboard`);
  const response = page.waitForResponse((r) => r.url().endsWith("/api/invite"));
  await page.evaluate(() => fetch("/api/invite", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }));
  await response;
  await signals.settle();
  const error = signals.drain().find((s) => s.kind === "http_error");
  expect(error?.kind === "http_error" ? error.body : undefined).toBe('{"error":"internal"}');
});

it("does not read the response of an error below 500", async () => {
  const page = await browser.newPage();
  const signals = new SignalCollector(page);
  await page.goto(`${fx.url}/docs`);
  await page.waitForTimeout(100);
  const miss = signals.drain().find((s) => s.kind === "http_error");
  expect(miss && "body" in miss ? miss.body : undefined).toBeUndefined();
});

it("notices a file the page hands over, since the page itself often doesn't change", async () => {
  const page = await browser.newPage();
  const signals = new SignalCollector(page);
  await page.goto(`${fx.url}/reports`);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Generate weekly brief" }).click();
  await download;
  expect(signals.drain()).toContainEqual(expect.objectContaining({ kind: "download", filename: "weekly-brief.txt" }));
});
