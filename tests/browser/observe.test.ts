import { afterAll, beforeAll, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { startFixture, type RunningFixture } from "../../fixture/server";
import { observe } from "../../src/browser/observe";

let fx: RunningFixture;
let browser: Browser;
let page: Page;

beforeAll(async () => {
  fx = await startFixture();
  browser = await chromium.launch();
  page = await browser.newPage();
});
afterAll(async () => {
  await browser.close();
  await fx.close();
});

it("never leaves two elements with the same id after the page changes (2026-10-16)", async () => {
  await page.goto("about:blank");
  await page.setContent(`<button id="a">Open menu</button><button id="b">Save</button>`);
  await observe(page);
  // The first button goes out of sight and a new one appears before it: ids shift on the next look.
  await page.evaluate(() => {
    document.getElementById("a")!.style.display = "none";
    document.body.insertAdjacentHTML("afterbegin", "<button>Cancel</button>");
  });
  await observe(page);
  const ids = await page.$$eval("[data-debutly-id]", (els) => els.map((e) => e.getAttribute("data-debutly-id")));
  expect(new Set(ids).size).toBe(ids.length);
});

it("gives each control the name and role the browser gives assistive technology", async () => {
  await page.goto("about:blank");
  await page.setContent(`<html lang="en"><body>
    <button><svg width="8" height="8"><title>Close dialog</title></svg></button>
    <button aria-hidden="true">Hidden save</button>
    <span id="team">Team name</span><input aria-labelledby="team">
    <button><svg width="8" height="8"></svg></button></body></html>`);
  const obs = await observe(page);
  expect(obs.elements.map((e) => e.ax)).toEqual([
    { name: "Close dialog", role: "button", hidden: false },
    { name: "", role: "none", hidden: true },
    { name: "Team name", role: "textbox", hidden: false },
    { name: "", role: "button", hidden: false },
  ]);
});

it("reads the page's language, text direction and how much of its text is Arabic", async () => {
  await page.goto("about:blank");
  await page.setContent(`<html lang="ar" dir="rtl"><body><h1>إنشاء حساب</h1><p>ابدأ متجرك اليوم</p></body></html>`);
  expect(await observe(page)).toMatchObject({ lang: "ar", dir: "rtl", arabicShare: 1 });
  await page.setContent(`<html><body><p>Create an account</p></body></html>`);
  expect(await observe(page)).toMatchObject({ lang: "", dir: "ltr", arabicShare: 0 });
});

it("notices a page that stops people zooming in", async () => {
  await page.goto("about:blank");
  await page.setContent(`<html><head><meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=0"></head><body>Hi</body></html>`);
  expect((await observe(page)).zoomBlocked).toBe("width=device-width, initial-scale=1, user-scalable=0");
  await page.setContent(`<html><head><meta name="viewport" content="width=device-width, maximum-scale=1.5"></head><body>Hi</body></html>`);
  expect((await observe(page)).zoomBlocked).toBe("width=device-width, maximum-scale=1.5");
  await page.setContent(`<html><head><meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=5"></head><body>Hi</body></html>`);
  expect((await observe(page)).zoomBlocked).toBe("");
});

it("takes the direction the Arabic text is laid out in, wherever the app sets it", async () => {
  await page.goto("about:blank");
  // An app that turns its own container right to left, as some single-page apps do.
  await page.setContent(`<html><body><div id="app" dir="rtl"><h1>المحادثات</h1><p>لا توجد محادثات نشطة</p></div></body></html>`);
  expect(await observe(page)).toMatchObject({ lang: "", dir: "rtl" });
  await page.setContent(`<html><body><div><h1>المحادثات</h1><p>لا توجد محادثات نشطة</p></div><p dir="rtl">English footer</p></body></html>`);
  expect(await observe(page)).toMatchObject({ dir: "ltr" });
});

it("names a field by the label wrapped around it, without the field's own text", async () => {
  await page.setContent(`
    <label>Bulk action <select><option>Archive</option><option>Delete</option></select></label>
    <label>Company name <input></label>
    <label><input type="checkbox"> Send me updates</label>`);
  const obs = await observe(page);
  expect(obs.elements.map((e) => e.name)).toEqual(["Bulk action", "Company name", "Send me updates"]);
});

it("lists interactive elements with roles and accessible names", async () => {
  await page.goto(`${fx.url}/signup`);
  const obs = await observe(page);
  expect(obs.title).toBe("Sign up - Fixturely");
  expect(obs.elements).toContainEqual(expect.objectContaining({ role: "link", name: "Pricing" }));
  expect(obs.elements).toContainEqual(expect.objectContaining({ role: "input:email", name: "Work email" }));
  expect(obs.elements).toContainEqual(expect.objectContaining({ role: "button", name: "Create account" }));
  expect(obs.text).toContain("Create your account");
});

it("exposes the unlabeled icon button with an empty name", async () => {
  await page.goto(`${fx.url}/dashboard`);
  const obs = await observe(page);
  expect(obs.elements).toContainEqual(expect.objectContaining({ role: "button", name: "" }));
});

it("skips hidden inputs", async () => {
  await page.goto(`${fx.url}/checkout?plan=solo`);
  const obs = await observe(page);
  expect(obs.elements.some((e) => e.role === "input:hidden")).toBe(false);
});

it("sees the options of an open custom dropdown", async () => {
  await page.goto(`${fx.url}/checkout?plan=solo`);
  await page.locator("#country").click();
  const obs = await observe(page);
  expect(obs.elements).toContainEqual(expect.objectContaining({ role: "combobox", name: "Billing country" }));
  expect(obs.elements).toContainEqual(expect.objectContaining({ role: "option", name: "United Kingdom" }));
});

it("falls back to the title tooltip for an icon-only button, as browsers do", async () => {
  await page.setContent(`<button title="Sign out"><svg width="8" height="8"></svg></button><button><svg width="8" height="8"></svg></button>`);
  const obs = await observe(page);
  expect(obs.elements.map((e) => e.name)).toEqual(["Sign out", ""]);
});

it("names a native select by its label and lists its options apart", async () => {
  await page.goto(`${fx.url}/signup`);
  const obs = await observe(page);
  expect(obs.elements).toContainEqual(
    expect.objectContaining({
      role: "select",
      name: "Team size",
      value: "Just me",
      options: ["Just me", "2-10 people", "11-50 people"],
    }),
  );
});
