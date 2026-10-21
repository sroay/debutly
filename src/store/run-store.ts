import type { CustomerUnit, Finding, Session, Step } from "../types";

export interface NewRun {
  /** Which app is under test, e.g. "acme". */
  app?: string;
  /** nightly | pr | manual | local */
  trigger?: string;
  /** The CI run behind this one, e.g. its GitHub Actions page. */
  ciUrl?: string;
  targetUrl: string;
  goal: string;
  icp?: string;
  tier?: string;
  unitKind?: string;
  model?: string;
  estimate?: { low: number; high: number } | null;
}

export interface RunUsage {
  inputTokens: number;
  outputTokens: number;
  costUsd?: number;
}

/** Something the app under test tried to send or reach, from its sandbox outbox. */
export interface SideEffect {
  outcome: string;
  rule: string | null;
  channel: string;
  host: string;
  url: string;
  recipient: string | null;
  summary: string | null;
  at: Date;
}

export interface StoredRun {
  id: string;
  app: string | null;
  trigger: string | null;
  ciUrl: string | null;
  targetUrl: string;
  goal: string;
  tier: string | null;
  status: string;
  model: string | null;
  estimateLowUsd: number | null;
  estimateHighUsd: number | null;
  costUsd: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  reportMd: string | null;
  createdAt: Date;
  finishedAt: Date | null;
  units: { id: string; kind: string; business: unknown }[];
  agents: { id: string; unitId: string; name: string; role: string | null; inclusion: string | null }[];
  sessions: { agentId: string; goal: string; outcome: string | null; outcomeNote: string | null; inputTokens: number | null; outputTokens: number | null; costUsd: number | null }[];
  steps: { agentId: string; index: number; url: string; action: unknown; reasoning: string | null; error: string | null; blocked: string | null; screenshotUrl: string | null }[];
  findings: (Finding & { sandboxCause?: string[] })[];
  sideEffects: SideEffect[];
}

/** Records a run while it happens, so it can be watched live (M5), compared and audited. */
export interface RunStore {
  createRun(r: NewRun): Promise<string>;
  recordUnits(runId: string, units: CustomerUnit[]): Promise<void>;
  startSession(runId: string, agentId: string, goal: string): Promise<void>;
  appendStep(runId: string, agentId: string, step: Step): Promise<void>;
  finishSession(runId: string, session: Session): Promise<void>;
  finishRun(
    runId: string,
    r: { status: "finished" | "failed" | "cancelled"; findings: Finding[]; reportMd: string; usage: RunUsage; sideEffects: SideEffect[] },
  ): Promise<void>;
  /** The run kill switch: agents stop at their next step. */
  requestCancel(runId: string): Promise<void>;
  isCancelled(runId: string): Promise<boolean>;
  getRun(runId: string): Promise<StoredRun | null>;
}
