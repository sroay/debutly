// The run kill switch from anywhere: npm run debutly:cancel -- <runId> --store postgres://…
// Agents stop at their next step; the run still writes its (partial) report.
import { parseArgs } from "node:util";
import { openDb } from "./store/db";
import { PgRunStore } from "./store/pg-run-store";

const { values, positionals } = parseArgs({ allowPositionals: true, options: { store: { type: "string" } } });
const [runId] = positionals;
const url = values.store ?? process.env.DATABASE_URL;
if (!runId || !url) {
  console.error("Usage: npm run debutly:cancel -- <runId> --store postgres://… (or set DATABASE_URL)");
  process.exit(1);
}
const { db, close } = await openDb(url);
const store = new PgRunStore(db);
await store.requestCancel(runId);
const run = await store.getRun(runId);
await close();
console.log(run ? `Run ${runId}: ${run.status}` : `No run ${runId}`);
process.exit(run ? 0 : 1);
