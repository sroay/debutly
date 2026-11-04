import type { Page, Response } from "playwright";
import type { Signal } from "../types";

const BODY_CHARS = 500;
/** How long a step waits for server-error bodies still being read before it is stored without them. */
const BODY_WAIT_MS = 2000;
/** Replies longer than this are not read for an error: a data download is not a reply that failed. */
const REPLY_MAX_BYTES = 256 * 1024;
/** Requests the app makes itself, whose JSON reply is how it tells the page what happened. */
const APP_REQUESTS = new Set(["fetch", "xhr"]);
const MESSAGE_CHARS = 200;

/**
 * The error a GraphQL reply carries when it has no result: "errors" with no "data". A reply that
 * has a result as well is the app working around one failed field, so it is not an error here.
 */
export function apiErrorIn(body: string): string | undefined {
  let reply: unknown;
  try {
    reply = JSON.parse(body);
  } catch {
    return undefined;
  }
  if (!reply || typeof reply !== "object" || Array.isArray(reply)) return undefined;
  const { errors, data } = reply as { errors?: unknown; data?: unknown };
  if (!Array.isArray(errors) || !errors.length || (data !== undefined && data !== null)) return undefined;
  const first = errors[0] as { message?: unknown } | null;
  const message = typeof first?.message === "string" ? first.message.replace(/\s+/g, " ").trim() : "";
  return message ? message.slice(0, MESSAGE_CHARS) : undefined;
}

export class SignalCollector {
  private buffer: Signal[] = [];
  private reading = new Set<Promise<void>>();

  constructor(page: Page) {
    page.on("console", (msg) => {
      if (msg.type() === "error") this.buffer.push({ kind: "console_error", message: msg.text(), url: page.url() });
    });
    page.on("pageerror", (err) => {
      this.buffer.push({ kind: "page_error", message: err.message, url: page.url() });
    });
    page.on("response", (res) => {
      if (res.status() < 400) {
        this.readApiReply(page, res);
        return;
      }
      // A failed navigation belongs to the page that was requested, not the one being left.
      const url = res.request().isNavigationRequest() ? res.url() : page.url();
      const startedAt = res.request().timing().startTime;
      const signal: Signal = { kind: "http_error", status: res.status(), requestUrl: res.url(), url, startedAt: startedAt > 0 ? startedAt : undefined, at: Date.now() };
      this.buffer.push(signal);
      // A server error often says why (e.g. "No API key found"). Read the start of it; it lands on
      // the same signal object, which findings read once the run is over.
      if (res.status() >= 500) {
        const read = res
          .text()
          .then((text) => {
            if (signal.kind === "http_error") signal.body = text.slice(0, BODY_CHARS);
          })
          .catch(() => {})
          .finally(() => this.reading.delete(read));
        this.reading.add(read);
      }
    });
    // Generating a report often only downloads a file; without this the agent saw "nothing
    // visibly changed" and concluded the button was broken.
    page.on("download", (download) => {
      this.buffer.push({ kind: "download", filename: download.suggestedFilename(), url: page.url() });
    });
    // Playwright dismisses dialogs by default, so every confirm() would read as Cancel. Answer OK,
    // as a person going along with the app would, and let the agent know what it asked.
    page.on("dialog", (dialog) => {
      this.buffer.push({ kind: "dialog", dialogType: dialog.type(), message: dialog.message(), url: page.url() });
      dialog.accept().catch(() => {});
    });
  }

  /** Reads an app's JSON reply for an error that a 200 status hides, and records it. */
  private readApiReply(page: Page, res: Response): void {
    const request = res.request();
    if (!APP_REQUESTS.has(request.resourceType())) return;
    const type = res.headers()["content-type"] ?? "";
    const length = Number(res.headers()["content-length"] ?? 0);
    if (!type.includes("json") || length > REPLY_MAX_BYTES) return;
    const url = page.url();
    const read = res
      .text()
      .then((text) => {
        if (text.length > REPLY_MAX_BYTES) return;
        const message = apiErrorIn(text);
        if (message) this.buffer.push({ kind: "api_error", message, requestUrl: res.url(), url });
      })
      .catch(() => {}) // a reply the page dropped before it was read
      .finally(() => this.reading.delete(read));
    this.reading.add(read);
  }

  /** A signal the agent loop observed itself, such as a slow page. */
  note(signal: Signal): void {
    this.buffer.push(signal);
  }

  /**
   * Waits, briefly, for the server-error bodies still being read. A step is stored as soon as it
   * ends; a fast 502 was stored without the body that said why it failed (2026-10-17).
   */
  async settle(): Promise<void> {
    if (!this.reading.size) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([Promise.allSettled([...this.reading]), new Promise((r) => (timer = setTimeout(r, BODY_WAIT_MS)))]);
    clearTimeout(timer);
  }

  drain(): Signal[] {
    const out = this.buffer;
    this.buffer = [];
    return out;
  }
}
