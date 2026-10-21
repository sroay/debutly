import { afterAll, beforeAll, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { observe } from "../../src/browser/observe";
import { settle } from "../../src/browser/settle";

// A client-rendered page: a "Loading…" shell at DOMContentLoaded, the real content once its data arrives.
const SHELL = `<!doctype html><title>App</title><body><p id="s">Loading dashboard...</p><script>
  fetch("/api/data").then((r) => r.json()).then((d) => {
    document.body.innerHTML = '<h1>' + d.company + '</h1><button>Add competitor</button>';
  });
</script></body>`;

let browser: Browser;
let page: Page;

beforeAll(async () => {
  browser = await chromium.launch();
  page = await browser.newPage();
  await page.route("http://app.test/", (r) => r.fulfill({ contentType: "text/html", body: SHELL }));
  await page.route("http://app.test/stuck", (r) => r.fulfill({ contentType: "text/html", body: "<p>Loading...</p>" }));
  await page.route("http://app.test/api/data", async (r) => {
    await new Promise((res) => setTimeout(res, 1_500));
    await r.fulfill({ contentType: "application/json", body: JSON.stringify({ company: "LeadGenius" }) });
  });
});
afterAll(async () => {
  await browser.close();
});

it("waits for a loading page to finish before it is read", async () => {
  await page.goto("http://app.test/", { waitUntil: "domcontentloaded" });
  expect((await observe(page)).text).toContain("Loading dashboard");
  await settle(page);
  const obs = await observe(page);
  expect(obs.text).toContain("LeadGenius");
  expect(obs.elements).toContainEqual(expect.objectContaining({ role: "button", name: "Add competitor" }));
});

it("gives up waiting on a page that never finishes loading", async () => {
  await page.goto("http://app.test/stuck", { waitUntil: "domcontentloaded" });
  const started = Date.now();
  await settle(page, { idleMs: 1_000, busyMs: 1_000 });
  expect(Date.now() - started).toBeLessThan(4_000);
  expect((await observe(page)).text).toBe("Loading...");
});
