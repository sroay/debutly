// What the dashboard shows, read from the run store. Plain functions over a Drizzle handle, so
// they run the same on Neon, any Postgres, or PGlite in tests.
import { and, asc, desc, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import type { Db } from "../../src/store/db";
import { agents, customerUnits, findings, runs, sessions, sideEffects, steps } from "../../src/store/schema";
import type { Action, Observation, Signal } from "../../src/types";

/** A finding is the app's (real), probably the agent's (low confidence), or the test environment's. */
export type FindingClass = "real" | "low" | "env";

export function classify(f: { sandboxCause: string[] | null; confidence: string }): FindingClass {
  if (f.sandboxCause) return "env";
  return f.confidence === "low" ? "low" : "real";
}

export interface FindingCounts {
  blocker: number;
  major: number;
  minor: number;
  low: number;
  env: number;
}

export interface RunSummary {
  id: string;
  app: string;
  trigger: string | null;
  ciUrl: string | null;
  status: string;
  model: string | null;
  createdAt: Date;
  costUsd: number | null;
  agents: number;
  succeeded: number;
  outcomes: Record<string, number>;
  findings: FindingCounts;
}

const NO_APP = "(no app)";
const emptyCounts = (): FindingCounts => ({ blocker: 0, major: 0, minor: 0, low: 0, env: 0 });

/** Runs, newest first, with how their agents did and what they found. */
export async function listRuns(db: Db, o: { app?: string; id?: string; limit?: number } = {}): Promise<RunSummary[]> {
  const rows = await db
    .select()
    .from(runs)
    .where(
      and(
        o.app ? (o.app === NO_APP ? sql`${runs.app} is null` : eq(runs.app, o.app)) : undefined,
        o.id ? eq(runs.id, o.id) : undefined,
      ),
    )
    .orderBy(desc(runs.createdAt))
    .limit(o.limit ?? 50);
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const [outcomes, found] = await Promise.all([
    db
      .select({ runId: sessions.runId, outcome: sessions.outcome, n: sql<number>`count(*)`.mapWith(Number) })
      .from(sessions)
      .where(inArray(sessions.runId, ids))
      .groupBy(sessions.runId, sessions.outcome),
    db
      .select({ runId: findings.runId, severity: findings.severity, confidence: findings.confidence, sandboxCause: findings.sandboxCause })
      .from(findings)
      .where(inArray(findings.runId, ids)),
  ]);
  return rows.map((r) => {
    const mine = outcomes.filter((o) => o.runId === r.id);
    const counts = emptyCounts();
    for (const f of found.filter((f) => f.runId === r.id)) {
      const c = classify(f);
      if (c === "real") counts[f.severity as "blocker" | "major" | "minor"]++;
      else counts[c]++;
    }
    return {
      id: r.id,
      app: r.app ?? NO_APP,
      trigger: r.trigger,
      ciUrl: r.ciUrl,
      status: r.status,
      model: r.model,
      createdAt: r.createdAt,
      costUsd: r.costUsd,
      agents: mine.reduce((n, o) => n + o.n, 0),
      succeeded: mine.find((o) => o.outcome === "success")?.n ?? 0,
      outcomes: Object.fromEntries(mine.map((o) => [o.outcome ?? "running", o.n])),
      findings: counts,
    };
  });
}

export interface AppOverview {
  app: string;
  latest: RunSummary;
  /** Oldest first, for a trend. */
  recent: RunSummary[];
}

/** Each app's latest run and its recent history. */
export async function appsOverview(db: Db, recent = 14): Promise<AppOverview[]> {
  const apps = await db.selectDistinct({ app: runs.app }).from(runs);
  const out: AppOverview[] = [];
  for (const { app } of apps) {
    const history = await listRuns(db, { app: app ?? NO_APP, limit: recent });
    if (history.length) out.push({ app: app ?? NO_APP, latest: history[0], recent: [...history].reverse() });
  }
  return out.sort((a, b) => a.app.localeCompare(b.app));
}

export interface StoredFinding {
  signature: string;
  kind: string;
  severity: string;
  confidence: string;
  title: string;
  detail: string;
  pagePath: string;
  hitBy: string[];
  visitors: number;
  evidence: { agentId: string; stepIndex: number }[];
  sandboxCause: string[] | null;
  class: FindingClass;
}

export interface RunDetail {
  run: typeof runs.$inferSelect;
  units: { id: string; kind: string; business: { name: string; archetype: string; size: number; monthlyBudget: number } | null }[];
  agents: {
    id: string;
    unitId: string;
    name: string;
    role: string | null;
    inclusion: string | null;
    outcome: string | null;
    outcomeNote: string | null;
    costUsd: number | null;
    steps: number;
  }[];
  findings: StoredFinding[];
  sideEffects: { outcome: string; n: number }[];
}

const SEVERITY_ORDER: Record<string, number> = { blocker: 0, major: 1, minor: 2 };

export async function runDetail(db: Db, runId: string): Promise<RunDetail | null> {
  const [run] = await db.select().from(runs).where(eq(runs.id, runId));
  if (!run) return null;
  const [units, people, sess, stepCounts, found, effects] = await Promise.all([
    db.select().from(customerUnits).where(eq(customerUnits.runId, runId)).orderBy(asc(customerUnits.id)),
    db.select().from(agents).where(eq(agents.runId, runId)).orderBy(asc(agents.id)),
    db.select().from(sessions).where(eq(sessions.runId, runId)),
    db
      .select({ agentId: steps.agentId, n: sql<number>`count(*)`.mapWith(Number) })
      .from(steps)
      .where(eq(steps.runId, runId))
      .groupBy(steps.agentId),
    db.select().from(findings).where(eq(findings.runId, runId)),
    db
      .select({ outcome: sideEffects.outcome, n: sql<number>`count(*)`.mapWith(Number) })
      .from(sideEffects)
      .where(eq(sideEffects.runId, runId))
      .groupBy(sideEffects.outcome),
  ]);
  // Older runs recorded sessions without agent rows; fall back to the sessions themselves.
  const people2 = people.length ? people : sess.map((s) => ({ runId, id: s.agentId, unitId: s.agentId, name: s.agentId, role: null, inclusion: null, persona: {} }));
  return {
    run,
    units: units.map((u) => ({ id: u.id, kind: u.kind, business: u.business as RunDetail["units"][number]["business"] })),
    agents: people2.map((p) => {
      const s = sess.find((s) => s.agentId === p.id);
      return {
        id: p.id,
        unitId: p.unitId,
        name: p.name,
        role: p.role,
        inclusion: p.inclusion,
        outcome: s?.outcome ?? null,
        outcomeNote: s?.outcomeNote ?? null,
        costUsd: s?.costUsd ?? null,
        steps: stepCounts.find((c) => c.agentId === p.id)?.n ?? 0,
      };
    }),
    findings: found
      .map((f) => ({ ...f, evidence: f.evidence as StoredFinding["evidence"], class: classify(f) }))
      .sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9) || a.title.localeCompare(b.title)),
    sideEffects: effects,
  };
}

export interface ReplayStep {
  index: number;
  url: string;
  title: string | null;
  action: Action;
  reasoning: string | null;
  observation: Observation;
  signals: Signal[];
  error: string | null;
  blocked: string | null;
  screenshotUrl: string | null;
}

export interface Replay {
  run: { id: string; app: string; createdAt: Date; goal: string };
  agent: { id: string; name: string; role: string | null; inclusion: string | null };
  session: { outcome: string | null; outcomeNote: string | null; costUsd: number | null; goal: string } | null;
  steps: ReplayStep[];
  /** Findings this agent's steps are evidence for, by step index. */
  findingsAt: Record<number, { title: string; severity: string; class: FindingClass }[]>;
}

export async function sessionReplay(db: Db, runId: string, agentId: string): Promise<Replay | null> {
  const [run] = await db.select({ id: runs.id, app: runs.app, createdAt: runs.createdAt, goal: runs.goal }).from(runs).where(eq(runs.id, runId));
  if (!run) return null;
  const [[agent], [session], stepRows, found] = await Promise.all([
    db.select().from(agents).where(and(eq(agents.runId, runId), eq(agents.id, agentId))),
    db.select().from(sessions).where(and(eq(sessions.runId, runId), eq(sessions.agentId, agentId))),
    db.select().from(steps).where(and(eq(steps.runId, runId), eq(steps.agentId, agentId))).orderBy(asc(steps.index)),
    db.select().from(findings).where(eq(findings.runId, runId)),
  ]);
  if (!agent && !session && !stepRows.length) return null;
  const findingsAt: Replay["findingsAt"] = {};
  for (const f of found) {
    for (const e of f.evidence as StoredFinding["evidence"]) {
      if (e.agentId !== agentId) continue;
      (findingsAt[e.stepIndex] ??= []).push({ title: f.title, severity: f.severity, class: classify(f) });
    }
  }
  return {
    run: { ...run, app: run.app ?? NO_APP },
    agent: agent ? { id: agent.id, name: agent.name, role: agent.role, inclusion: agent.inclusion } : { id: agentId, name: agentId, role: null, inclusion: null },
    session: session ? { outcome: session.outcome, outcomeNote: session.outcomeNote, costUsd: session.costUsd, goal: session.goal } : null,
    steps: stepRows.map((s) => ({
      index: s.index,
      url: s.url,
      title: s.title,
      action: s.action as Action,
      reasoning: s.reasoning,
      observation: s.observation as Observation,
      signals: s.signals as Signal[],
      error: s.error,
      blocked: s.blocked,
      screenshotUrl: s.screenshotUrl,
    })),
    findingsAt,
  };
}

/** Where a finding stands now: only in the latest run, in it and earlier ones, or not in it. */
export type FindingStatus = "new" | "recurring" | "absent";

export interface FindingHistory {
  app: string;
  signature: string;
  kind: string;
  title: string;
  detail: string;
  severity: string;
  pagePath: string;
  class: FindingClass;
  runsSeen: number;
  /** Runs of this app since the finding was first seen, including the first. */
  runsSince: number;
  firstSeen: Date;
  lastSeen: Date;
  lastRunId: string;
  status: FindingStatus;
}

/** Every finding across runs, by app: how often it turns up, and whether the latest run still has it. */
export async function findingHistory(db: Db, o: { app?: string } = {}): Promise<FindingHistory[]> {
  const latestFirst = (col: unknown) => sql`(array_agg(${col} order by ${runs.createdAt} desc))[1]`;
  const rows = await db
    .select({
      app: runs.app,
      signature: findings.signature,
      runsSeen: sql<number>`count(*)`.mapWith(Number),
      firstSeen: sql<Date>`min(${runs.createdAt})`.mapWith((v) => new Date(v)),
      lastSeen: sql<Date>`max(${runs.createdAt})`.mapWith((v) => new Date(v)),
      kind: latestFirst(findings.kind).mapWith(String),
      title: latestFirst(findings.title).mapWith(String),
      detail: latestFirst(findings.detail).mapWith(String),
      severity: latestFirst(findings.severity).mapWith(String),
      confidence: latestFirst(findings.confidence).mapWith(String),
      pagePath: latestFirst(findings.pagePath).mapWith(String),
      env: sql<boolean>`bool_or(${findings.sandboxCause} is not null)`.mapWith(Boolean),
      lastRunId: latestFirst(findings.runId).mapWith(String),
    })
    .from(findings)
    .innerJoin(runs, eq(runs.id, findings.runId))
    .where(o.app ? eq(runs.app, o.app) : undefined)
    .groupBy(runs.app, findings.signature);
  if (!rows.length) return [];
  const appRuns = await db
    .select({ app: runs.app, createdAt: runs.createdAt })
    .from(runs)
    .where(and(eq(runs.status, "finished"), o.app ? eq(runs.app, o.app) : isNotNull(runs.id)))
    .orderBy(desc(runs.createdAt));
  return rows
    .map((r): FindingHistory => {
      const app = r.app ?? NO_APP;
      const ofApp = appRuns.filter((x) => (x.app ?? NO_APP) === app);
      const latest = ofApp[0]?.createdAt.getTime() ?? 0;
      const inLatest = r.lastSeen.getTime() >= latest;
      return {
        app,
        signature: r.signature,
        kind: r.kind,
        title: r.title,
        detail: r.detail,
        severity: r.severity,
        pagePath: r.pagePath,
        class: r.env ? "env" : r.confidence === "low" ? "low" : "real",
        runsSeen: r.runsSeen,
        runsSince: Math.max(r.runsSeen, ofApp.filter((x) => x.createdAt.getTime() >= r.firstSeen.getTime()).length),
        firstSeen: r.firstSeen,
        lastSeen: r.lastSeen,
        lastRunId: r.lastRunId,
        status: !inLatest ? "absent" : r.runsSeen === 1 && r.firstSeen.getTime() >= latest ? "new" : "recurring",
      };
    })
    .sort(
      (a, b) =>
        Number(a.status === "absent") - Number(b.status === "absent") ||
        (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9) ||
        b.runsSeen - a.runsSeen,
    );
}

export interface SpendDay {
  day: string;
  app: string;
  costUsd: number;
  runs: number;
}

/** Model spend per day and app, from what each run recorded. */
export async function spendByDay(db: Db, days = 30, now = new Date()): Promise<SpendDay[]> {
  const since = new Date(now.getTime() - days * 86_400_000);
  const day = sql<string>`to_char(${runs.createdAt} at time zone 'UTC', 'YYYY-MM-DD')`;
  const rows = await db
    .select({ day, app: runs.app, costUsd: sql<number>`coalesce(sum(${runs.costUsd}), 0)`.mapWith(Number), runs: sql<number>`count(*)`.mapWith(Number) })
    .from(runs)
    .where(gte(runs.createdAt, since))
    .groupBy(day, runs.app)
    .orderBy(day);
  return rows.map((r) => ({ day: r.day, app: r.app ?? NO_APP, costUsd: r.costUsd, runs: r.runs }));
}
