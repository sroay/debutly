import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Page } from "playwright";
import { afterAll, beforeAll, expect, it } from "vitest";
import { hearFindings, saidNoName, spoken, type ScreenReader } from "../src/hear";
import type { Finding, Session } from "../src/types";

const PAGE = `<!doctype html><title>Sign up</title>
  <a href="#">Pricing</a>
  <button><svg width="12" height="12"></svg></button>
  <input type="email" placeholder="john@doe.com">
  <div role="button" tabindex="-1">Close</div>
  <div role="button" tabindex="-1" style="width:20px;height:20px;background:#ccc"></div>
  <span role="button">Save settings</span>
  <select><option>English (en)</option><option>العربية (ar)</option></select>
  <button>Continue</button>`;

let server: Server;
let base: string;
beforeAll(async () => {
  // Like an app: sign-up sends a signed-in visitor to the dashboard, and set-up after sign-up is
  // shown only once, so it always moves on.
  server = createServer((req, res) => {
    const signedIn = (req.headers.cookie ?? "").includes("signed=in");
    if (req.url === "/onboarding" || (req.url === "/signup" && signedIn)) {
      res.writeHead(302, { location: "/dashboard" });
      return res.end();
    }
    res.writeHead(200, { "content-type": "text/html" });
    res.end(req.url === "/dashboard" ? "<title>Dashboard</title><p>Welcome</p>" : PAGE);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

// Says what NVDA would for the focused control: its name if it has one, then its role.
function standInReader(): ScreenReader {
  let page: Page | undefined;
  let pending = "";
  return {
    name: "Stand-in 1.0",
    start: async () => {},
    stop: async () => {},
    focus: async (p) => {
      page = p;
    },
    press: async (key) => {
      await page!.keyboard.press(key);
      pending = (await page!.evaluate(`(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return "document";
        if (el.tagName === "SELECT") return "combo box, " + el.selectedOptions[0].label + ", collapsed";
        const role = el.getAttribute("role") || (el.tagName === "A" ? "link" : el.tagName === "INPUT" ? "edit" : el.tagName.toLowerCase());
        const name = el.getAttribute("aria-label") || el.getAttribute("placeholder") || (el.innerText || "").trim();
        return (name ? name + ", " : "") + role;
      })()`)) as string;
    },
    said: async () => {
      const s = pending;
      pending = "";
      return s;
    },
  };
}

const finding = (title: string, control: Finding["control"], path = "/signup"): Finding => ({
  signature: title,
  kind: control!.problem === "keyboard" ? "keyboard" : "a11y_unlabeled",
  severity: "major",
  title,
  detail: "",
  pagePath: path,
  hitBy: ["a"],
  visitors: 1,
  confidence: "high",
  evidence: [{ agentId: "a", stepIndex: ["/signup", "/settings", "/onboarding"].indexOf(path) }],
  control,
});

it("hears each screen-reader finding's control with the screen reader, and says whether it holds", async () => {
  const dir = await mkdtemp(join(tmpdir(), "debutly-hear-"));
  const observation = (path: string) => ({ url: base + path, title: "", text: "", elements: [] });
  const sessions: Session[] = [
    { agentId: "a", personaName: "A", goal: "g", outcome: "gave_up", outcomeNote: "", steps: ["/signup", "/settings", "/onboarding"].map((path, index) => ({ index, observation: observation(path), action: { type: "wait" as const }, reasoning: "", signals: [] })) },
  ];
  const findings: Finding[] = [
    finding("Unlabeled button on /signup", { role: "button", problem: "unnamed" }),
    finding("Email field on /signup is named only by its placeholder", { role: "input:email", problem: "placeholder" }),
    finding("Unlabeled button on /signup, which Tab doesn't reach", { role: "button", problem: "unreached" }),
    finding("Can't reach button \"Save settings\" on /signup with the keyboard", { role: "button", name: "Save settings", problem: "keyboard" }),
    finding("Unlabeled link on /settings", { role: "link", problem: "unnamed" }, "/settings"),
    finding("Unlabeled dropdown on /signup", { role: "select", problem: "unnamed" }),
    finding("Unlabeled button on /onboarding", { role: "button", problem: "unnamed" }, "/onboarding"),
  ];
  // The agent ended signed in, as agents do.
  const states = join(dir, "browser-state");
  await mkdir(states);
  const cookie = { name: "signed", value: "in", domain: "127.0.0.1", path: "/", expires: -1, httpOnly: false, secure: false, sameSite: "Lax" };
  await writeFile(join(states, "a.json"), JSON.stringify({ cookies: [cookie], origins: [] }));
  await writeFile(join(dir, "findings.json"), JSON.stringify(findings));
  await writeFile(join(dir, "sessions.json"), JSON.stringify(sessions));
  await writeFile(join(dir, "report.md"), "# Debutly Report\n");

  const heard = await hearFindings({ reportDir: dir, reader: standInReader(), browserStateDir: states, launch: () => chromium.launch() });
  const verdict = Object.fromEntries(heard.map((h) => [h.title, h.verdict]));
  expect(verdict).toEqual({
    "Unlabeled button on /signup": "confirmed",
    "Email field on /signup is named only by its placeholder": "confirmed",
    "Unlabeled button on /signup, which Tab doesn't reach": "confirmed",
    "Can't reach button \"Save settings\" on /signup with the keyboard": "confirmed",
    "Unlabeled link on /settings": "not on the page",
    // "English (en)" is the dropdown's current choice, not a name.
    "Unlabeled dropdown on /signup": "confirmed",
    "Unlabeled button on /onboarding": "not on the page",
  });
  expect(heard.find((h) => h.title === "Unlabeled button on /onboarding")!.note).toBe(
    "Opening /onboarding led to /dashboard signed in and to /dashboard signed out: it may be a step shown only once, such as set-up after sign-up.",
  );
  expect(heard.find((h) => h.title === "Unlabeled button on /signup")!.note).toBe('Stand-in said "button", with no name.');
  const report = await readFile(join(dir, "report.md"), "utf8");
  expect(report).toContain("## Heard with a screen reader");
  expect(report).toContain("- **confirmed**: Unlabeled button on /signup.");
  expect(JSON.parse(await readFile(join(dir, "heard.json"), "utf8")).reader).toBe("Stand-in 1.0");
}, 60_000);

it("tells a control announced without a name from one with a name, and says placeholders as a screen reader does", () => {
  expect(saidNoName("button")).toBe(true);
  expect(saidNoName("combo box, collapsed, has auto complete, editable, blank")).toBe(true);
  expect(saidNoName("edit, multi line, blank")).toBe(true);
  expect(saidNoName("Save settings, button")).toBe(false);
  expect(saidNoName("Monday, switch, on")).toBe(false);
  expect(spoken("john@doe.com")).toBe("john at doe dot com");
  expect(spoken("•••••••••••••")).toBe("13 bullet");
});

it("puts together what a screen reader says over two presses on one control", async () => {
  const dir = await mkdtemp(join(tmpdir(), "debutly-hear-"));
  const observation = { url: `${base}/signup`, title: "", text: "", elements: [] };
  await writeFile(join(dir, "sessions.json"), JSON.stringify([{ agentId: "a", personaName: "A", goal: "g", outcome: "gave_up", outcomeNote: "", steps: [{ index: 0, observation, action: { type: "wait" }, reasoning: "", signals: [] }] }]));
  await writeFile(join(dir, "findings.json"), JSON.stringify([finding("Email field on /signup is named only by its placeholder", { role: "input:email", problem: "placeholder" })]));
  await writeFile(join(dir, "report.md"), "# Debutly Report\n");
  // Like NVDA entering a form: the first press says where focus went, the next names the field.
  const reader = standInReader();
  let held = "";
  let entered = false;
  const twoPart: ScreenReader = {
    ...reader,
    press: async (key) => {
      if (!held) await reader.press(key); // a held press is spent naming the field
    },
    said: async () => {
      if (held) {
        const s = held;
        held = "";
        return s;
      }
      const s = await reader.said();
      if (entered || !s.includes("john@doe.com")) return s;
      entered = true;
      held = s;
      return "form landmark";
    },
  };
  const [h] = await hearFindings({ reportDir: dir, reader: twoPart, launch: () => chromium.launch() });
  expect(h.verdict).toBe("confirmed");
  expect(h.said[0]).toBe("form landmark john@doe.com, edit");
}, 60_000);
