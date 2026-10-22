import { expect, it, vi } from "vitest";
import { creditCheck, keyCreditsLeft } from "../../src/llm/credits";

const key = (data: unknown) => vi.fn(async () => new Response(JSON.stringify({ data }), { status: 200 }));

it("reads what an OpenRouter key may still spend", async () => {
  const fetchFn = key({ limit: 10, limit_remaining: 1.25 });
  expect(await keyCreditsLeft("https://openrouter.ai/api/v1/", "k", fetchFn)).toBe(1.25);
  const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe("https://openrouter.ai/api/v1/key");
  expect((init.headers as Record<string, string>).authorization).toBe("Bearer k");
});

it("can't tell for a key without a limit, another provider, or a failed lookup", async () => {
  expect(await keyCreditsLeft("https://openrouter.ai/api/v1", "k", key({ limit: null, limit_remaining: null }))).toBeNull();
  const elsewhere = key({ limit_remaining: 5 });
  expect(await keyCreditsLeft("https://api.together.xyz/v1", "k", elsewhere)).toBeNull();
  expect(elsewhere).not.toHaveBeenCalled();
  expect(await keyCreditsLeft("https://openrouter.ai/api/v1", "k", vi.fn(async () => new Response("no", { status: 401 })))).toBeNull();
  expect(await keyCreditsLeft("https://openrouter.ai/api/v1", "k", vi.fn(async () => Promise.reject(new Error("offline"))))).toBeNull();
});

it("refuses a run the key can't pay for at all, and warns when it may run short", () => {
  const estimate = { low: 0.4, high: 1.2 };
  expect(creditCheck(0.1, estimate)).toEqual({ refuse: expect.stringMatching(/\$0\.10 left.*at least \$0\.40/) });
  expect(creditCheck(0.8, estimate)).toEqual({ warn: expect.stringMatching(/\$0\.80 left.*up to \$1\.20/) });
  expect(creditCheck(5, estimate)).toEqual({});
  expect(creditCheck(null, estimate)).toEqual({});
  expect(creditCheck(0.1, null)).toEqual({});
});
