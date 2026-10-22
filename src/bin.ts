// The `debutly` command: `npx debutly init` once, then `npx debutly` runs the agents.
import "./util/load-env";
import "./util/legacy-env";
import "./util/key-defaults";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIG_FILE, configArgs, readConfig } from "./config";
import { OutOfCreditsError } from "./llm/types";

const HELP = `Debutly: AI agents use a test copy of your app like your first customers, and report what breaks.

Usage: npx debutly [command] [flags]

  init         a few questions, then a ${CONFIG_FILE} (and, if you want, a weekly GitHub workflow)
  run          the agents, with the settings in ${CONFIG_FILE} (the default command)
  doctor       checks the key, the browser, the config and that the app answers
  perceive     skeptical-buyer evaluators judge your pages, variants or an idea
  worker       an agent worker for queued runs
  cancel       stops a run: cancel <run id> --store <url>
  import       loads earlier runs from GitHub Actions report artifacts
  predictions  records real outcomes and shows prediction accuracy
  costs        your OpenRouter key's spend and each app's latest run

Flags override ${CONFIG_FILE}, e.g. npx debutly --tier standard --max-cost 3
The model key is read from DEBUTLY_API_KEY (or OPENROUTER_API_KEY, ANTHROPIC_API_KEY), and from a .env file here.
Docs: https://debutly.dev/docs`;

const [first, ...rest] = process.argv.slice(2);
const flagsOnly = !first || (first.startsWith("-") && !["--help", "-h", "--version", "-v"].includes(first));
const command = flagsOnly ? "run" : first;
const args = flagsOnly ? process.argv.slice(2) : rest;

// The other entry points read their own flags from process.argv, as if run directly.
const handOver = (entry: string, argv: string[]) => {
  process.argv = [process.argv[0], fileURLToPath(new URL(entry, import.meta.url)), ...argv];
};

async function run(): Promise<void> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(HELP);
    return;
  }
  let config;
  try {
    config = readConfig();
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
  if (!config && !args.includes("--url")) {
    console.error(`No ${CONFIG_FILE} here. Set one up with: npx debutly init\n(or pass --url, --goal and --icp)`);
    process.exit(1);
  }
  let argv: string[];
  try {
    argv = [...(config ? configArgs(config) : []), ...args];
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
  if (process.env.DEBUTLY_STORE_URL && !argv.includes("--store")) argv.push("--store", process.env.DEBUTLY_STORE_URL);
  if (!argv.includes("--out")) argv.push("--out", join(".debutly", "runs", new Date().toISOString().replace(/[:.]/g, "-")));

  const { chromiumInstalled, installChromium } = await import("./util/chromium");
  if (!chromiumInstalled()) {
    console.log("Downloading Chromium for the agents (once per machine, about 150 MB)...");
    if (!installChromium()) {
      console.error("Couldn't download Chromium. Try: npx playwright install chromium");
      process.exit(1);
    }
  }
  handOver("./cli.ts", argv);
  await import("./cli");
}

try {
  switch (command) {
    case "run":
      await run();
      break;
    case "init": {
      const { init } = await import("./init");
      process.exitCode = await init();
      break;
    }
    case "doctor": {
      const { doctor } = await import("./doctor");
      process.exitCode = await doctor();
      break;
    }
    case "perceive":
      handOver("./perceive.ts", args);
      await import("./perceive");
      break;
    case "worker":
      handOver("./worker.ts", args);
      await import("./worker");
      break;
    case "cancel":
      handOver("./cancel.ts", args);
      await import("./cancel");
      break;
    case "import":
      handOver("./import.ts", args);
      await import("./import");
      break;
    case "predictions":
      handOver("./predictions.ts", args);
      await import("./predictions");
      break;
    case "costs":
      handOver("./costs.ts", args);
      await import("./costs");
      break;
    case "help":
    case "--help":
    case "-h":
      console.log(HELP);
      break;
    case "version":
    case "--version":
    case "-v":
      console.log(createRequire(import.meta.url)("../package.json").version);
      break;
    default:
      console.error(`Unknown command "${command}".\n\n${HELP}`);
      process.exitCode = 1;
  }
} catch (err) {
  // A known dead end gets its fix, not a stack trace.
  if (!(err instanceof OutOfCreditsError)) throw err;
  console.error(`${err.message}\n\nTop up at https://openrouter.ai/settings/credits, or raise the key's limit, then run again.`);
  process.exitCode = 1;
}
