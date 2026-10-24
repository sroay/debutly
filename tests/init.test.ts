import { readFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { expect, it, vi } from "vitest";
import { configArgs } from "../src/config";
import { buildConfig, ignoreLines, init, startCommand, teamGoal, workflowYaml } from "../src/init";

it("writes a config the run accepts, with crews for team goals", () => {
  const solo = buildConfig({ url: "http://localhost:3000", goal: "Sign up", icp: "Freelance designers", team: false });
  expect(solo).toEqual({ $schema: "https://debutly.dev/schema.json", url: "http://localhost:3000", goal: "Sign up", icp: "Freelance designers", tier: "quick", maxCost: 1 });
  const crew = buildConfig({ url: "http://localhost:3000", goal: "Sign up and invite a teammate", icp: "Agencies", team: true, mailpit: "http://127.0.0.1:54324" });
  expect(crew).toMatchObject({ unit: "business", employees: 2, mailpit: "http://127.0.0.1:54324" });
  expect(() => configArgs(crew)).not.toThrow();
});

it("knows a team goal when it sees one", () => {
  expect(["Sign up and invite a teammate", "Add two colleagues to the workspace", "Buy 3 seats"].map(teamGoal)).toEqual([true, true, true]);
  expect(teamGoal("Sign up, choose a plan and pay (test mode)")).toBe(false);
});

it("starts the app in CI the way its scripts say", () => {
  expect(startCommand({ build: "next build", start: "next start" }, "http://localhost:3000")).toEqual(["npm ci", "npm run build", "PORT=3000 npm start &"]);
  expect(startCommand({ dev: "vite" }, "http://localhost:5173")).toEqual(["npm ci", "PORT=5173 npm run dev &"]);
  expect(startCommand(undefined, "http://localhost:8000")).toEqual(["# Start a test copy of your app here"]);
});

it("writes a workflow that uses the action and the repository secret", () => {
  const yaml = workflowYaml(["npm ci", "PORT=3000 npm run dev &"]);
  expect(yaml).toContain("      - uses: sroay/debutly@v0\n        with:\n          api-key: ${{ secrets.DEBUTLY_API_KEY }}");
  expect(yaml).toContain("      - run: |\n          npm ci\n          PORT=3000 npm run dev &\n");
});

it("keeps the key file and local reports out of git, once", () => {
  expect(ignoreLines("node_modules\n")).toEqual([".env", ".debutly/"]);
  expect(ignoreLines("/.env\r\n.debutly/\r\n")).toEqual([]);
});

it("takes a goal typed at the numbered question as the goal, and asks for one after 4", async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  const run = async (...answers: string[]) => {
    const dir = await mkdtemp(join(tmpdir(), "init-"));
    expect(await init(dir, Readable.from(answers.map((a) => `${a}\n`)))).toBe(0);
    return JSON.parse(readFileSync(join(dir, "debutly.json"), "utf8")).goal;
  };
  // Port 9 is closed, so no customers are guessed from the page.
  expect(await run("http://127.0.0.1:9", "Book a demo with a clinic", "Small clinics", "", "", "")).toBe("Book a demo with a clinic");
  expect(await run("http://127.0.0.1:9", "4", "Export a report", "Small clinics", "", "", "")).toBe("Export a report");
  expect(await run("http://127.0.0.1:9", "", "Small clinics", "", "", "")).toBe("Sign up and get to the main screen");
  vi.restoreAllMocks();
});
