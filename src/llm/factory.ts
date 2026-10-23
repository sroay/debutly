import { AnthropicLlm } from "./anthropic";
import { OpenAiCompatibleLlm } from "./openai-compatible";
import { isOpenRouter } from "./openrouter";
import type { LlmClient } from "./types";

export interface LlmPair {
  nav: LlmClient;
  judge: LlmClient;
}

/** DEBUTLY_NAV_ROUTING / DEBUTLY_JUDGE_ROUTING: OpenRouter provider preferences as JSON, e.g. {"order":["google-ai-studio/flex"]}. */
export function parseRouting(json: string | undefined, name = "DEBUTLY_NAV_ROUTING"): Record<string, unknown> | undefined {
  if (!json?.trim()) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new Error(`${name} is not valid JSON: ${json}`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} must be a JSON object`);
  return value as Record<string, unknown>;
}

// Agents send the pages they read to the model provider. On OpenRouter, Debutly asks only for
// providers that neither keep prompts (zero data retention) nor use them for training. The
// recommended models are served that way at their usual price (checked 2026-10-23).
// DEBUTLY_ZERO_RETENTION=off allows any provider.
const NO_RETENTION = { zdr: true, data_collection: "deny" } as const;

export function routing(env: Record<string, string | undefined>, baseUrl: string, own: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  const zeroRetention = isOpenRouter(baseUrl) && !/^(off|false|0|no)$/i.test(env.DEBUTLY_ZERO_RETENTION ?? "");
  if (!zeroRetention) return own;
  return { ...NO_RETENTION, ...own };
}

export function createLlms(env: Record<string, string | undefined>): LlmPair {
  const apiKey = env.DEBUTLY_API_KEY;
  if (!apiKey) throw new Error("DEBUTLY_API_KEY is required (bring your own key)");
  const provider = env.DEBUTLY_PROVIDER ?? "anthropic";

  if (provider === "anthropic") {
    return {
      nav: AnthropicLlm.fromApiKey(apiKey, env.DEBUTLY_NAV_MODEL ?? "claude-haiku-4-5"),
      judge: AnthropicLlm.fromApiKey(apiKey, env.DEBUTLY_JUDGE_MODEL ?? "claude-opus-5"),
    };
  }

  if (provider === "openai-compatible") {
    const baseUrl = env.DEBUTLY_BASE_URL;
    const navModel = env.DEBUTLY_NAV_MODEL;
    const judgeModel = env.DEBUTLY_JUDGE_MODEL;
    if (!baseUrl || !navModel || !judgeModel) {
      throw new Error("openai-compatible requires DEBUTLY_BASE_URL, DEBUTLY_NAV_MODEL and DEBUTLY_JUDGE_MODEL");
    }
    const reasoningEffort = env.DEBUTLY_REASONING_EFFORT || undefined;
    const navProvider = routing(env, baseUrl, parseRouting(env.DEBUTLY_NAV_ROUTING));
    const judgeProvider = routing(env, baseUrl, parseRouting(env.DEBUTLY_JUDGE_ROUTING, "DEBUTLY_JUDGE_ROUTING"));
    return {
      nav: new OpenAiCompatibleLlm({ baseUrl, apiKey, model: navModel, reasoningEffort, provider: navProvider }),
      judge: new OpenAiCompatibleLlm({ baseUrl, apiKey, model: judgeModel, provider: judgeProvider }),
    };
  }

  throw new Error(`Unknown DEBUTLY_PROVIDER "${provider}"`);
}
