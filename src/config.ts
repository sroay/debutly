import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Settings for `debutly run`, kept in the app's repo so a run needs no flags. */
export const CONFIG_FILE = "debutly.json";

// What debutly.json may set: the run's flags, camelCased. The store's address is a secret, so it
// comes from DEBUTLY_STORE_URL instead; where reports go and what started a run are per run.
const SETTINGS = [
  "url",
  "goal",
  "icp",
  "unit",
  "tier",
  "agents",
  "employees",
  "maxCost",
  "inclusion",
  "maxSteps",
  "concurrency",
  "mailpit",
  "emailDomain",
  "sandboxOutbox",
  "app",
  "screenshotDays",
  "agentTokenCap",
  "agentMinutes",
  "evaluators",
  "languages",
] as const;

export type Setting = (typeof SETTINGS)[number];
export type DebutlyConfig = Partial<Record<Setting, string | number | boolean>> & { $schema?: string };

const flagOf = (setting: string) => `--${setting.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;

/** The config file in `dir`, or undefined when there is none. */
export function readConfig(dir: string = process.cwd()): DebutlyConfig | undefined {
  const path = join(dir, CONFIG_FILE);
  if (!existsSync(path)) return undefined;
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("it should hold one JSON object");
    return parsed as DebutlyConfig;
  } catch (err) {
    throw new Error(`${CONFIG_FILE} can't be read: ${err instanceof Error ? err.message : err}`);
  }
}

/** The config as command-line flags. Flags given on the command line come after, so they win. */
export function configArgs(config: DebutlyConfig): string[] {
  const args: string[] = [];
  for (const [key, value] of Object.entries(config)) {
    if (key === "$schema" || value === undefined || value === null) continue;
    if (!(SETTINGS as readonly string[]).includes(key)) {
      throw new Error(`${CONFIG_FILE}: "${key}" is not a setting. Settings: ${SETTINGS.join(", ")}.`);
    }
    if (typeof value === "object") throw new Error(`${CONFIG_FILE}: "${key}" should be text or a number.`);
    args.push(flagOf(key), key === "inclusion" && typeof value === "boolean" ? (value ? "on" : "off") : String(value));
  }
  return args;
}
