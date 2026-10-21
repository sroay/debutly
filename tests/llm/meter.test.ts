import { expect, it } from "vitest";
import { ScriptedLlm } from "../../src/llm/scripted";
import { Meter } from "../../src/llm/meter";

it("sums usage and prices it per million tokens", () => {
  const meter = new Meter();
  meter.add({ inputTokens: 600_000, outputTokens: 20_000 });
  meter.add({ inputTokens: 400_000, outputTokens: 5_000 });
  expect(meter.total).toEqual({ inputTokens: 1_000_000, outputTokens: 25_000 });
  expect(meter.costUsd({ inputPerMTok: 0.5, outputPerMTok: 3 })).toBeCloseTo(0.575);
  expect(meter.costUsd(null)).toBeUndefined();
});

it("scripted replies report an estimate (4 characters per token), so tests can meter too", async () => {
  const usage: unknown[] = [];
  await new ScriptedLlm(() => "12345678").complete({ system: "abcd", messages: [{ role: "user", content: "efgh" }], onUsage: (u) => usage.push(u) });
  expect(usage).toEqual([{ inputTokens: 2, outputTokens: 2 }]);
});

it("prefers what the provider charged when every request reported it", () => {
  const charged = new Meter();
  charged.add({ inputTokens: 1_000_000, outputTokens: 0, costUsd: 0.375 });
  charged.add({ inputTokens: 0, outputTokens: 1_000_000, costUsd: 1.875 });
  expect(charged.costUsd({ inputPerMTok: 0.75, outputPerMTok: 3.75 })).toBeCloseTo(2.25);
  expect(charged.costUsd(null)).toBeCloseTo(2.25);

  // One request without a charge: fall back to the list-price estimate for all of them.
  const mixed = new Meter();
  mixed.add({ inputTokens: 1_000_000, outputTokens: 0, costUsd: 0.375 });
  mixed.add({ inputTokens: 1_000_000, outputTokens: 0 });
  expect(mixed.costUsd({ inputPerMTok: 0.75, outputPerMTok: 3.75 })).toBeCloseTo(1.5);
});
