import { expect, it } from "vitest";
import { saidOtherControl } from "../../src/agent/intent";
import type { InteractiveElement, Observation } from "../../src/types";

const el = (id: number, role: string, name: string, extra: Partial<InteractiveElement> = {}): InteractiveElement => ({ id, role, name, tag: role, ...extra });
const page = (elements: InteractiveElement[]): Observation => ({ url: "http://a.test/onboarding", title: "", text: "", elements });

// An onboarding step: the product's logo first, then the step's own controls.
const alerts = page([el(0, "link", "Acme"), el(1, "button", "Email alerts Get notified of hiring changes"), el(2, "button", "Back"), el(3, "button", "Complete setup")]);

it("notices words about one control and an action on another (2026-10-25)", () => {
  expect(saidOtherControl("I need to set up alerts, so I will click the button for email alerts.", { type: "click", id: 0 }, alerts)).toEqual(["Email alerts Get notified of hiring changes"]);
  const purpose = page([el(0, "link", "Acme"), el(3, "button", "Competitor"), el(4, "button", "Investment Target")]);
  expect(saidOtherControl("Since my goal is to monitor competitors, I must select 'Competitor' from the tracking purposes.", { type: "click", id: 0 }, purpose)).toEqual(["Competitor"]);
});

it("lets an action that matches its words, or a control without a name, through", () => {
  expect(saidOtherControl("I will click the button for email alerts.", { type: "click", id: 1 }, alerts)).toBeUndefined();
  expect(saidOtherControl("Everything is set, so I'll press Complete setup.", { type: "click", id: 3 }, alerts)).toBeUndefined();
  // Nothing on the page is named in its words: nothing to compare.
  expect(saidOtherControl("Let me go back to the start.", { type: "click", id: 0 }, alerts)).toBeUndefined();
  const icon = page([el(0, "button", "", { icon: "menu" }), el(1, "link", "Settings")]);
  expect(saidOtherControl("I'll open the menu to find Settings.", { type: "click", id: 0 }, icon)).toBeUndefined();
  // Typing what it says into a field.
  const form = page([el(0, "input:text", "Company name"), el(1, "button", "Continue")]);
  expect(saidOtherControl("I'll type RidgePoint Creative, then Continue.", { type: "fill", id: 0, text: "RidgePoint Creative" }, form)).toBeUndefined();
});

it("goes by the names a screen reader announces for the screen-reader agent", () => {
  const p = page([el(0, "button", "", { ax: { name: "Close dialog", role: "button", hidden: false } }), el(1, "button", "Save", { ax: { name: "Save", role: "button", hidden: false } })]);
  expect(saidOtherControl("I'll save my changes with Save.", { type: "click", id: 0 }, p, true)).toEqual(["Save"]);
});
