// A queue worker: runs agent sessions that runs (CLI with --queue, or later the API) enqueue.
// Scale out by starting more (docker compose up --scale worker=4).
//
//   REDIS_URL=redis://… DATABASE_URL=postgres://… DEBUTLY_API_KEY=… npm run debutly:worker
//
// Optional: DEBUTLY_WORKER_CONCURRENCY (default 2), DEBUTLY_S3_* for screenshots (else ./runs/worker/<runId>).
import "./util/legacy-env";
import { join } from "node:path";
import { Worker } from "bullmq";
import { chromium } from "playwright";
import { S3ArtifactStore } from "./artifacts/s3";
import { LocalArtifactStore } from "./artifacts/store";
import { MailpitInbox } from "./inbox/mailpit";
import { createLlms } from "./llm/factory";
import { AGENT_QUEUE, redisClient, type AgentJob } from "./queue/jobs";
import { createAgentProcessor } from "./queue/processor";
import { openDb } from "./store/db";
import { PgRunStore } from "./store/pg-run-store";
import type { Session } from "./types";

const { REDIS_URL, DATABASE_URL } = process.env;
if (!REDIS_URL || !DATABASE_URL) {
  console.error("The worker needs REDIS_URL and DATABASE_URL (and the DEBUTLY_* model settings).");
  process.exit(1);
}

const { db, close } = await openDb(DATABASE_URL);
const browser = await chromium.launch();
const process_ = createAgentProcessor({
  browser,
  llm: createLlms(process.env).nav,
  store: new PgRunStore(db),
  artifactsFor: (runId) => S3ArtifactStore.fromEnv(process.env, runId) ?? new LocalArtifactStore(join("runs", "worker", runId)),
  inboxFor: (url) => new MailpitInbox(url),
});

const worker = new Worker<AgentJob, Session>(AGENT_QUEUE, (job) => process_(job), {
  connection: redisClient(REDIS_URL),
  concurrency: Number(process.env.DEBUTLY_WORKER_CONCURRENCY ?? 2),
});
worker.on("completed", (job, s) => console.log(`[worker] ${job.data.persona.name} (${job.data.runId}): ${s.outcome}`));
worker.on("failed", (job, err) => console.error(`[worker] ${job?.data.persona.name ?? "?"}: ${err.message}`));
console.log(`[worker] waiting for agent sessions on ${AGENT_QUEUE}`);

const shutdown = async () => {
  await worker.close();
  await browser.close();
  await close();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
