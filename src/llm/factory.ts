import { AnthropicLlm } from "./anthropic";
import { OpenAiCompatibleLlm } from "./openai-compatible";
import type { LlmClient } from "./types";

export interface LlmPair {
  nav: LlmClient;
  judge: LlmClient;
}

/** DEBUTLY_NAV_ROUTING: OpenRouter provider preferences as JSON, e.g. {"order":["google-ai-studio/flex"]}. */
export function parseRouting(json: string | undefined): Record<string, unknown> | undefined {
  if (!json?.trim()) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new Error(`DEBUTLY_NAV_ROUTING is not valid JSON: ${json}`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("DEBUTLY_NAV_ROUTING must be a JSON object");
  return value as Record<string, unknown>;
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
    const provider = parseRouting(env.DEBUTLY_NAV_ROUTING);
    return {
      nav: new OpenAiCompatibleLlm({ baseUrl, apiKey, model: navModel, reasoningEffort, provider }),
      judge: new OpenAiCompatibleLlm({ baseUrl, apiKey, model: judgeModel }),
    };
  }

  throw new Error(`Unknown DEBUTLY_PROVIDER "${provider}"`);
}
