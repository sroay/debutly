// Load a finished run's folder (report.md, sessions.json, findings.json, screenshots/) into the
// store, so runs made without --store (every nightly CI run before the dashboard) can be seen in
// it. Screenshots go into the database as compact JPEGs, like a stored run's.
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { eq } from "drizzle-orm";
import { DbArtifactStore } from "../artifacts/db";
import type { Business, CustomerUnit, Finding, InclusionNeed, Persona, Session } from "../types";
import type { Db } from "./db";
import { PgRunStore } from "./pg-run-store";
import { runs } from "./schema";

export interface ImportOptions {
  app?: string;
  trigger?: string;
  ciUrl?: string;
  /** When the run happened (its CI run's start); the folder's report has no date. */
  at?: Date;
  /** PNG to JPEG, e.g. through a browser; without one, screenshots are left out. */
  toJpeg?: (png: Buffer) => Promise<Buffer>;
}

export interface ReportHeader {
  targetUrl: string;
  goal: string;
  costUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
  businesses: Business[];
}

/** What report.md says about the run that sessions.json doesn't: target, goal, cost, businesses. */
export function parseReportHeader(md: string): ReportHeader {
  const line = (label: string) => md.match(new RegExp(`^${label}: (.*?)\\s*$`, "m"))?.[1];
  const cost = md.match(/^Cost: \$([\d.]+) \(([\d,]+) input \+ ([\d,]+) output tokens\)/m);
  const units = md.match(/## Customer units\n\n([\s\S]*?)\n\n## /)?.[1] ?? "";
  const businesses = [...units.matchAll(/^- \*\*(.+?)\*\* \((.+?), ~(\d+) people, \$(\d+)\/mo\)/gm)].map(
    ([, name, archetype, size, budget]) => ({ name, archetype, size: Number(size), monthlyBudget: Number(budget), goal: "" }),
  );
  const num = (s?: string) => (s ? Number(s.replace(/,/g, "")) : undefined);
  return {
    targetUrl: line("Target") ?? "",
    goal: line("Goal") ?? "",
    costUsd: cost ? Number(cost[1]) : undefined,
    inputTokens: num(cost?.[2]),
    outputTokens: num(cost?.[3]),
    businesses,
  };
}

/** The customer units the sessions belong to: a business per unit id (u1, u2…), else one person each. */
export function unitsFromSessions(sessions: Session[], businesses: Business[]): CustomerUnit[] {
  const persona = (s: Session): Persona => ({
    id: s.agentId,
    name: s.personaName,
    background: "",
    goal: s.goal,
    patience: "medium",
    techSavvy: "medium",
    ...(s.role ? { role: s.role } : {}),
    ...(s.inclusion ? { inclusion: s.inclusion as InclusionNeed } : {}),
  });
  const byUnit = new Map<string, Session[]>();
  for (const s of sessions) {
    const unit = s.unitId ?? s.agentId;
    byUnit.set(unit, [...(byUnit.get(unit) ?? []), s]);
  }
  return [...byUnit.entries()].map(([id, members], i): CustomerUnit => {
    const owner = members.find((m) => m.agentId.endsWith("-o"));
    if (!owner) return { kind: "individual", id, person: persona(members[0]) };
    return {
      kind: "business",
      id,
      business: businesses[i] ?? { name: id, archetype: "", size: members.length, monthlyBudget: 0, goal: "" },
      owner: persona(owner),
      employees: members.filter((m) => m !== owner).map(persona),
    };
  });
}

/** Import one run folder; returns the new run's id. */
export async function importRunFolder(db: Db, dir: string, o: ImportOptions = {}): Promise<string> {
  const read = (name: string) => readFile(join(dir, name), "utf8");
  const header = parseReportHeader(await read("report.md"));
  const sessions = JSON.parse(await read("sessions.json")) as Session[];
  const findings = JSON.parse(await read("findings.json")) as Finding[];
  const reportMd = await read("report.md");

  const store = new PgRunStore(db);
  const runId = await store.createRun({ app: o.app, trigger: o.trigger, ciUrl: o.ciUrl, targetUrl: header.targetUrl, goal: header.goal });
  await store.recordUnits(runId, unitsFromSessions(sessions, header.businesses));

  const shots = new DbArtifactStore(db, runId);
  for (const s of sessions) {
    await store.startSession(runId, s.agentId, s.goal);
    for (const step of s.steps) {
      let screenshotPath: string | undefined;
      const file = step.screenshotPath ? join(dir, "screenshots", basename(step.screenshotPath)) : undefined;
      if (file && o.toJpeg && existsSync(file)) {
        screenshotPath = await shots.put(basename(file).replace(/\.png$/i, ".jpg"), await o.toJpeg(await readFile(file)), "image/jpeg");
      }
      await store.appendStep(runId, s.agentId, { ...step, screenshotPath });
    }
    await store.finishSession(runId, s);
  }

  const usage = {
    inputTokens: header.inputTokens ?? sessions.reduce((n, s) => n + (s.usage?.inputTokens ?? 0), 0),
    outputTokens: header.outputTokens ?? sessions.reduce((n, s) => n + (s.usage?.outputTokens ?? 0), 0),
    costUsd: header.costUsd,
  };
  await store.finishRun(runId, { status: "finished", findings, reportMd, usage, sideEffects: [] });
  if (o.at) await db.update(runs).set({ createdAt: o.at, startedAt: o.at, finishedAt: o.at }).where(eq(runs.id, runId));
  return runId;
}
