import { expect, it } from "vitest";
import { detectFindings } from "../../src/detect/findings";
import type { Action, Session, Signal, Step } from "../../src/types";

const B = "http://app.test";
const step = (index: number, path: string, signals: Signal[] = [], action: Action = { type: "click", id: 1 }, names: string[] = ["Go"]): Step => ({
  index,
  observation: { url: B + path, title: "", text: "", elements: names.map((name, id) => ({ id, role: "button", name, tag: "button" })) },
  action,
  reasoning: "",
  signals,
});
const session = (agentId: string, steps: Step[]): Session => ({ agentId, personaName: agentId, goal: "g", steps, outcome: "gave_up", outcomeNote: "" });

it("finds HTTP errors, escalates critical paths and scores consensus", () => {
  const invite500: Signal = { kind: "http_error", status: 500, requestUrl: `${B}/api/invite`, url: `${B}/dashboard` };
  const findings = detectFindings([session("a", [step(0, "/dashboard", [invite500])]), session("b", [step(0, "/dashboard", [invite500])])]);
  const f = findings.find((x) => x.kind === "http_error")!;
  expect(f.severity).toBe("blocker");
  expect(f.hitBy).toEqual(["a", "b"]);
  expect(f.visitors).toBe(2);
  expect(f.confidence).toBe("high");
  expect(f.evidence).toEqual([
    { agentId: "a", stepIndex: 0 },
    { agentId: "b", stepIndex: 0 },
  ]);
});

it("ignores favicon misses and browser echoes of HTTP errors", () => {
  const findings = detectFindings([
    session("a", [
      step(0, "/", [
        { kind: "http_error", status: 404, requestUrl: `${B}/favicon.ico`, url: `${B}/` },
        { kind: "console_error", message: "Failed to load resource: the server responded with a status of 500", url: `${B}/` },
      ]),
    ]),
  ]);
  expect(findings.filter((f) => f.kind !== "a11y_unlabeled")).toEqual([]);
});

it("flags unlabeled buttons once per page", () => {
  const findings = detectFindings([
    session("a", [step(0, "/dashboard", [], undefined, ["Save", ""]), step(1, "/dashboard", [], undefined, ["Save", ""])]),
  ]);
  const a11y = findings.filter((f) => f.kind === "a11y_unlabeled");
  expect(a11y).toHaveLength(1);
  expect(a11y[0].pagePath).toBe("/dashboard");
  expect(a11y[0].severity).toBe("minor");
});

it("detects stuck agents and rates a lone stuck agent low confidence", () => {
  const same: Action = { type: "click", id: 0 };
  const stuck = session("a", [step(0, "/settings", [], same), step(1, "/settings", [], same), step(2, "/settings", [], same)]);
  const others = ["b", "c", "d", "e"].map((id) => session(id, [step(0, "/settings")]));
  const f = detectFindings([stuck, ...others]).find((x) => x.kind === "stuck")!;
  expect(f.severity).toBe("major");
  expect(f.visitors).toBe(5);
  expect(f.confidence).toBe("low");
});

it("sorts by severity then confidence", () => {
  const findings = detectFindings([
    session("a", [
      step(0, "/docs", [{ kind: "http_error", status: 404, requestUrl: `${B}/docs`, url: `${B}/docs` }]),
      step(1, "/pricing", [{ kind: "page_error", message: "x is not defined", url: `${B}/pricing` }]),
    ]),
  ]);
  expect(findings.map((f) => f.severity)).toEqual(["blocker", "minor"]);
});

it("treats onboarding and sign-in as critical paths", () => {
  const f = detectFindings([
    session("a", [step(0, "/onboarding", [{ kind: "http_error", status: 401, requestUrl: `${B}/api/orgs`, url: `${B}/onboarding` }])]),
  ]).find((x) => x.kind === "http_error")!;
  expect(f.severity).toBe("major");
});

it("attributes a failure to the test environment when it blocked an outbound call during that request", () => {
  const t = 1_000_000;
  const scrape502: Signal = { kind: "http_error", status: 502, requestUrl: `${B}/api/analyze`, url: `${B}/onboarding`, startedAt: t, at: t + 800 };
  const invite500: Signal = { kind: "http_error", status: 500, requestUrl: `${B}/api/invite`, url: `${B}/onboarding`, startedAt: t + 10_000, at: t + 10_300 };
  const findings = detectFindings([session("a", [step(0, "/onboarding", [scrape502, invite500])])], {
    blocked: [{ host: "competitor.com", url: "https://competitor.com/", at: t + 400 }],
  });
  expect(findings.find((f) => f.title.includes("/api/analyze"))?.sandboxCause).toEqual(["competitor.com"]);
  expect(findings.find((f) => f.title.includes("/api/invite"))?.sandboxCause).toBeUndefined();
});

it("does not blame the test environment if the same failure also happened without a blocked call", () => {
  const t = 1_000_000;
  const fail = (start: number): Signal => ({ kind: "http_error", status: 502, requestUrl: `${B}/api/analyze`, url: `${B}/onboarding`, startedAt: start, at: start + 500 });
  const findings = detectFindings([session("a", [step(0, "/onboarding", [fail(t)])]), session("b", [step(0, "/onboarding", [fail(t + 60_000)])])], {
    blocked: [{ host: "competitor.com", url: "https://competitor.com/", at: t + 100 }],
  });
  expect(findings.find((f) => f.kind === "http_error")?.sandboxCause).toBeUndefined();
});

it("does not report an address the agent made up as a broken page, but does a broken emailed link", () => {
  const missing = (path: string): Signal => ({ kind: "http_error", status: 404, requestUrl: `${B}${path}`, url: `${B}${path}` });
  const guessed = { ...step(0, "/dashboard", [missing("/settings")], { type: "goto", path: "/settings" }), guessedUrl: true };
  const emailed = step(1, "/login", [missing("/join")], { type: "goto", path: `${B}/join?token=abc` });
  const findings = detectFindings([session("a", [guessed, emailed])]).filter((f) => f.kind === "http_error");
  expect(findings.map((f) => f.title)).toEqual(["HTTP 404 from /join"]);
});

it("in a test environment, puts a server error that says a key is missing down to the environment, quoting the app", () => {
  const noKey: Signal = { kind: "http_error", status: 503, requestUrl: `${B}/api/composer/adapt`, url: `${B}/content`, body: JSON.stringify({ error: "No API key found for provider: gemini. Configure it in Settings > API Keys.", retryable: true }) };
  const noAi: Signal = { kind: "http_error", status: 500, requestUrl: `${B}/api/smart/analyze-business`, url: `${B}/onboarding`, body: JSON.stringify({ error: "No AI API configured", suggestion: "Configure GOOGLE_AI_API_KEY" }) };
  const realBug: Signal = { kind: "http_error", status: 500, requestUrl: `${B}/api/briefing`, url: `${B}/`, body: JSON.stringify({ error: "Cannot read properties of undefined (reading 'map')" }) };
  const findings = detectFindings([session("a", [step(0, "/content", [noKey, noAi, realBug])])], { blocked: [], sandbox: true });
  expect(findings.find((f) => f.title.includes("/api/composer/adapt"))?.sandboxCause).toEqual([
    "missing key: No API key found for provider: gemini. Configure it in Settings > API Keys.",
  ]);
  expect(findings.find((f) => f.title.includes("/api/smart/analyze-business"))?.sandboxCause).toEqual(["missing key: No AI API configured"]);
  expect(findings.find((f) => f.title.includes("/api/briefing"))?.sandboxCause).toBeUndefined();
});

it("against a real deployment, a missing key is the app's bug", () => {
  const noKey: Signal = { kind: "http_error", status: 503, requestUrl: `${B}/api/composer/adapt`, url: `${B}/content`, body: '{"error":"No API key found for provider: gemini"}' };
  const findings = detectFindings([session("a", [step(0, "/content", [noKey])])], { blocked: [] });
  expect(findings.find((f) => f.kind === "http_error")?.sandboxCause).toBeUndefined();
});

it("blames the environment only when every occurrence is explained, by a blocked call or a missing key", () => {
  const t = 1_000_000;
  const blockedOnce: Signal = { kind: "http_error", status: 502, requestUrl: `${B}/api/analyze`, url: `${B}/onboarding`, startedAt: t, at: t + 500 };
  const keyOnce: Signal = { kind: "http_error", status: 502, requestUrl: `${B}/api/analyze`, url: `${B}/onboarding`, body: "Gemini API key is missing" };
  const unexplained: Signal = { kind: "http_error", status: 502, requestUrl: `${B}/api/analyze`, url: `${B}/onboarding`, body: "upstream timed out" };
  const blocked = [{ host: "site.example", url: "https://site.example/", at: t + 100 }];
  const both = detectFindings([session("a", [step(0, "/onboarding", [blockedOnce])]), session("b", [step(0, "/onboarding", [keyOnce])])], { blocked, sandbox: true });
  expect(both[0].sandboxCause).toEqual(["missing key: Gemini API key is missing", "site.example"]);
  const notAll = detectFindings([session("a", [step(0, "/onboarding", [keyOnce])]), session("b", [step(0, "/onboarding", [unexplained])])], { blocked, sandbox: true });
  expect(notAll[0].sandboxCause).toBeUndefined();
});

it("reports a slow page, more seriously when it took over 30 s or never arrived", () => {
  const slow = (ms: number, finished = true, slowNetwork = true): Signal => ({ kind: "slow_load", url: `${B}/`, ms, finished, slowNetwork });
  const [took41] = detectFindings([session("a", [step(0, "/", [slow(41_000)])])]).filter((f) => f.kind === "slow_load");
  expect(took41).toMatchObject({ title: "/ took 41 s to load on a slow connection", severity: "major" });
  expect(took41.detail).toMatch(/^On a slow connection \(500 kbit\/s/);
  const [took12] = detectFindings([session("a", [step(0, "/", [slow(12_000, true, false)])])]).filter((f) => f.kind === "slow_load");
  expect(took12).toMatchObject({ title: "/ took 12 s to load", severity: "minor" });
  const [never] = detectFindings([session("a", [step(0, "/", [slow(90_000, false)])])]).filter((f) => f.kind === "slow_load");
  expect(never).toMatchObject({ title: "/ still hadn't loaded after 90 s on a slow connection", severity: "major" });
});

it("reports a control that something keeps covering, even when the agent works round it", () => {
  const coveredSave = (index: number): Step => ({
    ...step(index, "/dashboard/profile", [], { type: "click", id: 0 }, ["Save"]),
    error: 'another element covers it: <line x2="8" x1="16" y1="13" y2="13">',
  });
  const tryKeys = (index: number): Step => step(index, "/dashboard/profile", [], { type: "press", key: "Enter" }, ["Save"]);
  const once = detectFindings([session("a", [coveredSave(0), tryKeys(1)])]);
  expect(once.find((f) => f.kind === "covered")).toBeUndefined();
  const [f] = detectFindings([session("a", [coveredSave(0), tryKeys(1), coveredSave(2)])]).filter((x) => x.kind === "covered");
  expect(f).toMatchObject({ title: 'Can\'t click button "Save" on /dashboard/profile: something covers it', severity: "major", hitBy: ["a"] });
  expect(f.detail).toContain('<line x2="8" x1="16" y1="13" y2="13">');
  expect(f.evidence).toEqual([{ agentId: "a", stepIndex: 2 }]);
});

it("does not call an agent stuck for waiting while the app works", () => {
  const waiting = (i: number) => step(i, "/content", [], { type: "wait" });
  const findings = detectFindings([session("a", [waiting(0), waiting(1), waiting(2)])]);
  expect(findings.find((f) => f.kind === "stuck")).toBeUndefined();
});

it("reports unlabeled form controls by what people call them, not only buttons and links", () => {
  const radios: Step = { ...step(0, "/dashboard/analyze"), observation: { url: `${B}/dashboard/analyze`, title: "", text: "", elements: [{ id: 29, role: "input:radio", name: "", tag: "input" }, { id: 30, role: "select", name: "", tag: "select" }, { id: 31, role: "input:file", name: "", tag: "input" }] } };
  const titles = detectFindings([session("a", [radios])]).filter((f) => f.kind === "a11y_unlabeled").map((f) => f.title).sort();
  expect(titles).toEqual(["Unlabeled dropdown on /dashboard/analyze", "Unlabeled radio button on /dashboard/analyze"]);
});
