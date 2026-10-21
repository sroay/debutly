import { and, asc, eq, inArray } from "drizzle-orm";
import type { CustomerUnit, Finding, Persona, Session, Step } from "../types";
import type { Db } from "./db";
import type { NewRun, RunStore, RunUsage, SideEffect, StoredRun } from "./run-store";
import * as t from "./schema";

const membersOf = (u: CustomerUnit): Persona[] => (u.kind === "individual" ? [u.person] : [u.owner, ...u.employees]);

export class PgRunStore implements RunStore {
  constructor(private readonly db: Db) {}

  async createRun(r: NewRun): Promise<string> {
    const [row] = await this.db
      .insert(t.runs)
      .values({
        app: r.app ?? null,
        trigger: r.trigger ?? null,
        ciUrl: r.ciUrl ?? null,
        targetUrl: r.targetUrl,
        goal: r.goal,
        icp: r.icp,
        tier: r.tier,
        unitKind: r.unitKind,
        model: r.model,
        estimateLowUsd: r.estimate?.low,
        estimateHighUsd: r.estimate?.high,
        status: "running",
        startedAt: new Date(),
      })
      .returning({ id: t.runs.id });
    return row.id;
  }

  async recordUnits(runId: string, units: CustomerUnit[]): Promise<void> {
    if (!units.length) return;
    await this.db.insert(t.customerUnits).values(units.map((u) => ({ runId, id: u.id, kind: u.kind, business: u.kind === "business" ? u.business : null })));
    const people = units.flatMap((u) => membersOf(u).map((p) => ({ unitId: u.id, p })));
    await this.db.insert(t.agents).values(
      people.map(({ unitId, p }) => ({ runId, id: p.id, unitId, name: p.name, role: p.role ?? null, inclusion: p.inclusion ?? null, persona: p })),
    );
  }

  async startSession(runId: string, agentId: string, goal: string): Promise<void> {
    await this.db.insert(t.sessions).values({ runId, agentId, goal }).onConflictDoNothing();
  }

  async appendStep(runId: string, agentId: string, s: Step): Promise<void> {
    await this.db
      .insert(t.steps)
      .values({
        runId,
        agentId,
        index: s.index,
        url: s.observation.url,
        title: s.observation.title,
        action: s.action,
        reasoning: s.reasoning,
        observation: s.observation,
        signals: s.signals,
        error: s.error ?? null,
        blocked: s.blocked ?? null,
        screenshotUrl: s.screenshotPath ?? null,
      })
      .onConflictDoNothing();
  }

  async finishSession(runId: string, s: Session): Promise<void> {
    const values = {
      outcome: s.outcome,
      outcomeNote: s.outcomeNote,
      inputTokens: s.usage?.inputTokens ?? null,
      outputTokens: s.usage?.outputTokens ?? null,
      costUsd: s.usage?.costUsd ?? null,
      finishedAt: new Date(),
    };
    await this.db
      .insert(t.sessions)
      .values({ runId, agentId: s.agentId, goal: s.goal, ...values })
      .onConflictDoUpdate({ target: [t.sessions.runId, t.sessions.agentId], set: values });
  }

  async finishRun(
    runId: string,
    r: { status: "finished" | "failed" | "cancelled"; findings: Finding[]; reportMd: string; usage: RunUsage; sideEffects: SideEffect[] },
  ): Promise<void> {
    if (r.findings.length) {
      await this.db.insert(t.findings).values(
        r.findings.map((f) => ({
          runId,
          signature: f.signature,
          kind: f.kind,
          severity: f.severity,
          confidence: f.confidence,
          title: f.title,
          detail: f.detail,
          pagePath: f.pagePath,
          hitBy: f.hitBy,
          visitors: f.visitors,
          evidence: f.evidence,
          sandboxCause: f.sandboxCause ?? null,
        })),
      );
    }
    if (r.sideEffects.length) await this.db.insert(t.sideEffects).values(r.sideEffects.map((e) => ({ runId, ...e })));
    await this.db
      .update(t.runs)
      .set({
        status: r.status,
        reportMd: r.reportMd,
        inputTokens: r.usage.inputTokens,
        outputTokens: r.usage.outputTokens,
        costUsd: r.usage.costUsd ?? null,
        finishedAt: new Date(),
      })
      .where(eq(t.runs.id, runId));
  }

  async requestCancel(runId: string): Promise<void> {
    await this.db
      .update(t.runs)
      .set({ status: "cancelling" })
      .where(and(eq(t.runs.id, runId), inArray(t.runs.status, ["queued", "running"])));
  }

  async isCancelled(runId: string): Promise<boolean> {
    const [row] = await this.db.select({ status: t.runs.status }).from(t.runs).where(eq(t.runs.id, runId));
    return row?.status === "cancelling" || row?.status === "cancelled";
  }

  async getRun(runId: string): Promise<StoredRun | null> {
    const [run] = await this.db.select().from(t.runs).where(eq(t.runs.id, runId));
    if (!run) return null;
    const [units, agents, sessions, steps, findings, sideEffects] = await Promise.all([
      this.db.select().from(t.customerUnits).where(eq(t.customerUnits.runId, runId)).orderBy(asc(t.customerUnits.id)),
      this.db.select().from(t.agents).where(eq(t.agents.runId, runId)).orderBy(asc(t.agents.id)),
      this.db.select().from(t.sessions).where(eq(t.sessions.runId, runId)).orderBy(asc(t.sessions.agentId)),
      this.db.select().from(t.steps).where(eq(t.steps.runId, runId)).orderBy(asc(t.steps.agentId), asc(t.steps.index)),
      this.db.select().from(t.findings).where(eq(t.findings.runId, runId)),
      this.db.select().from(t.sideEffects).where(eq(t.sideEffects.runId, runId)).orderBy(asc(t.sideEffects.id)),
    ]);
    return {
      ...run,
      units,
      agents,
      sessions,
      steps,
      findings: findings.map((f) => ({
        signature: f.signature,
        kind: f.kind as Finding["kind"],
        severity: f.severity as Finding["severity"],
        confidence: f.confidence as Finding["confidence"],
        title: f.title,
        detail: f.detail,
        pagePath: f.pagePath,
        hitBy: f.hitBy,
        visitors: f.visitors,
        evidence: f.evidence as Finding["evidence"],
        ...(f.sandboxCause ? { sandboxCause: f.sandboxCause } : {}),
      })),
      sideEffects: sideEffects.map(({ outcome, rule, channel, host, url, recipient, summary, at }) => ({ outcome, rule, channel, host, url, recipient, summary, at })),
    };
  }
}
