// Perception, grounding and experiments, without a browser per buyer:
//
//   npm run debutly:perceive -- --icp "…" --url https://app.test/ --url https://app.test/pricing \
//     [--competitors https://rival.test/pricing,https://other.test/pricing] [--evaluators 50]
//   npm run debutly:perceive -- --icp "…" --variant A=https://app.test/pricing --variant B=pricing-b.md
//   npm run debutly:perceive -- --icp "…" --from-run runs/<dir>          (pages the depth agents saw)
//   npm run debutly:perceive -- --icp "…" --file pitch.md                (idea stage)
//
// Pages are read, never submitted to. Writes launch-readiness.md, verdicts.json and
// market-context.json; with --store the run and its predictions are recorded.
import "./util/legacy-env";
import "./util/key-defaults";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "playwright";
import { estimatePerceptionCost } from "./cost/estimate";
import { fetchModelPrice } from "./cost/prices";
import { EVALUATORS, type Tier } from "./cost/tiers";
import { creditCheck, keyCreditsLeft } from "./llm/credits";
import { createLlms } from "./llm/factory";
import { captureExhibits, exhibitFromFile, exhibitsFromSessions, type Exhibit } from "./perception/exhibits";
import { buildMarketContext, type MarketContext } from "./perception/market-context";
import { runPerception } from "./perception/run-perception";
import { renderLaunchReadiness } from "./report/launch-readiness";
import { openDb } from "./store/db";
import { PgRunStore } from "./store/pg-run-store";
import { PgPredictionStore } from "./store/predictions";
import type { Session } from "./types";

const { values } = parseArgs({
  options: {
    icp: { type: "string" },
    product: { type: "string" },
    url: { type: "string", multiple: true },
    file: { type: "string", multiple: true },
    "from-run": { type: "string" },
    variant: { type: "string", multiple: true },
    competitors: { type: "string" },
    "market-context": { type: "string" },
    tier: { type: "string", default: "quick" },
    evaluators: { type: "string" },
    concurrency: { type: "string", default: "8" },
    "max-cost": { type: "string" },
    store: { type: "string" },
    out: { type: "string" },
  },
});

const variantArgs = values.variant ?? [];
const hasMain = !!(values.url?.length || values.file?.length || values["from-run"]);
if (!values.icp || (!hasMain && variantArgs.length < 2) || (hasMain && variantArgs.length)) {
  console.error(
    'Usage: npm run debutly:perceive -- --icp "<buyers>" (--url <url>… | --file <pitch>… | --from-run <dir> | --variant A=<url|file> --variant B=<url|file>) [--competitors url,url] [--market-context file] [--tier quick|standard|deep] [--evaluators N] [--max-cost USD] [--store postgres://…] [--out dir]',
  );
  process.exit(1);
}
const tier = values.tier as Tier;
if (!(tier in EVALUATORS)) {
  console.error("--tier must be quick, standard or deep");
  process.exit(1);
}
const evaluators = values.evaluators !== undefined ? Number(values.evaluators) : EVALUATORS[tier];
const isUrl = (s: string) => /^https?:\/\//.test(s);
const experiment = variantArgs.length > 0;

// Before anything is spent: what could this cost?
const navModel = process.env.DEBUTLY_NAV_MODEL ?? "claude-haiku-4-5";
const price = await fetchModelPrice(navModel);
const judgePrice = await fetchModelPrice(process.env.DEBUTLY_JUDGE_MODEL ?? "claude-opus-5");
const estimate = estimatePerceptionCost({ evaluators, experiment, price });
console.log(estimate ? `Estimated cost: $${estimate.low.toFixed(2)}–$${estimate.high.toFixed(2)} (${evaluators} evaluators on ${navModel})` : `Estimated cost: unknown (no price for ${navModel})`);
if (values["max-cost"] !== undefined && (!estimate || estimate.high > Number(values["max-cost"]))) {
  console.error(`Refusing to start: ${estimate ? `this could cost up to $${estimate.high.toFixed(2)}` : "the price is unknown"}, and --max-cost is $${values["max-cost"]}.`);
  process.exit(1);
}
const credits = creditCheck(await keyCreditsLeft(process.env.DEBUTLY_BASE_URL ?? "", process.env.DEBUTLY_API_KEY ?? ""), estimate);
if (credits.refuse) {
  console.error(`Refusing to start: ${credits.refuse}`);
  process.exit(1);
}
if (credits.warn) console.warn(`Warning: ${credits.warn}`);

const { nav, judge } = createLlms(process.env);
const browser = await chromium.launch();
const exhibitsByVariant: Record<string, Exhibit[]> = {};
let market: MarketContext | undefined;
try {
  if (experiment) {
    for (const arg of variantArgs) {
      const [name, source] = [arg.slice(0, arg.indexOf("=")), arg.slice(arg.indexOf("=") + 1)];
      if (!name || !source) throw new Error(`--variant must look like A=<url|file> (got "${arg}")`);
      const found = isUrl(source) ? await captureExhibits(browser, [source]) : [await exhibitFromFile(source)];
      exhibitsByVariant[name] = [...(exhibitsByVariant[name] ?? []), ...found.map((e) => ({ ...e, id: `${name}:${e.id}` }))];
    }
    if (Object.keys(exhibitsByVariant).length !== 2) throw new Error("an experiment needs exactly two variants, e.g. --variant A=… --variant B=…");
  } else {
    const main: Exhibit[] = [];
    if (values["from-run"]) main.push(...exhibitsFromSessions(JSON.parse(await readFile(join(values["from-run"], "sessions.json"), "utf8")) as Session[]));
    if (values.url?.length) main.push(...(await captureExhibits(browser, values.url)));
    for (const f of values.file ?? []) main.push(await exhibitFromFile(f));
    exhibitsByVariant.main = main;
  }

  if (values["market-context"]) {
    market = JSON.parse(await readFile(values["market-context"], "utf8")) as MarketContext;
  } else if (values.competitors) {
    const urls = values.competitors.split(",").map((u) => u.trim()).filter(Boolean);
    console.log(`Reading ${urls.length} competitor pages for market context...`);
    market = await buildMarketContext(judge, { icp: values.icp, product: values.product ?? "the product", competitorExhibits: await captureExhibits(browser, urls) });
  }
} finally {
  await browser.close();
}

const product = values.product ?? (values.url?.[0] ? new URL(values.url[0]).host : "the product");
console.log(`${evaluators} evaluators judging ${experiment ? Object.keys(exhibitsByVariant).join(" vs ") : `${exhibitsByVariant.main.length} pages`}...`);
const result = await runPerception({
  llm: nav,
  judge,
  icp: values.icp,
  product,
  exhibitsByVariant,
  evaluators,
  concurrency: Number(values.concurrency),
  market,
  price,
  judgePrice,
});

const outDir = values.out ?? `runs/perceive-${new Date().toISOString().replace(/[:.]/g, "-")}`;
await mkdir(outDir, { recursive: true });
const report = renderLaunchReadiness({ target: product, icp: values.icp, result });
await writeFile(join(outDir, "launch-readiness.md"), report);
await writeFile(join(outDir, "verdicts.json"), JSON.stringify({ verdicts: result.verdicts, pairs: result.pairs, aggregates: result.aggregates, pairAggregate: result.pairAggregate }, null, 2));
if (market) await writeFile(join(outDir, "market-context.json"), JSON.stringify(market, null, 2));

if (values.store) {
  const { db, close } = await openDb(values.store);
  const runs = new PgRunStore(db);
  const runId = await runs.createRun({ targetUrl: values.url?.[0] ?? product, goal: experiment ? "experiment" : "perception", icp: values.icp, tier, unitKind: "evaluators", model: navModel, estimate });
  await runs.finishRun(runId, { status: "finished", findings: [], reportMd: report, usage: result.usage, sideEffects: [] });
  const ids = await new PgPredictionStore(db).add(runId, result.predictions);
  await close();
  console.log(`Stored run ${runId} with ${ids.length} predictions:`);
  result.predictions.forEach((p, i) => console.log(`  ${ids[i]}  ${p.claim}`));
}

const cost = result.usage.costUsd !== undefined ? `, cost $${result.usage.costUsd.toFixed(4)}` : "";
console.log(`Done: ${result.evaluators - result.unusable} usable judgments${cost}. Report: ${join(outDir, "launch-readiness.md")}`);
