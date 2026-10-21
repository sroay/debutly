import { expect, it } from "vitest";
import { ScriptedLlm } from "../../src/llm/scripted";
import { evaluate } from "../../src/perception/evaluate";
import type { Exhibit } from "../../src/perception/exhibits";
import { persona } from "../helpers/scripted-agents";

const pricing: Exhibit = { id: "/pricing", kind: "pricing", title: "Pricing", text: "Solo $19/month. Studio $49/month.", elements: [] };

const good = {
  objections: [
    { category: "price", text: "Studio at $49 is steep for 3 seats", exhibitId: "/pricing" },
    { category: "unclear_value", text: "No mention of what reports include", exhibitId: "/pricing" },
  ],
  confusions: [{ text: "What counts as a seat?", exhibitId: "/pricing" }],
  scores: { clarity: 3, credibility: 2, value: 3, urgency: 2 },
  intent: "maybe",
  wouldPay: { plan: "Solo", monthlyUsd: 19 },
  summary: "Might try Solo; Studio is too expensive.",
};

it("returns a validated verdict from a skeptical buyer, grounded in the market", async () => {
  const llm = new ScriptedLlm(() => JSON.stringify(good));
  const v = await evaluate(llm, persona("e1", "Ann"), [pricing], { market: "Alternatives these buyers know:\n- Trello: free" });
  expect(v).toMatchObject({ evaluatorId: "e1", intent: "maybe", wouldPay: { plan: "Solo", monthlyUsd: 19 } });
  expect(v!.objections).toHaveLength(2);
  expect(llm.calls[0].system).toMatch(/at least 2/);
  expect(llm.calls[0].system).toMatch(/default to "no"/i);
  expect(llm.calls[0].messages[0].content).toContain("Trello: free");
  expect(llm.calls[0].messages[0].content).toContain("Solo $19/month");
});

it("asks again when the buyer gives fewer than two objections", async () => {
  const llm = new ScriptedLlm((_req, i) => JSON.stringify(i === 0 ? { ...good, objections: [good.objections[0]] } : good));
  const v = await evaluate(llm, persona("e2", "Bo"), [pricing], {});
  expect(v?.objections).toHaveLength(2);
  expect(llm.calls).toHaveLength(2);
  expect(llm.calls[1].messages.at(-1)?.content).toMatch(/objections/);
});

it("returns null (counted as unusable) when the reply stays invalid", async () => {
  const llm = new ScriptedLlm(() => "I like it!");
  expect(await evaluate(llm, persona("e3", "Cy"), [pricing], {})).toBeNull();
  expect(llm.calls).toHaveLength(3);
});
