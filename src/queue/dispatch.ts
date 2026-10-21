import type { Queue, QueueEvents } from "bullmq";
import type { RunAgent } from "../crew/run-unit";
import type { Session } from "../types";
import type { AgentJob } from "./jobs";

/**
 * A RunAgent that queues the session for a worker and waits for its result. Crew order is
 * unchanged: runUnit still waits for the owner before queuing the employees.
 */
export function queueDispatch(queue: Queue, events: QueueEvents, base: Omit<AgentJob, "persona" | "goal" | "brief">): RunAgent {
  return async (persona, goal, brief) => {
    const job = await queue.add("agent-session", { ...base, persona, goal, brief } satisfies AgentJob, {
      removeOnComplete: 1000,
      removeOnFail: 1000,
    });
    return (await job.waitUntilFinished(events)) as Session;
  };
}
