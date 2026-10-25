import { expect, it } from "vitest";
import { nothingToPressYet, untriedWaysOn } from "../../src/agent/give-up";
import type { InteractiveElement, Observation, Step } from "../../src/types";

const el = (id: number, role: string, name: string, extra: Partial<InteractiveElement> = {}): InteractiveElement => ({ id, role, name, tag: role, ...extra });
const at = (url: string, elements: InteractiveElement[]): Observation => ({ url, title: "", text: "", elements });
const click = (index: number, obs: Observation, id: number): Step => ({ index, observation: obs, action: { type: "click", id }, reasoning: "", signals: [] });

it("finds a way on the agent hasn't pressed on this page", () => {
  // Twenty's invite page, where a teammate agent gave up saying there was no way in.
  const invite = at("http://a.test/invite/abc", [el(0, "link", ""), el(1, "input:text", "Email"), el(2, "button", "Continue"), el(3, "link", "Privacy Policy")]);
  expect(untriedWaysOn(invite, [])).toEqual(["Continue"]);
  // Pressed already on this page: nothing left to suggest.
  expect(untriedWaysOn(invite, [click(0, invite, 2)])).toEqual([]);
  // Pressed on another page only: still untried here.
  const welcome = at("http://a.test/welcome", [el(0, "button", "Continue")]);
  expect(untriedWaysOn(invite, [click(0, welcome, 0)])).toEqual(["Continue"]);
});

it("leaves out disabled controls, links in the menu and anything that isn't a way on, and reads Arabic", () => {
  const page = at("http://a.test/x", [el(0, "button", "Continue", { disabled: true }), el(1, "button", "Delete"), el(2, "button", "استمر"), el(3, "button", "Join GulfServe FM"), el(4, "link", "Sign up")]);
  expect(untriedWaysOn(page, [])).toEqual(["استمر", "Join GulfServe FM"]);
});

it("goes by what the screen reader announces for the screen-reader agent", () => {
  const page = at("http://a.test/x", [el(0, "button", "", { ax: { name: "Sign in", role: "button", hidden: false } }), el(1, "button", "Next", { ax: { name: "", role: "none", hidden: true } })]);
  expect(untriedWaysOn(page, [], true)).toEqual(["Sign in"]);
});

it("counts adding or creating what the agent came for as a way on, in Arabic too", () => {
  // Twenty's People page, where an agent said the way to add a person was missing.
  const people = at("http://a.test/objects/people", [el(0, "button", "إنشاء شخص"), el(1, "button", "تصفية"), el(2, "button", "أضف شخص"), el(3, "button", "Add column")]);
  expect(untriedWaysOn(people, [])).toEqual(["إنشاء شخص", "أضف شخص", "Add column"]);
});

it("knows a page with nothing to press may still be arriving", () => {
  expect(nothingToPressYet(at("http://a.test/invite/abc", []))).toBe(true);
  expect(nothingToPressYet(at("http://a.test/invite/abc", [el(0, "button", "Continue")]))).toBe(false);
});
