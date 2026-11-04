import { expect, it } from "vitest";
import { describeProgress, goalProgress, pageKind, stuckOn } from "../../src/agent/progress";
import { ScriptedLlm } from "../../src/llm/scripted";
import { renderReport } from "../../src/report/markdown";
import type { Action, Session, Step } from "../../src/types";

const at = (index: number, url: string, action: Action, reasoning: string, names: string[] = []): Step => ({
  index,
  observation: { url: `http://crm.test${url}`, title: "", text: names.join("\n"), elements: names.map((name, id) => ({ id, role: "button", name, tag: "button" })) },
  action,
  reasoning,
  signals: [],
});

// An owner who set up the workspace and invited the team, then went round on one contact's page.
const owner = (): Session => ({
  agentId: "u1-o",
  personaName: "Khalid",
  role: "Owner",
  goal: "Create your workspace, add your three customers as companies each with a contact, and invite your teammates.",
  outcome: "budget_exhausted",
  outcomeNote: "stopped after 8 steps",
  steps: [
    at(0, "/welcome", { type: "click", id: 0 }, "I'll create my workspace.", ["Create workspace"]),
    at(1, "/invite-team", { type: "click", id: 0 }, "Inviting James and Fatima.", ["Invite"]),
    at(2, "/objects/companies", { type: "click", id: 0 }, "Adding my first customer.", ["New company"]),
    at(3, "/object/person/358db0e0-2b3a-4d2a-a748-0cab0f580138", { type: "click", id: 0 }, "No name field here.", ["Edit"]),
    at(4, "/object/person/358db0e0-2b3a-4d2a-a748-0cab0f580138", { type: "press", key: "Escape" }, "Closing the list."),
    at(5, "/object/person/5772de69-b0b7-4644-8922-b6e1d0a7c001", { type: "click", id: 0 }, "Trying the pencil again.", ["Edit"]),
    at(6, "/objects/people", { type: "wait" }, "Waiting."),
    at(7, "/object/person/5772de69-b0b7-4644-8922-b6e1d0a7c001", { type: "click", id: 0 }, "Still no name field.", ["Edit"]),
  ],
});

const PARTS = `Here is my answer: {"parts":[
  {"part":"create the workspace","done":true,"step":1},
  {"part":"invite the teammates","done":true,"step":2},
  {"part":"add three companies, each with a contact","done":false,"step":null},
  {"part":"a part done at a step never taken","done":true,"step":40}]}`;

it("asks the judge how far an agent got, from the steps as they happened, and keeps the step that finished each part (2026-11-04)", async () => {
  const judge = new ScriptedLlm(() => PARTS);
  const parts = await goalProgress(judge, owner());
  expect(parts).toEqual([
    { part: "create the workspace", done: true, stepIndex: 0 },
    { part: "invite the teammates", done: true, stepIndex: 1 },
    { part: "add three companies, each with a contact", done: false },
    { part: "a part done at a step never taken", done: true },
  ]);
  const asked = judge.calls[0].messages[0].content;
  expect(asked).toContain("Goal: Create your workspace");
  expect(asked).toContain('1. /welcome: clicked button "Create workspace" → now on /invite-team | thought: "I\'ll create my workspace."');
  expect(asked).toContain('8. /object/person/5772de69-b0b7-4644-8922-b6e1d0a7c001: clicked button "Edit" | thought: "Still no name field."');
  expect(asked).toContain('It ran out of steps: "stopped after 8 steps"');
});

it("asks nothing about an agent that got there, and leaves out a reply it can't read", async () => {
  const judge = new ScriptedLlm(() => "I think it did fine.");
  expect(await goalProgress(judge, { ...owner(), outcome: "success" })).toBeUndefined();
  expect(judge.calls).toHaveLength(0);
  expect(await goalProgress(judge, owner())).toBeUndefined();
  expect(await goalProgress(new ScriptedLlm(() => '{"parts":[{"part":"x","done":"yes"}]}'), owner())).toBeUndefined();
});

it("says what got done, what didn't, and the page its last steps went round on", () => {
  const s = owner();
  s.progress = [
    { part: "create the workspace", done: true, stepIndex: 0 },
    { part: "invite the teammates", done: true, stepIndex: 1 },
    { part: "add three companies, each with a contact", done: false },
  ];
  expect(pageKind("/object/person/358db0e0-2b3a-4d2a-a748-0cab0f580138")).toBe("/object/person/…");
  expect(pageKind("/event-types/12")).toBe("/event-types/…");
  expect(stuckOn(s)).toEqual({ page: "/object/person/…", steps: 4, of: 6 });
  expect(describeProgress(s)).toBe(
    "2 of 3 parts of the goal done: create the workspace (step 1), invite the teammates (step 2). Not done: add three companies, each with a contact. 4 of its last 6 steps were on /object/person/….",
  );
  const report = renderReport({ targetUrl: "http://crm.test", goal: "Set up", sessions: [s], findings: [] });
  expect(report).toContain("**Khalid (Owner) ran out of steps on /object/person/5772de69-b0b7-4644-8922-b6e1d0a7c001.** 2 of 3 parts of the goal done:");
  expect(report).toContain("| Khalid | Owner | — | budget_exhausted (2 of 3 parts done) | stopped after 8 steps |");
  expect(report).toContain('- **Khalid** ran out of steps on /object/person/5772de69-b0b7-4644-8922-b6e1d0a7c001: "stopped after 8 steps" 2 of 3 parts');
  // No parts known: the report reads as before.
  expect(describeProgress(owner())).toBe("");
});
