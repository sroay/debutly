// Can a teammate who signs up before opening their invite still join? Three times a teammate agent
// signed up on Twenty's front page, then opened the invite link from its email, and was told "User
// does not have access to this workspace"; one who opened the invite first got in. Here the owner
// invites two people: one signs up first, then opens the invite; the other opens the invite first.
// What each ends up seeing is printed. No agents, no model calls.
import { randomBytes } from "node:crypto";
import { chromium } from "playwright";

const APP = process.env.APP_URL ?? "http://localhost:3000";
const MAIL = process.env.MAILPIT_URL ?? "http://localhost:8025";
const NEXT = /^(continue|create workspace|skip|skip anyway|continue without sync|finish|get started)$/i;
const tag = Date.now();
const password = () => `Aa1!${randomBytes(8).toString("hex")}`;
const owner = `owner-${tag}@example.test`;
const first = `signs-up-first-${tag}@example.test`;
const invited = `opens-invite-first-${tag}@example.test`;

const browser = await chromium.launch();
const said = async (page, label) => {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(2000);
  const text = (await page.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 300);
  console.log(`${label}: ${new URL(page.url()).pathname}: ${text}`);
  return text;
};

async function signUp(page, email) {
  await page.getByRole("button", { name: /continue with email/i }).click({ timeout: 10_000 }).catch(() => {});
  await page.getByPlaceholder(/email/i).first().fill(email);
  await page.getByRole("button", { name: /^continue$/i }).click();
  await page.getByPlaceholder(/password/i).fill(password());
  await page.getByRole("button", { name: /sign up|continue|sign in/i }).last().click();
}

async function inviteLink(email) {
  for (let i = 0; i < 30; i++) {
    const found = await (await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`)).json();
    const id = found.messages?.[0]?.ID;
    if (id) {
      const message = await (await fetch(`${MAIL}/api/v1/message/${id}`)).json();
      const link = `${message.HTML ?? ""} ${message.Text ?? ""}`.match(/https?:\/\/[^\s"'<>]*\/invite\/[^\s"'<>]*/)?.[0];
      if (link) return link.replace(/&amp;/g, "&");
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return undefined;
}

// The owner signs up, sets up the workspace and invites both.
const ownerPage = await browser.newPage();
await ownerPage.goto(`${APP}/welcome`);
await ownerPage.waitForLoadState("networkidle");
await signUp(ownerPage, owner);
await ownerPage.waitForURL((url) => !url.pathname.startsWith("/welcome") || url.search.length > 0, { timeout: 30_000 }).catch(() => {});
for (let step = 0; step < 10; step++) {
  await ownerPage.getByRole("button", { name: NEXT }).first().waitFor({ state: "visible", timeout: 30_000 }).catch(() => {});
  const path = new URL(ownerPage.url()).pathname;
  if (path.startsWith("/objects/")) break;
  if (path === "/invite-team") {
    // The email fields show example addresses as placeholders.
    const fields = ownerPage.locator('input[placeholder*="@"]:visible');
    await fields.nth(0).fill(first);
    await fields.nth(1).fill(invited);
    const enabled = await ownerPage
      .waitForFunction(() => [...document.querySelectorAll("button")].some((b) => /^(invite|continue)$/i.test(b.innerText.trim()) && !b.disabled), null, { timeout: 15_000 })
      .then(() => true, () => false);
    if (!enabled) {
      const placeholders = await ownerPage.locator("input:visible").evaluateAll((els) => els.map((e) => e.getAttribute("placeholder")));
      await said(ownerPage, `Invite stayed disabled on /invite-team (fields: ${JSON.stringify(placeholders)})`);
      break;
    }
    await ownerPage.getByRole("button", { name: /^(invite|continue)$/i }).click();
    await ownerPage.waitForURL((url) => url.pathname !== path, { timeout: 30_000 }).catch(() => {});
    continue;
  }
  for (const field of await ownerPage.locator("input[type=text]:visible, input:not([type]):visible").all()) {
    if (!(await field.inputValue())) await field.fill("Probe");
  }
  await ownerPage.getByRole("button", { name: NEXT }).first().click();
  await ownerPage.waitForURL((url) => url.pathname !== path, { timeout: 30_000 }).catch(() => {});
}
console.log(`Owner set up the workspace, ending on ${new URL(ownerPage.url()).pathname}`);

const firstLink = await inviteLink(first);
const invitedLink = await inviteLink(invited);
console.log(`Invite emails: ${firstLink ? "arrived" : "missing"} for the one who signs up first, ${invitedLink ? "arrived" : "missing"} for the one who opens it first`);

// Signs up on the front page first, then opens the invite.
if (firstLink) {
  const page = await (await browser.newContext()).newPage();
  await page.goto(`${APP}/welcome`);
  await page.waitForLoadState("networkidle");
  await signUp(page, first);
  await said(page, "Signed up on the front page");
  await page.goto(firstLink);
  await said(page, "Then opened the invite");
  await page.screenshot({ path: "invite-probe-signed-up-first.png" });
}

// Opens the invite first, and signs up from it.
if (invitedLink) {
  const page = await (await browser.newContext()).newPage();
  await page.goto(invitedLink);
  await page.waitForLoadState("networkidle");
  await signUp(page, invited);
  await said(page, "Opened the invite first, then signed up");
  await page.screenshot({ path: "invite-probe-invite-first.png" });
}
await browser.close();
