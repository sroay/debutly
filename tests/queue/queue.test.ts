/**
 * Agents run through a real Redis queue on a worker, recording to the store, and the run
 * reaches the same findings as in-process. Runs only when REDIS_URL is set (compose, CI).
 */
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Queue, QueueEvents, Worker } from "bullmq";
import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, expect, it } from "vitest";
import { startFixture, type RunningFixture } from "../../fixture/server";
import { LocalArtifactStore } from "../../src/artifacts/store";
import { queueDispatch } from "../../src/queue/dispatch";
import { redisClient, type AgentJob } from "../../src/queue/jobs";
import { createAgentProcessor } from "../../src/queue/processor";
import { asIndividuals, runSimulation, type SimulationResult } from "../../src/run";
import { openDb, type OpenDb } from "../../src/store/db";
import { PgRunStore } from "../../src/store/pg-run-store";
import type { Session } from "../../src/types";
import { persona, scriptedAgents } from "../helpers/scripted-agents";

const REDIS_URL = process.env.REDIS_URL;
const name = `debutly-test-${Date.now()}`;
let fx: RunningFixture;
let open: OpenDb;
let browser: Browser;
let worker: Worker<AgentJob, Session>;
let queue: Queue;
let events: QueueEvents;
let result: SimulationResult;
let store: PgRunStore;

beforeAll(async () => {
  if (!REDIS_URL) return;
  fx = await startFixture();
  open = await openDb("memory:");
  store = new PgRunStore(open.db);
  browser = await chromium.launch();
  const dir = await mkdtemp(join(tmpdir(), "debutly-queue-"));
  const llm = scriptedAgents({
    Ava: [{ click: "Pricing" }, { click: "Choose Studio" }, { done: [false, "Studio button does nothing"] }],
    Cara: [{ click: "Docs" }, { done: [false, "Docs page missing"] }],
  });
  worker = new Worker<AgentJob, Session>(name, createAgentProcessor({ browser, llm, store, artifactsFor: () => new LocalArtifactStore(dir), inboxFor: () => ({ latest: async () => [] }) }), {
    connection: redisClient(REDIS_URL),
    concurrency: 2,
  });
  queue = new Queue(name, { connection: redisClient(REDIS_URL) });
  events = new QueueEvents(name, { connection: redisClient(REDIS_URL) });
  await events.waitUntilReady();
  result = await runSimulation({
    url: fx.url,
    goal: "Choose a plan",
    units: asIndividuals([persona("p1", "Ava"), persona("p2", "Cara")]),
    llm,
    maxSteps: 10,
    concurrency: 2,
    outDir: dir,
    store,
    dispatch: ({ runId, runTag }) => queueDispatch(queue, events, { runId: runId!, targetUrl: fx.url, maxSteps: 10, emailDomain: "agents.test", runTag }),
  });
}, 120_000);

afterAll(async () => {
  if (!REDIS_URL) return;
  await worker.close();
  await queue.obliterate({ force: true });
  await queue.close();
  await events.close();
  await browser.close();
  await open.close();
  await fx.close();
});

it.runIf(REDIS_URL)("runs each agent as a queued job and finds the seeded bugs", async () => {
  expect(result.sessions.map((s) => [s.personaName, s.outcome])).toEqual([
    ["Ava", "gave_up"],
    ["Cara", "gave_up"],
  ]);
  expect(result.findings.map((f) => f.signature)).toEqual(expect.arrayContaining(["http:404:/docs"]));
});

it.runIf(REDIS_URL)("the worker recorded every step to the store", async () => {
  const run = await store.getRun(result.runId!);
  expect(run!.status).toBe("finished");
  expect(run!.steps.length).toBe(result.sessions.reduce((n, s) => n + s.steps.length, 0));
});
