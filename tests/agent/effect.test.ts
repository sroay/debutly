import { expect, it } from "vitest";
import { describeEffect } from "../../src/agent/effect";
import type { Observation } from "../../src/types";

const page = (url: string, text: string): Observation => ({ url, title: "", text, elements: [] });
const pricing = page("http://a.test/pricing", "Pricing Solo Studio");

it("says when a click did nothing and an error occurred", () => {
  const effect = describeEffect({ type: "click", id: 1 }, pricing, pricing, [{ kind: "page_error", message: "x is not defined", url: pricing.url }], {});
  expect(effect).toBe("nothing visibly changed; a JavaScript error occurred");
});

it("reports the new page after navigation", () => {
  expect(describeEffect({ type: "click", id: 1 }, pricing, page("http://a.test/checkout?plan=solo", "Checkout"), [], {})).toBe("now on /checkout");
});

it("reports on-page changes and failed requests", () => {
  const after = page(pricing.url, "Pricing Solo Studio Something went wrong");
  const signals = [
    { kind: "http_error" as const, status: 500, requestUrl: "http://a.test/api/invite", url: pricing.url },
    { kind: "http_error" as const, status: 404, requestUrl: "http://a.test/favicon.ico", url: pricing.url },
  ];
  expect(describeEffect({ type: "click", id: 1 }, pricing, after, signals, {})).toBe("the page changed; a request failed (HTTP 500)");
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
