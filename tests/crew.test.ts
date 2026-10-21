/**
 * Business crews end to end on the fixture: the owner signs up, buys a plan and invites
 * two teammates, who each read the invite in their own inbox and join in their own browser.
 * A second owner gives up before inviting, so their teammate is never invited.
 */
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { fixtureInbox } from "../fixture/inbox";
import { startFixture, type RunningFixture } from "../fixture/server";
import { runSimulation, type SimulationResult } from "../src/run";
import type { CustomerUnit, Persona } from "../src/types";
import { persona, scriptedAgents, type Intent } from "./helpers/scripted-agents";

let fx: RunningFixture;
let result: SimulationResult;

const member = (id: string, name: string, role: string): Persona => ({ ...persona(id, name), role });
const join_: Intent[] = [
  { checkEmail: true },
  { openEmailLink: true },
  { fill: ["Name", "Teammate"] },
  { fill: ["Password", "test-pass-123"] },
  { click: "Join workspace" },
  { done: [true, "Joined the workspace"] },
];

const units: CustomerUnit[] = [
  {
    kind: "business",
    id: "u1",
    business: { name: "Acme", archetype: "agency", size: 8, monthlyBudget: 200, goal: "Win clients" },
    owner: member("u1-o", "Olga", "Owner"),
    employees: [member("u1-e1", "Emil", "Designer"), member("u1-e2", "Ema", "Developer")],
  },
  {
    kind: "business",
    id: "u2",
    business: { name: "Beta", archetype: "startup", size: 3, monthlyBudget: 20, goal: "Ship" },
    owner: member("u2-o", "Pia", "Owner"),
    employees: [member("u2-e1", "Rolf", "Analyst")],
  },
];

beforeAll(async () => {
  fx = await startFixture({ invites: "working" });
  const llm = scriptedAgents({
    Olga: [
      { click: "Sign up" },
      { fill: ["Work email", "olga@acme.test"] },
      { fill: ["Password", "test-pass-123"] },
      { click: "Create account" },
      { click: "Choose Solo" },
      { fill: ["Card number", "4242 4242 4242 4242"] },
      { click: "Pay" },
      { fill: ["Teammate email", "{email:Emil}"] },
      { click: "Send invite" },
      { fill: ["Teammate email", "{email:Ema}"] },
      { click: "Send invite" },
      { done: [true, "Bought Solo and invited Emil and Ema"] },
    ],
    Emil: join_,
    Ema: join_,
    Pia: [{ done: [false, "Too expensive for us"] }],
  });
  result = await runSimulation({
    url: fx.url,
    goal: "Sign up, choose a plan and set up your team",
    units,
    llm,
    maxSteps: 15,
    concurrency: 2,
    outDir: await mkdtemp(join(tmpdir(), "debutly-crew-")),
    inbox: fixtureInbox(fx.state),
  });
});
afterAll(async () => {
  await fx.close();
});

const outcome = (name: string) => result.sessions.find((s) => s.personaName === name);

it("the owner buys and invites; both teammates join from their own inboxes and logins", () => {
  expect(outcome("Olga")).toMatchObject({ outcome: "success", unitId: "u1", role: "Owner" });
  expect(outcome("Emil")).toMatchObject({ outcome: "success", unitId: "u1", role: "Designer" });
  expect(outcome("Ema")).toMatchObject({ outcome: "success", unitId: "u1", role: "Developer" });
  expect(fx.state.joined).toHaveLength(2);
  expect(fx.state.joined.every((e) => e.endsWith("@agents.test"))).toBe(true);
});

it("a teammate whose owner never invited them is recorded as not invited, without running", () => {
  expect(outcome("Pia")?.outcome).toBe("gave_up");
  expect(outcome("Rolf")).toMatchObject({ outcome: "not_invited", steps: [] });
});

it("no session hit an engine error", () => {
  for (const s of result.sessions) expect(s.outcome, `${s.personaName}: ${s.outcomeNote}`).not.toBe("error");
});
