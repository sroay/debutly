import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { startFixture, type RunningFixture } from "../../fixture/server";
import { observe } from "../../src/browser/observe";
import { execute, NOT_BY_KEYBOARD } from "../../src/browser/execute";

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

// setContent keeps the window and whatever earlier tests set on it, so each page starts fresh.
const show = async (html: string) => {
  await page.goto("about:blank");
  await page.setContent(html);
};

const idOf = (elements: { id: number; name: string }[], name: string) => {
  const el = elements.find((e) => e.name === name);
  if (!el) throw new Error(`no element named ${name}`);
  return el.id;
};

it("clicks links by id", async () => {
  await page.goto(fx.url);
  const obs = await observe(page);
  const result = await execute(page, { type: "click", id: idOf(obs.elements, "Pricing") }, obs, fx.url);
  expect(result).toEqual({});
  expect(new URL(page.url()).pathname).toBe("/pricing");
});

it("fills inputs by id", async () => {
  await page.goto(`${fx.url}/signup`);
  const obs = await observe(page);
  await execute(page, { type: "fill", id: idOf(obs.elements, "Work email"), text: "a@example.com" }, obs, fx.url);
  expect(await page.inputValue("#email")).toBe("a@example.com");
});

it("refuses off-origin navigation", async () => {
  const obs = await observe(page);
  const result = await execute(page, { type: "goto", path: "https://example.com/" }, obs, fx.url);
  expect(result.blocked).toMatch(/off-origin/);
});

it("refuses destructive clicks and never reaches the server", async () => {
  await page.goto(`${fx.url}/dashboard`);
  const obs = await observe(page);
  const result = await execute(page, { type: "click", id: idOf(obs.elements, "Delete workspace") }, obs, fx.url);
  expect(result.blocked).toMatch(/destructive/);
  expect(fx.state.workspaceDeleted).toBe(false);
});

it("refuses an upload aimed at a destructive button", async () => {
  await page.goto(`${fx.url}/dashboard`);
  const obs = await observe(page);
  const result = await execute(page, { type: "upload", id: idOf(obs.elements, "Delete workspace") }, obs, fx.url);
  expect(result.blocked).toMatch(/destructive/);
  expect(fx.state.workspaceDeleted).toBe(false);
});

it("refuses a destructive option in a custom dropdown, and leaves the dropdown closed", async () => {
  await show(`
    <span id="l">Account actions</span>
    <button id="t" role="combobox" aria-labelledby="l" aria-expanded="false" aria-controls="m"
      onclick="m.hidden = !m.hidden; this.setAttribute(aria-expanded, String(!m.hidden))">Choose</button>
    <ul id="m" role="listbox" hidden>
      <li role="option" onclick="m.hidden = true">Rename account</li>
      <li role="option" onclick="window.deleted = true; m.hidden = true">Delete account</li>
    </ul>
    <script>document.addEventListener("keydown", (e) => { if (e.key === "Escape") m.hidden = true; });</script>`);
  const obs = await observe(page);
  const result = await execute(page, { type: "fill", id: idOf(obs.elements, "Account actions"), text: "Delete account" }, obs, fx.url);
  expect(result.blocked).toMatch(/destructive/);
  expect(await page.evaluate(() => (window as unknown as { deleted?: boolean }).deleted)).toBeUndefined();
  expect(await page.locator("#m").isHidden()).toBe(true);
});

it("refuses a destructive option in a native select, and still chooses harmless ones", async () => {
  await show(`
    <label>Bulk action <select onchange="window.changed = this.value">
      <option>Choose…</option><option>Archive</option><option>Delete account</option>
    </select></label>`);
  const obs = await observe(page);
  const id = idOf(obs.elements, "Bulk action");
  expect((await execute(page, { type: "fill", id, text: "Delete account" }, obs, fx.url)).blocked).toMatch(/destructive/);
  expect(await page.evaluate(() => (window as unknown as { changed?: string }).changed)).toBeUndefined();
  expect(await execute(page, { type: "fill", id, text: "Archive" }, obs, fx.url)).toEqual({});
  expect(await page.evaluate(() => (window as unknown as { changed?: string }).changed)).toBe("Archive");
});

it("refuses Enter on a focused destructive button", async () => {
  await page.goto(`${fx.url}/dashboard`);
  await page.getByRole("button", { name: "Delete workspace" }).focus();
  const obs = await observe(page);
  expect((await execute(page, { type: "press", key: "Enter" }, obs, fx.url)).blocked).toMatch(/destructive/);
  expect(fx.state.workspaceDeleted).toBe(false);
});

it("refuses Enter in a field whose form a destructive button submits, but submits other forms", async () => {
  const form = (button: string) => `
    <form onsubmit="window.sent = true; return false">
      <input aria-label="Confirm"><button>${button}</button>
    </form>`;
  await show(form("Delete account"));
  await page.getByLabel("Confirm").focus();
  let obs = await observe(page);
  expect((await execute(page, { type: "press", key: "Enter" }, obs, fx.url)).blocked).toMatch(/destructive/);
  expect(await page.evaluate(() => (window as unknown as { sent?: boolean }).sent)).toBeUndefined();

  await show(form("Sign up"));
  await page.getByLabel("Confirm").focus();
  obs = await observe(page);
  expect(await execute(page, { type: "press", key: "Enter" }, obs, fx.url)).toEqual({});
  expect(await page.evaluate(() => (window as unknown as { sent?: boolean }).sent)).toBe(true);
});

it("refuses an arrow key that would move a focused select onto a destructive option", async () => {
  await show(`<label>Bulk action <select><option>Archive</option><option>Delete account</option></select></label>`);
  await page.getByLabel("Bulk action").focus();
  const obs = await observe(page);
  expect((await execute(page, { type: "press", key: "ArrowDown" }, obs, fx.url)).blocked).toMatch(/destructive/);
  expect(await page.getByLabel("Bulk action").inputValue()).toBe("Archive");
});

it("refuses Enter where the form's default button is destructive, wherever it sits", async () => {
  const sent = () => page.evaluate(() => (window as unknown as { sent?: boolean }).sent);
  // The default button can sit outside the form, joined to it by form="…".
  await show(`
    <form id="f" onsubmit="window.sent = true; return false"><input aria-label="Confirm"></form>
    <button form="f">Delete account</button>`);
  await page.getByLabel("Confirm").focus();
  let obs = await observe(page);
  expect((await execute(page, { type: "press", key: "Enter" }, obs, fx.url)).blocked).toMatch(/destructive/);
  expect(await sent()).toBeUndefined();
  // With no button, Enter still submits a one-field form: judge it by where it goes.
  await show(`<form action="/account/delete" onsubmit="window.sent = true; return false"><input aria-label="Confirm"></form>`);
  await page.getByLabel("Confirm").focus();
  obs = await observe(page);
  expect((await execute(page, { type: "press", key: "Enter" }, obs, fx.url)).blocked).toMatch(/destructive/);
  expect(await sent()).toBeUndefined();
});

it("refuses Enter on a combobox whose highlighted option is destructive", async () => {
  await show(`
    <input role="combobox" aria-label="Actions" aria-controls="l" aria-activedescendant="o2"
      onkeydown="if (event.key === 'Enter') window.chosen = document.getElementById(this.getAttribute('aria-activedescendant')).textContent">
    <ul id="l" role="listbox"><li id="o1" role="option">Rename</li><li id="o2" role="option">Delete account</li></ul>`);
  await page.getByLabel("Actions").focus();
  const obs = await observe(page);
  expect((await execute(page, { type: "press", key: "Enter" }, obs, fx.url)).blocked).toMatch(/destructive/);
  expect(await page.evaluate(() => (window as unknown as { chosen?: string }).chosen)).toBeUndefined();
});

it("judges a focused button by the name agents see, not just its text", async () => {
  await show(`<span id="n">Delete account</span><button aria-labelledby="n" onclick="window.clicked = true">Go</button>`);
  await page.getByRole("button").focus();
  const obs = await observe(page);
  expect((await execute(page, { type: "press", key: "Enter" }, obs, fx.url)).blocked).toMatch(/destructive/);
  expect(await page.evaluate(() => (window as unknown as { clicked?: boolean }).clicked)).toBeUndefined();
});

it("presses Enter with nothing focused even when the page mentions deleting", async () => {
  await show(`<p>You can delete your account in settings.</p>`);
  const obs = await observe(page);
  expect(await execute(page, { type: "press", key: "Enter" }, obs, fx.url)).toEqual({});
});

it("reports unknown element ids as errors", async () => {
  const obs = await observe(page);
  const result = await execute(page, { type: "click", id: 9999 }, obs, fx.url);
  expect(result.error).toMatch(/no element/);
});

it("picks an option from a custom dropdown", async () => {
  await page.goto(`${fx.url}/checkout?plan=solo`);
  let obs = await observe(page);
  await execute(page, { type: "click", id: idOf(obs.elements, "Billing country") }, obs, fx.url);
  obs = await observe(page);
  expect(await execute(page, { type: "click", id: idOf(obs.elements, "India") }, obs, fx.url)).toEqual({});
  expect(await page.inputValue("#country-value")).toBe("IN");
});

it("presses Escape to close a popup", async () => {
  await page.goto(`${fx.url}/checkout?plan=solo`);
  let obs = await observe(page);
  await execute(page, { type: "click", id: idOf(obs.elements, "Billing country") }, obs, fx.url);
  obs = await observe(page);
  expect(await execute(page, { type: "press", key: "Escape" }, obs, fx.url)).toEqual({});
  expect(await page.locator("#country-list").isHidden()).toBe(true);
});

it("says when a click fails because something else covers the element", async () => {
  await show(
    `<button>Invite Team Member</button><div class="getting-started" style="position:fixed;inset:0;background:transparent">Getting started</div>`,
  );
  const obs = await observe(page);
  const result = await execute(page, { type: "click", id: idOf(obs.elements, "Invite Team Member") }, obs, fx.url);
  expect(result.error).toMatch(/^another element covers it: <div class="getting-started"/);
}, 15_000);

it("says when a click fails because the element is disabled", async () => {
  await show(`<button disabled>Invite Team Member</button>`);
  const obs = await observe(page);
  const result = await execute(page, { type: "click", id: idOf(obs.elements, "Invite Team Member") }, obs, fx.url);
  expect(result.error).toBe("the element is disabled");
}, 15_000);

it("says when a field can't be typed in until its edit button is pressed", async () => {
  await show(`<label>Website <input readonly placeholder="www.example.com"></label><button><svg width="12" height="12"></svg></button>`);
  const obs = await observe(page);
  const result = await execute(page, { type: "fill", id: idOf(obs.elements, "Website"), text: "www.shop.ae" }, obs, fx.url);
  expect(result.error).toBe("the field is read-only, so it can't be typed in yet; there may be a button to edit it");
}, 15_000);

it("says when a link is off the screen, in a menu that is closed", async () => {
  await show(
    `<nav style="position:fixed;left:0;top:0;width:200px;height:100vh;transform:translateX(-100%)"><a href="#settings">Settings</a></nav>` +
      `<button aria-label="Open menu">☰</button>`,
  );
  const obs = await observe(page);
  const result = await execute(page, { type: "click", id: idOf(obs.elements, "Settings") }, obs, fx.url);
  expect(result.error).toBe("it is off the screen, perhaps in a menu or panel that is closed; open that first");
}, 15_000);

it("clicks the visible part of a partly covered element, like a person would", async () => {
  await show(
    `<button style="width:400px;height:40px" onclick="document.body.dataset.clicked='yes'">Invite Team Member</button>` +
      `<div style="position:fixed;left:180px;top:0;width:500px;height:120px;background:#eee">Getting started</div>`,
  );
  const obs = await observe(page);
  const result = await execute(page, { type: "click", id: idOf(obs.elements, "Invite Team Member") }, obs, fx.url);
  expect(result.error).toBeUndefined();
  expect(await page.evaluate(() => document.body.dataset.clicked)).toBe("yes");
}, 15_000);

it("waits a few seconds when the agent chooses to", async () => {
  await page.goto(`${fx.url}/signup`);
  const obs = await observe(page);
  const started = Date.now();
  expect(await execute(page, { type: "wait" }, obs, fx.url)).toEqual({});
  expect(Date.now() - started).toBeGreaterThanOrEqual(3_000);
});

it("chooses a native select's option by its label", async () => {
  await page.goto(`${fx.url}/signup`);
  const obs = await observe(page);
  const result = await execute(page, { type: "fill", id: idOf(obs.elements, "Team size"), text: "11-50" }, obs, fx.url);
  expect(result).toEqual({});
  expect(await page.inputValue("#team-size")).toBe("11-50 people");
});

it("says which options a select has when the agent asks for one it lacks", async () => {
  const obs = await observe(page);
  const result = await execute(page, { type: "fill", id: idOf(obs.elements, "Team size"), text: "200+" }, obs, fx.url);
  expect(result.error).toBe('no option "200+"; the options are "Just me", "2-10 people", "11-50 people"');
});

it("picks a custom dropdown's option by name: opens it and clicks the option, as a person does", async () => {
  await page.goto(`${fx.url}/checkout?plan=solo`);
  const obs = await observe(page);
  const result = await execute(page, { type: "fill", id: idOf(obs.elements, "Billing country"), text: "india" }, obs, fx.url);
  expect(result).toEqual({});
  expect(await page.inputValue("#country-value")).toBe("IN");
  expect(await page.locator("#country-list").isHidden()).toBe(true);
});

it("says which options a custom dropdown has, and closes it, when the agent asks for one it lacks", async () => {
  await page.goto(`${fx.url}/checkout?plan=solo`);
  const obs = await observe(page);
  const result = await execute(page, { type: "fill", id: idOf(obs.elements, "Billing country"), text: "France" }, obs, fx.url);
  expect(result.error).toBe('no option "France"; the options are "United Kingdom", "United States", "India"');
  expect(await page.locator("#country-list").isHidden()).toBe(true);
});

it("uploads a sample photo to a file field, and a sample CV through a button in front of a hidden one", async () => {
  await page.goto(`${fx.url}/upload`);
  const obs = await observe(page);
  expect(obs.elements).toContainEqual(expect.objectContaining({ role: "input:file", name: "Profile photo" }));
  // The hidden field behind the button is listed too: files can be attached to it.
  expect(obs.elements).toContainEqual(expect.objectContaining({ role: "input:file", name: "file upload (.pdf,.doc,.docx)" }));
  expect(await execute(page, { type: "upload", id: idOf(obs.elements, "Profile photo") }, obs, fx.url)).toEqual({});
  expect(await execute(page, { type: "upload", id: idOf(obs.elements, "Upload your CV") }, obs, fx.url)).toEqual({});
  const chosen = await page.locator("#chosen li").allTextContents();
  expect(chosen[0]).toMatch(/^photo: sample-photo\.png image\/png \d+$/);
  expect(chosen[1]).toMatch(/^cv: sample-cv\.pdf application\/pdf \d+$/);
});

it("says so when what the agent clicked to upload opens no file picker", async () => {
  await page.goto(`${fx.url}/upload`);
  const obs = await observe(page);
  const result = await execute(page, { type: "upload", id: idOf(obs.elements, "Does nothing") }, obs, fx.url);
  expect(result.error).toBe("clicking it opened no file picker");
});

describe("keyboard only, as the screen-reader agent works", () => {
  const keyboard = { keyboard: true };

  it("presses a button by focusing it and pressing Enter, and ticks a checkbox with Space", async () => {
    await show(`<button onclick="document.body.dataset.saved = 'yes'">Save</button>
      <label><input type="checkbox" id="news"> Send me news</label>`);
    const obs = await observe(page);
    expect(await execute(page, { type: "click", id: idOf(obs.elements, "Save") }, obs, fx.url, undefined, keyboard)).toEqual({});
    expect(await page.evaluate(() => document.body.dataset.saved)).toBe("yes");
    expect(await execute(page, { type: "click", id: idOf(obs.elements, "Send me news") }, obs, fx.url, undefined, keyboard)).toEqual({});
    expect(await page.isChecked("#news")).toBe(true);
  });

  it("can't use a control that isn't in the tab order, and says so", async () => {
    await show(`<span role="button" onclick="document.body.dataset.saved = 'yes'">Save</span>
      <button tabindex="-1">Skip me</button>`);
    const obs = await observe(page);
    const result = await execute(page, { type: "click", id: idOf(obs.elements, "Save") }, obs, fx.url, undefined, keyboard);
    expect(result.error).toBe(`${NOT_BY_KEYBOARD}: it isn't in the tab order`);
    expect(await page.evaluate(() => document.body.dataset.saved)).toBeUndefined();
    expect((await execute(page, { type: "click", id: idOf(obs.elements, "Skip me") }, obs, fx.url, undefined, keyboard)).error).toMatch(/^can't be reached with the keyboard/);
    // With a mouse it works.
    expect(await execute(page, { type: "click", id: idOf(obs.elements, "Save") }, obs, fx.url)).toEqual({});
  });

  it("types into a field it can tab to, and focuses a field it clicks without submitting the form", async () => {
    await show(`<form onsubmit="event.preventDefault(); document.body.dataset.sent = 'yes'"><label>Name <input id="name"></label><button>Send</button></form>`);
    const obs = await observe(page);
    expect(await execute(page, { type: "click", id: idOf(obs.elements, "Name") }, obs, fx.url, undefined, keyboard)).toEqual({});
    expect(await page.evaluate(() => document.body.dataset.sent)).toBeUndefined();
    expect(await execute(page, { type: "fill", id: idOf(obs.elements, "Name"), text: "Amal" }, obs, fx.url, undefined, keyboard)).toEqual({});
    expect(await page.inputValue("#name")).toBe("Amal");
  });

  it("notices when the focused control is entirely hidden behind something, and still presses it", async () => {
    await show(`<div style="height:1200px"></div>
      <button id="pay" onclick="document.body.dataset.paid = 'yes'">Pay</button>
      <div style="position:fixed;left:0;right:0;bottom:0;height:200px;background:#fff" class="cookie-bar">We use cookies</div>
      <script>scrollTo(0, document.body.scrollHeight)</script>`);
    const obs = await observe(page);
    const result = await execute(page, { type: "click", id: idOf(obs.elements, "Pay") }, obs, fx.url, undefined, keyboard);
    expect(result.focusObscured).toMatch(/^div\.cookie-bar/);
    expect(await page.evaluate(() => document.body.dataset.paid)).toBe("yes");
  });
});

it("refuses a control whose browser-given name is destructive, though Debutly's own reading finds no name", async () => {
  await show(`<button id="del" onclick="document.body.dataset.deleted = 'yes'"><img alt="Delete workspace" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" width="8" height="8"></button>`);
  const obs = await observe(page);
  const el = obs.elements.find((e) => e.ax?.name === "Delete workspace")!;
  expect(el.name).toBe("");
  for (const opts of [{}, { keyboard: true }]) {
    const result = await execute(page, { type: "click", id: el.id }, obs, fx.url, undefined, opts);
    expect(result.blocked).toBe('destructive action refused: "Delete workspace"');
  }
  await page.focus("#del");
  expect((await execute(page, { type: "press", key: "Enter" }, obs, fx.url)).blocked).toMatch(/^destructive action refused/);
  expect(await page.evaluate(() => document.body.dataset.deleted)).toBeUndefined();
});
