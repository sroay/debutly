import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { expect, it } from "vitest";

const ROOT = resolve(__dirname, "..");
const IMPORT = /^\s*(?:import|export)\b[^"']*?from\s+["']([^"']+)["']/gm;

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    if (d.name === "node_modules" || d.name.startsWith(".")) return [];
    const path = join(dir, d.name);
    return d.isDirectory() ? sources(path) : /\.tsx?$/.test(d.name) ? [path] : [];
  });
}

const resolveFile = (from: string, spec: string) =>
  [".ts", ".tsx", "/index.ts"].map((ext) => resolve(dirname(from), spec) + ext).find((p) => existsSync(p));

// The dashboard deploys on its own, without the engine's browser dependencies, and its build type-
// checks, so even a type-only import of Playwright breaks it. When effect.ts began to import
// prompt.ts, which reaches Playwright through the inclusion briefs, every dashboard deploy failed
// (2026-10-24) while these tests passed.
it("keeps the engine code the dashboard imports free of Playwright", () => {
  const seen = new Set<string>();
  const reachesPlaywright: string[] = [];
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const [, spec] of readFileSync(file, "utf8").matchAll(IMPORT)) {
      if (spec === "playwright" || spec.startsWith("@playwright/")) reachesPlaywright.push(relative(ROOT, file));
      else if (spec.startsWith(".")) {
        const next = resolveFile(file, spec);
        if (next && next.startsWith(join(ROOT, "src"))) visit(next);
      }
    }
  };
  for (const file of sources(join(ROOT, "dashboard"))) {
    for (const [, spec] of readFileSync(file, "utf8").matchAll(IMPORT)) {
      const target = spec.startsWith(".") ? resolveFile(file, spec) : undefined;
      if (target?.startsWith(join(ROOT, "src"))) visit(target);
    }
  }
  expect(seen.size).toBeGreaterThan(0);
  expect(reachesPlaywright).toEqual([]);
});
