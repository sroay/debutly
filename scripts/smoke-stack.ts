// End-to-end check of the self-hosted stack (docker compose --profile smoke run --rm smoke):
// serves the fixture, runs 2 real agents through the queue on the workers, and checks the run
// landed in Postgres with its screenshots in S3 storage. Costs about $0.01 of LLM.
import "../src/util/legacy-env";
import "../src/util/key-defaults";
import { Queue, QueueEvents } from "bullmq";
import { hostname } from "node:os";
import { startFixture } from "../fixture/server";
import { fetchModelPrice } from "../src/cost/prices";
import { createLlms } from "../src/llm/factory";
import { queueDispatch } from "../src/queue/dispatch";
import { AGENT_QUEUE, redisClient } from "../src/queue/jobs";
import { asIndividuals, runSimulation } from "../src/run";
import { openDb } from "../src/store/db";
import { PgRunStore } from "../src/store/pg-run-store";
import type { Persona } from "../src/types";

const { REDIS_URL, DATABASE_URL } = process.env;
if (!REDIS_URL || !DATABASE_URL) throw new Error("run inside the compose stack (REDIS_URL, DATABASE_URL)");

const fixture = await startFixture({ port: 4310, host: "0.0.0.0" });
// Workers are other containers: they reach this one by its hostname.
const url = `http://${hostname()}:4310`;
const person = (id: string, name: string, background: string): Persona => ({ id, name, background, goal: "Try the product", patience: "medium", techSavvy: "medium" });

const price = await fetchModelPrice(process.env.DEBUTLY_NAV_MODEL ?? "");
const { db, close } = await openDb(DATABASE_URL);
const store = new PgRunStore(db);
const queue = new Queue(AGENT_QUEUE, { connection: redisClient(REDIS_URL) });
const events = new QueueEvents(AGENT_QUEUE, { connection: redisClient(REDIS_URL) });
await events.waitUntilReady();

const result = await runSimulation({
  url,
  goal: "Sign up, choose a plan and invite a teammate. Finish when done or when you would give up.",
  units: asIndividuals([person("p1", "Ava", "Runs a 4-person design studio."), person("p2", "Ben", "Freelance developer, impatient.")]),
  llm: createLlms(process.env).nav,
  maxSteps: 8,
  concurrency: 2,
  outDir: "runs/smoke",
  store,
  run: { tier: "quick", unitKind: "individual", model: process.env.DEBUTLY_NAV_MODEL },
  price,
  dispatch: ({ runId, runTag }) => queueDispatch(queue, events, { runId: runId!, targetUrl: url, maxSteps: 8, price, emailDomain: "agents.test", runTag }),
});

const run = await store.getRun(result.runId!);
const shots = run!.steps.map((s) => s.screenshotUrl).filter((u): u is string => !!u);
const shotOk = shots.length ? (await fetch(shots[0].replace("localhost:9010", "s3:8333"))).ok : false;
console.log(`run ${run!.id}: ${run!.status}, ${run!.sessions.length} sessions, ${run!.steps.length} steps, ${run!.findings.length} findings, cost ${run!.costUsd ?? "?"}`);
console.log(`screenshots in S3 storage: ${shots.length} (first reachable: ${shotOk})`);
await Promise.all([events.close(), queue.close(), close(), fixture.close()]);
const ok = run!.status === "finished" && run!.sessions.length === 2 && run!.steps.length > 0 && shotOk;
console.log(ok ? "SMOKE OK" : "SMOKE FAILED");
process.exit(ok ? 0 : 1);
