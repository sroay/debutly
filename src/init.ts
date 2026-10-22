// `debutly init`: a few questions, then a debutly.json (and, if wanted, a weekly GitHub workflow)
// so that `npx debutly` alone runs the agents.
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { CONFIG_FILE, type DebutlyConfig } from "./config";
import { looksLikeProduction } from "./doctor";

export const GOALS = [
  "Sign up and get to the main screen",
  "Sign up, choose a plan and pay (test mode)",
  "Sign up and invite a teammate",
] as const;

/** Customers who invite teammates are teams: an owner signs up, teammates accept by email. */
export const teamGoal = (goal: string) => /\b(invite|teammate|team|colleague|workspace|seat)s?\b/i.test(goal);

export interface Answers {
  url: string;
  goal: string;
  icp: string;
  team: boolean;
  mailpit?: string;
}

export function buildConfig(a: Answers): DebutlyConfig {
  return {
    $schema: "https://debutly.dev/schema.json",
    url: a.url,
    goal: a.goal,
    icp: a.icp,
    ...(a.team ? { unit: "business", employees: 2 } : {}),
    tier: "quick",
    maxCost: 1,
    ...(a.mailpit ? { mailpit: a.mailpit } : {}),
  };
}

/** How the workflow starts the app, guessed from its package.json scripts. */
export function startCommand(scripts: Record<string, string> | undefined, url: string): string[] {
  const port = new URL(url).port || "3000";
  if (scripts?.build && scripts?.start) return ["npm ci", "npm run build", `PORT=${port} npm start &`];
  if (scripts?.dev) return ["npm ci", `PORT=${port} npm run dev &`];
  return ["# Start a test copy of your app here"];
}

export function workflowYaml(start: string[]): string {
  return [
    "# Debutly's AI agents use a test copy of your app like new customers, every Monday.",
    "# Settings are in debutly.json. Add your model key as the repository secret DEBUTLY_API_KEY.",
    "name: debutly",
    "on:",
    '  schedule: [{ cron: "0 4 * * 1" }]',
    "  workflow_dispatch:",
    "jobs:",
    "  agents:",
    "    runs-on: ubuntu-latest",
    "    timeout-minutes: 45",
    "    steps:",
    "      - uses: actions/checkout@v4",
    "      # Starts your app for the agents. Adjust it if the app needs a database or test keys.",
    "      - run: |",
    ...start.map((line) => `          ${line}`),
    "      - uses: sroay/debutly@v0",
    "        with:",
    "          api-key: ${{ secrets.DEBUTLY_API_KEY }}",
    "",
  ].join("\n");
}

/** Adds the lines .gitignore lacks: the key file and Debutly's local reports. */
export function ignoreLines(current: string): string[] {
  const have = new Set(current.split(/\r?\n/).map((l) => l.trim()));
  return [".env", ".debutly/"].filter((l) => !have.has(l) && !have.has(`/${l}`));
}

const visibleText = (html: string) =>
  html
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 4000);

/** One sentence on who the app is for, read off its home page by the judge model. */
async function guessCustomers(url: string): Promise<string | undefined> {
  if (!process.env.DEBUTLY_API_KEY) return undefined;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    const text = visibleText(await res.text());
    if (text.length < 80) return undefined;
    const { createLlms } = await import("./llm/factory");
    const { judge } = createLlms(process.env);
    const reply = await judge.complete({
      system: "You describe a product's ideal customers in one plain sentence, under 20 words, like: Owners of small marketing agencies, 2 to 15 people.",
      messages: [{ role: "user", content: `Who are the ideal customers of this product? Its home page says:\n\n${text}` }],
      maxTokens: 200,
    });
    return reply.replace(/\s+/g, " ").trim().replace(/^["']|["']$/g, "") || undefined;
  } catch {
    return undefined;
  }
}

export async function init(cwd: string = process.cwd()): Promise<number> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  // Lines are buffered, so answers piped in by a script aren't lost between questions; at the end
  // of the input every question takes its default.
  const lines = rl[Symbol.asyncIterator]();
  const ask = async (question: string, fallback = "") => {
    process.stdout.write(fallback ? `${question} [${fallback}] ` : `${question} `);
    const { value, done } = await lines.next();
    if (done || !process.stdin.isTTY) process.stdout.write("\n");
    return (done ? "" : String(value).trim()) || fallback;
  };
  try {
    console.log("Debutly sends AI agents through a test copy of your app, like your first customers.\n");
    if (existsSync(join(cwd, CONFIG_FILE)) && !/^y/i.test(await ask(`${CONFIG_FILE} exists. Replace it? (y/N)`, "N"))) return 0;

    const url = await ask("Where is the test copy of your app running?", "http://localhost:3000");
    if (looksLikeProduction(url)) {
      console.log("  Careful: agents create accounts, submit forms and pay in test mode. Use a local, staging or throwaway copy, never production.");
    }

    console.log("\nWhat should the agents try to do?");
    GOALS.forEach((g, i) => console.log(`  ${i + 1}. ${g}`));
    console.log("  4. Something else");
    const pick = await ask("Choose 1-4:", "1");
    const goal = GOALS[Number(pick) - 1] ?? (await ask("Describe it in a sentence:"));

    const guess = await guessCustomers(url);
    const icp = await ask("\nWho are your customers? One sentence, e.g. who they are and how big.", guess);
    if (!icp) {
      console.log("Debutly needs to know who the customers are; run init again when you know.");
      return 1;
    }
    const team = /^y/i.test(await ask("Do they use it as a team, inviting teammates? (y/N)", teamGoal(goal) ? "y" : "N"));
    const mailpit =
      (await ask(
        "If sign-up sends a confirmation email: the address of a local mail catcher (Mailpit, e.g. from `supabase start`), or Enter to skip.",
        team ? "http://127.0.0.1:54324" : "",
      )) || undefined;

    const config = buildConfig({ url, goal, icp, team, mailpit });
    writeFileSync(join(cwd, CONFIG_FILE), `${JSON.stringify(config, null, 2)}\n`);
    console.log(`\nWrote ${CONFIG_FILE}.`);

    const gitignore = join(cwd, ".gitignore");
    if (existsSync(join(cwd, ".git")) || existsSync(gitignore)) {
      const add = ignoreLines(existsSync(gitignore) ? readFileSync(gitignore, "utf8") : "");
      if (add.length) {
        appendFileSync(gitignore, `\n# Debutly: your model key, and local reports\n${add.join("\n")}\n`);
        console.log(`Added ${add.join(" and ")} to .gitignore.`);
      }
    }

    if (/^y/i.test(await ask("\nAdd a GitHub Actions workflow that runs the agents every Monday? (y/N)", "N"))) {
      const path = join(cwd, ".github", "workflows", "debutly.yml");
      if (existsSync(path)) console.log(".github/workflows/debutly.yml exists; left as it is.");
      else {
        let scripts: Record<string, string> | undefined;
        try {
          scripts = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8")).scripts;
        } catch {
          // not a Node app, or no package.json: the workflow says where to start the app
        }
        mkdirSync(join(cwd, ".github", "workflows"), { recursive: true });
        writeFileSync(path, workflowYaml(startCommand(scripts, url)));
        console.log("Wrote .github/workflows/debutly.yml. Add the repository secret DEBUTLY_API_KEY (Settings → Secrets and variables → Actions).");
      }
    }

    console.log(
      process.env.DEBUTLY_API_KEY
        ? "\nNext: npx debutly doctor, then npx debutly"
        : "\nNext: create a key at https://openrouter.ai/keys, put DEBUTLY_API_KEY=… in .env here, then run npx debutly doctor and npx debutly",
    );
    return 0;
  } finally {
    rl.close();
  }
}
