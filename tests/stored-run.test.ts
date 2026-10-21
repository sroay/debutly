/**
 * A run recorded to Postgres (in-process PGlite) as it happens: everything the
 * file report has is in the store too, plus usage and cost.
 */
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { startFixture, type RunningFixture } from "../fixture/server";
import { asIndividuals, runSimulation, type SimulationResult } from "../src/run";
import { openDb, type OpenDb } from "../src/store/db";
import { PgRunStore } from "../src/store/pg-run-store";
import { persona, scriptedAgents } from "./helpers/scripted-agents";

let fx: RunningFixture;
let open: OpenDb;
let store: PgRunStore;
let result: SimulationResult;

beforeAll(async () => {
  fx = await startFixture();
  open = await openDb("memory:");
  store = new PgRunStore(open.db);
  const llm = scriptedAgents({
    Ava: [{ click: "Pricing" }, { click: "Choose Studio" }, { done: [false, "Studio button does nothing"] }],
    Cara: [{ click: "Docs" }, { done: [false, "Docs page missing"] }],
  });
  result = await runSimulation({
    url: fx.url,
    goal: "Choose a plan",
    units: asIndividuals([persona("p1", "Ava"), persona("p2", "Cara")]),
    llm,
    maxSteps: 10,
    concurrency: 2,
    outDir: await mkdtemp(join(tmpdir(), "debutly-stored-")),
    store,
    run: { tier: "quick", unitKind: "individual", model: "scripted", estimate: { low: 0.01, high: 0.02 } },
    price: { inputPerMTok: 1, outputPerMTok: 1 },
  });
});
afterAll(async () => {
  await open.close();
  await fx.close();
});

it("stores the run with every session, step and finding", async () => {
  const run = await store.getRun(result.runId!);
  expect(run).toMatchObject({ status: "finished", tier: "quick", estimateHighUsd: 0.02 });
  expect(run!.sessions.map((s) => [s.agentId, s.outcome])).toEqual([
    ["p1", "gave_up"],
    ["p2", "gave_up"],
  ]);
  expect(run!.steps).toHaveLength(result.sessions.reduce((n, s) => n + s.steps.length, 0));
  expect(run!.findings.map((f) => f.signature).sort()).toEqual(result.findings.map((f) => f.signature).sort());
  expect(run!.reportMd).toContain("# Debutly Report");
});

it("records the run's token usage and cost, and puts it in the report", async () => {
  const run = await store.getRun(result.runId!);
  expect(run!.inputTokens).toBeGreaterThan(0);
  expect(run!.costUsd).toBeCloseTo(((run!.inputTokens ?? 0) + (run!.outputTokens ?? 0)) / 1_000_000);
  expect(run!.reportMd).toMatch(/Cost: \$\d/);
});
