import { expect, it } from "vitest";
import { ScriptedLlm } from "../../src/llm/scripted";
import { comparePair } from "../../src/perception/compare";
import type { Exhibit } from "../../src/perception/exhibits";
import { persona } from "../helpers/scripted-agents";

const a: Exhibit[] = [{ id: "a-pricing", kind: "pricing", title: "A", text: "Variant A copy: $19/month", elements: [] }];
const b: Exhibit[] = [{ id: "b-pricing", kind: "pricing", title: "B", text: "Variant B copy: $15/month", elements: [] }];
const reply = (preferred: string) =>
  JSON.stringify({
    objections1: [{ category: "price", text: "pricey" }],
    objections2: [{ category: "trust", text: "who are they" }],
    preferred,
    reasons: ["cheaper"],
  });

it("maps the option the buyer picked back to its variant, whichever order it was shown in", async () => {
  // rng < 0.5 keeps A as Option 1; >= 0.5 swaps.
  const kept = await comparePair(new ScriptedLlm(() => reply("1")), persona("e1", "Ann"), a, b, {}, () => 0.1);
  expect(kept).toMatchObject({ preferred: "A", objectionsA: [{ category: "price" }], objectionsB: [{ category: "trust" }] });

  const llm = new ScriptedLlm(() => reply("1"));
  const swapped = await comparePair(llm, persona("e2", "Bo"), a, b, {}, () => 0.9);
  expect(swapped).toMatchObject({ preferred: "B", objectionsB: [{ category: "price" }], objectionsA: [{ category: "trust" }] });
  const prompt = llm.calls[0].messages[0].content;
  expect(prompt.indexOf("Variant B copy")).toBeLessThan(prompt.indexOf("Variant A copy"));
});

it("keeps a buyer who wants neither", async () => {
  expect((await comparePair(new ScriptedLlm(() => reply("neither")), persona("e3", "Cy"), a, b, {}, () => 0.2))?.preferred).toBe("neither");
});

it("shows both variants blind: no variant names, file names or web addresses", async () => {
  const llm = new ScriptedLlm(() => JSON.stringify({ objections1: [{ category: "price", text: "too pricey", exhibitId: "1.1" }], objections2: [{ category: "trust", text: "who are they", exhibitId: "2.1" }], preferred: "1", reasons: ["r"] }));
  const withUrl: Exhibit[] = [{ id: "A:/pricing", kind: "pricing", title: "Pricing", url: "https://acme.test/pricing", text: "Variant A copy", elements: [] }];
  const fromFile: Exhibit[] = [{ id: "B:pricing-b.md", kind: "pricing", title: "Acme pricing", text: "Variant B copy", elements: [] }];
  const r = await comparePair(llm, persona("e4", "Di"), withUrl, fromFile, {}, () => 0.1);
  const prompt = llm.calls[0].messages[0].content;
  expect(prompt).not.toMatch(/acme\.test|pricing-b\.md|A:\/pricing|B:/);
  expect(r?.objectionsA[0].exhibitId).toBe("A:/pricing");
  expect(r?.objectionsB[0].exhibitId).toBe("B:pricing-b.md");
});
