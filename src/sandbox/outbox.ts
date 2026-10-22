import type { SideEffect } from "../store/run-store";

/** An outbound call the app under test tried to make and its sandbox refused. */
export interface BlockedCall {
  host: string;
  url: string;
  /** When the sandbox blocked it (epoch ms). */
  at: number;
}

export interface SandboxOutbox {
  /** Everything the sandbox faked or blocked since `since`: the run's side effects. */
  entriesSince(since: Date): Promise<SideEffect[]>;
}

// Calls a failure can come from: ones the sandbox refused, and AI calls it answered with a stand-in
// (an app's AI proxy failed on the stand-in answers, 2026-10-16 to 18). A faked email is not
// one: the app is told it was sent.
export const blockedCalls = (entries: SideEffect[]): BlockedCall[] =>
  entries
    .filter((e) => e.outcome === "blocked" || (e.outcome === "faked" && e.channel === "ai"))
    .map((e) => ({ host: e.host, url: e.url, at: e.at.getTime() }));

interface OutboxEntry {
  outcome?: string;
  rule?: string | null;
  channel?: string;
  host?: string;
  url?: string;
  recipient?: string | null;
  summary?: string | null;
  created_at?: string;
}

/**
 * Reads a throwaway environment's sandbox outbox (GET <url>?since=…, bearer token),
 * the record every Debutly sandbox keeps of what it faked or blocked.
 */
export class HttpSandboxOutbox implements SandboxOutbox {
  constructor(
    private readonly url: string,
    private readonly token: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async entriesSince(since: Date): Promise<SideEffect[]> {
    const res = await this.fetchFn(`${this.url}?since=${encodeURIComponent(since.toISOString())}`, {
      headers: { authorization: `Bearer ${this.token}` },
    });
    if (!res.ok) throw new Error(`sandbox outbox: HTTP ${res.status}`);
    const { entries = [] } = (await res.json()) as { entries?: OutboxEntry[] };
    return entries
      .filter((e) => e.outcome && e.host && e.created_at)
      .map((e) => ({
        outcome: e.outcome!,
        rule: e.rule ?? null,
        channel: e.channel ?? "unknown",
        host: e.host!,
        url: e.url ?? "",
        recipient: e.recipient ?? null,
        summary: e.summary ?? null,
        at: new Date(e.created_at!),
      }));
  }
}
