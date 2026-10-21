/**
 * Runs the same agents against a fresh Fixturely for each model and reports which
 * seeded bugs each model's agents caught, how they finished, how fast and what it cost.
 *
 *   node --env-file=.env --import tsx scripts/compare-models.ts model-a model-b ...
 *
 * A model may name one OpenRouter provider endpoint after "@", e.g.
 * google/gemini-3.8-flash@google-ai-studio/flex (Gemini's half-price tier). Models run a few at
 * a time; each run's cost is what the provider charged (OpenRouter reports it per request).
 * Needs an OpenAI-compatible endpoint (DEBUTLY_BASE_URL, DEBUTLY_API_KEY).
 */
import "../src/util/legacy-env";
import { join } from "node:path";
import { startFixture } from "../fixture/server";
import { OpenAiCompatibleLlm } from "../src/llm/openai-compatible";
import { asIndividuals, runSimulation } from "../src/run";
import type { Finding, Persona } from "../src/types";

const baseUrl = process.env.DEBUTLY_BASE_URL;
const apiKey = process.env.DEBUTLY_API_KEY;
if (!baseUrl || !apiKey) throw new Error("Set DEBUTLY_BASE_URL and DEBUTLY_API_KEY in .env");
const models = process.argv.slice(2);
if (!models.length) throw new Error("Pass one or more model ids");
const AT_ONCE = 4;

const GOAL =
  "You are evaluating this product as a possible customer. Look around the site, sign up, choose a plan and pay with the test card, then invite a teammate from the dashboard. Finish when you have done that or when you would give up.";

const PERSONAS: Persona[] = [
  { id: "p1", name: "Maya", background: "Runs a 6-person design agency and wants the Studio plan for her team.", goal: "Get her team onto the Studio plan.", patience: "low", techSavvy: "high" },
  { id: "p2", name: "Tom", background: "Freelance consultant on a tight budget who reads everything before paying.", goal: "Find the cheapest plan that works and read the docs first.", patience: "high", techSavvy: "medium" },
  { id: "p3", name: "Priya", background: "Operations lead at a 20-person SME; careful, wants to invite a colleague straight away.", goal: "Set up an account and invite a colleague.", patience: "medium", techSavvy: "low" },
];

const has = (f: Finding[], test: (x: Finding) => boolean) => (f.some(test) ? "yes" : "no");

const outRoot = join("runs", `compare-${new Date().toISOString().replace(/[:.]/g, "-")}`);

async function compare(spec: string): Promise<string> {
  const [model, endpoint] = spec.split("@");
  const provider = endpoint ? { order: [endpoint], allow_fallbacks: false } : undefined;
  const fx = await startFixture();
  const started = Date.now();
  try {
    const result = await runSimulation({
      url: fx.url,
      goal: GOAL,
      units: asIndividuals(PERSONAS),
      llm: new OpenAiCompatibleLlm({ baseUrl: baseUrl!, apiKey: apiKey!, model, provider, reasoningEffort: process.env.DEBUTLY_REASONING_EFFORT || undefined }),
      maxSteps: 20,
      concurrency: 3,
      outDir: join(outRoot, spec.replace(/[^a-z0-9.-]+/gi, "_")),
    });
    const f = result.findings;
    const seconds = Math.round((Date.now() - started) / 1000);
    const steps = result.sessions.reduce((n, s) => n + s.steps.length, 0);
    const cost = result.usage.costUsd === undefined ? "n/a" : `$${result.usage.costUsd.toFixed(4)}`;
    const errors = result.sessions.filter((s) => s.outcome === "error").length;
    console.log(`done: ${spec} (${result.reportPath})`);
    return [
      spec,
      has(f, (x) => x.signature === "http:404:/docs"),
      has(f, (x) => x.kind === "page_error" && x.pagePath === "/pricing"),
      has(f, (x) => x.signature === "http:500:/api/invite"),
      has(f, (x) => x.kind === "a11y_unlabeled" && x.pagePath === "/dashboard"),
      fx.state.workspaceDeleted ? "NO" : "yes",
      String(steps),
      `${seconds}s`,
      // Agents run 3 at a time, so a step's wall time is about 3 × this.
      steps ? `${((seconds * 3) / steps).toFixed(1)}s` : "-",
      cost,
      `${result.usage.inputTokens} / ${result.usage.outputTokens}`,
      errors ? `${errors} errored` : "",
      result.sessions.map((s) => `${s.personaName}:${s.outcome}`).join(" "),
    ].join(" | ");
  } catch (err) {
    return `${spec} | run failed: ${err instanceof Error ? err.message.slice(0, 200) : String(err)}`;
  } finally {
    await fx.close();
  }
}

const rows: string[] = [];
for (let i = 0; i < models.length; i += AT_ONCE) rows.push(...(await Promise.all(models.slice(i, i + AT_ONCE).map(compare))));

console.log(
  "\n| Model | Dead docs link | Broken Studio button | Failing invite | Unlabeled button | Delete refused | Steps | Time | Per step | Cost | Tokens in / out | Errors | Outcomes |",
);
console.log("|---|---|---|---|---|---|---|---|---|---|---|---|---|");
for (const r of rows) console.log(`| ${r} |`);
console.log(`\nReports: ${outRoot}`);
