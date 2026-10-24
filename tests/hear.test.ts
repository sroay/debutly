import { mkdtemp, readFile, writeFile } from "node:fs/promises";
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
  <button>Continue</button>`;

let server: Server;
let base: string;
beforeAll(async () => {
  server = createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(req.url === "/elsewhere" ? "<title>Moved</title><p>Moved</p>" : PAGE);
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
  evidence: [{ agentId: "a", stepIndex: path === "/signup" ? 0 : 1 }],
  control,
});

it("hears each screen-reader finding's control with the screen reader, and says whether it holds", async () => {
  const dir = await mkdtemp(join(tmpdir(), "debutly-hear-"));
  const observation = (path: string) => ({ url: base + path, title: "", text: "", elements: [] });
  const sessions: Session[] = [
    { agentId: "a", personaName: "A", goal: "g", outcome: "gave_up", outcomeNote: "", steps: [0, 1].map((index) => ({ index, observation: observation(index ? "/settings" : "/signup"), action: { type: "wait" as const }, reasoning: "", signals: [] })) },
  ];
  const findings: Finding[] = [
    finding("Unlabeled button on /signup", { role: "button", problem: "unnamed" }),
    finding("Email field on /signup is named only by its placeholder", { role: "input:email", problem: "placeholder" }),
    finding("Unlabeled button on /signup, which Tab doesn't reach", { role: "button", problem: "unreached" }),
    finding("Can't reach button \"Save settings\" on /signup with the keyboard", { role: "button", name: "Save settings", problem: "keyboard" }),
    finding("Unlabeled link on /settings", { role: "link", problem: "unnamed" }, "/settings"),
  ];
  await writeFile(join(dir, "findings.json"), JSON.stringify(findings));
  await writeFile(join(dir, "sessions.json"), JSON.stringify(sessions));
  await writeFile(join(dir, "report.md"), "# Debutly Report\n");

  const heard = await hearFindings({ reportDir: dir, reader: standInReader(), launch: () => chromium.launch() });
  const verdict = Object.fromEntries(heard.map((h) => [h.title, h.verdict]));
  expect(verdict).toEqual({
    "Unlabeled button on /signup": "confirmed",
    "Email field on /signup is named only by its placeholder": "confirmed",
    "Unlabeled button on /signup, which Tab doesn't reach": "confirmed",
    "Can't reach button \"Save settings\" on /signup with the keyboard": "confirmed",
    "Unlabeled link on /settings": "not on the page",
  });
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
