import { expect, it } from "vitest";
import { NOT_BY_KEYBOARD } from "../../src/browser/execute";
import { detectFindings } from "../../src/detect/findings";
import type { Action, InclusionNeed, InteractiveElement, Observation, Session, Step } from "../../src/types";

const B = "http://app.test";
const page = (path: string, elements: InteractiveElement[] = [], extra: Partial<Observation> = {}): Observation => ({ url: B + path, title: "", text: "", elements, lang: "en", dir: "ltr", arabicShare: 0, ...extra });
const step = (index: number, observation: Observation, action: Action = { type: "wait" }, result: Partial<Step> = {}): Step => ({ index, observation, action, reasoning: "", signals: [], ...result });
const session = (agentId: string, steps: Step[], inclusion?: InclusionNeed, more: Partial<Session> = {}): Session => ({ agentId, personaName: agentId, goal: "g", steps, outcome: "gave_up", outcomeNote: "", inclusion, ...more });
const button = (id: number, name: string, ax?: InteractiveElement["ax"]): InteractiveElement => ({ id, role: "button", name, tag: "button", ...(ax ? { ax } : {}) });

it("goes by the browser's own names for unlabeled controls, and relates them to WCAG", () => {
  const els = [
    button(0, "", { name: "Close dialog", role: "button", hidden: false }), // named by its SVG title
    button(1, "", { name: "", role: "button", hidden: false }),
    { id: 2, role: "link", name: "", tag: "a", ax: { name: "", role: "link", hidden: false } },
    { id: 3, role: "select", name: "", tag: "select", ax: { name: "", role: "combobox", hidden: false } },
  ];
  const findings = detectFindings([session("a", [step(0, page("/settings", els))])]).filter((f) => f.kind === "a11y_unlabeled");
  expect(findings.map((f) => [f.title, f.wcag])).toEqual([
    ["Unlabeled button on /settings", ["4.1.2"]],
    ["Unlabeled link on /settings", ["2.4.4", "4.1.2"]],
    ["Unlabeled dropdown on /settings", ["1.3.1", "3.3.2", "4.1.2"]],
  ]);
  expect(findings.every((f) => f.confidence === "high")).toBe(true);
});

it("reports a control the keyboard can't reach, measured once, with high confidence", () => {
  const save = button(0, "Save settings", { name: "Save settings", role: "generic", hidden: false });
  const sr = session("sr", [step(0, page("/settings", [save]), { type: "click", id: 0 }, { error: `${NOT_BY_KEYBOARD}: it isn't in the tab order` })], "screen_reader");
  const others = ["b", "c", "d"].map((id) => session(id, [step(0, page("/settings", [save]))]));
  const [f] = detectFindings([sr, ...others]).filter((x) => x.kind === "keyboard");
  expect(f).toMatchObject({ title: 'Can\'t reach button "Save settings" on /settings with the keyboard', severity: "major", confidence: "high", wcag: ["2.1.1"], hitBy: ["sr"] });
  expect(f.detail).toMatch(/isn't in the tab order/);
});

it("reports keyboard focus hidden behind something", () => {
  const pay = button(0, "Pay");
  const [f] = detectFindings([session("sr", [step(0, page("/checkout", [pay]), { type: "click", id: 0 }, { focusObscured: 'div.cookie-bar ("We use cookies")' })], "screen_reader")]).filter(
    (x) => x.kind === "focus_obscured",
  );
  expect(f).toMatchObject({ title: 'Keyboard focus on button "Pay" on /checkout is hidden', severity: "major", wcag: ["2.4.11"] });
  expect(f.detail).toContain('div.cookie-bar ("We use cookies")');
});

it("reports a page that scrolls sideways at 320 pixels, and notes when it may be allowed", () => {
  const lv = session("lv", [step(0, page("/team")), step(1, page("/usage")), step(2, page("/team"))], "low_vision", {
    reflow: [
      { url: `${B}/team`, widthPx: 320, overflowPx: 580, widest: 'div.banner ("Invite your team"), 900 px wide', exception: "" },
      { url: `${B}/usage`, widthPx: 320, overflowPx: 580, widest: "table, 900 px wide", exception: "it is inside a data table, which may scroll" },
      { url: `${B}/features`, widthPx: 320, overflowPx: 0, widest: "", exception: "" },
    ],
  });
  const reflow = detectFindings([lv]).filter((f) => f.kind === "reflow");
  expect(reflow.map((f) => f.title)).toEqual(["/team scrolls sideways at 320 pixels wide", "/usage scrolls sideways at 320 pixels wide"]);
  expect(reflow[0]).toMatchObject({ wcag: ["1.4.10"], confidence: "high", evidence: [{ agentId: "lv", stepIndex: 2 }] });
  expect(reflow[0].detail).toContain('div.banner ("Invite your team"), 900 px wide');
  expect(reflow[1].detail).toContain("It may be allowed: it is inside a data table, which may scroll.");
});

it("relates a control covered only at zoom to resizing and reflow", () => {
  const covered = (i: number, agent: string): Step =>
    step(i, page("/profile", [button(0, "Save Changes")]), { type: "click", id: 0 }, { error: 'another element covers it: <nav class="bottom">' });
  const atZoom = detectFindings([session("lv", [covered(0, "lv"), covered(1, "lv")], "low_vision")]).find((f) => f.kind === "covered");
  expect(atZoom?.wcag).toEqual(["1.4.4", "1.4.10"]);
  const atFullSize = detectFindings([session("a", [covered(0, "a"), covered(1, "a")])]).find((f) => f.kind === "covered");
  expect(atFullSize?.wcag).toBeUndefined();
});

it("checks the page says its language, and that Arabic runs right to left", () => {
  const findings = detectFindings([
    session("a", [
      step(0, page("/", [], { lang: "" })),
      step(1, page("/ar/signup", [], { lang: "en", dir: "ltr", arabicShare: 0.9 })),
      step(2, page("/ar/plans", [], { lang: "ar", dir: "rtl", arabicShare: 0.95 })),
    ]),
  ]).filter((f) => f.kind === "language");
  expect(findings.map((f) => [f.title, f.severity, f.wcag])).toEqual([
    ["/ar/signup shows Arabic text left to right", "major", undefined],
    ["Pages don't say what language they're in", "minor", ["3.1.1"]],
    ['/ar/signup is in Arabic but says it is "en"', "minor", ["3.1.1"]],
  ]);
});

it("leaves runs recorded before these checks alone", () => {
  const old: Observation = { url: `${B}/`, title: "", text: "", elements: [button(0, "Save")] };
  expect(detectFindings([session("a", [step(0, old)])])).toEqual([]);
});

it("keeps a few pixels of sideways scroll minor, even on a sign-up page", () => {
  const check = (overflowPx: number) => ({ url: `${B}/signup`, widthPx: 320, overflowPx, widest: "", exception: "" });
  const at = (overflowPx: number) =>
    detectFindings([session("lv", [step(0, page("/signup"))], "low_vision", { reflow: [check(overflowPx)] })]).find((f) => f.kind === "reflow");
  expect(at(4)?.severity).toBe("minor");
  expect(at(4)?.detail).toContain("only 4 px");
  expect(at(300)?.severity).toBe("major");
});
