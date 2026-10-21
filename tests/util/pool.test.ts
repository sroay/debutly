import { expect, it } from "vitest";
import { mapWithConcurrency } from "../../src/util/pool";

it("preserves order and never exceeds the limit", async () => {
  let active = 0;
  let peak = 0;
  const out = await mapWithConcurrency([30, 10, 20, 5, 15], 2, async (ms, i) => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, ms));
    active--;
    return i * 10;
  });
  expect(out).toEqual([0, 10, 20, 30, 40]);
  expect(peak).toBe(2);
});
