import { afterEach, beforeEach, expect, it } from "vitest";
import { openDb, type OpenDb } from "../../src/store/db";
import { PgRunStore } from "../../src/store/pg-run-store";
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
    business: { name: "Acme", archetype: "agency", size: 8, monthlyBudget: 200, goal: "g" },
    owner: { ...persona("u1-o", "Olga"), role: "Owner", inclusion: "screen_reader" },
    employees: [{ ...persona("u1-e1", "Emil"), role: "Designer" }],
  },
];

const step = (index: number): Step => ({
  index,
  observation: { url: `http://app.test/page${index}`, title: `Page ${index}`, text: "t", elements: [] },
  action: { type: "click", id: index },
  reasoning: `step ${index}`,
  signals: [],
  screenshotPath: `http://minio/run/u1-o-00${index}.png`,
});

it("records a run as it happens and reads it back whole", async () => {
  const runId = await store.createRun({ targetUrl: "http://app.test", goal: "Sign up", icp: "agencies", tier: "quick", unitKind: "business", model: "m", estimate: { low: 0.01, high: 0.02 } });
  await store.recordUnits(runId, units);
  await store.startSession(runId, "u1-o", "Sign up and invite");
  await store.appendStep(runId, "u1-o", step(0));
  await store.appendStep(runId, "u1-o", step(1));
  const session: Session = {
    agentId: "u1-o",
    personaName: "Olga",
    goal: "Sign up and invite",
    steps: [step(0), step(1)],
    outcome: "success",
    outcomeNote: "done",
    unitId: "u1",
    role: "Owner",
    usage: { inputTokens: 5000, outputTokens: 300, costUsd: 0.005 },
  };
  await store.finishSession(runId, session);
  const finding: Finding = {
    signature: "http:500:/api/invite",
    kind: "http_error",
    severity: "blocker",
    title: "HTTP 500 from /api/invite",
    detail: "d",
    pagePath: "/dashboard",
    hitBy: ["u1-o"],
    visitors: 1,
    confidence: "high",
    evidence: [{ agentId: "u1-o", stepIndex: 1 }],
  };
  await store.finishRun(runId, {
    status: "finished",
    findings: [finding],
    reportMd: "# Report",
    usage: { inputTokens: 5000, outputTokens: 300, costUsd: 0.005 },
    sideEffects: [{ outcome: "faked", rule: "resend", channel: "email", host: "api.resend.com", url: "https://api.resend.com/emails", recipient: "emil@agents.test", summary: "POST", at: new Date() }],
  });

  const run = await store.getRun(runId);
  expect(run).toMatchObject({ id: runId, status: "finished", tier: "quick", costUsd: 0.005, reportMd: "# Report", estimateHighUsd: 0.02 });
  expect(run!.units.map((u) => u.id)).toEqual(["u1"]);
  expect(run!.agents.map((a) => [a.id, a.role, a.inclusion])).toEqual([
    ["u1-e1", "Designer", null],
    ["u1-o", "Owner", "screen_reader"],
  ]);
  expect(run!.sessions).toEqual([expect.objectContaining({ agentId: "u1-o", outcome: "success", inputTokens: 5000, costUsd: 0.005 })]);
  expect(run!.steps.map((s) => [s.agentId, s.index, s.screenshotUrl])).toEqual([
    ["u1-o", 0, "http://minio/run/u1-o-000.png"],
    ["u1-o", 1, "http://minio/run/u1-o-001.png"],
  ]);
  expect(run!.findings).toEqual([expect.objectContaining({ signature: "http:500:/api/invite", hitBy: ["u1-o"] })]);
  expect(run!.sideEffects).toEqual([expect.objectContaining({ rule: "resend", recipient: "emil@agents.test" })]);
});

it("flips the kill switch", async () => {
  const runId = await store.createRun({ targetUrl: "http://app.test", goal: "g" });
  expect(await store.isCancelled(runId)).toBe(false);
  await store.requestCancel(runId);
  expect(await store.isCancelled(runId)).toBe(true);
  expect((await store.getRun(runId))?.status).toBe("cancelling");
});

it("returns null for an unknown run", async () => {
  expect(await store.getRun("00000000-0000-4000-8000-000000000000")).toBeNull();
});

it("records which app a run tested, what started it and its CI page", async () => {
  const runId = await store.createRun({ app: "acme", trigger: "nightly", ciUrl: "https://github.com/acme/app/actions/runs/1", targetUrl: "http://app.test", goal: "g" });
  expect(await store.getRun(runId)).toMatchObject({ app: "acme", trigger: "nightly", ciUrl: "https://github.com/acme/app/actions/runs/1" });
});
