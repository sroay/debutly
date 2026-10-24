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

it("tells apart unnamed controls Tab lands on, ones it can't reach, ones with a description, and fields named by a placeholder", () => {
  const ax = (name: string, role: string, description?: string) => ({ name, role, hidden: false, ...(description ? { description } : {}) });
  const els: InteractiveElement[] = [
    { id: 0, role: "link", name: "Search...", tag: "a", ax: ax("Search...", "link") },
    { id: 1, role: "button", name: "", tag: "button", ax: ax("", "button") },
    { id: 2, role: "link", name: "My Inbox", tag: "a", ax: ax("My Inbox", "link") },
    { id: 3, role: "button", name: "", tag: "button", ax: ax("", "button", "Sort conversations") },
    { id: 4, role: "button", name: "", tag: "div", tabbable: false, ax: ax("", "button") },
    { id: 5, role: "input:email", name: "john@doe.com", tag: "input", nameFrom: "placeholder", ax: ax("john@doe.com", "textbox") },
    { id: 6, role: "input:password", name: "•••••••••••••", tag: "input", nameFrom: "placeholder", ax: ax("•••••••••••••", "textbox") },
    { id: 7, role: "input:search", name: "Search", tag: "input", nameFrom: "placeholder", ax: ax("Search", "searchbox") },
  ];
  const findings = detectFindings([session("a", [step(0, page("/signup", els))])]).filter((f) => f.kind === "a11y_unlabeled");
  const byTitle = Object.fromEntries(findings.map((f) => [f.title, f]));
  expect(Object.keys(byTitle).sort()).toEqual([
    "Button on /signup has a description but no name",
    "Email field on /signup is named only by its placeholder",
    "Password field on /signup is named only by its placeholder",
    "Unlabeled button on /signup",
    "Unlabeled button on /signup, which Tab doesn't reach",
  ]);
  expect(byTitle["Unlabeled button on /signup"]).toMatchObject({ severity: "major" });
  expect(byTitle["Unlabeled button on /signup"].detail).toContain('It is after "Search..." and before "My Inbox".');
  expect(byTitle["Button on /signup has a description but no name"]).toMatchObject({ severity: "minor", wcag: ["4.1.2"] });
  expect(byTitle["Button on /signup has a description but no name"].detail).toContain('("Sort conversations")');
  expect(byTitle["Unlabeled button on /signup, which Tab doesn't reach"]).toMatchObject({ severity: "minor" });
  expect(byTitle["Email field on /signup is named only by its placeholder"]).toMatchObject({ severity: "major", wcag: ["1.3.1", "3.3.2"] });
  expect(byTitle["Password field on /signup is named only by its placeholder"].detail).toContain("as a count of bullets");
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

it("says when a refused form had Arabic input in it, and for how many of the agents who got the error", () => {
  const phone: InteractiveElement = { id: 0, role: "input:tel", name: "Phone", tag: "input" };
  const name: InteractiveElement = { id: 1, role: "input:text", name: "Full name", tag: "input" };
  const submit = button(2, "Create account");
  const form = page("/signup", [phone, name, submit]);
  const refused = { kind: "http_error" as const, status: 422, requestUrl: `${B}/api/accounts`, url: `${B}/signup` };
  const signUp = (id: string, nameText: string, phoneText: string) =>
    session(id, [
      step(0, form, { type: "fill", id: 1, text: nameText }),
      step(1, form, { type: "fill", id: 0, text: phoneText }),
      step(2, form, { type: "click", id: 2 }, { signals: [refused] }),
    ]);
  const [f] = detectFindings([signUp("fatima", "فاطمة الحمادي", "٠٥٠١٢٣٤٥٦٧"), signUp("james", "James Carter", "+971 50 123 4567")]).filter(
    (x) => x.kind === "http_error",
  );
  expect(f.title).toBe("HTTP 422 from /api/accounts");
  expect(f.detail).toContain(
    '1 of the 2 agents who got this error had just typed Arabic-Indic digits into "Phone" ("٠٥٠١٢٣٤٥٦٧") and Arabic script into "Full name" ("فاطمة الحمادي").',
  );
  expect(f.detail).toContain("Check that the form accepts them, and converts the digits to 0–9 where it needs to.");

  // Arabic typed on another page, or a server error, isn't related.
  const elsewhere = session("noora", [
    step(0, page("/profile", [phone]), { type: "fill", id: 0, text: "٠٥٠١٢٣٤٥٦٧" }),
    step(1, form, { type: "click", id: 2 }, { signals: [refused, { ...refused, status: 500, requestUrl: `${B}/api/other` }] }),
  ]);
  expect(detectFindings([elsewhere]).map((x) => x.detail).join(" ")).not.toContain("Arabic");
});

it("reports once, site-wide, that pages stop people zooming in", () => {
  const blocked = "width=device-width, initial-scale=1, user-scalable=0";
  const findings = detectFindings([
    session("a", [step(0, page("/app/login", [], { zoomBlocked: blocked })), step(1, page("/app/dashboard", [], { zoomBlocked: blocked }))]),
    session("b", [step(0, page("/app/login", [], { zoomBlocked: "" }))]),
  ]).filter((f) => f.kind === "zoom");
  expect(findings).toHaveLength(1);
  expect(findings[0]).toMatchObject({ title: "Pages stop people zooming in", severity: "major", confidence: "high", wcag: ["1.4.4"], pagePath: "/app/login" });
  expect(findings[0].detail).toContain(`("${blocked}")`);
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
