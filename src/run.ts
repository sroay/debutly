import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";
import { LocalArtifactStore, type ArtifactStore } from "./artifacts/store";
import { runAgentSession } from "./agent/run-agent";
import { runUnit, type RunAgent } from "./crew/run-unit";
import { detectFindings } from "./detect/findings";
import type { Inbox } from "./inbox/types";
import type { LlmClient } from "./llm/types";
import { PEOPLE_FILE } from "./persona/people";
import { renderReport } from "./report/markdown";
import type { ModelPrice } from "./llm/meter";
import { blockedCalls, type SandboxOutbox } from "./sandbox/outbox";
import type { NewRun, RunStore, RunUsage, SideEffect } from "./store/run-store";
import type { CustomerUnit, Finding, Persona, Session } from "./types";
import { mapWithConcurrency } from "./util/pool";

export interface SimulationOptions {
  url: string;
  goal: string;
  /** Individuals and/or business crews; crews run owner first, then invited employees. */
  units: CustomerUnit[];
  llm: LlmClient;
  maxSteps: number;
  /** How many units run at once. */
  concurrency: number;
  outDir: string;
  /** Gives each agent its own email address and lets it read mail (magic links, invites). */
  inbox?: Inbox;
  emailDomain?: string;
  /** The app's sandbox outbox, to tell failures the test environment caused from real ones. */
  sandboxOutbox?: SandboxOutbox;
  /** Where screenshots go; defaults to <outDir>/screenshots. */
  artifacts?: ArtifactStore;
  /** Records the run as it happens (and provides its kill switch). */
  store?: RunStore;
  /** An existing run to record into (e.g. one queued by an API); otherwise one is created. */
  runId?: string;
  /** What to record about the run when creating it. */
  run?: Omit<NewRun, "targetUrl" | "goal">;
  /** Per-agent limits. */
  caps?: { maxTokens?: number; maxMs?: number };
  /** The nav model's price, to cost each session. */
  price?: ModelPrice | null;
  /** In-memory kill switch when there is no store (e.g. Ctrl+C). */
  shouldStop?: () => boolean | Promise<boolean>;
  /** Where to keep each agent's browser state (cookies, storage) at the end, for `debutly hear`. */
  browserStateDir?: string;
  /** Sends each agent somewhere else to run (e.g. a queue of workers) instead of this process. */
  dispatch?: (ctx: { runId?: string; runTag: string }) => RunAgent;
}

export const asIndividuals = (personas: Persona[]): CustomerUnit[] => personas.map((p) => ({ kind: "individual", id: p.id, person: p }));

export function agentEmail(persona: Pick<Persona, "id" | "name">, runTag: string, domain: string): string {
  const slug = persona.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug || "agent"}.${persona.id}.${runTag}@${domain}`;
}

export interface SimulationResult {
  runId?: string;
  sessions: Session[];
  findings: Finding[];
  reportPath: string;
  usage: RunUsage;
}

/** Sums sessions' usage; the cost is known only if every session's is. */
export function runUsage(sessions: Session[]): RunUsage {
  const costs = sessions.filter((s) => s.usage).map((s) => s.usage!.costUsd);
  return {
    inputTokens: sessions.reduce((n, s) => n + (s.usage?.inputTokens ?? 0), 0),
    outputTokens: sessions.reduce((n, s) => n + (s.usage?.outputTokens ?? 0), 0),
    costUsd: costs.length && costs.every((c) => c !== undefined) ? costs.reduce((a, c) => a + (c ?? 0), 0) : undefined,
  };
}

export async function runSimulation(o: SimulationOptions): Promise<SimulationResult> {
  await mkdir(o.outDir, { recursive: true });
  const artifacts = o.artifacts ?? new LocalArtifactStore(join(o.outDir, "screenshots"));
  const origin = new URL(o.url).origin;
  const started = new Date();
  const runTag = started.getTime().toString(36);
  const emailOf = (p: Persona) => agentEmail(p, runTag, o.emailDomain ?? "agents.test");
  const { store } = o;
  const runId = store ? (o.runId ?? (await store.createRun({ targetUrl: o.url, goal: o.goal, ...o.run }))) : o.runId;
  if (store && runId) await store.recordUnits(runId, o.units);
  // The run kill switch: the store's (so another process can cancel) or the caller's.
  const shouldStop = store && runId ? () => store.isCancelled(runId) : o.shouldStop;
  // Queue mode: workers run the agents (and record them); otherwise they run here.
  const browser = o.dispatch ? undefined : await chromium.launch();
  try {
    const runAgent: RunAgent = o.dispatch
      ? o.dispatch({ runId, runTag })
      : (persona, goal, brief) =>
          runAgentSession(
            { browser: browser!, llm: o.llm, origin, maxSteps: o.maxSteps, artifacts, emailOf, inbox: o.inbox, caps: o.caps, price: o.price, shouldStop, store, runId, browserStateDir: o.browserStateDir },
            persona,
            goal,
            brief,
          );
    const perUnit = await mapWithConcurrency(o.units, o.concurrency, (unit) => runUnit(unit, o.goal, { runAgent, emailOf, inbox: o.inbox }));
    const sessions = perUnit.flat();
    // Teammates who were never invited never ran; record them too.
    if (store && runId) for (const s of sessions.filter((x) => x.outcome === "not_invited")) await store.finishSession(runId, s);

    let sideEffects: SideEffect[] = [];
    if (o.sandboxOutbox) {
      try {
        sideEffects = await o.sandboxOutbox.entriesSince(started);
      } catch (err) {
        console.warn(`Could not read the sandbox outbox, so failures are not checked against it: ${err instanceof Error ? err.message : err}`);
      }
    }
    const findings = detectFindings(sessions, { blocked: blockedCalls(sideEffects), sandbox: !!o.sandboxOutbox });
    const usage = runUsage(sessions);
    const reportMd = renderReport({ targetUrl: o.url, goal: o.goal, sessions, findings, units: o.units, usage, model: o.run?.model });
    const reportPath = join(o.outDir, "report.md");
    await writeFile(join(o.outDir, "sessions.json"), JSON.stringify(sessions, null, 2));
    await writeFile(join(o.outDir, "findings.json"), JSON.stringify(findings, null, 2));
    await writeFile(join(o.outDir, PEOPLE_FILE), JSON.stringify(o.units, null, 2));
    await writeFile(reportPath, reportMd);
    if (store && runId) {
      const status = sessions.some((s) => s.outcome === "cancelled") ? "cancelled" : "finished";
      await store.finishRun(runId, { status, findings, reportMd, usage, sideEffects });
    }
    return { runId, sessions, findings, reportPath, usage };
  } catch (err) {
    if (store && runId) {
      await store
        .finishRun(runId, { status: "failed", findings: [], reportMd: `Run failed: ${err instanceof Error ? err.message : err}`, usage: { inputTokens: 0, outputTokens: 0 }, sideEffects: [] })
        .catch(() => {});
    }
    throw err;
  } finally {
    await browser?.close();
  }
}
