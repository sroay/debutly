// Cost meter: what Debutly is spending, in one place.
//
//   npm run debutly:costs -- [--repo owner/name ...]
//
// Shows the OpenRouter key's spend (today, this week, this month, limit left) and, for each app
// repo given, what its latest nightly agent run cost (read from the GitHub run log via `gh`).
import "./util/legacy-env";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parseArgs } from "node:util";

const run = promisify(execFile);

export interface KeySpend {
  today: number;
  week: number;
  month: number;
  total: number;
  limit: number | null;
  remaining: number | null;
  resets: string | null;
}

export async function fetchKeySpend(baseUrl: string, apiKey: string, fetchFn: typeof fetch = fetch): Promise<KeySpend> {
  const res = await fetchFn(`${baseUrl.replace(/\/+$/, "")}/key`, { headers: { authorization: `Bearer ${apiKey}` } });
  if (!res.ok) throw new Error(`OpenRouter key info: HTTP ${res.status}`);
  const { data: d } = (await res.json()) as { data: Record<string, unknown> };
  const n = (k: string) => (typeof d[k] === "number" ? (d[k] as number) : 0);
  return {
    today: n("usage_daily"),
    week: n("usage_weekly"),
    month: n("usage_monthly"),
    total: n("usage"),
    limit: typeof d.limit === "number" ? d.limit : null,
    remaining: typeof d.limit_remaining === "number" ? d.limit_remaining : null,
    resets: typeof d.limit_reset === "string" ? d.limit_reset : null,
  };
}

/** The cost a Debutly run printed at the end ("Done: … cost $0.1234 …"), from a CI log. */
export function costFromLog(log: string): number | null {
  const matches = [...log.matchAll(/Done: [^\n]*?cost \$(\d+(?:\.\d+)?)/g)];
  return matches.length ? Number(matches[matches.length - 1][1]) : null;
}

export interface NightlyCost {
  repo: string;
  when: string;
  costUsd: number | null;
  url: string;
}

async function latestNightly(repo: string): Promise<NightlyCost | null> {
  const { stdout } = await run("gh", ["run", "list", "--repo", repo, "--workflow", "throwaway-env.yml", "--status", "success", "--limit", "5", "--json", "databaseId,createdAt,url,event"]);
  const runs = JSON.parse(stdout) as { databaseId: number; createdAt: string; url: string; event: string }[];
  for (const r of runs) {
    const { stdout: log } = await run("gh", ["run", "view", String(r.databaseId), "--repo", repo, "--log"], { maxBuffer: 64 * 1024 * 1024 });
    const costUsd = costFromLog(log);
    if (costUsd !== null) return { repo, when: r.createdAt, costUsd, url: r.url };
  }
  return null;
}

const usd = (x: number) => `$${x.toFixed(2)}`;

if (process.argv[1]?.endsWith("costs.ts")) {
  const { values } = parseArgs({ options: { repo: { type: "string", multiple: true } } });
  const { DEBUTLY_BASE_URL, DEBUTLY_API_KEY } = process.env;
  if (DEBUTLY_BASE_URL?.includes("openrouter.ai") && DEBUTLY_API_KEY) {
    const s = await fetchKeySpend(DEBUTLY_BASE_URL, DEBUTLY_API_KEY);
    console.log("OpenRouter key");
    console.log(`  Today ${usd(s.today)} · this week ${usd(s.week)} · this month ${usd(s.month)} · all time ${usd(s.total)}`);
    if (s.limit !== null) console.log(`  Limit ${usd(s.limit)}${s.resets ? ` (resets ${s.resets})` : ""} · left ${usd(s.remaining ?? 0)}`);
  } else {
    console.log("OpenRouter key: not configured (DEBUTLY_BASE_URL / DEBUTLY_API_KEY)");
  }

  const nightly: NightlyCost[] = [];
  for (const repo of values.repo ?? []) {
    try {
      const n = await latestNightly(repo);
      if (n) nightly.push(n);
      else console.log(`  ${repo}: no costed agent run found yet`);
    } catch (err) {
      console.log(`  ${repo}: could not read runs (${err instanceof Error ? err.message.split("\n")[0] : err})`);
    }
  }
  if (nightly.length) {
    console.log("\nLatest agent run per app");
    for (const n of nightly) console.log(`  ${n.repo.padEnd(40)} ${usd(n.costUsd ?? 0)}  (${n.when.slice(0, 10)})`);
    const perNight = nightly.reduce((a, n) => a + (n.costUsd ?? 0), 0);
    console.log(`  ${"Per night, all apps".padEnd(40)} ${usd(perNight)}  → about ${usd(perNight * 30)} a month`);
  }
}
