// Load finished runs into the store for the dashboard.
//
//   npm run debutly:import -- --store <url> --dir runs/2026-10-02 --app acme [--at 2026-10-02T10:02Z]
//   npm run debutly:import -- --store <url> --github acme/app --app acme [--since 2026-09-28]
//
// --github reads that repo's Debutly workflow runs through the `gh` CLI, downloads each
// one's report artifact and imports it; runs already in the store (same CI page) are skipped.
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs, promisify } from "node:util";
import { eq } from "drizzle-orm";
import { chromium, type Browser } from "playwright";
import { openDb } from "./store/db";
import { importRunFolder } from "./store/import-run";
import { runs } from "./store/schema";

const run = promisify(execFile);
const TRIGGERS: Record<string, string> = { schedule: "nightly", pull_request: "pr", workflow_dispatch: "manual" };
// The report artifact's name; runs from before 2026-10-03, when Debutly was Wind Tunnel, use the second.
const REPORT_ARTIFACTS = ["debutly-report", "wind-tunnel-report"];

/** Downloads a CI run's report into dir; false when the run has none. */
async function downloadReport(repo: string, runId: number, dir: string): Promise<boolean> {
  for (const name of REPORT_ARTIFACTS) {
    try {
      await run("gh", ["run", "download", String(runId), "--repo", repo, "-n", name, "-D", dir], { maxBuffer: 1 << 24 });
      return true;
    } catch {
      // No artifact by this name; try the next.
    }
  }
  return false;
}

const { values } = parseArgs({
  options: {
    store: { type: "string" },
    dir: { type: "string" },
    github: { type: "string" },
    workflow: { type: "string", default: "throwaway-env.yml" },
    app: { type: "string" },
    at: { type: "string" },
    "ci-url": { type: "string" },
    trigger: { type: "string" },
    since: { type: "string" },
    limit: { type: "string", default: "30" },
  },
});

if (!values.store || (!values.dir && !values.github)) {
  console.error("Usage: npm run debutly:import -- --store <url> (--dir <run folder> | --github owner/repo) [--app name] [--since YYYY-MM-DD]");
  process.exit(1);
}

// Screenshots go in as compact JPEGs, converted by drawing each PNG in a browser.
async function jpegConverter(browser: Browser) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
  return async (png: Buffer) => {
    await page.setContent(`<style>body{margin:0}</style><img src="data:image/png;base64,${png.toString("base64")}">`);
    const img = page.locator("img");
    await img.evaluate((el: HTMLImageElement) => el.decode());
    return img.screenshot({ type: "jpeg", quality: 50 });
  };
}

const { db, close } = await openDb(values.store);
const browser = await chromium.launch();
try {
  const toJpeg = await jpegConverter(browser);
  if (values.dir) {
    const id = await importRunFolder(db, values.dir, {
      app: values.app,
      trigger: values.trigger,
      ciUrl: values["ci-url"],
      at: values.at ? new Date(values.at) : undefined,
      toJpeg,
    });
    console.log(`Imported ${values.dir} as run ${id}`);
  } else {
    const repo = values.github!;
    const app = values.app ?? repo.split("/").pop()!;
    const { stdout } = await run("gh", ["run", "list", "--repo", repo, "--workflow", values.workflow!, "--status", "success", "--limit", values.limit!, "--json", "databaseId,event,createdAt,url"], { maxBuffer: 1 << 24 });
    const listed = (JSON.parse(stdout) as { databaseId: number; event: string; createdAt: string; url: string }[])
      .filter((r) => !values.since || r.createdAt >= values.since)
      .reverse();
    for (const r of listed) {
      const [seen] = await db.select({ id: runs.id }).from(runs).where(eq(runs.ciUrl, r.url));
      if (seen) continue;
      const dir = await mkdtemp(join(tmpdir(), "debutly-import-"));
      // Runs that skipped the agents (e.g. pull requests without the run-agents label) have no report.
      if (!(await downloadReport(repo, r.databaseId, dir))) {
        await rm(dir, { recursive: true, force: true });
        continue;
      }
      try {
        const id = await importRunFolder(db, dir, { app, trigger: TRIGGERS[r.event] ?? r.event, ciUrl: r.url, at: new Date(r.createdAt), toJpeg });
        console.log(`Imported ${repo} ${r.createdAt} (${r.event}) as run ${id}`);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    }
  }
} finally {
  await browser.close();
  await close();
}
