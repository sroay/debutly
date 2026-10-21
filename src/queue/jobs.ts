import { Redis } from "ioredis";
import type { ModelPrice } from "../llm/meter";
import type { Persona } from "../types";

export const AGENT_QUEUE = "debutly-agent-sessions";

/**
 * One agent session to run on a worker. No secrets: workers take the LLM key, database and
 * artifact credentials from their own environment.
 */
export interface AgentJob {
  runId: string;
  targetUrl: string;
  persona: Persona;
  goal: string;
  brief?: string;
  maxSteps: number;
  caps?: { maxTokens?: number; maxMs?: number };
  price?: ModelPrice | null;
  /** The run's test inbox (Mailpit), for magic links and invites. */
  mailpitUrl?: string;
  emailDomain: string;
  /** Keeps agent email addresses the same whichever worker runs them. */
  runTag: string;
}

/** A Redis client for BullMQ (it needs one it can block on: no request retry limit). */
export const redisClient = (url: string) => new Redis(url, { maxRetriesPerRequest: null });
