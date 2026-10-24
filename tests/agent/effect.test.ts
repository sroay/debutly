import { expect, it } from "vitest";
import { describeEffect } from "../../src/agent/effect";
import type { InteractiveElement, Observation } from "../../src/types";

const page = (url: string, text: string): Observation => ({ url, title: "", text, elements: [] });
const pricing = page("http://a.test/pricing", "Pricing\nSolo\nStudio");

it("says when a click did nothing and an error occurred", () => {
  const effect = describeEffect({ type: "click", id: 1 }, pricing, pricing, [{ kind: "page_error", message: "x is not defined", url: pricing.url }], {});
  expect(effect).toBe("nothing visibly changed; a JavaScript error occurred");
});

it("reports the new page after navigation", () => {
  expect(describeEffect({ type: "click", id: 1 }, pricing, page("http://a.test/checkout?plan=solo", "Checkout"), [], {})).toBe("now on /checkout");
});

it("reports on-page changes and failed requests", () => {
  const after = page(pricing.url, "Pricing\nSolo\nStudio\nSomething went wrong");
  const signals = [
    { kind: "http_error" as const, status: 500, requestUrl: "http://a.test/api/invite", url: pricing.url },
    { kind: "http_error" as const, status: 404, requestUrl: "http://a.test/favicon.ico", url: pricing.url },
  ];
  expect(describeEffect({ type: "click", id: 1 }, pricing, after, signals, {})).toBe('the page changed: new text "Something went wrong"; a request failed (HTTP 500)');
});

it("stays quiet about typing, which rarely changes the visible text", () => {
  expect(describeEffect({ type: "fill", id: 1, text: "a" }, pricing, pricing, [], {})).toBe("");
});

it("reports blocked and failed actions instead", () => {
  expect(describeEffect({ type: "click", id: 1 }, pricing, pricing, [], { blocked: "destructive action refused" })).toBe("blocked: destructive action refused");
  expect(describeEffect({ type: "click", id: 1 }, pricing, pricing, [], { error: "timeout" })).toBe("failed: timeout");
});

it("tells the agent a dialog popped up and was answered OK", () => {
  const signals = [{ kind: "dialog" as const, dialogType: "confirm", message: "Import this CV?", url: pricing.url }];
  expect(describeEffect({ type: "click", id: 1 }, pricing, pricing, signals, {})).toBe(
    'nothing visibly changed; a confirm dialog said "Import this CV?" (answered OK)',
  );
});

it("says a file downloaded rather than that nothing changed", () => {
  const reports = page("http://a.test/reports", "Reports Weekly brief");
  const effect = describeEffect({ type: "click", id: 1 }, reports, reports, [{ kind: "download", filename: "Weekly-Brief.docx", url: reports.url }], {});
  expect(effect).toBe("a file downloaded: Weekly-Brief.docx");
});

const el = (id: number, role: string, name: string, extra: Partial<InteractiveElement> = {}): InteractiveElement => ({ id, role, name, tag: role.split(":")[0], ...extra });
const at = (text: string, elements: InteractiveElement[]): Observation => ({ url: "http://a.test/invite", title: "", text, elements });

it("says what appeared and what went, so an agent sees the next step it is asked for", () => {
  // Twenty's invitation: after Continue, a password field and a new button appear.
  const before = at("Join Gulf Trade Solutions\nContinue", [el(0, "input:email", "Email"), el(1, "button", "Continue")]);
  const after = at("Join Gulf Trade Solutions\nMust be at least 8 characters\nCreate account", [
    el(0, "input:email", "Email"),
    el(1, "input:password", "Password"),
    el(2, "button", "Create account"),
  ]);
  expect(describeEffect({ type: "click", id: 1 }, before, after, [], {})).toBe(
    'the page changed: new input:password "Password", button "Create account"; gone button "Continue"; new text "Must be at least 8 characters"',
  );
});

it("counts a second copy of the same control as new", () => {
  // Each press of "Create company" added another empty "Untitled" row.
  const before = at("Companies\nUntitled", [el(0, "button", "Create company"), el(1, "link", "Untitled")]);
  const after = at("Companies\nUntitled\nUntitled", [el(0, "button", "Create company"), el(1, "link", "Untitled"), el(2, "link", "Untitled")]);
  expect(describeEffect({ type: "click", id: 0 }, before, after, [], {})).toBe('the page changed: new link "Untitled"');
});

it("says when a control's state changed", () => {
  const before = at("Settings", [el(0, "input:text", "Title", { value: "Consultation" }), el(1, "button", "Save", { disabled: true }), el(2, "input:checkbox", "I agree", { checked: false })]);
  const after = at("Settings", [el(0, "input:text", "Title", { value: "Consultation" }), el(1, "button", "Save"), el(2, "input:checkbox", "I agree", { checked: true })]);
  expect(describeEffect({ type: "click", id: 2 }, before, after, [], {})).toBe('the page changed: now enabled button "Save"; now checked input:checkbox "I agree"');
});

it("names a new icon button by its icon for a sighted agent only", () => {
  const before = at("Inbox", [el(0, "button", "Open menu")]);
  const after = at("Inbox", [el(0, "button", "Open menu"), el(1, "button", "", { icon: "trash" })]);
  expect(describeEffect({ type: "click", id: 0 }, before, after, [], {})).toBe('the page changed: new button "" (trash icon)');
  expect(describeEffect({ type: "click", id: 0 }, before, after, [], {}, { screenReader: true })).toBe('the page changed: new button ""');
});
