import { afterAll, beforeAll, expect, it } from "vitest";
import { fixtureInbox } from "../fixture/inbox";
import { startFixture, type RunningFixture } from "../fixture/server";

let fx: RunningFixture;
beforeAll(async () => {
  fx = await startFixture();
});
afterAll(async () => {
  await fx.close();
});

it("serves the home page", async () => {
  const res = await fetch(`${fx.url}/`);
  expect(res.status).toBe(200);
  expect(await res.text()).toContain("Fixturely");
});

it("has the seeded dead link", async () => {
  expect((await fetch(`${fx.url}/docs`)).status).toBe(404);
});

it("has the seeded failing invite endpoint", async () => {
  const res = await fetch(`${fx.url}/api/invite`, { method: "POST" });
  expect(res.status).toBe(500);
});

it("confirms signup and shows the account instead of Sign up afterwards", async () => {
  const res = await fetch(`${fx.url}/signup`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "email=maya%40example.com&password=x",
    redirect: "manual",
  });
  const cookie = res.headers.get("set-cookie") ?? "";
  expect(cookie).toContain("fixturely_user=");
  const pricing = await (await fetch(`${fx.url}/pricing`, { headers: { cookie: cookie.split(";")[0] } })).text();
  expect(pricing).toContain("Welcome, maya@example.com");
  expect(pricing).not.toContain(">Sign up<");
  expect(pricing).toContain("Log out");
});

it("records destructive calls in state", async () => {
  await fetch(`${fx.url}/api/workspace`, { method: "DELETE" });
  expect(fx.state.workspaceDeleted).toBe(true);
});

it("with working invites, emails a join link that signs the teammate in", async () => {
  const working = await startFixture({ invites: "working" });
  try {
    const invite = await fetch(`${working.url}/api/invite`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: "fixturely_user=olga%40acme.test" },
      body: JSON.stringify({ email: "emil@acme.test" }),
    });
    expect(invite.status).toBe(200);
    const [mail] = await fixtureInbox(working.state).latest("emil@acme.test");
    expect(mail.subject).toBe("olga@acme.test invited you to Fixturely");
    const join = await fetch(mail.links[0]);
    expect(await join.text()).toContain("Join olga@acme.test's workspace");
    const joined = await fetch(mail.links[0], {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ name: "Emil", password: "x" }),
      redirect: "manual",
    });
    expect(joined.status).toBe(303);
    expect(joined.headers.get("set-cookie")).toContain("fixturely_user=emil%40acme.test");
    expect(working.state.joined).toEqual(["emil@acme.test"]);
    expect((await fetch(`${working.url}/join?token=nope`)).status).toBe(404);
  } finally {
    await working.close();
  }
});
