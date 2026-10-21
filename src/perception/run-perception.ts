import { z } from "zod";
import { Meter, type ModelPrice } from "../llm/meter";
import type { LlmClient } from "../llm/types";
import { generatePersonas } from "../persona/generate";
import type { NewPrediction } from "../store/predictions";
import type { Finding, Persona } from "../types";
import { extractJsonObject } from "../util/json";
import { mapWithConcurrency } from "../util/pool";
import { aggregatePairs, aggregateVerdicts, rankObjections, type PairAggregate, type VerdictAggregate } from "./aggregate";
import { comparePair, type PairJudgment } from "./compare";
import { evaluate, type Verdict } from "./evaluate";
import type { Exhibit } from "./exhibits";
import { marketBrief, type MarketContext } from "./market-context";

const PERSONA_BATCH = 25;

export interface PerceptionOptions {
  /** Cheap model for the evaluators. */
  llm: LlmClient;
  /** Stronger model for evaluator personas and the summary. */
  judge: LlmClient;
  icp: string;
  product: string;
  /** One key ("main") for a perception run; two (e.g. A and B) for an experiment. */
  exhibitsByVariant: Record<string, Exhibit[]>;
  evaluators: number;
  concurrency: number;
  market?: MarketContext;
  price?: ModelPrice | null;
  judgePrice?: ModelPrice | null;
  /** Functional findings from a depth run, for the Launch Readiness verdict. */
  functional?: Finding[];
  rng?: () => number;
}

export interface Summary {
  verdict: string;
  fixes: { fix: string; addresses: string }[];
}

export interface PerceptionResult {
  mode: "single" | "experiment";
  variants: string[];
  evaluators: number;
  unusable: number;
  verdicts: Verdict[];
  pairs: PairJudgment[];
  /** Per variant. In an experiment only objections are filled (from the pairwise judgments). */
  aggregates: Record<string, VerdictAggregate>;
  pairAggregate?: PairAggregate;
  summary: Summary;
  predictions: NewPrediction[];
  usage: { inputTokens: number; outputTokens: number; costUsd?: number };
  market?: MarketContext;
}

const SummarySchema = z.object({ verdict: z.string().min(1), fixes: z.array(z.object({ fix: z.string(), addresses: z.string() })) });

const SUMMARY_SYSTEM = `You write the verdict of a Launch Readiness report from simulated buyer evidence.
Use only the numbers and quotes you are given; never invent statistics, percentages or conversion rates. Scores are on a 1–5 scale. This is simulated evidence, not real traction: say what the simulated buyers did, comparatively.
Reply with one JSON object: {"verdict": 3-5 plain sentences, "fixes": [{"fix": a concrete change to the product or its pages, "addresses": the objection category or finding it answers}]} with at most 5 fixes, most important first.`;

async function evaluatorPersonas(judge: LlmClient, icp: string, market: string | undefined, count: number): Promise<Persona[]> {
  const out: Persona[] = [];
  while (out.length < count) {
    const n = Math.min(PERSONA_BATCH, count - out.length);
    const batch = await generatePersonas(judge, market ? `${icp}\n\n${market}` : icp, n);
    out.push(...batch.map((p, i) => ({ ...p, id: `e${out.length + i + 1}` })));
  }
  return out;
}

const emptyAggregate = (evaluators: number, objections: VerdictAggregate["objections"]): VerdictAggregate => ({
  evaluators,
  unusable: 0,
  objections,
  intent: { no: 0, maybe: 0, yes: 0 },
  meanScores: { clarity: 0, credibility: 0, value: 0, urgency: 0 },
  wouldPay: { answers: 0, medianUsd: null, plans: {} },
  confusions: [],
});

function predictionsFor(r: Omit<PerceptionResult, "predictions" | "summary" | "usage">): NewPrediction[] {
  const out: NewPrediction[] = [];
  if (r.mode === "experiment" && r.pairAggregate) {
    const p = r.pairAggregate;
    const other = r.variants.find((v) => v !== p.leader) ?? "?";
    out.push({
      metric: "winner",
      claim: `${p.leader} beats ${other} (${Math.round(p.winRate * 100)}% of buyers who chose; 95% interval ${Math.round(p.interval.low * 100)}–${Math.round(p.interval.high * 100)}%${p.decisive ? "" : ", not decisive"})`,
      predicted: { winner: p.leader, winRate: p.winRate, interval: p.interval, decisive: p.decisive },
    });
    return out;
  }
  const a = r.aggregates[r.variants[0]];
  const top = a.objections[0];
  if (top) out.push({ metric: "top_objection", claim: `The top objection is ${top.category} (${top.buyers} of ${a.evaluators} buyers)`, predicted: { category: top.category, buyers: top.buyers, of: a.evaluators } });
  const share = a.evaluators ? (a.intent.yes + a.intent.maybe) / a.evaluators : 0;
  out.push({ metric: "intent_share", claim: `${Math.round(share * 100)}% of simulated buyers would consider it (not a conversion rate)`, predicted: { share, of: a.evaluators } });
  return out;
}

/** Design §7: breadth evaluators judge the exhibits; an experiment compares two variants pairwise. */
export async function runPerception(o: PerceptionOptions): Promise<PerceptionResult> {
  const variants = Object.keys(o.exhibitsByVariant);
  if (!variants.length || variants.length > 2) throw new Error("give one set of exhibits, or two variants to compare");
  const nav = new Meter();
  const judgeMeter = new Meter();
  const brief = o.market ? marketBrief(o.market) : undefined;
  const personas = await evaluatorPersonas({ complete: (req) => o.judge.complete({ ...req, onUsage: judgeMeter.add }) }, o.icp, brief, o.evaluators);

  let base: Omit<PerceptionResult, "predictions" | "summary" | "usage">;
  if (variants.length === 1) {
    const [only] = variants;
    const results = await mapWithConcurrency(personas, o.concurrency, (p) => evaluate(o.llm, p, o.exhibitsByVariant[only], { market: brief, onUsage: nav.add }));
    const verdicts = results.filter((v): v is Verdict => v !== null);
    const unusable = results.length - verdicts.length;
    base = { mode: "single", variants, evaluators: personas.length, unusable, verdicts, pairs: [], aggregates: { [only]: aggregateVerdicts(verdicts, unusable) }, market: o.market };
  } else {
    const [a, b] = variants;
    const rng = o.rng ?? Math.random;
    const results = await mapWithConcurrency(personas, o.concurrency, (p) =>
      comparePair(o.llm, p, o.exhibitsByVariant[a], o.exhibitsByVariant[b], { market: brief, onUsage: nav.add }, rng),
    );
    const pairs = results.filter((x): x is PairJudgment => x !== null);
    base = {
      mode: "experiment",
      variants,
      evaluators: personas.length,
      unusable: results.length - pairs.length,
      verdicts: [],
      pairs,
      aggregates: {
        [a]: emptyAggregate(pairs.length, rankObjections(pairs.map((p) => p.objectionsA))),
        [b]: emptyAggregate(pairs.length, rankObjections(pairs.map((p) => p.objectionsB))),
      },
      pairAggregate: aggregatePairs(pairs),
      market: o.market,
    };
  }

  const evidence = {
    product: o.product,
    buyers: o.icp,
    mode: base.mode,
    evaluators: base.evaluators,
    unusable: base.unusable,
    perVariant: base.aggregates,
    experiment: base.pairAggregate,
    functionalBlockers: (o.functional ?? []).filter((f) => f.severity !== "minor" && !f.sandboxCause).map((f) => `${f.severity}: ${f.title}`),
    market: brief,
  };
  let summary: Summary = { verdict: "Summary unavailable.", fixes: [] };
  try {
    const raw = await o.judge.complete({
      system: SUMMARY_SYSTEM,
      messages: [{ role: "user", content: `Evidence:\n${JSON.stringify(evidence, null, 2)}` }],
      maxTokens: 1500,
      onUsage: judgeMeter.add,
    });
    summary = SummarySchema.parse(extractJsonObject(raw));
  } catch (err) {
    console.warn(`Launch Readiness summary unavailable: ${err instanceof Error ? err.message : err}`);
  }

  const navCost = nav.costUsd(o.price);
  const judgeCost = judgeMeter.costUsd(o.judgePrice);
  return {
    ...base,
    summary,
    predictions: predictionsFor(base),
    usage: {
      inputTokens: nav.total.inputTokens + judgeMeter.total.inputTokens,
      outputTokens: nav.total.outputTokens + judgeMeter.total.outputTokens,
      costUsd: navCost !== undefined && judgeCost !== undefined ? navCost + judgeCost : undefined,
    },
  };
}
