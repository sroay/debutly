import type { PairJudgment } from "./compare";
import type { ObjectionCategory, Verdict } from "./evaluate";

/** Wilson score interval (95%) for a proportion: sensible even for small samples. */
export function wilson(successes: number, n: number, z = 1.96): { low: number; high: number } {
  if (n === 0) return { low: 0, high: 1 };
  const p = successes / n;
  const denom = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denom;
  const margin = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return { low: Math.max(0, centre - margin), high: Math.min(1, centre + margin) };
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export interface VerdictAggregate {
  evaluators: number;
  unusable: number;
  /** Ranked by how many buyers raised each category (at least once). */
  objections: { category: ObjectionCategory; buyers: number; examples: string[] }[];
  intent: { no: number; maybe: number; yes: number };
  meanScores: { clarity: number; credibility: number; value: number; urgency: number };
  wouldPay: { answers: number; medianUsd: number | null; plans: Record<string, number> };
  confusions: { exhibitId: string; count: number; examples: string[] }[];
}

/** Objection categories ranked by how many buyers raised each (at least once), with example quotes. */
export function rankObjections(perBuyer: { category: ObjectionCategory; text: string }[][]): VerdictAggregate["objections"] {
  const byCategory = new Map<ObjectionCategory, { buyers: number; examples: string[] }>();
  for (const objections of perBuyer) {
    for (const category of new Set(objections.map((o) => o.category))) {
      const entry = byCategory.get(category) ?? { buyers: 0, examples: [] };
      entry.buyers++;
      const quote = objections.find((o) => o.category === category)!.text;
      if (entry.examples.length < 3 && !entry.examples.includes(quote)) entry.examples.push(quote);
      byCategory.set(category, entry);
    }
  }
  return [...byCategory.entries()].map(([category, e]) => ({ category, ...e })).sort((a, b) => b.buyers - a.buyers);
}

export function aggregateVerdicts(verdicts: Verdict[], unusable = 0): VerdictAggregate {
  const mean = (k: keyof Verdict["scores"]) => (verdicts.length ? verdicts.reduce((n, v) => n + v.scores[k], 0) / verdicts.length : 0);
  const payers = verdicts.filter((v) => v.intent !== "no" && v.wouldPay).map((v) => v.wouldPay!);
  const plans: Record<string, number> = {};
  for (const p of payers) plans[p.plan] = (plans[p.plan] ?? 0) + 1;
  const confusions = new Map<string, { count: number; examples: string[] }>();
  for (const c of verdicts.flatMap((v) => v.confusions)) {
    const key = c.exhibitId ?? "general";
    const entry = confusions.get(key) ?? { count: 0, examples: [] };
    entry.count++;
    if (entry.examples.length < 3 && !entry.examples.includes(c.text)) entry.examples.push(c.text);
    confusions.set(key, entry);
  }
  return {
    evaluators: verdicts.length,
    unusable,
    objections: rankObjections(verdicts.map((v) => v.objections)),
    intent: {
      no: verdicts.filter((v) => v.intent === "no").length,
      maybe: verdicts.filter((v) => v.intent === "maybe").length,
      yes: verdicts.filter((v) => v.intent === "yes").length,
    },
    meanScores: { clarity: mean("clarity"), credibility: mean("credibility"), value: mean("value"), urgency: mean("urgency") },
    wouldPay: { answers: payers.length, medianUsd: payers.length ? median(payers.map((p) => p.monthlyUsd)) : null, plans },
    confusions: [...confusions.entries()].map(([exhibitId, e]) => ({ exhibitId, ...e })).sort((a, b) => b.count - a.count),
  };
}

export interface PairAggregate {
  winsA: number;
  winsB: number;
  neither: number;
  /** The variant more buyers chose (ties go to A), and its share of decided judgments. */
  leader: "A" | "B";
  winRate: number;
  interval: { low: number; high: number };
  /** The interval excludes 50/50: the lead is unlikely to be noise. */
  decisive: boolean;
  /** Share of decided judgments won by whichever option was shown first (0.5 = no position bias). */
  firstShownWinShare: number;
  reasons: { A: string[]; B: string[] };
}

export function aggregatePairs(pairs: PairJudgment[]): PairAggregate {
  const winsA = pairs.filter((p) => p.preferred === "A").length;
  const winsB = pairs.filter((p) => p.preferred === "B").length;
  const decided = winsA + winsB;
  const leader = winsB > winsA ? "B" : "A";
  const leaderWins = Math.max(winsA, winsB);
  const interval = wilson(leaderWins, decided);
  const firstWins = pairs.filter((p) => p.preferred !== "neither" && p.preferred === p.shownFirst).length;
  return {
    winsA,
    winsB,
    neither: pairs.length - decided,
    leader,
    winRate: decided ? leaderWins / decided : 0,
    interval,
    decisive: decided > 0 && interval.low > 0.5,
    firstShownWinShare: decided ? firstWins / decided : 0,
    reasons: {
      A: pairs.filter((p) => p.preferred === "A").flatMap((p) => p.reasons).slice(0, 5),
      B: pairs.filter((p) => p.preferred === "B").flatMap((p) => p.reasons).slice(0, 5),
    },
  };
}
