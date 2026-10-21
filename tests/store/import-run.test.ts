import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { DbArtifactStore } from "../../src/artifacts/db";
import { openDb, type OpenDb } from "../../src/store/db";
import { importRunFolder, parseReportHeader, unitsFromSessions } from "../../src/store/import-run";
import { PgRunStore } from "../../src/store/pg-run-store";
import type { Finding, Session } from "../../src/types";

const REPORT = `# Debutly Report

> Simulated evidence — not real traction. Findings come from AI agents, not real users.

Target: http://localhost:3000  
Goal: Sign up and invite a teammate.  
Agents: 2  
Cost: $0.0343 (411,660 input + 26,248 output tokens)  
Findings: 0 blocker, 1 major, 0 minor (0 low-confidence)

## Customer units

- **Northbeam Analytics** (B2B SaaS startup, ~48 people, $500/mo): owner Maya succeeded; 1 of 1 teammates got in

## Agent outcomes
`;

const session = (agentId: string, name: string, extra: Partial<Session> = {}): Session => ({
  agentId,
  personaName: name,
  goal: "Sign up",
  outcome: "success",
  outcomeNote: "done",
  steps: [
    {
      index: 0,
      observation: { url: "http://localhost:3000/", title: "Home", text: "Welcome", elements: [] },
      action: { type: "click", id: 1 },
      reasoning: "Start",
      signals: [],
      screenshotPath: `../.throwaway/debutly/screenshots/${agentId}-000.png`,
    },
  ],
  usage: { inputTokens: 100, outputTokens: 10, costUsd: 0.01 },
  ...extra,
});

let open: OpenDb;
beforeEach(async () => {
  open = await openDb("memory:");
});
afterEach(async () => {
  await open.close();
});

it("reads target, goal, cost and businesses from a report", () => {
  expect(parseReportHeader(REPORT)).toEqual({
    targetUrl: "http://localhost:3000",
    goal: "Sign up and invite a teammate.",
    costUsd: 0.0343,
    inputTokens: 411660,
    outputTokens: 26248,
    businesses: [{ name: "Northbeam Analytics", archetype: "B2B SaaS startup", size: 48, monthlyBudget: 500, goal: "" }],
  });
});

it("rebuilds business crews and individuals from the sessions", () => {
  const crew = unitsFromSessions(
    [session("u1-o", "Maya", { unitId: "u1", role: "Owner", inclusion: "slow_connection" }), session("u1-e1", "Derek", { unitId: "u1", role: "Product Manager" })],
    parseReportHeader(REPORT).businesses,
  );
  expect(crew).toMatchObject([{ kind: "business", id: "u1", business: { name: "Northbeam Analytics" }, owner: { name: "Maya", role: "Owner", inclusion: "slow_connection" }, employees: [{ name: "Derek" }] }]);
  expect(unitsFromSessions([session("p1", "Priya")], [])).toMatchObject([{ kind: "individual", id: "p1", person: { name: "Priya" } }]);
});

it("imports a run folder whole: run, crews, sessions, steps, screenshots and findings", async () => {
  const dir = await mkdtemp(join(tmpdir(), "debutly-import-"));
  await mkdir(join(dir, "screenshots"));
  await writeFile(join(dir, "report.md"), REPORT);
  await writeFile(join(dir, "sessions.json"), JSON.stringify([session("u1-o", "Maya", { unitId: "u1", role: "Owner" }), session("u1-e1", "Derek", { unitId: "u1", outcome: "gave_up" })]));
  const finding: Finding = { signature: "covered:/x:button \"Save\"", kind: "covered", severity: "major", confidence: "high", title: "Can't click", detail: "d", pagePath: "/x", hitBy: ["u1-o"], visitors: 1, evidence: [{ agentId: "u1-o", stepIndex: 0 }] };
  await writeFile(join(dir, "findings.json"), JSON.stringify([finding]));
  await writeFile(join(dir, "screenshots", "u1-o-000.png"), Buffer.from("png-bytes"));

  const at = new Date("2026-10-02T10:02:01Z");
  const runId = await importRunFolder(open.db, dir, { app: "acme", trigger: "nightly", ciUrl: "https://github.com/acme/app/actions/runs/1", at, toJpeg: async (png) => Buffer.concat([Buffer.from("jpeg:"), png]) });

  const run = await new PgRunStore(open.db).getRun(runId);
  expect(run).toMatchObject({ app: "acme", trigger: "nightly", status: "finished", costUsd: 0.0343, inputTokens: 411660, goal: "Sign up and invite a teammate." });
  expect(run!.createdAt.toISOString()).toBe(at.toISOString());
  expect(run!.units).toMatchObject([{ id: "u1", kind: "business", business: { name: "Northbeam Analytics" } }]);
  expect(run!.agents.map((a) => `${a.name}:${a.role ?? ""}`).sort()).toEqual(["Derek:", "Maya:Owner"]);
  expect(run!.sessions.map((s) => s.outcome).sort()).toEqual(["gave_up", "success"]);
  expect(run!.findings).toMatchObject([{ kind: "covered", severity: "major" }]);
  // The screenshot that existed is in the database as a JPEG; the missing one is simply absent.
  const shot = run!.steps.find((s) => s.agentId === "u1-o")!.screenshotUrl;
  expect(shot).toBe(`db:${runId}/u1-o-000.jpg`);
  expect((await DbArtifactStore.get(open.db, runId, "u1-o-000.jpg"))?.data.toString()).toBe("jpeg:png-bytes");
  expect(run!.steps.find((s) => s.agentId === "u1-e1")!.screenshotUrl).toBeNull();
});
