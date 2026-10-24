// `debutly hear [report dir] [--browser-state dir] [--tabs 120]`: a run's screen-reader findings,
// checked with a real screen reader through Guidepup: NVDA on Windows, VoiceOver on macOS. The
// app must be running where the report's pages point; for pages behind sign-in, run the agents
// with --browser-state <dir> first.
import { execFileSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { chromium, type Page } from "playwright";
import { hearFindings, type ScreenReader } from "./hear";

const USAGE =
  "Usage: npx debutly hear [report dir] [--browser-state <dir>] [--tabs 120]\nNeeds Windows (NVDA) or macOS (VoiceOver), set up for automation: npm i -D @guidepup/guidepup && npx @guidepup/setup";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { "browser-state": { type: "string" }, tabs: { type: "string", default: "120" } },
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

/** The Chrome Playwright launches, as macOS knows it. */
const CHROME_FOR_TESTING = "com.google.chrome.for.testing";

interface SpeechLog {
  spokenPhraseLog(): Promise<string[]>;
  clearSpokenPhraseLog(): Promise<void>;
}

/** Everything said until the screen reader has been quiet: NVDA can speak in parts ("main landmark", then the field). */
async function untilQuiet(reader: SpeechLog): Promise<string> {
  const parts: string[] = [];
  for (let quiet = 0; quiet < 2 && parts.length < 20; ) {
    await delay(250);
    const log = await reader.spokenPhraseLog();
    await reader.clearSpokenPhraseLog();
    if (log.length) {
      parts.push(...log);
      quiet = 0;
    } else quiet++;
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

async function loadGuidepup(): Promise<typeof import("@guidepup/guidepup")> {
  try {
    return await import("@guidepup/guidepup");
  } catch {
    throw new Error(`Guidepup isn't installed.\n${USAGE}`);
  }
}

/**
 * NVDA, through Guidepup. Putting it on the page follows Guidepup's own Playwright helper (MIT):
 * make sure the browser window is the one in front, then go to the top of the document. It
 * doesn't click the page to focus it, as that helper does: a click lands on whatever is there.
 */
async function nvdaReader(): Promise<ScreenReader> {
  const { nvda, NVDAKeyCodeCommands, WindowsKeyCodes, WindowsModifiers } = await loadGuidepup();
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
    said: () => untilQuiet(nvda),
  };
}

/**
 * VoiceOver, through Guidepup. It follows keyboard focus, so Tab needs only Chrome in front
 * (Guidepup's helper for reading a page with VoiceOver's own cursor goes further, through its
 * item chooser; Tab doesn't need that). Pressing Control first stops anything still being read.
 */
async function voiceOverReader(): Promise<ScreenReader> {
  const { voiceOver, macOSActivateId, MacOSKeyCodes } = await loadGuidepup();
  let macOS = "";
  try {
    macOS = execFileSync("sw_vers", ["-productVersion"], { encoding: "utf8" }).trim();
  } catch {
    // not worth failing over
  }
  return {
    name: macOS ? `VoiceOver (macOS ${macOS})` : "VoiceOver",
    start: () => voiceOver.start({ capture: "initial" }),
    stop: () => voiceOver.stop(),
    async focus(page: Page) {
      await macOSActivateId(CHROME_FOR_TESTING);
      await voiceOver.perform({ keyCode: MacOSKeyCodes.Control }, { capture: false });
      await page.bringToFront();
      await delay(500);
      await voiceOver.clearSpokenPhraseLog();
    },
    press: (key) => voiceOver.press(key),
    said: () => untilQuiet(voiceOver),
  };
}

async function screenReader(): Promise<ScreenReader> {
  if (process.platform === "win32") return nvdaReader();
  if (process.platform === "darwin") return voiceOverReader();
  throw new Error(`debutly hear uses NVDA on Windows or VoiceOver on macOS.\n${USAGE}`);
}

const reportDir = positionals[0] ?? latestRun();
if (!reportDir) {
  console.error(`No report given, and none under .debutly/runs.\n${USAGE}`);
  process.exit(1);
}
try {
  const reader = await screenReader();
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
