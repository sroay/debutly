import { expect, it, vi } from "vitest";
import { blockedCalls, HttpSandboxOutbox } from "../../src/sandbox/outbox";

it("reads everything the test environment faked or blocked since the run began, with the token", async () => {
  const fetchFn = vi.fn(async () =>
    Response.json({
      entries: [
        { outcome: "blocked", rule: null, channel: "unknown", host: "api.firecrawl.dev", url: "https://api.firecrawl.dev/v1/scrape", created_at: "2026-09-28T09:00:01.000Z" },
        { outcome: "faked", rule: "resend", channel: "email", host: "api.resend.com", url: "https://api.resend.com/emails", recipient: "a@x.test", summary: "POST", created_at: "2026-09-28T09:00:02.000Z" },
      ],
    }),
  );
  const outbox = new HttpSandboxOutbox("http://localhost:3000/api/sandbox/outbox", "tok", fetchFn as unknown as typeof fetch);
  const entries = await outbox.entriesSince(new Date("2026-09-28T09:00:00.000Z"));
  expect(entries).toEqual([
    expect.objectContaining({ outcome: "blocked", host: "api.firecrawl.dev" }),
    expect.objectContaining({ outcome: "faked", rule: "resend", recipient: "a@x.test", at: new Date("2026-09-28T09:00:02.000Z") }),
  ]);
  expect(blockedCalls(entries)).toEqual([{ host: "api.firecrawl.dev", url: "https://api.firecrawl.dev/v1/scrape", at: Date.parse("2026-09-28T09:00:01.000Z") }]);
  expect(fetchFn).toHaveBeenCalledWith("http://localhost:3000/api/sandbox/outbox?since=2026-09-28T09%3A00%3A00.000Z", {
    headers: { authorization: "Bearer tok" },
  });
});

it("says why when the outbox can't be read", async () => {
  const outbox = new HttpSandboxOutbox("http://x.test/outbox", "bad", (async () => new Response("", { status: 401 })) as unknown as typeof fetch);
  await expect(outbox.entriesSince(new Date())).rejects.toThrow(/HTTP 401/);
});
