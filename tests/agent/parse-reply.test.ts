import { expect, it } from "vitest";
import { parseAgentReply } from "../../src/agent/parse-reply";
import { describeAction } from "../../src/agent/describe";

it("parses a plain JSON reply", () => {
  const r = parseAgentReply(`{"reasoning":"go","action":{"type":"click","id":3}}`);
  expect(r).toEqual({ reasoning: "go", action: { type: "click", id: 3 } });
});

it("parses JSON wrapped in prose or code fences", () => {
  const r = parseAgentReply('Sure:\n```json\n{"reasoning":"x","action":{"type":"done","success":false,"note":"broken"}}\n```');
  expect(r.action).toEqual({ type: "done", success: false, note: "broken" });
});

it("accepts a reply that leaves out the reasoning", () => {
  expect(parseAgentReply(`{"action":{"type":"click","id":4}}`)).toEqual({ reasoning: "", action: { type: "click", id: 4 } });
});

it("rejects invalid actions", () => {
  expect(() => parseAgentReply(`{"reasoning":"x","action":{"type":"fly"}}`)).toThrow();
  expect(() => parseAgentReply("no json here")).toThrow(/no JSON/);
});

it("describes actions in human terms", () => {
  const obs = { url: "http://x/", title: "t", text: "", elements: [{ id: 2, role: "button", name: "Pay", tag: "button" }] };
  expect(describeAction({ type: "click", id: 2 }, obs)).toBe('clicked button "Pay"');
  expect(describeAction({ type: "fill", id: 2, text: "a" }, obs)).toBe('typed "a" into button "Pay"');
  expect(describeAction({ type: "goto", path: "/x" }, obs)).toBe("went to /x");
  expect(describeAction({ type: "done", success: true, note: "ok" }, obs)).toBe("finished (success): ok");
});

it("parses key presses and rejects keys outside the safe set", () => {
  expect(parseAgentReply(`{"reasoning":"close","action":{"type":"press","key":"Escape"}}`).action).toEqual({ type: "press", key: "Escape" });
  expect(() => parseAgentReply(`{"reasoning":"x","action":{"type":"press","key":"Control+W"}}`)).toThrow();
});

it("parses waiting for a page that is still loading", () => {
  expect(parseAgentReply(`{"reasoning":"still loading","action":{"type":"wait"}}`).action).toEqual({ type: "wait" });
  expect(describeAction({ type: "wait" }, { url: "http://x/", title: "t", text: "", elements: [] })).toBe("waited for the page to load");
});

it("reads an action a model sent as a string, quoted or escaped (GLM 5.3 Flash does both)", () => {
  // Seen in the 2026-10-02 nightly runs: three tries, the same reply, and the agent ended.
  const quoted = `{"reasoning":"Company name is filled.","action":"{"type":"fill","id":1,"text":"fuseagency.com"}"}`;
  expect(parseAgentReply(quoted)).toEqual({ reasoning: "Company name is filled.", action: { type: "fill", id: 1, text: "fuseagency.com" } });
  const withComma = `{"reasoning":"Location.","action":"{"type":"fill","id":45,"text":"New York, NY"}"}`;
  expect(parseAgentReply(withComma).action).toEqual({ type: "fill", id: 45, text: "New York, NY" });
  const first = `{"action":"{"type":"click","id":3}","reasoning":"Next."}`;
  expect(parseAgentReply(first)).toEqual({ reasoning: "Next.", action: { type: "click", id: 3 } });
  const escaped = JSON.stringify({ reasoning: "Wait.", action: JSON.stringify({ type: "wait" }) });
  expect(parseAgentReply(escaped).action).toEqual({ type: "wait" });
});

it("reads a quoted action whose closing quote and brace never came (2026-10-17)", () => {
  const unclosed = `{"reasoning":"Filling phone field, then location, then save.","action":"{"type":"fill","id":35,"text":"+1 555 0142"}`;
  expect(parseAgentReply(unclosed)).toEqual({ reasoning: "Filling phone field, then location, then save.", action: { type: "fill", id: 35, text: "+1 555 0142" } });
});

it("reads an action flattened into the reply, its type as a string beside its fields (2026-10-18)", () => {
  const click = `{"reasoning":"Submit the form to create the content.","action":"click","id":50}`;
  expect(parseAgentReply(click)).toEqual({ reasoning: "Submit the form to create the content.", action: { type: "click", id: 50 } });
  expect(parseAgentReply(`{"reasoning":"x","action":"fill","id":7,"text":"hello"}`).action).toEqual({ type: "fill", id: 7, text: "hello" });
  expect(parseAgentReply(`{"reasoning":"x","action":"done","success":true,"note":"ok"}`).action).toEqual({ type: "done", success: true, note: "ok" });
  expect(parseAgentReply(`{"reasoning":"x","action":"press","key":"Escape"}`).action).toEqual({ type: "press", key: "Escape" });
});

it("still refuses a string action that isn't an action", () => {
  expect(() => parseAgentReply(`{"reasoning":"x","action":"click the button"}`)).toThrow();
  expect(() => parseAgentReply(`{"reasoning":"x","action":"{"type":"explode"}"}`)).toThrow();
  // A flattened action still needs its fields.
  expect(() => parseAgentReply(`{"reasoning":"x","action":"click"}`)).toThrow();
});

it("reads a reply split into two objects, one after the other (2026-10-24)", () => {
  const split = `{"reasoning": "The button is not responding; I will press Enter again."}\n{"action": "press","key":"Enter"}`;
  expect(parseAgentReply(split)).toEqual({ reasoning: "The button is not responding; I will press Enter again.", action: { type: "press", key: "Enter" } });
  const nested = `{"reasoning":"Save it {now}"}\n{"action":{"type":"click","id":3}}`;
  expect(parseAgentReply(nested)).toEqual({ reasoning: "Save it {now}", action: { type: "click", id: 3 } });
  // Two whole replies: the first one counts.
  expect(parseAgentReply(`{"reasoning":"a","action":{"type":"wait"}}\n{"reasoning":"b","action":{"type":"click","id":1}}`)).toEqual({ reasoning: "a", action: { type: "wait" } });
});

it("says plainly that a reply has no action, so asking again can work", () => {
  expect(() => parseAgentReply(`{"reasoning": "Since 'Get started' is disabled, I am waiting for the system."}`)).toThrow('the reply has no "action"');
  expect(() => parseAgentReply(`{"reasoning":"x","action":{"type":"click"}}`)).toThrow(/^action\.id: /);
});
