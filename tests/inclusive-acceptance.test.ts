/**
 * The access-need checks end to end: the screen-reader agent works by keyboard and the
 * low-vision agent's pages are measured at 320 pixels, against barriers seeded in the fixture.
 */
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { startFixture, type RunningFixture } from "../fixture/server";
import { asIndividuals, runSimulation, type SimulationResult } from "../src/run";
import { persona, scriptedAgents } from "./helpers/scripted-agents";

let fx: RunningFixture;
let result: SimulationResult;

beforeAll(async () => {
  fx = await startFixture();
  const llm = scriptedAgents({
    Sam: [{ goto: "/settings" }, { click: "Save settings" }, { click: "Export data" }, { done: [false, "Can't save my settings"] }],
    Lena: [{ goto: "/team" }, { goto: "/usage" }, { goto: "/features" }, { done: [true, "Looked around"] }],
  });
  result = await runSimulation({
    url: fx.url,
    goal: "Change my settings",
    units: asIndividuals([
      { ...persona("p1", "Sam"), inclusion: "screen_reader" },
      { ...persona("p2", "Lena"), inclusion: "low_vision" },
    ]),
    llm,
    maxSteps: 10,
    concurrency: 2,
    outDir: await mkdtemp(join(tmpdir(), "debutly-inclusive-")),
  });
}, 120_000);
afterAll(async () => {
  await fx.close();
});

it("can't save settings by keyboard, because the button is a span outside the tab order", () => {
  expect(result.findings).toContainEqual(
    expect.objectContaining({ kind: "keyboard", pagePath: "/settings", wcag: ["2.1.1"], confidence: "high", title: expect.stringContaining('"Save settings"') }),
  );
});

it("sees the cookie bar hide keyboard focus on Export data", () => {
  expect(result.findings).toContainEqual(expect.objectContaining({ kind: "focus_obscured", pagePath: "/settings", wcag: ["2.4.11"], detail: expect.stringContaining("cookie-bar") }));
});

it("measures the low-vision agent's pages at 320 pixels: the banner fails, the data table may scroll, plain pages pass", () => {
  const reflow = result.findings.filter((f) => f.kind === "reflow");
  expect(reflow.map((f) => f.pagePath).sort()).toEqual(["/team", "/usage"]);
  expect(reflow.find((f) => f.pagePath === "/usage")?.detail).toContain("It may be allowed: it is inside a data table");
});

it("keeps every session free of engine errors", () => {
  for (const s of result.sessions) expect(s.outcome, `${s.personaName}: ${s.outcomeNote}`).not.toBe("error");
});
