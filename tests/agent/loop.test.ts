import { afterAll, beforeAll, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import { startFixture, type RunningFixture } from "../../fixture/server";
import { runSession } from "../../src/agent/loop";
import { ScriptedLlm } from "../../src/llm/scripted";
import { OutOfCreditsError } from "../../src/llm/types";
import { persona, scriptedAgents } from "../helpers/scripted-agents";

let fx: RunningFixture;
let browser: Browser;
beforeAll(async () => {
  fx = await startFixture();
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser.close();
  await fx.close();
});

it("runs a persona through steps and records signals per step", async () => {
  const llm = scriptedAgents({
    Ava: [{ click: "Pricing" }, { click: "Choose Studio" }, { done: [false, "Studio button does nothing"] }],
  });
  const page = await browser.newPage();
  const session = await runSession({
    page,
    llm,
    persona: persona("p1", "Ava"),
    goal: "Buy the Studio plan",
    origin: fx.url,
    maxSteps: 10,
  });
  expect(session.steps).toHaveLength(3);
  expect(session.outcome).toBe("gave_up");
  expect(session.outcomeNote).toBe("Studio button does nothing");
  expect(session.steps[1].signals.some((s) => s.kind === "page_error")).toBe(true);
  expect(llm.calls[0].system).toContain("Buy the Studio plan");
  expect(llm.calls[2].messages[0].content).toContain('clicked button "Choose Studio"');
});

it("tells the agent what each action did", async () => {
  const llm = scriptedAgents({
    Eve: [{ click: "Pricing" }, { click: "Choose Studio" }, { done: [false, "stop"] }],
  });
  await runSession({ page: await browser.newPage(), llm, persona: persona("p5", "Eve"), goal: "Buy", origin: fx.url, maxSteps: 5 });
  const lastPrompt = llm.calls[2].messages[0].content;
  expect(lastPrompt).toContain('clicked link "Pricing" → now on /pricing');
  expect(lastPrompt).toContain('clicked button "Choose Studio" → nothing visibly changed; a JavaScript error occurred');
});

it("reads its inbox and follows an emailed link to another server", async () => {
  const authServer = await startFixture();
  try {
    const link = `${authServer.url}/features`;
    const asked: string[] = [];
    const inbox = {
      latest: async (address: string) => {
        asked.push(address);
        return [{ subject: "Your magic link", text: `Log in: ${link}`, links: [link] }];
      },
    };
    const llm = scriptedAgents({
      Zoe: [{ checkEmail: true }, { goto: link }, { done: [true, "logged in"] }],
    });
    const session = await runSession({
      page: await browser.newPage(),
      llm,
      persona: persona("p6", "Zoe"),
      goal: "Log in",
      origin: fx.url,
      maxSteps: 5,
      identity: { email: "zoe@agents.test" },
      inbox,
    });
    expect(llm.calls[0].system).toContain("zoe@agents.test");
    expect(llm.calls[0].system).toContain('{"type":"check_email"}');
    expect(asked).toEqual(["zoe@agents.test"]);
    expect(llm.calls[1].messages[0].content).toContain(`checked email → 1 email: "Your magic link" links: ${link}`);
    expect(session.steps[1].blocked).toBeUndefined();
    expect(session.steps[1].guessedUrl).toBeUndefined();
    expect(session.steps[2].observation.url).toBe(link);
    expect(session.outcome).toBe("success");
  } finally {
    await authServer.close();
  }
});

it("still refuses off-site links that did not arrive by email", async () => {
  const llm = scriptedAgents({ Ned: [{ goto: "https://example.com/" }, { done: [false, "stop"] }] });
  const session = await runSession({
    page: await browser.newPage(),
    llm,
    persona: persona("p7", "Ned"),
    goal: "Wander",
    origin: fx.url,
    maxSteps: 3,
    identity: { email: "ned@agents.test" },
    inbox: { latest: async () => [] },
  });
  expect(session.steps[0].blocked).toMatch(/off-origin/);
  expect(session.steps[0].guessedUrl).toBe(true);
});

it("stops at the step budget", async () => {
  const llm = scriptedAgents({ Ben: Array.from({ length: 5 }, () => ({ click: "Home" })) });
  const session = await runSession({
    page: await browser.newPage(),
    llm,
    persona: persona("p2", "Ben"),
    goal: "Wander",
    origin: fx.url,
    maxSteps: 3,
  });
  expect(session.steps).toHaveLength(3);
  expect(session.outcome).toBe("budget_exhausted");
});

it("asks again after an unreadable reply and carries on", async () => {
  const good = JSON.stringify({ reasoning: "done", action: { type: "done", success: true, note: "ok" } });
  const llm = new ScriptedLlm((_req, i) => (i === 0 ? "Let me think about this page." : good));
  const session = await runSession({
    page: await browser.newPage(),
    llm,
    persona: persona("p4", "Dan"),
    goal: "Anything",
    origin: fx.url,
    maxSteps: 3,
  });
  expect(session.outcome).toBe("success");
  const retry = llm.calls[1].messages;
  expect(retry.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
  expect(retry[2].content).toMatch(/not valid/i);
});

it("waits when the model keeps sending reasoning with no action, a few times only (2026-10-24)", async () => {
  const thinking = JSON.stringify({ reasoning: "I opened the menu; I will wait to see what appears." });
  const done = JSON.stringify({ reasoning: "done", action: { type: "done", success: true, note: "ok" } });
  // Three replies with no action, then a good one.
  const llm = new ScriptedLlm((_req, i) => (i < 3 ? thinking : done));
  const session = await runSession({ page: await browser.newPage(), llm, persona: persona("p5", "Sara"), goal: "Anything", origin: fx.url, maxSteps: 3 });
  expect(session.outcome).toBe("success");
  expect(session.steps[0]).toMatchObject({ action: { type: "wait" }, reasoning: "I opened the menu; I will wait to see what appears." });

  // Never an action at all: a few waits, then the engine error it is.
  const stubborn = new ScriptedLlm(() => thinking);
  const stuck = await runSession({ page: await browser.newPage(), llm: stubborn, persona: persona("p6", "Tom"), goal: "Anything", origin: fx.url, maxSteps: 10 });
  expect(stuck.steps.map((s) => s.action.type)).toEqual(["wait", "wait", "wait"]);
  expect(stuck.outcome).toBe("error");
  expect(stuck.outcomeNote).toContain('the reply has no "action"');
}, 60_000);

it("asks once before giving up with an untried way on in plain sight, and respects a second give-up", async () => {
  const giveUp = JSON.stringify({ reasoning: "No way in.", action: { type: "done", success: false, note: "stuck" } });
  const llm = new ScriptedLlm(() => giveUp);
  const session = await runSession({ page: await browser.newPage(), llm, persona: persona("p9", "Ines"), goal: "Sign up", origin: `${fx.url}/signup`, maxSteps: 3 });
  expect(session.outcome).toBe("gave_up");
  expect(llm.calls).toHaveLength(2);
  expect(llm.calls[1].messages.at(-1)!.content).toContain(`you haven't tried "Create account"`);
  expect(llm.calls[1].messages.at(-1)!.content).toContain("give up if you are sure");
  expect(llm.calls[1].messages.at(-1)!.content).not.toContain(`"Sign up"`); // the menu link

  // Asked, it goes on instead.
  const goesOn = new ScriptedLlm((_req, i) => (i === 0 ? giveUp : i === 1 ? JSON.stringify({ reasoning: "Try it.", action: { type: "wait" } }) : JSON.stringify({ reasoning: "ok", action: { type: "done", success: true, note: "in" } })));
  const second = await runSession({ page: await browser.newPage(), llm: goesOn, persona: persona("p10", "Jon"), goal: "Sign up", origin: `${fx.url}/signup`, maxSteps: 3 });
  expect(second.outcome).toBe("success");
  expect(second.steps[0]).toMatchObject({ action: { type: "wait" }, reasoning: "Try it." });
}, 60_000);

it("ends with error, keeping the raw reply, when the model stays unreadable", async () => {
  const llm = new ScriptedLlm(() => "I refuse to answer in JSON");
  const session = await runSession({
    page: await browser.newPage(),
    llm,
    persona: persona("p3", "Cara"),
    goal: "Anything",
    origin: fx.url,
    maxSteps: 3,
  });
  expect(session.outcome).toBe("error");
  expect(session.outcomeNote).toMatch(/no JSON/);
  expect(session.outcomeNote).toContain("I refuse to answer in JSON");
  expect(llm.calls).toHaveLength(3);
});

it("keeps the steps already taken when the model provider fails mid-session (2026-10-21)", async () => {
  const llm = new ScriptedLlm((_req, i) => {
    if (i > 0) throw new OutOfCreditsError("This request would exceed your available credits");
    return JSON.stringify({ reasoning: "look around", action: { type: "wait" } });
  });
  const session = await runSession({ page: await browser.newPage(), llm, persona: persona("p4", "Dev"), goal: "Anything", origin: fx.url, maxSteps: 5 });
  expect(session.outcome).toBe("error");
  expect(session.outcomeNote).toMatch(/^The AI provider account is out of credits/);
  // Its steps still count towards the findings.
  expect(session.steps).toHaveLength(1);
  expect(session.usage?.inputTokens).toBeGreaterThan(0);
});

it("records the session's token usage and cost", async () => {
  const llm = scriptedAgents({ Ivy: [{ click: "Pricing" }, { done: [true, "ok"] }] });
  const session = await runSession({
    page: await browser.newPage(),
    llm,
    persona: persona("p9", "Ivy"),
    goal: "Look",
    origin: fx.url,
    maxSteps: 5,
    price: { inputPerMTok: 1_000_000, outputPerMTok: 0 },
  });
  expect(session.usage!.inputTokens).toBeGreaterThan(0);
  expect(session.usage!.costUsd).toBe(session.usage!.inputTokens);
});

it("stops at the token cap", async () => {
  const llm = scriptedAgents({ Jon: [{ click: "Pricing" }, { click: "Features" }, { click: "Pricing" }, { done: [true, "ok"] }] });
  const session = await runSession({ page: await browser.newPage(), llm, persona: persona("p10", "Jon"), goal: "Look", origin: fx.url, maxSteps: 10, caps: { maxTokens: 1 } });
  expect(session.outcome).toBe("budget_exhausted");
  expect(session.outcomeNote).toMatch(/token cap/);
  expect(session.steps).toHaveLength(1);
});

it("stops at the time cap", async () => {
  const llm = scriptedAgents({ Kai: [{ click: "Pricing" }, { click: "Features" }, { done: [true, "ok"] }] });
  const session = await runSession({ page: await browser.newPage(), llm, persona: persona("p11", "Kai"), goal: "Look", origin: fx.url, maxSteps: 10, caps: { maxMs: 1 } });
  expect(session.outcome).toBe("budget_exhausted");
  expect(session.outcomeNote).toMatch(/time cap/);
});

it("stops when the run is cancelled", async () => {
  let cancelled = false;
  const llm = scriptedAgents({ Lea: [{ click: "Pricing" }, { click: "Features" }, { done: [true, "ok"] }] });
  const session = await runSession({
    page: await browser.newPage(),
    llm: { complete: async (req) => ((cancelled = true), llm.complete(req)) },
    persona: persona("p12", "Lea"),
    goal: "Look",
    origin: fx.url,
    maxSteps: 10,
    shouldStop: async () => cancelled,
  });
  expect(session.outcome).toBe("cancelled");
  expect(session.steps).toHaveLength(1);
});

it("carries on with a model that sends its action as a string, as GLM 5.3 Flash does", async () => {
  const llm = new ScriptedLlm(() => `{"reasoning":"Done here.","action":"{"type":"done","success":true,"note":"ok"}"}`);
  const session = await runSession({ page: await browser.newPage(), llm, persona: persona("p5", "Eli"), goal: "Anything", origin: fx.url, maxSteps: 3 });
  expect(session.outcome).toBe("success");
  expect(llm.calls).toHaveLength(1);
});

it("reports a slow first page and starts once it is in", async () => {
  const llm = new ScriptedLlm(() => JSON.stringify({ reasoning: "", action: { type: "done", success: true, note: "ok" } }));
  const session = await runSession({
    page: await browser.newPage(),
    llm,
    persona: { ...persona("p6", "Fay"), inclusion: "slow_connection" },
    goal: "Anything",
    origin: `${fx.url}/slow?ms=400`,
    maxSteps: 3,
    firstLoad: { slowMs: 200 },
  });
  expect(session.outcome).toBe("success");
  expect(session.steps[0].observation.text).toContain("Finally here");
  expect(session.steps[0].signals).toContainEqual(expect.objectContaining({ kind: "slow_load", finished: true, slowNetwork: true }));
});

it("weighs a slow first page's scripts and styles, and how much came uncompressed", async () => {
  const llm = new ScriptedLlm(() => JSON.stringify({ reasoning: "", action: { type: "done", success: true, note: "ok" } }));
  const session = await runSession({
    page: await browser.newPage(),
    llm,
    persona: persona("p8", "Hal"),
    goal: "Anything",
    origin: `${fx.url}/slow?ms=300&heavy=1`,
    maxSteps: 2,
    firstLoad: { slowMs: 100 },
  });
  const slow = session.steps[0].signals.find((s) => s.kind === "slow_load");
  expect(slow).toMatchObject({ assets: { files: 1 } });
  const assets = (slow as Extract<typeof slow, { kind: "slow_load" }>).assets!;
  expect(assets.bytes).toBeGreaterThan(200 * 1024);
  expect(assets.uncompressedBytes).toBe(assets.bytes);
});

it("does not end the session when the first page outlasts the wait: the agent sees what there is", async () => {
  const llm = new ScriptedLlm(() => JSON.stringify({ reasoning: "", action: { type: "done", success: false, note: "nothing loaded" } }));
  const session = await runSession({
    page: await browser.newPage(),
    llm,
    persona: persona("p7", "Gus"),
    goal: "Anything",
    origin: `${fx.url}/slow?ms=3000`,
    maxSteps: 3,
    firstLoad: { timeoutMs: 300 },
  });
  expect(session.outcome).toBe("gave_up");
  expect(session.steps[0].signals).toContainEqual(expect.objectContaining({ kind: "slow_load", finished: false, slowNetwork: false }));
});

it("goes on without a step's screenshot when taking or keeping it fails", async () => {
  const llm = new ScriptedLlm(() => JSON.stringify({ reasoning: "", action: { type: "done", success: true, note: "ok" } }));
  const failing = { put: async () => { throw new Error("page.screenshot: Timeout 30000ms exceeded"); } };
  const session = await runSession({ page: await browser.newPage(), llm, persona: persona("p8", "Hal"), goal: "Anything", origin: fx.url, maxSteps: 3, artifacts: failing });
  expect(session.outcome).toBe("success");
  expect(session.steps[0].screenshotPath).toBeUndefined();
});
