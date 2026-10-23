import type { Browser } from "playwright";
import type { ArtifactStore } from "../artifacts/store";
import type { Inbox } from "../inbox/types";
import type { ModelPrice } from "../llm/meter";
import type { LlmClient } from "../llm/types";
import { openAgentPage } from "../persona/inclusion";
import type { RunStore } from "../store/run-store";
import type { Persona, Session } from "../types";
import { runSession } from "./loop";

export interface AgentRunDeps {
  browser: Browser;
  llm: LlmClient;
  origin: string;
  maxSteps: number;
  artifacts: ArtifactStore;
  emailOf: (persona: Persona) => string;
  inbox?: Inbox;
  caps?: { maxTokens?: number; maxMs?: number };
  price?: ModelPrice | null;
  shouldStop?: () => boolean | Promise<boolean>;
  /** With a store and run id, the session and each step are recorded as they happen. */
  store?: RunStore;
  runId?: string;
}

/**
 * One agent, start to finish, in its own browser context (no shared cookies or login, even
 * inside a crew). Used in-process by runSimulation and by queue workers alike.
 */
export async function runAgentSession(d: AgentRunDeps, persona: Persona, goal: string, brief: string | undefined): Promise<Session> {
  const record = d.store && d.runId ? { store: d.store, runId: d.runId } : undefined;
  const { context, page } = await openAgentPage(d.browser, persona.inclusion);
  if (record) await record.store.startSession(record.runId, persona.id, goal);
  let session: Session;
  try {
    session = await runSession({
      page,
      llm: d.llm,
      persona,
      goal,
      origin: d.origin,
      maxSteps: d.maxSteps,
      artifacts: d.artifacts,
      identity: d.inbox ? { email: d.emailOf(persona) } : undefined,
      inbox: d.inbox,
      brief,
      caps: d.caps,
      price: d.price,
      shouldStop: d.shouldStop,
      onStep: record ? (step) => record.store.appendStep(record.runId, persona.id, step) : undefined,
    });
  } catch (err) {
    session = { agentId: persona.id, personaName: persona.name, goal, steps: [], outcome: "error", outcomeNote: err instanceof Error ? err.message : String(err) };
  } finally {
    await context.close();
  }
  if (record) await record.store.finishSession(record.runId, session);
  return session;
}
