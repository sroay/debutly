import { expect, it } from "vitest";
import { ScriptedLlm } from "../../src/llm/scripted";
import type { LlmRequest } from "../../src/llm/types";
import type { Exhibit } from "../../src/perception/exhibits";
import { runPerception } from "../../src/perception/run-perception";
import { renderLaunchReadiness } from "../../src/report/launch-readiness";

const buyer = (name: string) => ({ name, background: "Runs a small agency.", goal: "Track rivals", patience: "low", techSavvy: "medium" });
const verdict = { objections: [{ category: "price", text: "Too dear", exhibitId: "/pricing" }, { category: "trust", text: "No customer logos", exhibitId: "/" }], confusions: [], scores: { clarity: 3, credibility: 2, value: 3, urgency: 2 }, intent: "maybe", wouldPay: { plan: "Solo", monthlyUsd: 29 }, summary: "Maybe." };
const pair = { objections1: [{ category: "price", text: "pricier" }], objections2: [{ category: "trust", text: "unknown brand" }], preferred: "2", reasons: ["clearer plans"] };
const summary = { verdict: "Buyers doubt the price and the brand.", fixes: [{ fix: "Show customer logos above the fold", addresses: "trust" }] };

// One scripted model plays every role, answering by what it is asked.
const scripted = () =>
  new ScriptedLlm((req: LlmRequest) => {
    if (req.system.includes("design realistic")) return JSON.stringify([buyer("Ann"), buyer("Bo"), buyer("Cy")]);
    if (req.system.includes("Launch Readiness")) return JSON.stringify(summary);
    if (req.messages[0].content.includes("Two versions")) return JSON.stringify(pair);
    return JSON.stringify(verdict);
  });

const main: Exhibit[] = [
  { id: "/", kind: "landing", title: "Home", text: "Know your competitors", elements: [] },
  { id: "/pricing", kind: "pricing", title: "Pricing", text: "$49/month", elements: [] },
];

it("judges one version: ranked objections, intent, a summary grounded in counts, and predictions", async () => {
  const llm = scripted();
  const r = await runPerception({ llm, judge: llm, icp: "Agencies", product: "Acme", exhibitsByVariant: { main }, evaluators: 3, concurrency: 3 });
  expect(r.aggregates.main.evaluators).toBe(3);
  expect(r.aggregates.main.objections[0]).toMatchObject({ category: "price", buyers: 3 });
  expect(r.summary.verdict).toContain("price");
  expect(r.predictions.map((p) => p.metric)).toEqual(["top_objection", "intent_share"]);
  const summaryCall = llm.calls.find((c) => c.system.includes("Launch Readiness"))!;
  expect(summaryCall.messages[0].content).toContain('"buyers": 3');
});

it("runs an experiment pairwise and predicts the winner with its interval", async () => {
  const llm = scripted();
  const variantB: Exhibit[] = [{ id: "/pricing", kind: "pricing", title: "Pricing", text: "$39/month", elements: [] }];
  const r = await runPerception({ llm, judge: llm, icp: "Agencies", product: "Acme", exhibitsByVariant: { A: main, B: variantB }, evaluators: 3, concurrency: 3, rng: () => 0.1 });
  expect(r.pairAggregate).toMatchObject({ winsB: 3, winsA: 0, leader: "B" });
  expect(r.aggregates.A.objections[0].category).toBe("price");
  expect(r.aggregates.B.objections[0].category).toBe("trust");
  expect(r.predictions.find((p) => p.metric === "winner")).toMatchObject({ predicted: { winner: "B" } });

  const md = renderLaunchReadiness({ target: "Acme", icp: "Agencies", result: r });
  expect(md).toContain("Simulated evidence — not real traction");
  expect(md).toContain("## Variant comparison");
  expect(md).toMatch(/\| B \| 3 of 3/);
  expect(md).toContain("Show customer logos above the fold");
  expect(md).not.toMatch(/conversion/i);
});
