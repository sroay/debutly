import { expect, it } from "vitest";
import { resolveRunSize } from "../../src/cost/tiers";

it("uses the tier's size when nothing is given", () => {
  expect(resolveRunSize({ tier: "quick" })).toEqual({ tier: "quick", units: 3, employees: 0 });
  expect(resolveRunSize({ tier: "standard" })).toEqual({ tier: "standard", units: 10, employees: 2 });
  expect(resolveRunSize({ tier: "deep" })).toEqual({ tier: "deep", units: 30, employees: 3 });
});

it("lets explicit counts win over the tier", () => {
  expect(resolveRunSize({ tier: "standard", units: 4, employees: 1 })).toEqual({ tier: "standard", units: 4, employees: 1 });
});

it("defaults to quick, and rejects unknown tiers", () => {
  expect(resolveRunSize({})).toEqual({ tier: "quick", units: 3, employees: 0 });
  expect(() => resolveRunSize({ tier: "huge" })).toThrow(/quick, standard or deep/);
});

it("counts agents: a crew is its owner plus employees", () => {
  expect(resolveRunSize({ tier: "standard" })).toMatchObject({ units: 10, employees: 2 });
});
