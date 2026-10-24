// `debutly hear [report dir] [--browser-state dir] [--tabs 60]`: a run's screen-reader findings,
// checked with NVDA on Windows (through Guidepup). The app must be running where the report's
// pages point; for pages behind sign-in, run the agents with --browser-state <dir> first.
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { chromium, type Page } from "playwright";
import { hearFindings, type ScreenReader } from "./hear";

const USAGE = "Usage: npx debutly hear [report dir] [--browser-state <dir>] [--tabs 60]\nNeeds Windows with NVDA set up for automation: npm i -D @guidepup/guidepup && npx @guidepup/setup";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { "browser-state": { type: "string" }, tabs: { type: "string", default: "60" } },
});

/** The newest run under .debutly/runs, where `debutly run` writes reports by default. */
function latestRun(): string | undefined {
  try {
    const root = join(".debutly", "runs");
    return readdirSync(root)
      .map((d) => join(root, d))
      .filter((d) => statSync(d).isDirectory())
      .sort()
      .at(-1);
  } catch {
    return undefined;
  }
}

const clean = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * NVDA, through Guidepup. Putting it on the page follows Guidepup's own Playwright helper (MIT):
 * make sure the browser window is the one in front, then go to the top of the document. It
 * doesn't click the page to focus it, as that helper does: a click lands on whatever is there.
 */
async function nvdaReader(): Promise<ScreenReader> {
  if (process.platform !== "win32") throw new Error(`debutly hear uses NVDA, which runs on Windows.\n${USAGE}`);
  let guidepup: typeof import("@guidepup/guidepup");
  try {
    guidepup = await import("@guidepup/guidepup");
  } catch {
    throw new Error(`Guidepup isn't installed.\n${USAGE}`);
  }
  const { nvda, NVDAKeyCodeCommands, WindowsKeyCodes, WindowsModifiers } = guidepup;
  // Guidepup's NVDA build is versioned like "0.2.1-2026.2": the NVDA release is the last part.
  const version = (nvda as unknown as { version?: string }).version?.match(/(\d{4}\.\d+(?:\.\d+)?)$/)?.[1];
  return {
    name: version ? `NVDA ${version}` : "NVDA",
    start: () => nvda.start({ capture: "initial" }),
    stop: () => nvda.stop(),
    async focus(page: Page) {
      await nvda.perform(NVDAKeyCodeCommands.exitFocusMode, { capture: false });
      const title = clean(await page.title());
      for (let attempt = 0; attempt < 10; attempt++) {
        await nvda.perform(NVDAKeyCodeCommands.reportTitle);
        const window = clean(await nvda.lastSpokenPhrase());
        if ((title && window.startsWith(title)) || window.includes("chrome")) break;
        await nvda.perform({ keyCode: [WindowsKeyCodes.Escape], modifiers: [WindowsModifiers.Alt] }, { capture: false });
        await delay(500);
      }
      await page.bringToFront();
      await nvda.perform({ keyCode: [WindowsKeyCodes.Home], modifiers: [WindowsModifiers.Control] }, { capture: false });
      await nvda.clearSpokenPhraseLog();
    },
    press: (key) => nvda.press(key),
    // NVDA can speak in parts ("main landmark", then the field): wait until it has been quiet.
    async said() {
      const parts: string[] = [];
      for (let quiet = 0; quiet < 2 && parts.length < 20; ) {
        await delay(250);
        const log = await nvda.spokenPhraseLog();
        await nvda.clearSpokenPhraseLog();
        if (log.length) {
          parts.push(...log);
          quiet = 0;
        } else quiet++;
      }
      return parts.join(" ").replace(/\s+/g, " ").trim();
    },
  };
}

const reportDir = positionals[0] ?? latestRun();
if (!reportDir) {
  console.error(`No report given, and none under .debutly/runs.\n${USAGE}`);
  process.exit(1);
}
try {
  const reader = await nvdaReader();
  console.log(`Hearing ${reportDir} with ${reader.name}...`);
  const heard = await hearFindings({
    reportDir,
    reader,
    browserStateDir: values["browser-state"],
    tabs: Number(values.tabs),
    launch: () => chromium.launch({ headless: false }),
  });
  if (!heard.length) console.log("No screen-reader findings to hear in this report.");
  for (const h of heard) console.log(`${h.verdict.padEnd(15)} ${h.title}: ${h.note}`);
  console.log(`Added to ${join(reportDir, "report.md")} and ${join(reportDir, "heard.json")}.`);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
