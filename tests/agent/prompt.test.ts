import { expect, it } from "vitest";
import { buildStepMessage, buildSystemPrompt } from "../../src/agent/prompt";
import { persona } from "../helpers/scripted-agents";

it("keeps the name first and adds role, company brief and inclusion need", () => {
  const p = { ...persona("u1-e1", "Emil"), role: "Designer", inclusion: "screen_reader" as const };
  const prompt = buildSystemPrompt(p, "Accept the invite", undefined, "You work at Acme, an agency of about 8 people.");
  expect(prompt.startsWith("You are Emil.")).toBe(true);
  expect(prompt).toContain("Your role: Designer.");
  expect(prompt).toContain("You work at Acme");
  expect(prompt).toMatch(/screen reader/);
});

it("adds nothing extra for a plain persona", () => {
  const prompt = buildSystemPrompt(persona("p1", "Ava"), "Buy");
  expect(prompt).not.toContain("Your role");
  expect(prompt).not.toMatch(/screen reader|zoomed|connection|first language/);
});

it("shows a select's chosen option and its options, so the agent can pick one by name", () => {
  const message = buildStepMessage(
    {
      url: "http://app.test/settings",
      title: "Settings",
      text: "",
      elements: [
        { id: 3, role: "select", name: "Company size", tag: "select", value: "1-10", options: ["1-10", "11-50"] },
        { id: 4, role: "button", name: "Save", tag: "button" },
      ],
    },
    [],
  );
  expect(message).toContain('[3] select "Company size" set to "1-10", options: "1-10" | "11-50"');
  expect(message).toContain('[4] button "Save"\n');
});

it("shows the screen-reader agent what a screen reader announces, and nothing hidden from it", () => {
  const obs = {
    url: "http://app.test/",
    title: "Home",
    text: "",
    elements: [
      { id: 0, role: "button", name: "", tag: "button", ax: { name: "Close dialog", role: "button", hidden: false } },
      { id: 1, role: "button", name: "Hidden save", tag: "button", ax: { name: "", role: "none", hidden: true } },
      { id: 2, role: "input:text", name: "Search", tag: "input", ax: { name: "Search", role: "textbox", hidden: false } },
      { id: 3, role: "link", name: "Help", tag: "a" },
    ],
  };
  const heard = buildStepMessage(obs, [], { screenReader: true });
  expect(heard).toContain('[0] button "Close dialog"');
  expect(heard).not.toContain("Hidden save");
  expect(heard).toContain('[2] textbox "Search"');
  // Without the browser's names (not Chromium), Debutly's own reading stands in.
  expect(heard).toContain('[3] link "Help"');
  // Everyone else sees the page as before.
  expect(buildStepMessage(obs, [])).toContain('[1] button "Hidden save"');
});
