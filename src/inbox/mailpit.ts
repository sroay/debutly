import type { EmailMessage, Inbox } from "./types";

const MAX_MESSAGES = 3;

const decodeEntities = (s: string) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'");

function extractLinks(text: string, html: string): string[] {
  const fromText = text.match(/https?:\/\/[^\s<>"')]+/g) ?? [];
  const fromHtml = [...html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]);
  return [...new Set([...fromText, ...fromHtml].map(decodeEntities).filter((l) => /^https?:\/\//.test(l)))];
}

/** Reads the local Mailpit mail catcher that `supabase start` runs, used as the agents' inboxes. */
export class MailpitInbox implements Inbox {
  private readonly base: string;

  constructor(
    baseUrl: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {
    this.base = baseUrl.replace(/\/+$/, "");
  }

  async latest(address: string): Promise<EmailMessage[]> {
    const search = await this.fetchFn(`${this.base}/api/v1/search?query=${encodeURIComponent(`to:"${address}"`)}`);
    if (!search.ok) throw new Error(`mailbox search failed: HTTP ${search.status}`);
    const { messages = [] } = (await search.json()) as { messages?: { ID: string }[] };
    const out: EmailMessage[] = [];
    for (const { ID } of messages.slice(0, MAX_MESSAGES)) {
      const res = await this.fetchFn(`${this.base}/api/v1/message/${ID}`);
      if (!res.ok) continue;
      const m = (await res.json()) as { Subject?: string; Text?: string; HTML?: string };
      out.push({ subject: m.Subject ?? "", text: (m.Text ?? "").slice(0, 1500), links: extractLinks(m.Text ?? "", m.HTML ?? "") });
    }
    return out;
  }
}
