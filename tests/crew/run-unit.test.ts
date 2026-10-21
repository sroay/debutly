import { expect, it, vi } from "vitest";
import { runUnit, type RunAgent } from "../../src/crew/run-unit";
import type { CustomerUnit, Session } from "../../src/types";
import { persona } from "../helpers/scripted-agents";

const crew: CustomerUnit = {
  kind: "business",
  id: "u1",
  business: { name: "Acme", archetype: "agency", size: 8, monthlyBudget: 200, goal: "win clients" },
  owner: { ...persona("u1-o", "Olga"), role: "Owner" },
  employees: [
    { ...persona("u1-e1", "Emil"), role: "Designer" },
    { ...persona("u1-e2", "Ema"), role: "Developer", inclusion: "low_vision" },
  ],
};
const emailOf = (p: { name: string }) => `${p.name.toLowerCase()}@acme.test`;
const done = (name: string, note = "ok"): Session => ({ agentId: name, personaName: name, goal: "", steps: [], outcome: "success", outcomeNote: note });

it("runs the owner first with the teammates to invite, then only the employees who got an invite", async () => {
  const runAgent = vi.fn<RunAgent>(async (p) => done(p.name, p.name === "Olga" ? "Bought Studio, invited both" : "joined"));
  const inbox = { latest: vi.fn(async (address: string) => (address === "emil@acme.test" ? [{ subject: "Invite", text: "", links: [] }] : [])) };
  const sessions = await runUnit(crew, "Sign up and choose a plan", { runAgent, inbox, emailOf });

  const [ownerCall] = runAgent.mock.calls;
  expect(ownerCall[1]).toContain("Sign up and choose a plan");
  expect(ownerCall[1]).toContain("Emil (Designer) at emil@acme.test");
  expect(ownerCall[2]).toContain("You work at Acme, an agency of about 8 people");
  expect(ownerCall[2]).toContain("You run Acme");
  expect(runAgent.mock.calls.map((c) => c[0].name)).toEqual(["Olga", "Emil"]);
  expect(runAgent.mock.calls[1][1]).toContain("Olga has invited you");
  // Landing in an empty workspace of one's own is not joining the team.
  expect(runAgent.mock.calls[1][1]).toContain("check that you are in Acme's shared workspace");
  expect(runAgent.mock.calls[1][1]).toContain("report that as a failure, not success");
  expect(runAgent.mock.calls[1][2]).toContain('Olga (the owner) reported: "Bought Studio, invited both"');
  expect(sessions.map((s) => [s.personaName, s.outcome, s.unitId, s.role])).toEqual([
    ["Olga", "success", "u1", "Owner"],
    ["Emil", "success", "u1", "Designer"],
    ["Ema", "not_invited", "u1", "Developer"],
  ]);
  expect(sessions[2]).toMatchObject({ inclusion: "low_vision", outcomeNote: "No invite email arrived after Olga finished." });
});

it("runs an individual once with the goal as given", async () => {
  const runAgent = vi.fn<RunAgent>(async (p) => done(p.name));
  const sessions = await runUnit({ kind: "individual", id: "p1", person: persona("p1", "Priya") }, "Find a job", { runAgent, emailOf });
  expect(runAgent).toHaveBeenCalledWith(expect.objectContaining({ name: "Priya" }), "Find a job", undefined);
  expect(sessions).toEqual([expect.objectContaining({ unitId: "p1", personaName: "Priya" })]);
});

it("without an inbox, teammates cannot receive invites and are recorded as such", async () => {
  const runAgent = vi.fn<RunAgent>(async (p) => done(p.name));
  const sessions = await runUnit(crew, "g", { runAgent, emailOf });
  expect(runAgent).toHaveBeenCalledTimes(1);
  expect(sessions.slice(1).every((s) => s.outcome === "not_invited" && /no test inbox/i.test(s.outcomeNote))).toBe(true);
});

it("an owner-only business just runs the owner with the plain goal", async () => {
  const runAgent = vi.fn<RunAgent>(async (p) => done(p.name));
  await runUnit({ ...crew, employees: [] } as CustomerUnit, "Sign up", { runAgent, emailOf });
  expect(runAgent.mock.calls[0][1]).toBe("Sign up");
});
