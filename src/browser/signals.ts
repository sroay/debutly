import type { Page } from "playwright";
import type { Signal } from "../types";

const BODY_CHARS = 500;

export class SignalCollector {
  private buffer: Signal[] = [];

  constructor(page: Page) {
    page.on("console", (msg) => {
      if (msg.type() === "error") this.buffer.push({ kind: "console_error", message: msg.text(), url: page.url() });
    });
    page.on("pageerror", (err) => {
      this.buffer.push({ kind: "page_error", message: err.message, url: page.url() });
    });
    page.on("response", (res) => {
      if (res.status() < 400) return;
      // A failed navigation belongs to the page that was requested, not the one being left.
      const url = res.request().isNavigationRequest() ? res.url() : page.url();
      const startedAt = res.request().timing().startTime;
      const signal: Signal = { kind: "http_error", status: res.status(), requestUrl: res.url(), url, startedAt: startedAt > 0 ? startedAt : undefined, at: Date.now() };
      this.buffer.push(signal);
      // A server error often says why (e.g. "No API key found"). Read the start of it; it lands on
      // the same signal object, which findings read once the run is over.
      if (res.status() >= 500) {
        res
          .text()
          .then((text) => {
            if (signal.kind === "http_error") signal.body = text.slice(0, BODY_CHARS);
          })
          .catch(() => {});
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

  /** A signal the agent loop observed itself, such as a slow page. */
  note(signal: Signal): void {
    this.buffer.push(signal);
  }

  drain(): Signal[] {
    const out = this.buffer;
    this.buffer = [];
    return out;
  }
}
