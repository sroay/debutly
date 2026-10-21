import { expect, it } from "vitest";
import { estimateRunCost } from "../../src/cost/estimate";

it("brackets a run between agents using 60% and 100% of their steps", () => {
  const e = estimateRunCost({ agents: 3, maxSteps: 25, price: { inputPerMTok: 0.75, outputPerMTok: 3.75 } })!;
  // per step: 2,500 input × $0.75/M + 150 output × $3.75/M = $0.0024375
  expect(e.high).toBeCloseTo(3 * 25 * 0.0024375);
  expect(e.low).toBeCloseTo(e.high * 0.6);
});

it("returns no figure for an unknown price", () => {
  expect(estimateRunCost({ agents: 3, maxSteps: 25, price: null })).toBeNull();
});

it("estimates a perception run from evaluator calls", async () => {
  const { estimatePerceptionCost } = await import("../../src/cost/estimate");
  const e = estimatePerceptionCost({ evaluators: 50, experiment: false, price: { inputPerMTok: 0.75, outputPerMTok: 3.75 } })!;
  // per call: 3,500 × 0.75/M + 450 × 3.75/M = $0.0043125
  expect((e.low + e.high) / 2).toBeCloseTo(50 * 0.0043125);
});
