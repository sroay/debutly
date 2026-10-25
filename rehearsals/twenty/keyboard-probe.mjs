// Does each step of Twenty's set-up go on from the keyboard? A screen-reader agent pressed Enter on
// the profile step's Continue four times and nothing happened, with every field filled and the
// button enabled. Here each step's fields are filled, then Continue is tried with Enter, then
// Space, then a click, and what moved the page on is printed. No agents, no model calls.
import { randomBytes } from "node:crypto";
import { chromium } from "playwright";

const APP = process.env.APP_URL ?? "http://localhost:3000";
const NEXT = /^(continue|create workspace|skip|skip anyway|continue without sync|finish|get started)$/i;

const browser = await chromium.launch();
const page = await browser.newPage();
const requests = [];
page.on("request", (r) => {
  if (r.resourceType() === "fetch" || r.resourceType() === "xhr") requests.push(r.method() + " " + new URL(r.url()).pathname);
});

await page.goto(`${APP}/welcome`);
await page.waitForLoadState("networkidle");
await page.getByRole("button", { name: /continue with email/i }).click().catch(() => {});
await page.getByPlaceholder(/email/i).fill(`keyboard-probe-${Date.now()}@example.test`);
await page.getByRole("button", { name: /^continue$/i }).click();
await page.getByPlaceholder(/password/i).fill(`Aa1!${randomBytes(8).toString("hex")}`);
await page.getByRole("button", { name: /sign up/i }).click();
await page.waitForURL((url) => !url.pathname.startsWith("/welcome"), { timeout: 60_000 }).catch(() => {});

const movedOn = async (from, ms = 6000) => {
  await page.waitForURL((url) => url.pathname !== from, { timeout: ms }).catch(() => {});
  return new URL(page.url()).pathname !== from;
};

for (let step = 0; step < 10; step++) {
  await page.waitForLoadState("networkidle").catch(() => {});
  // Some steps load first (/workspace-activation): wait for their button.
  await page.getByRole("button", { name: NEXT }).first().waitFor({ state: "visible", timeout: 30_000 }).catch(() => {});
  const path = new URL(page.url()).pathname;
  if (path.startsWith("/objects/")) break;
  for (const field of await page.locator("input[type=text]:visible, input:not([type]):visible").all()) {
    if (!(await field.inputValue())) await field.fill("Probe");
  }
  const button = page.getByRole("button", { name: NEXT }).first();
  if (!(await button.count())) {
    console.log(`${path}: no Continue or Skip button found`);
    break;
  }
  const name = (await button.innerText()).trim();
  let how = "";
  const fields = await page.locator("input:visible").all();
  for (const [label, act] of [
    // As a keyboard user gets there: Tab from the last field. Debutly's agent sets focus instead.
    ["Tab to it, then Enter", async () => {
      if (fields.length) await fields.at(-1).focus();
      for (let i = 0; i < 6 && !(await button.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press("Tab");
      if (await button.evaluate((el) => el === document.activeElement)) await page.keyboard.press("Enter");
      else console.log(`${path}: Tab never reached "${name}"`);
    }],
    ["Enter with focus set on it", async () => { await button.focus(); await page.keyboard.press("Enter"); }],
    ["Space", async () => { await button.focus(); await page.keyboard.press("Space"); }],
    ["a click", async () => { await button.click(); }],
  ]) {
    const before = requests.length;
    await act();
    if (await movedOn(path)) {
      how = label;
      break;
    }
    console.log(`${path}: ${label} on "${name}" did nothing visible (requests sent: ${requests.slice(before).join(", ") || "none"})`);
  }
  console.log(how ? `${path}: "${name}" went on with ${how}` : `${path}: "${name}" didn't go on at all`);
  if (!how) break;
}
await page.screenshot({ path: "keyboard-probe-ended.png" });
await browser.close();
