/**
 * The platform's regression suite: the engine must keep catching every
 * bug seeded in the Fixturely fixture, and keep refusing the destructive button.
 */
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { startFixture, type RunningFixture } from "../fixture/server";
import { asIndividuals, runSimulation, type SimulationResult } from "../src/run";
import { persona, scriptedAgents, type Intent } from "./helpers/scripted-agents";

let fx: RunningFixture;
let result: SimulationResult;

const signup: Intent[] = [
  { click: "Sign up" },
  { fill: ["Work email", "user@example.com"] },
  { fill: ["Password", "test-pass-123"] },
  { click: "Create account" },
];

beforeAll(async () => {
  fx = await startFixture();
  const llm = scriptedAgents({
    Ava: [...signup, { click: "Choose Studio" }, { done: [false, "Studio button does nothing"] }],
    Ben: [
      ...signup,
      { click: "Choose Solo" },
      { fill: ["Card number", "4242 4242 4242 4242"] },
      { click: "Pay" },
      { fill: ["Teammate email", "cara@example.com"] },
      { click: "Send invite" },
      { click: "Delete workspace" },
      { done: [false, "Invites fail"] },
    ],
    Cara: [{ click: "Docs" }, { done: [false, "Docs page missing"] }],
  });
  result = await runSimulation({
    url: fx.url,
    goal: "Sign up, choose a plan and invite a teammate",
    units: asIndividuals([persona("p1", "Ava"), persona("p2", "Ben"), persona("p3", "Cara")]),
    llm,
    maxSteps: 15,
    concurrency: 3,
    outDir: await mkdtemp(join(tmpdir(), "debutly-acceptance-")),
  });
});
afterAll(async () => {
  await fx.close();
});

it("completes every session without engine errors", () => {
  for (const s of result.sessions) expect(s.outcome, `${s.personaName}: ${s.outcomeNote}`).not.toBe("error");
});

it("catches the dead docs link", () => {
  expect(result.findings).toContainEqual(expect.objectContaining({ signature: "http:404:/docs", confidence: "high" }));
});

it("catches the broken Studio button as a blocker", () => {
  const f = result.findings.find((x) => x.kind === "page_error" && x.pagePath === "/pricing");
  expect(f?.severity).toBe("blocker");
  expect(f?.detail).toContain("startCheckout");
});

it("catches the failing invite as a blocker", () => {
  expect(result.findings).toContainEqual(expect.objectContaining({ signature: "http:500:/api/invite", severity: "blocker" }));
});

it("catches the unlabeled dashboard button", () => {
  expect(result.findings).toContainEqual(expect.objectContaining({ kind: "a11y_unlabeled", pagePath: "/dashboard" }));
});

it("refused the destructive action", () => {
  expect(fx.state.workspaceDeleted).toBe(false);
  const ben = result.sessions.find((s) => s.personaName === "Ben")!;
  expect(ben.steps.some((s) => s.blocked?.includes("destructive"))).toBe(true);
});

it("writes a labeled report", async () => {
  expect(await readFile(result.reportPath, "utf8")).toContain("Simulated evidence");
});
