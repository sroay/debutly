// Postgres schema for stored runs. Organizations, apps as records and
// multi-tenancy arrive later; runs name their app, and the M5 dashboard reads all of this.
import { sql } from "drizzle-orm";
import { boolean, customType, doublePrecision, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const runs = pgTable(
  "runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Which app was tested (e.g. "acme"), so the dashboard can group runs by it. */
    app: text("app"),
    /** nightly | pr | manual | local: what started the run. */
    trigger: text("trigger"),
    /** The CI run behind this one (e.g. its GitHub Actions page), when there is one. */
    ciUrl: text("ci_url"),
    targetUrl: text("target_url").notNull(),
    goal: text("goal").notNull(),
    icp: text("icp"),
    tier: text("tier"),
    unitKind: text("unit_kind"),
    /** queued | running | cancelling | cancelled | finished | failed */
    status: text("status").notNull().default("queued"),
    model: text("model"),
    estimateLowUsd: doublePrecision("estimate_low_usd"),
    estimateHighUsd: doublePrecision("estimate_high_usd"),
    costUsd: doublePrecision("cost_usd"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    reportMd: text("report_md"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [index("runs_created_at_idx").on(t.createdAt.desc()), index("runs_app_created_at_idx").on(t.app, t.createdAt.desc())],
);

// postgres-js returns a Buffer, PGlite a Uint8Array: hand back a Buffer either way.
const bytea = customType<{ data: Buffer; driverData: Buffer | Uint8Array }>({
  dataType: () => "bytea",
  fromDriver: (value) => (Buffer.isBuffer(value) ? value : Buffer.from(value)),
});

/**
 * Step screenshots kept in the database, for a deployment with no object storage (a free
 * Postgres is enough to run the dashboard). Compact JPEGs, pruned after a few days.
 */
export const screenshots = pgTable(
  "screenshots",
  {
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    contentType: text("content_type").notNull(),
    data: bytea("data").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.runId, t.key] }), index("screenshots_created_at_idx").on(t.createdAt)],
);

export const customerUnits = pgTable(
  "customer_units",
  {
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    id: text("id").notNull(),
    kind: text("kind").notNull(),
    business: jsonb("business"),
  },
  (t) => [primaryKey({ columns: [t.runId, t.id] })],
);

export const agents = pgTable(
  "agents",
  {
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    id: text("id").notNull(),
    unitId: text("unit_id").notNull(),
    name: text("name").notNull(),
    role: text("role"),
    inclusion: text("inclusion"),
    persona: jsonb("persona").notNull(),
  },
  (t) => [primaryKey({ columns: [t.runId, t.id] })],
);

export const sessions = pgTable(
  "sessions",
  {
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    agentId: text("agent_id").notNull(),
    goal: text("goal").notNull(),
    outcome: text("outcome"),
    outcomeNote: text("outcome_note"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    costUsd: doublePrecision("cost_usd"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.runId, t.agentId] })],
);

export const steps = pgTable(
  "steps",
  {
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    agentId: text("agent_id").notNull(),
    index: integer("index").notNull(),
    url: text("url").notNull(),
    title: text("title"),
    action: jsonb("action").notNull(),
    reasoning: text("reasoning"),
    observation: jsonb("observation").notNull(),
    signals: jsonb("signals").notNull(),
    error: text("error"),
    blocked: text("blocked"),
    screenshotUrl: text("screenshot_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.runId, t.agentId, t.index] })],
);

export const findings = pgTable(
  "findings",
  {
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    signature: text("signature").notNull(),
    kind: text("kind").notNull(),
    severity: text("severity").notNull(),
    confidence: text("confidence").notNull(),
    title: text("title").notNull(),
    detail: text("detail").notNull(),
    pagePath: text("page_path").notNull(),
    hitBy: text("hit_by").array().notNull(),
    visitors: integer("visitors").notNull(),
    evidence: jsonb("evidence").notNull(),
    sandboxCause: text("sandbox_cause").array(),
  },
  (t) => [primaryKey({ columns: [t.runId, t.signature] })],
);

/** What the app under test tried to send or reach, from its sandbox outbox. */
export const sideEffects = pgTable(
  "side_effects",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    outcome: text("outcome").notNull(),
    rule: text("rule"),
    channel: text("channel").notNull(),
    host: text("host").notNull(),
    url: text("url").notNull(),
    recipient: text("recipient"),
    summary: text("summary"),
    at: timestamp("at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [index("side_effects_run_idx").on(t.runId)],
);

/**
 * Design §8 Calibration Loop: every verdict is a prediction; when the real outcome is known it
 * is recorded, and accuracy is tracked over time.
 */
export const predictions = pgTable(
  "predictions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    /** winner | top_objection | intent_share */
    metric: text("metric").notNull(),
    claim: text("claim").notNull(),
    predicted: jsonb("predicted").notNull(),
    actual: jsonb("actual"),
    correct: boolean("correct"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    checkedAt: timestamp("checked_at", { withTimezone: true }),
  },
  (t) => [index("predictions_run_idx").on(t.runId)],
);
