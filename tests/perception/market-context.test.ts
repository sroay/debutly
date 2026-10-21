import { expect, it } from "vitest";
import { ScriptedLlm } from "../../src/llm/scripted";
import { buildMarketContext, marketBrief } from "../../src/perception/market-context";
import type { Exhibit } from "../../src/perception/exhibits";

const rivalPricing: Exhibit = { id: "/pricing", kind: "pricing", title: "Rival pricing", url: "https://rival.test/pricing", text: "Enterprise plans from $20,000/yr", elements: [] };

const reply = {
  competitors: [{ name: "Rival", url: "https://rival.test/pricing", pricing: "Enterprise plans from $20,000/yr", positioning: "Enterprise CI" }],
  complaints: ["(general knowledge) Setup takes weeks"],
  switchingTriggers: ["(general knowledge) Renewal price jumps"],
};

it("summarises competitor pages into a grounded market context", async () => {
  const llm = new ScriptedLlm(() => `Here:\n${JSON.stringify(reply)}`);
  const ctx = await buildMarketContext(llm, { icp: "B2B SaaS PMMs", product: "Acme", competitorExhibits: [rivalPricing] });
  expect(ctx.competitors[0]).toMatchObject({ name: "Rival", pricing: "Enterprise plans from $20,000/yr" });
  expect(ctx.sources).toEqual(["https://rival.test/pricing"]);
  expect(llm.calls[0].messages[0].content).toContain("Enterprise plans from $20,000/yr");
  expect(marketBrief(ctx)).toContain("Rival: Enterprise plans from $20,000/yr");
});

it("rejects a context with no competitors", async () => {
  const llm = new ScriptedLlm(() => JSON.stringify({ ...reply, competitors: [] }));
  await expect(buildMarketContext(llm, { icp: "i", product: "p", competitorExhibits: [rivalPricing] })).rejects.toThrow();
});
