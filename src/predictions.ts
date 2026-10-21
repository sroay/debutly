// The Calibration Loop from the command line:
//   npm run debutly:predictions -- list [--unresolved] --store <url>
//   npm run debutly:predictions -- record <predictionId> <actual> --store <url>   e.g. B, or price
//   npm run debutly:predictions -- accuracy --store <url>
import { parseArgs } from "node:util";
import { openDb } from "./store/db";
import { PgPredictionStore } from "./store/predictions";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { store: { type: "string" }, unresolved: { type: "boolean", default: false } },
});
const [command, id, actual] = positionals;
const url = values.store ?? process.env.DATABASE_URL;
if (!url || !["list", "record", "accuracy"].includes(command ?? "") || (command === "record" && (!id || !actual))) {
  console.error("Usage: npm run debutly:predictions -- list [--unresolved] | record <id> <actual> | accuracy   --store postgres://… (or DATABASE_URL)");
  process.exit(1);
}
const { db, close } = await openDb(url);
const store = new PgPredictionStore(db);
if (command === "list") {
  for (const p of await store.list({ unresolved: values.unresolved })) {
    const outcome = p.checkedAt ? `actual ${JSON.stringify(p.actual)} → ${p.correct === null ? "not scored" : p.correct ? "correct" : "wrong"}` : "awaiting outcome";
    console.log(`${p.id}  [${p.metric}] ${p.claim}  (${outcome})`);
  }
} else if (command === "record") {
  const p = await store.record(id, actual);
  console.log(`Recorded: ${p.claim} → actual ${actual}: ${p.correct === null ? "stored (not scored yet)" : p.correct ? "correct" : "wrong"}`);
} else {
  const a = await store.accuracy();
  console.log(a.rate === null ? "No scored predictions yet." : `Accuracy: ${a.correct} of ${a.scored} correct (${Math.round(a.rate * 100)}%)`);
}
await close();
