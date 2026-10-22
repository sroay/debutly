import { OutOfCreditsError, type LlmClient, type LlmRequest } from "./types";

export interface OpenAiCompatibleOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  fetchFn?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** OpenRouter's unified reasoning control. Clicking through pages rarely needs deep thinking. */
  reasoningEffort?: string;
  /**
   * OpenRouter provider routing, passed through: e.g. {"order":["google-ai-studio/flex"]} for
   * Gemini's half-price tier, or {"sort":"throughput"} for the fastest host of an open model.
   */
  provider?: Record<string, unknown>;
}

const MAX_ATTEMPTS = 4;
const MAX_WAIT_MS = 30_000;
const isRetryable = (status: number) => status === 429 || status >= 500;

export class OpenAiCompatibleLlm implements LlmClient {
  private outOfCredits?: OutOfCreditsError;

  constructor(private readonly opts: OpenAiCompatibleOptions) {}

  get reasoningEffort(): string | undefined {
    return this.opts.reasoningEffort;
  }

  async complete(req: LlmRequest): Promise<string> {
    if (this.outOfCredits) throw this.outOfCredits;
    const fetchFn = this.opts.fetchFn ?? fetch;
    const openRouter = /openrouter.ai/.test(this.opts.baseUrl);
    const sleep = this.opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    const body = JSON.stringify({
      model: this.opts.model,
      max_tokens: req.maxTokens ?? 4096,
      messages: [{ role: "system", content: req.system }, ...req.messages],
      ...(this.opts.reasoningEffort ? { reasoning: { effort: this.opts.reasoningEffort } } : {}),
      ...(this.opts.provider ? { provider: this.opts.provider } : {}),
      // OpenRouter then reports what each request actually cost.
      ...(openRouter ? { usage: { include: true } } : {}),
    });

    for (let attempt = 1; ; attempt++) {
      const res = await fetchFn(`${this.opts.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.opts.apiKey}` },
        body,
      });
      if (res.ok) {
        const data = (await res.json()) as {
          choices?: { message?: { content?: string | null } }[];
          usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
        };
        if (data.usage) {
          const { prompt_tokens = 0, completion_tokens = 0, cost } = data.usage;
          req.onUsage?.({ inputTokens: prompt_tokens, outputTokens: completion_tokens, ...(typeof cost === "number" ? { costUsd: cost } : {}) });
        }
        return data.choices?.[0]?.message?.content ?? "";
      }
      const text = await res.text();
      // OpenRouter: the account (or the key's limit) can't cover this request.
      if (res.status === 402) {
        this.outOfCredits = new OutOfCreditsError(text);
        throw this.outOfCredits;
      }
      if (!isRetryable(res.status) || attempt >= MAX_ATTEMPTS) {
        throw new Error(`LLM HTTP ${res.status}: ${text}`);
      }
      const retryAfter = Number(res.headers.get("retry-after"));
      const waitMs = retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt;
      await sleep(Math.min(waitMs, MAX_WAIT_MS));
    }
  }
}
