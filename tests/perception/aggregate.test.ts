import { expect, it } from "vitest";
import { aggregatePairs, aggregateVerdicts, wilson } from "../../src/perception/aggregate";
import type { PairJudgment } from "../../src/perception/compare";
import type { Verdict } from "../../src/perception/evaluate";

it("computes the Wilson 95% interval", () => {
  const w = wilson(60, 100);
  expect(w.low).toBeCloseTo(0.502, 3);
  expect(w.high).toBeCloseTo(0.691, 3);
  expect(wilson(0, 0)).toEqual({ low: 0, high: 1 });
});

const verdict = (id: string, intent: Verdict["intent"], categories: Verdict["objections"][number]["category"][], pay: number | null): Verdict => ({
  evaluatorId: id,
  objections: categories.map((category) => ({ category, text: `${category} worry from ${id}` })),
  confusions: [{ text: "What is a seat?", exhibitId: "/pricing" }],
  scores: { clarity: 3, credibility: 2, value: intent === "yes" ? 4 : 2, urgency: 2 },
  intent,
  wouldPay: pay === null ? null : { plan: "Solo", monthlyUsd: pay },
  summary: "",
});

it("ranks objections by how many buyers raised them, and summarises intent and willingness to pay", () => {
  const a = aggregateVerdicts(
    [verdict("e1", "no", ["price", "trust"], null), verdict("e2", "maybe", ["price", "price", "complexity"], 19), verdict("e3", "yes", ["trust", "price"], 49)],
    1,
  );
  expect(a.evaluators).toBe(3);
  expect(a.unusable).toBe(1);
  expect(a.objections.map((o) => [o.category, o.buyers])).toEqual([
    ["price", 3],
    ["trust", 2],
    ["complexity", 1],
  ]);
  expect(a.objections[0].examples).toHaveLength(3);
  expect(a.intent).toEqual({ no: 1, maybe: 1, yes: 1 });
  expect(a.meanScores.value).toBeCloseTo(8 / 3);
  expect(a.wouldPay).toEqual({ answers: 2, medianUsd: 34, plans: { Solo: 2 } });
  expect(a.confusions).toEqual([{ exhibitId: "/pricing", count: 3, examples: ["What is a seat?"] }]);
});

const pair = (preferred: PairJudgment["preferred"], shownFirst: "A" | "B" = "A"): PairJudgment => ({
  evaluatorId: "e",
  preferred,
  reasons: [`chose ${preferred}`],
  objectionsA: [{ category: "price", text: "a" }],
  objectionsB: [{ category: "trust", text: "b" }],
  shownFirst,
});

it("reports the leader's win rate with an interval, decisive only when it excludes 50/50", () => {
  const clear = aggregatePairs([...Array(30).fill(pair("B")), ...Array(10).fill(pair("A")), pair("neither")]);
  expect(clear).toMatchObject({ winsA: 10, winsB: 30, neither: 1, leader: "B", decisive: true });
  expect(clear.winRate).toBeCloseTo(0.75);
  const close = aggregatePairs([...Array(11).fill(pair("B")), ...Array(9).fill(pair("A"))]);
  expect(close.decisive).toBe(false);
});

it("measures position bias: how often the first-shown option won", () => {
  const p = aggregatePairs([pair("A", "A"), pair("A", "A"), pair("B", "A"), pair("B", "B")]);
  expect(p.firstShownWinShare).toBeCloseTo(3 / 4);
});
