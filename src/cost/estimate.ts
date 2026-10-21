import type { ModelPrice } from "../llm/meter";

export interface CostEstimate {
  low: number;
  high: number;
}

// Typical navigation step on the 2026-09-27/28 runs: ~2,500 prompt tokens (page + history, with
// provider-side caching) and ~150 reply tokens. That brackets the observed ~$0.08 per 3-agent run.
// Replace with averages from stored runs once enough are recorded.
const TOKENS_PER_STEP = { input: 2500, output: 150 };

/** Cost range for a run: agents using 60% (low) to 100% (high) of their step budget. */
export function estimateRunCost(o: { agents: number; maxSteps: number; price: ModelPrice | null; tokensPerStep?: { input: number; output: number } }): CostEstimate | null {
  if (!o.price) return null;
  const t = o.tokensPerStep ?? TOKENS_PER_STEP;
  const perStep = (t.input * o.price.inputPerMTok + t.output * o.price.outputPerMTok) / 1_000_000;
  const high = o.agents * o.maxSteps * perStep;
  return { low: high * 0.6, high };
}

// One evaluator call: the pages (~3,000 tokens; two variants ~5,000) plus rubric and persona in,
// a JSON verdict (~450 tokens) out. Persona generation and the summary add little.
const EVALUATOR_TOKENS = { single: { input: 3500, output: 450 }, experiment: { input: 5500, output: 500 } };

/** Cost range for a perception run: ±20% around the per-call estimate. */
export function estimatePerceptionCost(o: { evaluators: number; experiment: boolean; price: ModelPrice | null }): CostEstimate | null {
  if (!o.price) return null;
  const t = o.experiment ? EVALUATOR_TOKENS.experiment : EVALUATOR_TOKENS.single;
  const mid = (o.evaluators * (t.input * o.price.inputPerMTok + t.output * o.price.outputPerMTok)) / 1_000_000;
  return { low: mid * 0.8, high: mid * 1.2 };
}
