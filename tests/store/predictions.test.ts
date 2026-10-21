import { afterEach, beforeEach, expect, it } from "vitest";
import { openDb, type OpenDb } from "../../src/store/db";
import { PgRunStore } from "../../src/store/pg-run-store";
import { PgPredictionStore } from "../../src/store/predictions";

let open: OpenDb;
let predictions: PgPredictionStore;
let runId: string;
beforeEach(async () => {
  open = await openDb("memory:");
  predictions = new PgPredictionStore(open.db);
  runId = await new PgRunStore(open.db).createRun({ targetUrl: "https://acme.test", goal: "perception" });
});
afterEach(async () => {
  await open.close();
});

it("stores predictions, records real outcomes and scores accuracy", async () => {
  const [winner, objection, share] = await predictions.add(runId, [
    { metric: "winner", claim: "Variant B beats A", predicted: { winner: "B", winRate: 0.7, decisive: true } },
    { metric: "top_objection", claim: "Price is the top objection", predicted: { category: "price" } },
    { metric: "intent_share", claim: "32% would consider it", predicted: { share: 0.32 } },
  ]);
  expect((await predictions.list({ unresolved: true })).map((p) => p.id).sort()).toEqual([winner, objection, share].sort());

  expect(await predictions.record(winner, "B")).toMatchObject({ correct: true });
  expect(await predictions.record(objection, "trust")).toMatchObject({ correct: false });
  // Intent share is kept but not scored until calibration data exists.
  expect(await predictions.record(share, "0.05")).toMatchObject({ correct: null });

  expect(await predictions.accuracy()).toEqual({ scored: 2, correct: 1, rate: 0.5 });
  expect(await predictions.list({ unresolved: true })).toEqual([]);
});

it("refuses to record an outcome for an unknown prediction", async () => {
  await expect(predictions.record("00000000-0000-4000-8000-000000000000", "B")).rejects.toThrow(/No prediction/);
});
