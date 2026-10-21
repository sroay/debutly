import { expect, it, vi } from "vitest";
import { fetchModelPrice } from "../../src/cost/prices";

const catalogue = { data: [{ id: "google/gemini-3.8-flash", pricing: { prompt: "0.00000075", completion: "0.00000375" } }] };

it("reads USD-per-token prices from OpenRouter's model list as per-million", async () => {
  const fetchFn = vi.fn(async () => Response.json(catalogue));
  expect(await fetchModelPrice("google/gemini-3.8-flash", fetchFn as unknown as typeof fetch)).toEqual({ inputPerMTok: 0.75, outputPerMTok: 3.75 });
  expect(fetchFn).toHaveBeenCalledWith("https://openrouter.ai/api/v1/models");
});

it("falls back to the built-in table when the list is unreachable", async () => {
  const fetchFn = vi.fn(async () => {
    throw new Error("offline");
  });
  expect(await fetchModelPrice("deepseek/deepseek-v4-flash", fetchFn as unknown as typeof fetch)).toEqual({ inputPerMTok: 0.079, outputPerMTok: 0.159 });
});

it("says the price is unknown rather than guessing", async () => {
  const fetchFn = vi.fn(async () => Response.json({ data: [] }));
  expect(await fetchModelPrice("someone/unknown-model", fetchFn as unknown as typeof fetch)).toBeNull();
});
