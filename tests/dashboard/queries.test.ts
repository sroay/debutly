import { eq } from "drizzle-orm";
import { afterEach, beforeEach, expect, it } from "vitest";
import { appsOverview, classify, findingHistory, listRuns, runDetail, sessionReplay, spendByDay } from "../../dashboard/lib/queries";
import { openDb, type OpenDb } from "../../src/store/db";
import { PgRunStore } from "../../src/store/pg-run-store";
import { runs } from "../../src/store/schema";
import type { CustomerUnit, Finding, Session, Step } from "../../src/types";
import { persona } from "../helpers/scripted-agents";

let open: OpenDb;
let store: PgRunStore;
beforeEach(async () => {
  open = await openDb("memory:");
  store = new PgRunStore(open.db);
});
afterEach(async () => {
  await open.close();
});

const units: CustomerUnit[] = [
  {
    kind: "business",
    id: "u1",
    business: { name: "Northbeam", archetype: "startup", size: 40, monthlyBudget: 500, goal: "g" },
    owner: { ...persona("u1-o", "Maya"), role: "Owner", inclusion: "slow_connection" },
    employees: [{ ...persona("u1-e1", "Derek"), role: "PM" }],
  },
];

const step = (index: number, path = "/"): Step => ({
  index,
  observation: { url: `http://localhost:3000${path}`, title: "t", text: "", elements: [{ id: 1, role: "button", name: "Save", tag: "button" }] },
  action: { type: "click", id: 1 },
  reasoning: `step ${index}`,
  signals: [],
  screenshotPath: `db:run/u1-o-00${index}.jpg`,
});

const finding = (signature: string, extra: Partial<Finding> = {}): Finding => ({
  signature,
  kind: "http_error",
  severity: "major",
  confidence: "high",
  title: signature,
  detail: "d",
  pagePath: "/",
  hitBy: ["u1-o"],
  visitors: 1,
  evidence: [{ agentId: "u1-o", stepIndex: 1 }],
  ...extra,
});

/** A finished run for `app` at `at`: Maya succeeds, Derek gives up, with these findings. */
async function seedRun(app: string, at: string, found: Finding[], cost = 0.04): Promise<string> {
  const runId = await store.createRun({ app, trigger: "nightly", ciUrl: `https://ci/${at}`, targetUrl: "http://localhost:3000", goal: "Sign up" });
  await store.recordUnits(runId, units);
  const outcomes: [string, Session["outcome"]][] = [
    ["u1-o", "success"],
    ["u1-e1", "gave_up"],
  ];
  for (const [agentId, outcome] of outcomes) {
    await store.startSession(runId, agentId, "Sign up");
    await store.appendStep(runId, agentId, step(0));
    await store.appendStep(runId, agentId, step(1, "/settings"));
    const session: Session = { agentId, personaName: agentId, goal: "Sign up", steps: [], outcome, outcomeNote: `${outcome} note`, usage: { inputTokens: 10, outputTokens: 1, costUsd: cost / 2 } };
    await store.finishSession(runId, session);
  }
  await store.finishRun(runId, { status: "finished", findings: found, reportMd: "# r", usage: { inputTokens: 20, outputTokens: 2, costUsd: cost }, sideEffects: [] });
  await open.db.update(runs).set({ createdAt: new Date(at) }).where(eq(runs.id, runId));
  return runId;
}

it("sorts a finding into the app's, the agent's (low confidence) or the test environment's", () => {
  expect(classify({ sandboxCause: null, confidence: "high" })).toBe("real");
  expect(classify({ sandboxCause: null, confidence: "low" })).toBe("low");
  expect(classify({ sandboxCause: ["missing key: x"], confidence: "high" })).toBe("env");
});

it("lists runs newest first with how the agents did and what they found", async () => {
  await seedRun("acme", "2026-10-01T10:00:00Z", [finding("a")]);
  await seedRun("acme", "2026-10-02T10:00:00Z", [finding("a"), finding("b", { severity: "minor" }), finding("c", { confidence: "low" }), finding("d", { sandboxCause: ["x.com"] })]);
  await seedRun("globex", "2026-10-02T09:00:00Z", []);
  const list = await listRuns(open.db, { app: "acme" });
  expect(list.map((r) => r.createdAt.toISOString())).toEqual(["2026-10-02T10:00:00.000Z", "2026-10-01T10:00:00.000Z"]);
  expect(list[0]).toMatchObject({
    app: "acme",
    agents: 2,
    succeeded: 1,
    outcomes: { success: 1, gave_up: 1 },
    findings: { blocker: 0, major: 1, minor: 1, low: 1, env: 1 },
    costUsd: 0.04,
  });
  expect((await listRuns(open.db)).length).toBe(3);
});

it("gives each app its latest run and recent history, oldest first", async () => {
  await seedRun("acme", "2026-10-01T10:00:00Z", []);
  await seedRun("acme", "2026-10-02T10:00:00Z", []);
  await seedRun("globex", "2026-10-02T09:00:00Z", []);
  const overview = await appsOverview(open.db);
  expect(overview.map((a) => a.app)).toEqual(["acme", "globex"]);
  expect(overview[0].latest.createdAt.toISOString()).toBe("2026-10-02T10:00:00.000Z");
  expect(overview[0].recent.map((r) => r.createdAt.toISOString())).toEqual(["2026-10-01T10:00:00.000Z", "2026-10-02T10:00:00.000Z"]);
});

it("shows a run whole: businesses, agents with outcomes and step counts, findings by severity", async () => {
  const id = await seedRun("acme", "2026-10-02T10:00:00Z", [finding("minor-one", { severity: "minor" }), finding("blocker-one", { severity: "blocker" })]);
  const detail = await runDetail(open.db, id);
  expect(detail?.units).toMatchObject([{ id: "u1", business: { name: "Northbeam" } }]);
  expect(detail?.agents).toMatchObject([
    { id: "u1-e1", name: "Derek", role: "PM", outcome: "gave_up", steps: 2 },
    { id: "u1-o", name: "Maya", inclusion: "slow_connection", outcome: "success", steps: 2 },
  ]);
  expect(detail?.findings.map((f) => f.title)).toEqual(["blocker-one", "minor-one"]);
  expect(await runDetail(open.db, "00000000-0000-4000-8000-000000000000")).toBeNull();
});

it("replays an agent's steps, marking the steps findings point at", async () => {
  const id = await seedRun("acme", "2026-10-02T10:00:00Z", [finding("covered", { kind: "covered" })]);
  const replay = await sessionReplay(open.db, id, "u1-o");
  expect(replay?.agent).toMatchObject({ name: "Maya", role: "Owner" });
  expect(replay?.session).toMatchObject({ outcome: "success" });
  expect(replay?.steps.map((s) => s.index)).toEqual([0, 1]);
  expect(replay?.steps[1]).toMatchObject({ url: "http://localhost:3000/settings", action: { type: "click", id: 1 }, reasoning: "step 1" });
  expect(replay?.findingsAt).toEqual({ 1: [{ title: "covered", severity: "major", class: "real" }] });
  expect(await sessionReplay(open.db, id, "nobody")).toBeNull();
});

it("tracks each finding across runs: recurring, new in the latest run, or gone from it", async () => {
  await seedRun("acme", "2026-10-01T10:00:00Z", [finding("old-and-current"), finding("gone")]);
  await seedRun("acme", "2026-10-02T10:00:00Z", [finding("old-and-current"), finding("fresh", { severity: "minor" }), finding("noise", { sandboxCause: ["missing key: x"] })]);
  const history = await findingHistory(open.db, { app: "acme" });
  const by = Object.fromEntries(history.map((h) => [h.signature, h]));
  expect(by["old-and-current"]).toMatchObject({ status: "recurring", runsSeen: 2, runsSince: 2, class: "real" });
  expect(by.fresh).toMatchObject({ status: "new", runsSeen: 1, runsSince: 1 });
  expect(by.gone).toMatchObject({ status: "absent", runsSeen: 1, runsSince: 2 });
  expect(by.noise.class).toBe("env");
  // Current findings first, the ones the latest run no longer has last.
  expect(history.at(-1)?.signature).toBe("gone");
});

it("adds up spend per day and app", async () => {
  await seedRun("acme", "2026-10-01T10:00:00Z", [], 0.05);
  await seedRun("acme", "2026-10-01T20:00:00Z", [], 0.03);
  await seedRun("globex", "2026-10-02T09:00:00Z", [], 0.02);
  const spend = await spendByDay(open.db, 30, new Date("2026-10-03T00:00:00Z"));
  expect(spend).toEqual([
    { day: "2026-10-01", app: "acme", costUsd: 0.08, runs: 2 },
    { day: "2026-10-02", app: "globex", costUsd: 0.02, runs: 1 },
  ]);
});
