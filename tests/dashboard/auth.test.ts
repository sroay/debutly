import { afterEach, expect, it, vi } from "vitest";
import { authMode, isSignedIn, passwordMatches, safeNext, sessionToken } from "../../dashboard/lib/auth";

afterEach(() => vi.unstubAllEnvs());

it("signs a browser in with the right password only, in constant time", () => {
  vi.stubEnv("DASHBOARD_PASSWORD", "correct horse");
  expect(authMode()).toBe("password");
  expect(passwordMatches("correct horse")).toBe(true);
  expect(passwordMatches("correct hors")).toBe(false);
  expect(passwordMatches("")).toBe(false);
  expect(isSignedIn(sessionToken())).toBe(true);
  expect(isSignedIn(undefined)).toBe(false);
  expect(isSignedIn("forged")).toBe(false);
});

it("signs everyone out when the password changes", () => {
  vi.stubEnv("DASHBOARD_PASSWORD", "old");
  const cookie = sessionToken();
  vi.stubEnv("DASHBOARD_PASSWORD", "new");
  expect(isSignedIn(cookie)).toBe(false);
});

it("stays shut in production without a password, and open only under next dev", () => {
  vi.stubEnv("DASHBOARD_PASSWORD", "");
  vi.stubEnv("NODE_ENV", "production");
  expect(authMode()).toBe("unconfigured");
  expect(isSignedIn(sessionToken(""))).toBe(false);
  vi.stubEnv("NODE_ENV", "development");
  expect(authMode()).toBe("open");
  expect(isSignedIn(undefined)).toBe(true);
});

it("sends a signed-in browser only to a page on this dashboard, never another site", () => {
  expect(safeNext("/runs/abc?step=2#top")).toBe("/runs/abc?step=2#top");
  expect(safeNext(null)).toBe("/");
  // Browsers drop tabs and newlines from an address, so "/<tab>/evil.test" would become "//evil.test".
  // Reading the path as a browser does turns "/.//evil.test" into "//evil.test" too.
  const evil = ["https://evil.test/", "//evil.test", "/\\evil.test", "/\t/evil.test", "/\n/evil.test", "/\r//evil.test", "/.//evil.test", "/..//evil.test", "/%2e//evil.test", "javascript:alert(1)", "evil.test"];
  for (const next of evil) expect(safeNext(next)).toBe("/");
});
