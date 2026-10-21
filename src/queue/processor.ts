import type { Job } from "bullmq";
import type { Browser } from "playwright";
import { runAgentSession } from "../agent/run-agent";
import type { ArtifactStore } from "../artifacts/store";
import type { Inbox } from "../inbox/types";
import type { LlmClient } from "../llm/types";
import { agentEmail } from "../run";
import type { RunStore } from "../store/run-store";
import type { Session } from "../types";
import type { AgentJob } from "./jobs";

export interface ProcessorDeps {
  browser: Browser;
  llm: LlmClient;
  store: RunStore;
  artifactsFor: (runId: string) => ArtifactStore;
  inboxFor: (mailpitUrl: string) => Inbox;
}

/** Runs one queued agent session, recording it to the store, and returns the session. */
export function createAgentProcessor(d: ProcessorDeps): (job: Pick<Job<AgentJob>, "data">) => Promise<Session> {
  return async ({ data: j }) =>
    runAgentSession(
      {
        browser: d.browser,
        llm: d.llm,
        origin: new URL(j.targetUrl).origin,
        maxSteps: j.maxSteps,
        artifacts: d.artifactsFor(j.runId),
        emailOf: (p) => agentEmail(p, j.runTag, j.emailDomain),
        inbox: j.mailpitUrl ? d.inboxFor(j.mailpitUrl) : undefined,
        caps: j.caps,
        price: j.price,
        shouldStop: () => d.store.isCancelled(j.runId),
        store: d.store,
        runId: j.runId,
      },
      j.persona,
      j.goal,
      j.brief,
    );
}
