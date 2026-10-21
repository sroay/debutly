import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";

it("runs its in-page code under tsx, as real runs do", () => {
  const out = execFileSync(process.execPath, ["--import", "tsx", "tests/browser/tsx-runtime-check.ts"], { encoding: "utf8", timeout: 60_000 });
  const results = JSON.parse(out.trim().split("\n").pop()!);
  expect(results.observe).toBeGreaterThan(0);
  expect(results).toMatchObject({ press: {}, choose: {}, pick: {} });
  for (const r of Object.values(results)) if (typeof r === "object") expect(r).not.toHaveProperty("error");
}, 90_000);
