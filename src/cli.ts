import "./util/legacy-env";
import "./util/key-defaults";
import { parseArgs } from "node:util";
import { Queue, QueueEvents } from "bullmq";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { estimatePerceptionCost, estimateRunCost } from "./cost/estimate";
import { fetchModelPrice } from "./cost/prices";
import { agentCount, resolveRunSize } from "./cost/tiers";
import { DbArtifactStore, TeeArtifactStore } from "./artifacts/db";
import { S3ArtifactStore } from "./artifacts/s3";
import { LocalArtifactStore, type ArtifactStore } from "./artifacts/store";
import { MailpitInbox } from "./inbox/mailpit";
import { creditCheck, keyCreditsLeft } from "./llm/credits";
import { createLlms } from "./llm/factory";
import { OUT_OF_CREDITS } from "./llm/types";
import { generateUnits } from "./persona/generate";
import { withInclusion } from "./persona/inclusion";
import { languageName, parseLanguages, withLanguages } from "./persona/language";
import { peopleCount, readPeople } from "./persona/people";
import { exhibitsFromSessions } from "./perception/exhibits";
import { runPerception } from "./perception/run-perception";
import { renderLaunchReadiness } from "./report/launch-readiness";
import { queueDispatch } from "./queue/dispatch";
import { AGENT_QUEUE, redisClient } from "./queue/jobs";
import { HttpSandboxOutbox } from "./sandbox/outbox";
import { runSimulation } from "./run";
import { openDb } from "./store/db";
import { PgRunStore } from "./store/pg-run-store";
import type { CustomerUnit, Persona } from "./types";
import { runOrigin } from "./util/run-origin";

const MAX_EMPLOYEES = 4;

const { values } = parseArgs({
  options: {
    url: { type: "string" },
    goal: { type: "string" },
    icp: { type: "string" },
    // Customer units: "individual" (B2C, one person each) or "business" (owner + employees).
    unit: { type: "string", default: "individual" },
    // Run size: quick (3 units, owners only), standard (10, 2 employees each) or deep (30, 3 each).
    tier: { type: "string", default: "quick" },
    // How many units (individuals or business crews); overrides the tier.
    agents: { type: "string" },
    // Employees per business crew (0 = owner only); overrides the tier.
    employees: { type: "string" },
    // Refuse to start if the run could cost more than this many USD.
    "max-cost": { type: "string" },
    // Screen-reader, low-vision, slow-connection and non-native-English agents, rotating nightly.
    inclusion: { type: "string", default: "on" },
    // GLM-5.3 Flash, the default agent model, takes about 40% more steps than Gemini.
    "max-steps": { type: "string", default: "30" },
    concurrency: { type: "string", default: "3" },
    out: { type: "string" },
    // Local mail catcher (e.g. Mailpit from `supabase start`) that gives agents real inboxes.
    mailpit: { type: "string" },
    // Keeps each agent's signed-in browser for `debutly hear`; holds session cookies, so keep it out of the report.
    "browser-state": { type: "string" },
    "email-domain": { type: "string", default: "agents.test" },
    // The app's sandbox outbox (token in DEBUTLY_SANDBOX_TOKEN), to separate failures the test environment caused.
    "sandbox-outbox": { type: "string" },
    // Record the run as it happens: postgres://… (or memory: for a throwaway in-process database).
    store: { type: "string" },
    // For the dashboard: which app this is, what started the run, and its CI page. In GitHub
    // Actions all three default from the workflow (repository name, event, run URL).
    app: { type: "string" },
    trigger: { type: "string" },
    "ci-url": { type: "string" },
    // Days to keep screenshots stored in the database (with --store and no S3), default 7.
    "screenshot-days": { type: "string", default: "7" },
    // Run agents on queue workers (npm run debutly:worker) instead of here: redis://…; needs a postgres --store.
    queue: { type: "string" },
    // Per-agent caps on top of --max-steps.
    "agent-token-cap": { type: "string" },
    "agent-minutes": { type: "string" },
    // After the depth run, this many breadth evaluators judge the pages the agents saw (Launch Readiness report).
    evaluators: { type: "string" },
    // Customers' first languages, as lang codes (ar,en): agents take them in turn.
    languages: { type: "string" },
    // An earlier run's people.json: the same agents again, e.g. to see whether a fix worked.
    people: { type: "string" },
  },
});

const unitKind = values.unit;
if (!values.url || !values.goal || !values.icp || (unitKind !== "individual" && unitKind !== "business")) {
  console.error(
    'Usage: npx debutly (settings in debutly.json; npx debutly init writes one) or npx debutly --url <url> --goal "<goal>" --icp "<ideal customer profile>" [--unit individual|business] [--tier quick|standard|deep] [--agents N] [--employees N] [--max-cost USD] [--inclusion on|off] [--max-steps 30] [--concurrency 3] [--out runs/x] [--mailpit http://127.0.0.1:54324] [--email-domain agents.test] [--sandbox-outbox http://localhost:3000/api/sandbox/outbox] [--store postgres://…] [--app name] [--trigger nightly|pr|manual] [--ci-url url] [--screenshot-days 7] [--browser-state dir] [--queue redis://…] [--agent-token-cap N] [--agent-minutes N] [--evaluators N] [--people runs/x/people.json]',
  );
  process.exit(1);
}
// Checked before anything is spent: a wrong code stops the run here.
let languages: string[];
try {
  languages = parseLanguages(values.languages);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
const size = resolveRunSize({
  tier: values.tier,
  units: values.agents !== undefined ? Number(values.agents) : undefined,
  employees: values.employees !== undefined ? Number(values.employees) : undefined,
});
const employees = Math.min(Math.max(size.employees || 0, 0), MAX_EMPLOYEES);
const count = size.units;
const maxSteps = Number(values["max-steps"]);
let reused: CustomerUnit[] | undefined;
try {
  reused = values.people ? await readPeople(values.people) : undefined;
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
if (unitKind === "business" && employees > 0 && !values.mailpit) {
  console.warn("Business crews need --mailpit for invites; employees will be recorded as not invited.");
}

// Before anything is spent: what could this run cost?
const navModel = process.env.DEBUTLY_NAV_MODEL ?? (process.env.DEBUTLY_PROVIDER === "openai-compatible" ? "" : "claude-haiku-4-5");
const agents = reused ? peopleCount(reused) : agentCount(unitKind, { ...size, employees });
const price = await fetchModelPrice(navModel);
const evaluatorCount = values.evaluators !== undefined ? Number(values.evaluators) : 0;
const depthEstimate = estimateRunCost({ agents, maxSteps, price });
const breadthEstimate = evaluatorCount ? estimatePerceptionCost({ evaluators: evaluatorCount, experiment: false, price }) : { low: 0, high: 0 };
const estimate = depthEstimate && breadthEstimate ? { low: depthEstimate.low + breadthEstimate.low, high: depthEstimate.high + breadthEstimate.high } : null;
console.log(
  estimate
    ? `Estimated cost: $${estimate.low.toFixed(2)}–$${estimate.high.toFixed(2)} (${agents} agents × up to ${maxSteps} steps${evaluatorCount ? ` + ${evaluatorCount} evaluators` : ""} on ${navModel})`
    : `Estimated cost: unknown (no price found for ${navModel})`,
);
if (values["max-cost"] !== undefined) {
  const ceiling = Number(values["max-cost"]);
  if (!estimate) {
    console.error(`Refusing to start: --max-cost is set but the price of ${navModel} is unknown.`);
    process.exit(1);
  }
  if (estimate.high > ceiling) {
    console.error(`Refusing to start: this run could cost up to $${estimate.high.toFixed(2)}, above --max-cost $${ceiling.toFixed(2)}.`);
    process.exit(1);
  }
}

// A key with a spending limit says what it has left: don't start a run it can't finish.
const credits = creditCheck(await keyCreditsLeft(process.env.DEBUTLY_BASE_URL ?? "", process.env.DEBUTLY_API_KEY ?? ""), estimate);
if (credits.refuse) {
  console.error(`Refusing to start: ${credits.refuse}`);
  process.exit(1);
}
if (credits.warn) console.warn(`Warning: ${credits.warn}`);

const { nav, judge } = createLlms(process.env);
let units: CustomerUnit[];
if (reused) {
  console.log(`The same ${agents} agents as before, from ${values.people}:`);
  units = reused;
} else {
  console.log(`Generating ${count} ${unitKind === "business" ? `business crew(s) with ${employees} employees each` : "individual(s)"}...`);
  units = await generateUnits(judge, values.icp, { kind: unitKind, count, employees, languages });
  if (values.inclusion !== "off") {
    const dayOfYear = Math.floor((Date.now() - Date.UTC(new Date().getUTCFullYear(), 0, 1)) / 86_400_000);
    units = withInclusion(units, dayOfYear);
  }
  units = withLanguages(units, languages);
}

const describe = (p: Persona) =>
  `${p.id} ${p.name}${p.role ? ` (${p.role})` : ""}${p.inclusion ? ` [${p.inclusion.replace(/_/g, " ")}]` : ""}${p.language && p.language !== "en" ? ` [${languageName(p.language)}]` : ""}: ${p.background}`;
for (const u of units) {
  if (u.kind === "individual") console.log(`  ${describe(u.person)}`);
  else {
    console.log(`  ${u.id} ${u.business.name}, ${u.business.archetype} of ~${u.business.size}, $${u.business.monthlyBudget}/mo`);
    for (const p of [u.owner, ...u.employees]) console.log(`    ${describe(p)}`);
  }
}

if (values.queue && (!values.store || values.store === "memory:")) {
  console.error("--queue needs --store postgres://…: workers record the agents there.");
  process.exit(1);
}
const outDir = values.out ?? `runs/${new Date().toISOString().replace(/[:.]/g, "-")}`;
const opened = values.store ? await openDb(values.store) : undefined;
const store = opened ? new PgRunStore(opened.db) : undefined;
const origin = runOrigin({ app: values.app, trigger: values.trigger, ciUrl: values["ci-url"] }, process.env);
const runId = store
  ? await store.createRun({ ...origin, targetUrl: values.url, goal: values.goal, icp: values.icp, tier: size.tier, unitKind, model: navModel, estimate })
  : undefined;
// Screenshots: S3 when it is configured; otherwise, with a store, the database (compact JPEGs,
// old ones pruned) as well as the run folder, so the dashboard has them with nothing but Postgres.
const s3 = runId ? S3ArtifactStore.fromEnv(process.env, runId) : undefined;
let artifacts: ArtifactStore | undefined = s3;
if (!s3 && opened && runId && values.store !== "memory:") {
  const pruned = await DbArtifactStore.prune(opened.db, Number(values["screenshot-days"]));
  if (pruned) console.log(`Pruned ${pruned} screenshots older than ${values["screenshot-days"]} days from the store.`);
  artifacts = new TeeArtifactStore([new LocalArtifactStore(join(outDir, "screenshots")), new DbArtifactStore(opened.db, runId)]);
}
if (runId) console.log(`Run ${runId} (cancel from anywhere with: npm run debutly:cancel -- ${runId} --store <url>)`);

// Kill switch: the first Ctrl+C lets agents stop at their next step and still writes
// the report; a second one exits at once.
let cancelled = false;
process.on("SIGINT", () => {
  if (cancelled) process.exit(130);
  cancelled = true;
  console.warn("\nCancelling: agents stop at their next step (Ctrl+C again to quit now)...");
  if (store && runId) void store.requestCancel(runId);
});

const queue = values.queue ? new Queue(AGENT_QUEUE, { connection: redisClient(values.queue) }) : undefined;
const queueEvents = values.queue ? new QueueEvents(AGENT_QUEUE, { connection: redisClient(values.queue) }) : undefined;
const caps = {
  maxTokens: values["agent-token-cap"] !== undefined ? Number(values["agent-token-cap"]) : undefined,
  maxMs: values["agent-minutes"] !== undefined ? Number(values["agent-minutes"]) * 60_000 : undefined,
};

console.log(`Running against ${values.url}${values.mailpit ? " (with inboxes)" : ""}...`);
const result = await runSimulation({
  url: values.url,
  goal: values.goal,
  units,
  llm: nav,
  maxSteps,
  concurrency: Number(values.concurrency),
  outDir,
  inbox: values.mailpit ? new MailpitInbox(values.mailpit) : undefined,
  emailDomain: values["email-domain"],
  sandboxOutbox: values["sandbox-outbox"] ? new HttpSandboxOutbox(values["sandbox-outbox"], process.env.DEBUTLY_SANDBOX_TOKEN ?? "") : undefined,
  store,
  runId,
  price,
  caps,
  shouldStop: () => cancelled,
  artifacts,
  browserStateDir: values["browser-state"],
  dispatch:
    queue && queueEvents && runId
      ? ({ runTag }) =>
          queueDispatch(queue, queueEvents, {
            runId,
            targetUrl: values.url!,
            maxSteps,
            caps,
            price,
            mailpitUrl: values.mailpit,
            emailDomain: values["email-domain"] ?? "agents.test",
            runTag,
          })
      : undefined,
});
await queueEvents?.close();
await queue?.close();
await opened?.close();

if (evaluatorCount > 0) {
  console.log(`${evaluatorCount} evaluators judging the pages the agents saw...`);
  const perception = await runPerception({
    llm: nav,
    judge,
    icp: values.icp,
    product: values.url,
    exhibitsByVariant: { main: exhibitsFromSessions(result.sessions) },
    evaluators: evaluatorCount,
    concurrency: Math.max(Number(values.concurrency), 8),
    price,
    judgePrice: await fetchModelPrice(process.env.DEBUTLY_JUDGE_MODEL ?? ""),
    functional: result.findings,
  });
  const readiness = join(outDir, "launch-readiness.md");
  await writeFile(readiness, renderLaunchReadiness({ target: values.url, icp: values.icp, result: perception, functional: result.findings }));
  console.log(`Launch Readiness: ${readiness}`);
}

const noCredit = result.sessions.filter((s) => s.outcome === "error" && s.outcomeNote.startsWith(OUT_OF_CREDITS)).length;
if (noCredit) {
  const message = `The AI provider account ran out of credits: ${noCredit} of ${result.sessions.length} agents stopped early. Top up and run again.`;
  // On GitHub Actions, an annotation puts it on the run's summary page.
  console.error(process.env.GITHUB_ACTIONS ? `::error title=Debutly run cut short::${message}` : message);
}
const cost = result.usage.costUsd !== undefined ? `, cost $${result.usage.costUsd.toFixed(4)}` : "";
console.log(`Done: ${result.findings.length} findings${cost}. Report: ${result.reportPath}${runId ? ` (run ${runId})` : ""}`);
