import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { chromium } from "playwright";

/** Is the browser the agents use downloaded yet? */
export function chromiumInstalled(): boolean {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
}

/** Downloads it with Playwright's own installer (about 150 MB, once per machine). */
export function installChromium(): boolean {
  const cli = join(dirname(createRequire(import.meta.url).resolve("playwright/package.json")), "cli.js");
  return spawnSync(process.execPath, [cli, "install", "chromium"], { stdio: "inherit" }).status === 0;
}
