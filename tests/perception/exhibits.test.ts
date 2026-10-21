import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { expect, it } from "vitest";
import { startFixture } from "../../fixture/server";
import { captureExhibits, exhibitFromFile, exhibitsFromSessions, kindOf } from "../../src/perception/exhibits";
import type { Session, Step } from "../../src/types";

it("recognises page kinds from the path, title and copy", () => {
  expect(kindOf("https://a.test/", "Home", "")).toBe("landing");
  expect(kindOf("https://a.test/pricing", "Plans", "")).toBe("pricing");
  expect(kindOf("https://a.test/plans", "Plans", "$19 per month")).toBe("pricing");
  expect(kindOf("https://a.test/register", "Join", "")).toBe("signup");
  expect(kindOf("https://a.test/onboarding/step-2", "Setup", "")).toBe("onboarding");
  expect(kindOf("https://a.test/dashboard/settings", "Settings", "")).toBe("dashboard");
  expect(kindOf("https://a.test/blog/post", "Post", "")).toBe("other");
});

const step = (index: number, url: string, text: string): Step => ({
  index,
  observation: { url, title: url, text, elements: [{ id: 1, role: "button", name: "Go", tag: "button" }] },
  action: { type: "click", id: 1 },
  reasoning: "",
  signals: [],
});
const session = (steps: Step[]): Session => ({ agentId: "p1", personaName: "A", goal: "g", steps, outcome: "success", outcomeNote: "" });

it("keeps the last snapshot per page, key pages first", () => {
  const exhibits = exhibitsFromSessions([
    session([step(0, "http://a.test/blog", "blog"), step(1, "http://a.test/pricing", "old prices"), step(2, "http://a.test/", "home"), step(3, "http://a.test/pricing", "new prices")]),
  ]);
  expect(exhibits.map((e) => [e.kind, e.text])).toEqual([
    ["pricing", "new prices"],
    ["landing", "home"],
    ["other", "blog"],
  ]);
  expect(exhibits[0].elements).toEqual(["button: Go"]);
});

it("captures pages read-only, with their full copy", async () => {
  const fx = await startFixture();
  const browser = await chromium.launch();
  try {
    const exhibits = await captureExhibits(browser, [fx.url, `${fx.url}/pricing`]);
    expect(exhibits.map((e) => e.kind)).toEqual(["landing", "pricing"]);
    expect(exhibits[1].text).toContain("$49/month");
    expect(fx.state.signups).toEqual([]);
  } finally {
    await browser.close();
    await fx.close();
  }
});

it("reads an idea-stage pitch from a file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "debutly-pitch-"));
  const file = join(dir, "pitch.md");
  await writeFile(file, "# Acme\nPricing: $29/month");
  expect(await exhibitFromFile(file)).toMatchObject({ kind: "pricing", title: "Acme", text: "# Acme\nPricing: $29/month" });
});

it("maps however an evaluator named a page back to that page", async () => {
  const { canonicalExhibitId } = await import("../../src/perception/exhibits");
  const exhibits = [
    { id: "/", kind: "landing" as const, title: "Home", url: "https://acme.test/", text: "", elements: [] },
    { id: "/pricing", kind: "pricing" as const, title: "Pricing", url: "https://acme.test/pricing", text: "", elements: [] },
  ];
  for (const ref of ["/", "landing", "https://acme.test/", "https://acme.test"]) expect(canonicalExhibitId(ref, exhibits)).toBe("/");
  for (const ref of ["/pricing", "/pricing/", "pricing", "https://acme.test/pricing/", "Pricing"]) expect(canonicalExhibitId(ref, exhibits)).toBe("/pricing");
  expect(canonicalExhibitId("somewhere else", exhibits)).toBeUndefined();
  expect(canonicalExhibitId(undefined, exhibits)).toBeUndefined();
});

it("reads a variant file the way a buyer would see it: no hidden notes, named by its heading, kind from its content", async () => {
  const dir = await mkdtemp(join(tmpdir(), "debutly-variant-"));
  const file = join(dir, "pricing-b.md");
  await writeFile(file, "<!-- demonstration rewrite, do not show -->\n# Acme pricing\nSolo $19/month");
  const e = await exhibitFromFile(file);
  expect(e).toMatchObject({ kind: "pricing", title: "Acme pricing" });
  expect(e.text).not.toContain("demonstration");
});

it("opens FAQ answers before reading, as a person would", async () => {
  const browser = await chromium.launch();
  try {
    const html = `<main><details><summary>Is there a free plan?</summary>Yes, forever.</details>
<button aria-expanded="false" onclick="this.nextElementSibling.hidden=false;this.setAttribute('aria-expanded','true')">Why does Studio cost more?</button><p hidden>It adds white-label.</p>
<button aria-expanded="false" onclick="document.body.dataset.menu='open'">Menu</button></main>`;
    const [e] = await captureExhibits(browser, [`data:text/html,${encodeURIComponent(html)}`]);
    expect(e.text).toContain("Yes, forever.");
    expect(e.text).toContain("It adds white-label.");
  } finally {
    await browser.close();
  }
});
