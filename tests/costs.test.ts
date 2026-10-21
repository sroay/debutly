import { expect, it } from "vitest";
import { costFromLog, fetchKeySpend } from "../src/costs";

it("reads the run cost a Debutly run printed at the end of a CI log", () => {
  const log = "throwaway\tRun agents\t2026-09-28T08:55Z Estimated cost: $0.44–$0.73\nthrowaway\tRun agents\t2026-09-28T08:56Z Done: 3 findings, cost $0.3307. Report: ../x/report.md";
  expect(costFromLog(log)).toBe(0.3307);
  expect(costFromLog("no cost here")).toBeNull();
});

it("reads the key's spend by period from OpenRouter", async () => {
  const fetchFn = async () => Response.json({ data: { usage: 4.08, usage_daily: 2.46, usage_weekly: 2.46, usage_monthly: 4.08, limit: 5, limit_remaining: 0.92, limit_reset: "monthly" } });
  expect(await fetchKeySpend("https://openrouter.ai/api/v1", "k", fetchFn as unknown as typeof fetch)).toEqual({ today: 2.46, week: 2.46, month: 4.08, total: 4.08, limit: 5, remaining: 0.92, resets: "monthly" });
});
