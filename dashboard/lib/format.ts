// How the dashboard words and formats things.

/** "acme" → "Acme"; short names read as initials: "crm" → "CRM". */
export function appLabel(app: string): string {
  if (app.length <= 3) return app.toUpperCase();
  return app.charAt(0).toUpperCase() + app.slice(1);
}

export function money(usd: number | null | undefined): string {
  if (usd == null) return "—";
  if (usd === 0) return "$0";
  return usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`;
}

const OUTCOMES: Record<string, string> = {
  success: "Finished",
  gave_up: "Gave up",
  budget_exhausted: "Ran out of steps",
  error: "Engine error",
  not_invited: "Never invited",
  cancelled: "Cancelled",
  running: "Running",
};
export const outcomeLabel = (o: string | null | undefined) => OUTCOMES[o ?? "running"] ?? o ?? "Running";
export const outcomeTone = (o: string | null | undefined) =>
  o === "success" ? "good" : o === "gave_up" || o === "budget_exhausted" ? "warn" : o === "error" || o === "not_invited" ? "bad" : "";

const NEEDS: Record<string, string> = {
  screen_reader: "Screen reader",
  low_vision: "Low vision (zoomed)",
  slow_connection: "Slow connection",
  non_native_english: "Non-native English",
};
export const needLabel = (n: string | null | undefined) => (n ? (NEEDS[n] ?? n) : null);

const TRIGGERS: Record<string, string> = { nightly: "Nightly", pr: "Pull request", manual: "Manual", local: "Local", push: "Push" };
export const triggerLabel = (t: string | null | undefined) => (t ? (TRIGGERS[t] ?? t) : "—");

/** Where to load a step's screenshot from: the database through our API, or a storage URL as is. */
export function screenshotSrc(ref: string | null | undefined): string | null {
  if (!ref) return null;
  if (ref.startsWith("db:")) return `/api/screenshots/${ref.slice(3)}`;
  return /^https?:\/\//.test(ref) ? ref : null;
}

export function pathOf(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return url;
  }
}

/** Share of agents who finished, as a tone for a trend bar. */
export function successTone(succeeded: number, agents: number): "good" | "warn" | "bad" | "" {
  if (!agents) return "";
  const r = succeeded / agents;
  return r >= 0.8 ? "good" : r >= 0.5 ? "warn" : "bad";
}
