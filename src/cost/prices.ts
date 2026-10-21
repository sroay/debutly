import type { ModelPrice } from "../llm/meter";

// USD per million tokens, from OpenRouter's model list on 2026-09-28. Used when it can't be reached.
const KNOWN: Record<string, ModelPrice> = {
  "google/gemini-3.8-flash": { inputPerMTok: 0.75, outputPerMTok: 3.75 },
  "z-ai/glm-5.3-flash": { inputPerMTok: 0.15, outputPerMTok: 0.5 },
  "deepseek/deepseek-v4-flash": { inputPerMTok: 0.079, outputPerMTok: 0.159 },
  "anthropic/claude-haiku-4.5": { inputPerMTok: 1, outputPerMTok: 5 },
  "claude-haiku-4-5": { inputPerMTok: 1, outputPerMTok: 5 },
  "anthropic/claude-sonnet-5": { inputPerMTok: 2, outputPerMTok: 10 },
  "anthropic/claude-opus-5": { inputPerMTok: 5, outputPerMTok: 25 },
  "claude-opus-5": { inputPerMTok: 5, outputPerMTok: 25 },
};

/** A model's price per million tokens: OpenRouter's live list, then the table above, else null (unknown). */
export async function fetchModelPrice(model: string, fetchFn: typeof fetch = fetch): Promise<ModelPrice | null> {
  try {
    const res = await fetchFn("https://openrouter.ai/api/v1/models");
    if (res.ok) {
      const { data = [] } = (await res.json()) as { data?: { id: string; pricing?: { prompt?: string; completion?: string } }[] };
      const pricing = data.find((m) => m.id === model)?.pricing;
      const input = Number(pricing?.prompt);
      const output = Number(pricing?.completion);
      if (Number.isFinite(input) && Number.isFinite(output) && pricing) {
        return { inputPerMTok: Math.round(input * 1e9) / 1e3, outputPerMTok: Math.round(output * 1e9) / 1e3 };
      }
    }
  } catch {
    // Offline or blocked: fall through to the table.
  }
  return KNOWN[model] ?? null;
}
