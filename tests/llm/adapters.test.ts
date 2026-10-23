import { describe, expect, it, vi } from "vitest";
import { AnthropicLlm, type MessagesClient } from "../../src/llm/anthropic";
import { OpenAiCompatibleLlm } from "../../src/llm/openai-compatible";
import { createLlms, parseRouting } from "../../src/llm/factory";
import { OutOfCreditsError } from "../../src/llm/types";

const req = { system: "be brief", messages: [{ role: "user" as const, content: "hi" }], maxTokens: 100 };

describe("AnthropicLlm", () => {
  it("sends system/model and joins text blocks", async () => {
    const create = vi.fn().mockResolvedValue({
      stop_reason: "end_turn",
      content: [
        { type: "text", text: "hel" },
        { type: "text", text: "lo" },
      ],
    });
    const llm = new AnthropicLlm({ messages: { create } } as unknown as MessagesClient, "claude-haiku-4-5");
    expect(await llm.complete(req)).toBe("hello");
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ model: "claude-haiku-4-5", system: "be brief", max_tokens: 100 }),
    );
  });

  it("throws on refusal", async () => {
    const create = vi.fn().mockResolvedValue({ stop_reason: "refusal", content: [] });
    const llm = new AnthropicLlm({ messages: { create } } as unknown as MessagesClient, "m");
    await expect(llm.complete(req)).rejects.toThrow(/refused/);
  });

  it("stops at the first low-balance error and asks no more", async () => {
    const create = vi.fn().mockRejectedValue(new Error("400 Your credit balance is too low to access the Anthropic API."));
    const llm = new AnthropicLlm({ messages: { create } } as unknown as MessagesClient, "m");
    await expect(llm.complete(req)).rejects.toBeInstanceOf(OutOfCreditsError);
    await expect(llm.complete(req)).rejects.toBeInstanceOf(OutOfCreditsError);
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe("OpenAiCompatibleLlm", () => {
  it("posts chat completions with system message first", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 }),
    );
    const llm = new OpenAiCompatibleLlm({ baseUrl: "https://x.test/v1/", apiKey: "k", model: "m", fetchFn });
    expect(await llm.complete(req)).toBe("ok");
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe("https://x.test/v1/chat/completions");
    const body = JSON.parse(init.body);
    expect(body.messages[0]).toEqual({ role: "system", content: "be brief" });
    expect(init.headers.authorization).toBe("Bearer k");
  });

  it("throws on HTTP errors without retrying", async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response("nope", { status: 401 }));
    const llm = new OpenAiCompatibleLlm({ baseUrl: "https://x.test/v1", apiKey: "k", model: "m", fetchFn });
    await expect(llm.complete(req)).rejects.toThrow(/401/);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("retries rate limits and server errors, honouring retry-after", async () => {
    const ok = new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 });
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(new Response("busy", { status: 429, headers: { "retry-after": "2" } }))
      .mockResolvedValueOnce(new Response("oops", { status: 502 }))
      .mockResolvedValueOnce(ok);
    const sleep = vi.fn(async (_ms: number) => {});
    const llm = new OpenAiCompatibleLlm({ baseUrl: "https://x.test/v1", apiKey: "k", model: "m", fetchFn, sleep });
    expect(await llm.complete(req)).toBe("ok");
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls[0][0]).toBe(2000);
  });

  it("stops at the first out-of-credits reply and asks no more (2026-10-21)", async () => {
    const fetchFn = vi.fn(async () => new Response('{"error":{"message":"This request would exceed your available credits","code":402}}', { status: 402 }));
    const llm = new OpenAiCompatibleLlm({ baseUrl: "https://x.test/v1", apiKey: "k", model: "m", fetchFn, sleep: async () => {} });
    await expect(llm.complete(req)).rejects.toBeInstanceOf(OutOfCreditsError);
    // Every agent shares the client: the others stop at their next step, without paying for a request each.
    await expect(llm.complete(req)).rejects.toThrow(/out of credits/);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("asks for a shorter reply when that is all the balance covers (2026-10-22)", async () => {
    const short = '{"error":{"message":"This request requires more credits, or fewer max_tokens. You requested up to 16000 tokens, but can only afford 7001.","code":402}}';
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(new Response(short, { status: 402 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 }));
    const llm = new OpenAiCompatibleLlm({ baseUrl: "https://x.test/v1", apiKey: "k", model: "m", fetchFn });
    expect(await llm.complete({ ...req, maxTokens: 16000 })).toBe("ok");
    const sizes = fetchFn.mock.calls.map((c) => JSON.parse((c as unknown as [string, RequestInit])[1].body as string).max_tokens);
    expect(sizes).toEqual([16000, 7001]);
    // Too little for any useful reply: out of credits.
    const broke = vi.fn(async () => new Response(short.replace("7001", "300"), { status: 402 }));
    await expect(new OpenAiCompatibleLlm({ baseUrl: "https://x.test/v1", apiKey: "k", model: "m", fetchFn: broke }).complete(req)).rejects.toBeInstanceOf(OutOfCreditsError);
  });

  it("gives up after repeated rate limits", async () => {
    const fetchFn = vi.fn(async () => new Response("busy", { status: 429 }));
    const llm = new OpenAiCompatibleLlm({ baseUrl: "https://x.test/v1", apiKey: "k", model: "m", fetchFn, sleep: async () => {} });
    await expect(llm.complete(req)).rejects.toThrow(/429/);
    expect(fetchFn).toHaveBeenCalledTimes(4);
  });

  it("asks for less thinking only when a reasoning effort is set", async () => {
    const reply = () => new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 });
    const fetchFn = vi.fn(async () => reply());
    await new OpenAiCompatibleLlm({ baseUrl: "https://x.test/v1", apiKey: "k", model: "m", fetchFn, reasoningEffort: "low" }).complete(req);
    await new OpenAiCompatibleLlm({ baseUrl: "https://x.test/v1", apiKey: "k", model: "m", fetchFn }).complete(req);
    const bodies = fetchFn.mock.calls.map((c) => JSON.parse((c as unknown as [string, RequestInit])[1].body as string));
    expect(bodies[0].reasoning).toEqual({ effort: "low" });
    expect(bodies[1]).not.toHaveProperty("reasoning");
  });

  it("treats a missing reply as empty text", async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: null } }] }), { status: 200 }));
    const llm = new OpenAiCompatibleLlm({ baseUrl: "https://x.test/v1", apiKey: "k", model: "m", fetchFn });
    expect(await llm.complete(req)).toBe("");
  });
});

describe("createLlms", () => {
  it("requires a key", () => {
    expect(() => createLlms({})).toThrow(/DEBUTLY_API_KEY/);
  });

  it("defaults to anthropic with a cheap nav model and a strong judge model", () => {
    const { nav, judge } = createLlms({ DEBUTLY_API_KEY: "k" });
    expect(nav).toBeInstanceOf(AnthropicLlm);
    expect((nav as AnthropicLlm).model).toBe("claude-haiku-4-5");
    expect((judge as AnthropicLlm).model).toBe("claude-opus-5");
  });

  it("passes DEBUTLY_REASONING_EFFORT to openai-compatible models", () => {
    const { nav } = createLlms({
      DEBUTLY_API_KEY: "k",
      DEBUTLY_PROVIDER: "openai-compatible",
      DEBUTLY_BASE_URL: "https://x.test/v1",
      DEBUTLY_NAV_MODEL: "a",
      DEBUTLY_JUDGE_MODEL: "b",
      DEBUTLY_REASONING_EFFORT: "low",
    });
    expect((nav as OpenAiCompatibleLlm).reasoningEffort).toBe("low");
  });

  it("requires base url and models for openai-compatible", () => {
    expect(() => createLlms({ DEBUTLY_API_KEY: "k", DEBUTLY_PROVIDER: "openai-compatible" })).toThrow(/DEBUTLY_BASE_URL/);
  });

  it("on OpenRouter, sends pages only to providers that keep no data, unless told otherwise", async () => {
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        bodies.push(JSON.parse(init.body as string));
        return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }));
      }),
    );
    const env = { DEBUTLY_API_KEY: "k", DEBUTLY_PROVIDER: "openai-compatible", DEBUTLY_BASE_URL: "https://openrouter.ai/api/v1", DEBUTLY_NAV_MODEL: "a", DEBUTLY_JUDGE_MODEL: "b" };
    const providers = async (over: Record<string, string>) => {
      bodies.length = 0;
      const { nav, judge } = createLlms({ ...env, ...over });
      await nav.complete(req);
      await judge.complete(req);
      return bodies.map((b) => b.provider);
    };
    try {
      const noRetention = { zdr: true, data_collection: "deny" };
      expect(await providers({})).toEqual([noRetention, noRetention]);
      // Routing of its own is added to the policy, for the judge too.
      expect(await providers({ DEBUTLY_NAV_ROUTING: '{"sort":"throughput"}', DEBUTLY_JUDGE_ROUTING: '{"order":["deepinfra"]}' })).toEqual([
        { ...noRetention, sort: "throughput" },
        { ...noRetention, order: ["deepinfra"] },
      ]);
      expect(await providers({ DEBUTLY_ZERO_RETENTION: "off" })).toEqual([undefined, undefined]);
      // Another provider has its own terms; OpenRouter's settings mean nothing there.
      expect(await providers({ DEBUTLY_BASE_URL: "https://api.deepseek.com/v1" })).toEqual([undefined, undefined]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("usage reporting", () => {
  it("OpenAI-compatible reports the provider's token counts per request", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 1200, completion_tokens: 80 } }), { status: 200 }),
    );
    const onUsage = vi.fn();
    await new OpenAiCompatibleLlm({ baseUrl: "https://x.test/v1", apiKey: "k", model: "m", fetchFn }).complete({ ...req, onUsage });
    expect(onUsage).toHaveBeenCalledWith({ inputTokens: 1200, outputTokens: 80 });
  });

  it("Anthropic reports the provider's token counts per request", async () => {
    const create = vi.fn().mockResolvedValue({ stop_reason: "end_turn", content: [{ type: "text", text: "x" }], usage: { input_tokens: 900, output_tokens: 40 } });
    const onUsage = vi.fn();
    await new AnthropicLlm({ messages: { create } } as unknown as MessagesClient, "m").complete({ ...req, onUsage });
    expect(onUsage).toHaveBeenCalledWith({ inputTokens: 900, outputTokens: 40 });
  });
});

describe("what requests actually cost", () => {
  it("on OpenRouter, asks for and reports each request's charge, and passes provider routing", async () => {
    const fetchFn = vi.fn(
      async () => new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 10, completion_tokens: 2, cost: 0.0000045 } }), { status: 200 }),
    );
    const usage: unknown[] = [];
    const provider = { order: ["google-ai-studio/flex"] };
    await new OpenAiCompatibleLlm({ baseUrl: "https://openrouter.ai/api/v1", apiKey: "k", model: "m", fetchFn, provider }).complete({ ...req, onUsage: (u) => usage.push(u) });
    const body = JSON.parse((fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.usage).toEqual({ include: true });
    expect(body.provider).toEqual(provider);
    expect(usage).toEqual([{ inputTokens: 10, outputTokens: 2, costUsd: 0.0000045 }]);
  });

  it("other providers get neither field", async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }), { status: 200 }));
    const usage: unknown[] = [];
    await new OpenAiCompatibleLlm({ baseUrl: "https://x.test/v1", apiKey: "k", model: "m", fetchFn }).complete({ ...req, onUsage: (u) => usage.push(u) });
    const body = JSON.parse((fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body).not.toHaveProperty("usage");
    expect(body).not.toHaveProperty("provider");
    expect(usage).toEqual([{ inputTokens: 1, outputTokens: 1 }]);
  });

  it("reads DEBUTLY_NAV_ROUTING as JSON and rejects anything else", () => {
    expect(parseRouting(undefined)).toBeUndefined();
    expect(parseRouting(' {"sort":"throughput"} ')).toEqual({ sort: "throughput" });
    expect(() => parseRouting("flex")).toThrow(/not valid JSON/);
    expect(() => parseRouting("[1]")).toThrow(/JSON object/);
  });
});
