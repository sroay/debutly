import { expect, it } from "vitest";
import { renderReport } from "../../src/report/markdown";
import type { CustomerUnit, Finding, Session } from "../../src/types";

const session: Session = {
  agentId: "p1",
  personaName: "Ava",
  goal: "Buy",
  outcome: "gave_up",
  outcomeNote: "Studio broken",
  steps: [
    {
      index: 0,
      observation: { url: "http://a.test/pricing", title: "", text: "", elements: [{ id: 4, role: "button", name: "Choose Studio", tag: "button" }] },
      action: { type: "click", id: 4 },
      reasoning: "I want Studio",
      signals: [],
      screenshotPath: "shots/p1-000.png",
    },
  ],
};

const finding = (confidence: Finding["confidence"], title: string): Finding => ({
  signature: title,
  kind: "page_error",
  severity: "blocker",
  title,
  detail: "startCheckout is not defined",
  pagePath: "/pricing",
  hitBy: ["p1"],
  visitors: 1,
  confidence,
  evidence: [{ agentId: "p1", stepIndex: 0 }],
});

it("renders label, outcomes, findings with repro, and separates low confidence", () => {
  const md = renderReport({
    targetUrl: "http://a.test",
    goal: "Buy",
    sessions: [session],
    findings: [finding("high", "JS error on /pricing"), finding("low", "Maybe flaky")],
  });
  expect(md).toContain("Simulated evidence — not real traction");
  expect(md).toContain("| Ava | — | — | gave_up | Studio broken |");
  expect(md).toContain("### [BLOCKER] JS error on /pricing");
  expect(md).toContain("1 of 1 agents who visited /pricing (high confidence)");
  expect(md).toContain('1. clicked button "Choose Studio" — "I want Studio"');
  expect(md).toContain("shots/p1-000.png");
  const lowSection = md.split("## Low-confidence findings")[1];
  expect(lowSection).toContain("Maybe flaky");
});

it("puts where agents stopped, in their own words, near the top", () => {
  const stopped: Session = {
    ...session,
    agentId: "p2",
    personaName: "Doug",
    outcome: "gave_up",
    outcomeNote: "Generate First Content fails with Unauthorized",
    steps: [{ ...session.steps[0], observation: { ...session.steps[0].observation, url: "http://a.test/onboarding" } }],
  };
  const done: Session = { ...session, agentId: "p3", personaName: "Mia", outcome: "success", outcomeNote: "all good" };
  const md = renderReport({ targetUrl: "http://a.test", goal: "Buy", sessions: [stopped, done], findings: [] });
  const section = md.split("## Where agents stopped")[1]?.split("## ")[0] ?? "";
  expect(section).toContain('**Doug** gave up on /onboarding: "Generate First Content fails with Unauthorized"');
  expect(section).not.toContain("Mia");
  expect(md.indexOf("## Where agents stopped")).toBeLessThan(md.indexOf("## Findings"));
});

it("moves failures the test environment caused out of the findings and explains them", () => {
  const caused: Finding = { ...finding("high", "HTTP 502 from /api/analyze"), kind: "http_error", sandboxCause: ["competitor.com"] };
  const md = renderReport({ targetUrl: "http://a.test", goal: "Buy", sessions: [session], findings: [caused] });
  expect(md).toContain("Findings: 0 blocker, 0 major, 0 minor (0 low-confidence, 1 caused by the test environment)");
  const [, main] = md.split("## Findings");
  expect(main.split("## Caused by the test environment")[0]).toContain("_None._");
  expect(md).toContain("## Caused by the test environment");
  expect(md).toContain("HTTP 502 from /api/analyze");
  expect(md).toContain("Blocked at the same moment: competitor.com.");
});

it("quotes what the app said when a missing key explains a failure", () => {
  const caused: Finding = {
    ...finding("high", "HTTP 503 from /api/composer/adapt"),
    kind: "http_error",
    sandboxCause: ["missing key: No API key found for provider: gemini"],
  };
  const md = renderReport({ targetUrl: "http://a.test", goal: "Buy", sessions: [session], findings: [caused] });
  expect(md).toContain("has none of its secret keys");
  expect(md).toContain('The app said a key or setting is missing: "No API key found for provider: gemini".');
  expect(md).not.toContain("Blocked at the same moment");
});

it("ends with where the report came from", () => {
  const md = renderReport({ targetUrl: "http://a.test", goal: "Buy", sessions: [session], findings: [] });
  expect(md.trimEnd().endsWith("Rehearsed with [Debutly](https://debutly.dev).")).toBe(true);
});

it("says up front when the AI provider ran out of credits part-way", () => {
  const stopped: Session = { ...session, agentId: "p2", personaName: "Ben", outcome: "error", outcomeNote: "The AI provider account is out of credits: 402" };
  const md = renderReport({ targetUrl: "http://a.test", goal: "Buy", sessions: [session, stopped], findings: [] });
  expect(md).toContain("## Run cut short");
  expect(md).toContain("so 1 of 2 agents stopped early: Ben.");
  expect(renderReport({ targetUrl: "http://a.test", goal: "Buy", sessions: [session], findings: [] })).not.toContain("Run cut short");
});

it("says when the app couldn't reach the website an agent made up", () => {
  const caused: Finding = { ...finding("high", "HTTP 502 from /api/smart/analyze-business"), kind: "http_error", sandboxCause: ["made-up site: pulsehr.io"] };
  const md = renderReport({ targetUrl: "http://a.test", goal: "Buy", sessions: [session], findings: [caused] });
  expect(md).toContain("The app couldn't reach the website the agent made up for its company: pulsehr.io.");
  expect(md).not.toContain("Blocked at the same moment");
});

it("summarises each business crew and shows role and inclusion need per agent", () => {
  const acme: CustomerUnit = {
    kind: "business",
    id: "u1",
    business: { name: "Acme", archetype: "agency", size: 8, monthlyBudget: 200, goal: "g" },
    owner: { id: "u1-o", name: "Olga", background: "", goal: "", patience: "low", techSavvy: "high", role: "Owner" },
    employees: [{ id: "u1-e1", name: "Emil", background: "", goal: "", patience: "low", techSavvy: "high", role: "Designer", inclusion: "screen_reader" }],
  };
  const sessions: Session[] = [
    { agentId: "u1-o", personaName: "Olga", goal: "g", steps: [], outcome: "success", outcomeNote: "Bought Solo", unitId: "u1", role: "Owner" },
    { agentId: "u1-e1", personaName: "Emil", goal: "", steps: [], outcome: "not_invited", outcomeNote: "No invite email arrived after Olga finished.", unitId: "u1", role: "Designer", inclusion: "screen_reader" },
  ];
  const md = renderReport({ targetUrl: "http://a.test", goal: "g", sessions, findings: [], units: [acme] });
  expect(md).toContain("## Customer units");
  expect(md).toContain("**Acme** (agency, ~8 people, $200/mo): owner Olga succeeded; 0 of 1 teammates got in (Emil: No invite email arrived after Olga finished.)");
  expect(md).toContain("| Emil | Designer | screen reader | not_invited | No invite email arrived after Olga finished. |");
  expect(md).toContain('**Emil** never got an invite: "No invite email arrived after Olga finished."');
});

it("links the WCAG criteria a finding relates to, as things to check, and says when the browser measured it", () => {
  const keyboard: Finding = {
    ...finding("high", 'Can\'t reach button "Save settings" on /settings with the keyboard'),
    kind: "keyboard",
    pagePath: "/settings",
    wcag: ["2.1.1"],
    hitBy: ["p1"],
    visitors: 4,
  };
  const md = renderReport({ targetUrl: "http://a.test", goal: "Buy", sessions: [session], findings: [keyboard] });
  expect(md).toContain("Related WCAG 2.2: [2.1.1 Keyboard](https://www.w3.org/WAI/WCAG22/Understanding/keyboard) (A), for a person to check.");
  expect(md).toContain("Measured by the browser on /settings, by 1 of 4 agents who visited it.");
  expect(md).toContain("WCAG references point to what a person should check. Debutly doesn't test conformance");
  // Without WCAG references the note stays out.
  expect(renderReport({ targetUrl: "http://a.test", goal: "Buy", sessions: [session], findings: [finding("high", "x")] })).not.toContain("WCAG");
});

it("shows each agent's access need and first language", () => {
  const amal: Session = { ...session, agentId: "p2", personaName: "Amal", inclusion: "screen_reader", language: "ar" };
  const md = renderReport({ targetUrl: "http://a.test", goal: "Buy", sessions: [session, amal], findings: [] });
  expect(md).toContain("| Amal | — | screen reader, Arabic |");
  expect(md).toContain("| Ava | — | — |");
});

it("opens with what to fix first: agents the app stopped, then serious findings with what to do", () => {
  const stopped: Session = {
    ...session,
    agentId: "p2",
    personaName: "Omar",
    role: "Sales rep",
    inclusion: "screen_reader",
    outcome: "gave_up",
    outcomeNote: "The invite link says I have no access to this workspace",
    steps: [{ ...session.steps[0], observation: { ...session.steps[0].observation, url: "http://a.test/welcome" }, screenshotPath: "/home/runner/work/_temp/report/screenshots/p2-007.png" }],
  };
  const done: Session = { ...session, agentId: "p3", personaName: "Mia", outcome: "success", outcomeNote: "all good" };
  const stuck: Finding = { ...finding("high", "Agent stuck on /companies"), kind: "stuck", severity: "major", hitBy: ["p3"] };
  const unlabeled: Finding = { ...finding("high", "Unlabeled link on /invite/:id"), kind: "a11y_unlabeled", severity: "major", hitBy: ["p2"], control: { role: "link", problem: "unnamed" } };
  const minor: Finding = { ...finding("high", "Console error on /"), kind: "console_error", severity: "minor" };
  const md = renderReport({ targetUrl: "http://a.test", goal: "Buy", sessions: [stopped, done], findings: [stuck, unlabeled, minor] });
  const section = md.split("## Fix these first")[1].split("\n## ")[0];
  expect(md.indexOf("## Fix these first")).toBeLessThan(md.indexOf("## Agent outcomes"));
  expect(section).toContain("1 of 2 agents reached the goal.");
  expect(section).toContain('1. **Omar (Sales rep; screen reader) gave up on /welcome.** In the agent\'s words: "The invite link says I have no access to this workspace" Start with the last screenshot, screenshots/p2-007.png.');
  // The finding an agent that stopped ran into comes before one hit only by an agent that got through.
  expect(section).toContain("2. **Unlabeled link on /invite/:id** (major). Give each one visible text, or an aria-label");
  expect(section).toContain("3. **Agent stuck on /companies** (major). Watch the reproduction below");
  expect(section).not.toContain("Console error");
  expect(section).toContain("One more finding is below.");
});

it("says so when nothing stopped an agent and nothing serious was found", () => {
  const done: Session = { ...session, outcome: "success", outcomeNote: "ok" };
  const section = renderReport({ targetUrl: "http://a.test", goal: "Buy", sessions: [done], findings: [] }).split("## Fix these first")[1].split("\n## ")[0];
  expect(section).toContain("1 of 1 agents reached the goal.");
  expect(section).toContain("Nothing stopped an agent, and nothing serious was found.");
});
