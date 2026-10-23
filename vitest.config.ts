import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  // rehearsals/ holds Playwright checks that run under a screen reader on Windows, not here.
  test: { testTimeout: 60_000, hookTimeout: 60_000, exclude: [...configDefaults.exclude, "rehearsals/**"] },
});
