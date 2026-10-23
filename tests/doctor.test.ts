import { expect, it, vi } from "vitest";
import { looksLikeProduction, renderChecks, runChecks, type DoctorDeps } from "../src/doctor";

const deps = (over: Partial<DoctorDeps> = {}): DoctorDeps => ({
  env: { DEBUTLY_API_KEY: "sk-or-v1-abc", DEBUTLY_PROVIDER: "openai-compatible", DEBUTLY_BASE_URL: "https://openrouter.ai/api/v1", DEBUTLY_NAV_MODEL: "z-ai/glm-5.3-flash" },
  nodeVersion: "22.4.0",
  fetchFn: vi.fn(async (url: string | URL | Request) =>
    String(url).endsWith("/key") ? new Response(JSON.stringify({ data: { limit_remaining: 4.5 } })) : new Response("<html></html>"),
  ) as unknown as typeof fetch,
  chromiumInstalled: () => true,
  readConfig: () => ({ url: "http://localhost:3000", goal: "Sign up", icp: "Agency owners" }),
  ...over,
});

it("passes a machine that is ready, and says so", async () => {
  const checks = await runChecks(deps());
  expect(checks.map((c) => c.status)).toEqual(["ok", "ok", "ok", "ok", "ok", "ok"]);
  expect(checks[2].detail).toBe("$4.50 left on the key's limit; the account's own balance isn't visible here");
  expect(renderChecks(checks)).toMatch(/Ready\. Start a run with: npx debutly$/);
});

it("says what to do when there's no key, Node is old, or nothing answers", async () => {
  const checks = await runChecks(
    deps({ env: {}, nodeVersion: "18.20.0", fetchFn: vi.fn(async () => Promise.reject(new Error("ECONNREFUSED"))) as unknown as typeof fetch }),
  );
  const failed = checks.filter((c) => c.status === "fail").map((c) => c.label);
  expect(failed).toEqual(["Node.js 18.20.0 is too old", "No model API key", "Nothing answers at http://localhost:3000"]);
  expect(checks.find((c) => c.label === "No model API key")?.detail).toContain("https://openrouter.ai/keys");
  expect(renderChecks(checks)).toMatch(/3 things to fix before a run\.$/);
});

it("fails a rejected key, and never prints it", async () => {
  const fetchFn = vi.fn(async () => new Response("no", { status: 401 })) as unknown as typeof fetch;
  const out = renderChecks(await runChecks(deps({ fetchFn })));
  expect(out).toContain("✗ The provider rejects the API key");
  expect(out).not.toContain("sk-or-v1-abc");
});

it("points to init without a config, and wants url, goal and icp in one", async () => {
  expect((await runChecks(deps({ readConfig: () => undefined }))).at(-1)).toMatchObject({ status: "warn", label: "No debutly.json here" });
  expect((await runChecks(deps({ readConfig: () => ({ url: "http://localhost:3000" }) }))).find((c) => c.status === "fail")?.label).toBe("debutly.json has no goal, icp");
});

it("warns when the address may be the real app", async () => {
  expect(looksLikeProduction("https://app.acme.com")).toBe(true);
  expect(["http://localhost:3000", "http://127.0.0.1:8080", "https://staging.acme.com", "https://acme-preview.example.com", "http://app.test", "https://qa2.acme.com"].map(looksLikeProduction)).toEqual([
    false,
    false,
    false,
    false,
    false,
    false,
  ]);
  const checks = await runChecks(deps({ readConfig: () => ({ url: "https://app.acme.com", goal: "Sign up", icp: "x" }) }));
  expect(checks.find((c) => c.status === "warn")?.label).toBe("https://app.acme.com may be your real app");
});
