import { expect, it } from "vitest";
import { configArgs } from "../src/config";
import { buildConfig, ignoreLines, startCommand, teamGoal, workflowYaml } from "../src/init";

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
