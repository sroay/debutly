// One password for the whole dashboard (DASHBOARD_PASSWORD), kept as a signed cookie. Enough
// for a self-hosted, single-owner dashboard; teams and SSO belong to the hosted edition.
import { createHmac, timingSafeEqual } from "node:crypto";

export const AUTH_COOKIE = "debutly_auth";
export const AUTH_MAX_AGE_S = 30 * 24 * 60 * 60;

/** Signing in is needed whenever a password is set; without one, only `next dev` is open. */
export function authMode(): "password" | "open" | "unconfigured" {
  if (process.env.DASHBOARD_PASSWORD) return "password";
  return process.env.NODE_ENV === "development" ? "open" : "unconfigured";
}

/** The cookie value for a signed-in browser: changes whenever the password does. */
export function sessionToken(password = process.env.DASHBOARD_PASSWORD ?? ""): string {
  return createHmac("sha256", password).update("debutly-dashboard-v1").digest("base64url");
}

export function passwordMatches(given: string, password = process.env.DASHBOARD_PASSWORD ?? ""): boolean {
  if (!password) return false;
  const a = Buffer.from(sessionToken(given));
  const b = Buffer.from(sessionToken(password));
  return a.length === b.length && timingSafeEqual(a, b);
}

export function isSignedIn(cookieValue: string | undefined): boolean {
  const mode = authMode();
  if (mode === "open") return true;
  if (mode === "unconfigured" || !cookieValue) return false;
  const a = Buffer.from(cookieValue);
  const b = Buffer.from(sessionToken());
  return a.length === b.length && timingSafeEqual(a, b);
}

const HERE = "http://dashboard.invalid";

/**
 * Where to go after signing in: only a page on this dashboard, never another site. Browsers drop
 * tabs and newlines from an address, so "/<tab>/evil.test" would become "//evil.test"; the value
 * is refused with any control character or backslash, and read as a browser would read it. That
 * reading turns "/.//evil.test" into "//evil.test" as well, so the result is checked too.
 */
export function safeNext(value: FormDataEntryValue | string | null | undefined): string {
  const next = typeof value === "string" ? value : "/";
  if (!next.startsWith("/") || /[\x00-\x1f\x7f\\]/.test(next)) return "/";
  const url = new URL(next, HERE);
  const out = url.pathname + url.search + url.hash;
  return url.origin === HERE && !out.startsWith("//") ? out : "/";
}
