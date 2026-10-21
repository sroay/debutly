import { expect, it } from "vitest";
import { inclusionBrief, withInclusion } from "../../src/persona/inclusion";
import type { CustomerUnit } from "../../src/types";
import { persona } from "../helpers/scripted-agents";

const solo = (id: string, name: string): CustomerUnit => ({ kind: "individual", id, person: persona(id, name) });
const needs = (units: CustomerUnit[]) => units.map((u) => (u.kind === "individual" ? u.person.inclusion : undefined));

it("gives the first agents one need each, rotating the starting need by the offset", () => {
  const units = [solo("p1", "A"), solo("p2", "B"), solo("p3", "C")];
  expect(needs(withInclusion(units, 0))).toEqual(["screen_reader", "low_vision", "slow_connection"]);
  expect(needs(withInclusion(units, 1))).toEqual(["low_vision", "slow_connection", "non_native_english"]);
});

it("counts every crew member, owner first", () => {
  const crew: CustomerUnit = {
    kind: "business",
    id: "u1",
    business: { name: "Acme", archetype: "agency", size: 8, monthlyBudget: 200, goal: "g" },
    owner: persona("u1-o", "Olga"),
    employees: [persona("u1-e1", "Emil")],
  };
  const [out] = withInclusion([crew], 3);
  expect(out.kind === "business" && [out.owner.inclusion, out.employees[0].inclusion]).toEqual(["non_native_english", "screen_reader"]);
});

it("leaves agents beyond the four needs as they are", () => {
  const units = ["a", "b", "c", "d", "e"].map((n, i) => solo(`p${i}`, n));
  expect(withInclusion(units, 0).at(-1)).toEqual(units.at(-1));
});

it("tells the agent how the need changes the way they use the web", () => {
  expect(inclusionBrief("screen_reader")).toMatch(/screen reader/i);
  expect(inclusionBrief("non_native_english")).toMatch(/English is not your first language/);
});
