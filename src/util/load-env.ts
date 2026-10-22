// The debutly command reads a .env file in the folder it runs in, as `node --env-file=.env` does.
// Variables already set win. Imported first, before anything reads a setting.
import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";

const KEYS = ["DEBUTLY_API_KEY", "OPENROUTER_API_KEY", "ANTHROPIC_API_KEY"];
// Where the key is sent. A .env may choose that only along with the key itself: one in a repo
// you cloned must not send the key in your shell to an address of its choosing.
const ENDPOINTS = ["DEBUTLY_BASE_URL", "ANTHROPIC_BASE_URL"];

/** Adds the file's variables to `env`; returns a warning for each one left out. */
export function loadEnv(text: string, env: NodeJS.ProcessEnv = process.env): string[] {
  const file = parseEnv(text);
  const used = KEYS.find((k) => env[k] || file[k]);
  const keyFromFile = used !== undefined && !env[used] && !!file[used];
  const warnings: string[] = [];
  for (const [name, value] of Object.entries(file)) {
    if (env[name] !== undefined) continue;
    if (ENDPOINTS.includes(name) && used && !keyFromFile) {
      warnings.push(`.env here sets ${name}, but your key comes from your environment, so that address is ignored. Put the key in the same .env to use it.`);
      continue;
    }
    env[name] = value;
  }
  return warnings;
}

if (existsSync(".env")) for (const warning of loadEnv(readFileSync(".env", "utf8"))) console.warn(warning);
