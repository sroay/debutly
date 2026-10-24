import { expect, it, vi } from "vitest";
import { MailpitInbox } from "../../src/inbox/mailpit";

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

it("returns the latest messages for an address with their links, newest first", async () => {
  const fetchFn = vi.fn(async (url: string) => {
    if (url.includes("/api/v1/search")) {
      expect(decodeURIComponent(url)).toContain('to:"maya@agents.test"');
      return json({ messages: [{ ID: "m2", Subject: "Your magic link" }, { ID: "m1", Subject: "Welcome" }] });
    }
    if (url.endsWith("/api/v1/message/m2")) {
      return json({ Subject: "Your magic link", Text: "Log in: http://127.0.0.1:54421/auth/v1/verify?token=abc&type=magiclink&redirect_to=http://127.0.0.1:3000/auth/callback\nThanks" });
    }
    return json({ Subject: "Welcome", Text: "", HTML: '<a href="https://app.test/start?x=1&amp;y=2">Start</a>' });
  });
  const inbox = new MailpitInbox("http://127.0.0.1:54424/", fetchFn as unknown as typeof fetch);
  const messages = await inbox.latest("maya@agents.test");
  expect(messages.map((m) => m.subject)).toEqual(["Your magic link", "Welcome"]);
  expect(messages[0].links).toEqual(["http://127.0.0.1:54421/auth/v1/verify?token=abc&type=magiclink&redirect_to=http://127.0.0.1:3000/auth/callback"]);
  expect(messages[1].links).toEqual(["https://app.test/start?x=1&y=2"]);
});

it("returns nothing for an empty inbox", async () => {
  const inbox = new MailpitInbox("http://mail.test", (async () => json({ messages: [] })) as unknown as typeof fetch);
  expect(await inbox.latest("nobody@agents.test")).toEqual([]);
});

it("signs in to a mailbox given with a login, without putting the login in the address", async () => {
  const seen: { url: string; auth?: string }[] = [];
  const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
    seen.push({ url, auth: (init?.headers as Record<string, string> | undefined)?.authorization });
    return json({ messages: [] });
  });
  await new MailpitInbox("https://checker:s3cret@mail.example.test/", fetchFn as unknown as typeof fetch).latest("maya@agents.test");
  expect(seen[0].url.startsWith("https://mail.example.test/api/v1/search")).toBe(true);
  expect(seen[0].auth).toBe(`Basic ${Buffer.from("checker:s3cret").toString("base64")}`);
});
