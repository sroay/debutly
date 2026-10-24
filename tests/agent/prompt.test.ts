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

it("tells an Arabic-speaking agent to use the site in Arabic and type as an Arabic keyboard does", () => {
  const system = buildSystemPrompt({ ...persona("p1", "Amal"), language: "ar" }, "Sign up");
  expect(system).toContain("Your first language is Arabic.");
  expect(system).toContain("٠١٢٣٤٥٦٧٨٩");
  expect(buildSystemPrompt({ ...persona("p2", "Ben"), language: "en" }, "Sign up")).not.toContain("first language");
});

it("shows each control's state, as a person sees it", () => {
  const obs = {
    url: "http://a.test/settings",
    title: "",
    text: "Settings",
    elements: [
      { id: 0, role: "button", name: "Save", tag: "button", disabled: true as const },
      { id: 1, role: "input:text", name: "Website", tag: "input", value: "www.shop.test", readOnly: true as const },
      { id: 2, role: "input:password", name: "Password", tag: "input", filled: true as const },
      { id: 3, role: "input:checkbox", name: "I agree", tag: "input", checked: true },
      { id: 4, role: "button", name: "Account menu", tag: "button", expanded: false },
      { id: 5, role: "input:email", name: "Email", tag: "input" },
    ],
  };
  const message = buildStepMessage(obs, []);
  expect(message).toContain('[0] button "Save" (disabled)');
  expect(message).toContain('[1] input:text "Website" (read-only, holds "www.shop.test")');
  expect(message).toContain('[2] input:password "Password" (filled in)');
  expect(message).toContain('[3] input:checkbox "I agree" (checked)');
  expect(message).toContain('[4] button "Account menu" (closed)');
  expect(message).toContain('[5] input:email "Email"\n');
});

it("shows a sighted agent the icon on a button with no text, but not the screen-reader agent", () => {
  const obs = {
    url: "http://a.test/inbox",
    title: "",
    text: "",
    elements: [{ id: 0, role: "button", name: "", tag: "button", icon: "dots vertical", ax: { name: "", role: "button", hidden: false } }],
  };
  expect(buildStepMessage(obs, [])).toContain('[0] button "" (dots vertical icon)');
  expect(buildStepMessage(obs, [], { screenReader: true })).not.toContain("icon");
});
