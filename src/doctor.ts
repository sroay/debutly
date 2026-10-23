// `debutly doctor`: is everything in place for a run? Each check says what to do when it fails.
import { CONFIG_FILE, readConfig, type DebutlyConfig } from "./config";
import { keyCreditsLeft } from "./llm/credits";
import { isOpenRouter } from "./llm/openrouter";

export type CheckStatus = "ok" | "warn" | "fail";
export interface Check {
  status: CheckStatus;
  label: string;
  detail?: string;
}

export interface DoctorDeps {
  env: NodeJS.ProcessEnv;
  nodeVersion: string;
  fetchFn: typeof fetch;
  chromiumInstalled: () => boolean;
  readConfig: () => DebutlyConfig | undefined;
}

const MIN_NODE = [20, 12];
const TIMEOUT_MS = 10_000;

const atLeast = (version: string, [major, minor]: number[]) => {
  const [a, b] = version.split(".").map(Number);
  return a > major || (a === major && b >= minor);
};

// Addresses that are plainly a copy on this machine or a network-local test host.
const LOCAL_HOST = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\]|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|.+\.(localhost|local|test|internal))$/i;
// A label that marks a hosted test copy: staging.example.com, my-app-git-branch.preview.example.com.
const TEST_LABEL = /(^|[.-])(staging|stage|preview|dev|test|qa|sandbox|uat)([.-]|\d|$)/i;

/** Could this address be the real, production app? Agents sign up, submit forms and pay. */
export function looksLikeProduction(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return !LOCAL_HOST.test(host) && !TEST_LABEL.test(host);
  } catch {
    return false;
  }
}

async function keyWorks(env: NodeJS.ProcessEnv, fetchFn: typeof fetch): Promise<Check> {
  const key = env.DEBUTLY_API_KEY ?? "";
  const provider = env.DEBUTLY_PROVIDER ?? "anthropic";
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  try {
    const res =
      provider === "anthropic"
        ? await fetchFn("https://api.anthropic.com/v1/models", { headers: { "x-api-key": key, "anthropic-version": "2023-06-01" }, signal })
        : await fetchFn(`${(env.DEBUTLY_BASE_URL ?? "").replace(/\/+$/, "")}/${isOpenRouter(env.DEBUTLY_BASE_URL) ? "key" : "models"}`, {
            headers: { authorization: `Bearer ${key}` },
            signal,
          });
    if (res.status === 401 || res.status === 403) return { status: "fail", label: "The provider rejects the API key", detail: "Check it was copied in full, or create a new one." };
    if (!res.ok) return { status: "warn", label: `The provider answered HTTP ${res.status} when asked about the key` };
  } catch (err) {
    return { status: "warn", label: "Couldn't reach the model provider", detail: err instanceof Error ? err.message : String(err) };
  }
  const left = await keyCreditsLeft(env.DEBUTLY_BASE_URL ?? "", key, fetchFn);
  return { status: "ok", label: "The provider accepts the API key", detail: left === null ? undefined : `$${left.toFixed(2)} left on the key's limit; the account's own balance isn't visible here` };
}

async function appAnswers(url: string, fetchFn: typeof fetch): Promise<Check> {
  try {
    const res = await fetchFn(url, { redirect: "follow", signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (res.status >= 500) return { status: "warn", label: `${url} answers HTTP ${res.status}`, detail: "Agents will start on an error page." };
    return { status: "ok", label: `${url} answers (HTTP ${res.status})` };
  } catch {
    return { status: "fail", label: `Nothing answers at ${url}`, detail: "Start your app first (a test copy, never production), then check again." };
  }
}

export async function runChecks(d: DoctorDeps): Promise<Check[]> {
  const checks: Check[] = [];
  checks.push(
    atLeast(d.nodeVersion, MIN_NODE)
      ? { status: "ok", label: `Node.js ${d.nodeVersion}` }
      : { status: "fail", label: `Node.js ${d.nodeVersion} is too old`, detail: `Debutly needs ${MIN_NODE.join(".")} or later: https://nodejs.org` },
  );

  if (!d.env.DEBUTLY_API_KEY) {
    checks.push({
      status: "fail",
      label: "No model API key",
      detail: "Create one at https://openrouter.ai/keys and add DEBUTLY_API_KEY=… to a .env file here (keep .env out of git), or set OPENROUTER_API_KEY.",
    });
  } else {
    const via = d.env.DEBUTLY_PROVIDER === "anthropic" ? "Anthropic" : (d.env.DEBUTLY_BASE_URL ?? "an OpenAI-compatible provider");
    checks.push({ status: "ok", label: `API key found (${via}; agents use ${d.env.DEBUTLY_NAV_MODEL ?? "the default model"})` });
    checks.push(await keyWorks(d.env, d.fetchFn));
  }

  checks.push(
    d.chromiumInstalled()
      ? { status: "ok", label: "Chromium is installed" }
      : { status: "warn", label: "Chromium isn't downloaded yet", detail: "The first run downloads it (about 150 MB), or run: npx playwright install chromium" },
  );

  let config: DebutlyConfig | undefined;
  try {
    config = d.readConfig();
  } catch (err) {
    checks.push({ status: "fail", label: err instanceof Error ? err.message : String(err) });
    return checks;
  }
  if (!config) {
    checks.push({ status: "warn", label: `No ${CONFIG_FILE} here`, detail: "Run npx debutly init to create one, or pass --url, --goal and --icp to each run." });
    return checks;
  }
  const missing = (["url", "goal", "icp"] as const).filter((k) => !config[k]);
  checks.push(
    missing.length
      ? { status: "fail", label: `${CONFIG_FILE} has no ${missing.join(", ")}`, detail: "Every run needs the app's address, a goal and who the customers are." }
      : { status: "ok", label: `${CONFIG_FILE}: "${config.goal}"` },
  );
  if (typeof config.url === "string") {
    if (looksLikeProduction(config.url)) {
      checks.push({
        status: "warn",
        label: `${config.url} may be your real app`,
        detail: "Agents create accounts, submit forms and pay in test mode. Point Debutly at a local, staging or throwaway copy.",
      });
    }
    checks.push(await appAnswers(config.url, d.fetchFn));
  }
  return checks;
}

const MARK: Record<CheckStatus, string> = { ok: "✓", warn: "!", fail: "✗" };

export function renderChecks(checks: Check[]): string {
  const lines = checks.map((c) => `${MARK[c.status]} ${c.label}${c.detail ? `\n    ${c.detail}` : ""}`);
  const failed = checks.filter((c) => c.status === "fail").length;
  lines.push("", failed ? `${failed} thing${failed === 1 ? "" : "s"} to fix before a run.` : "Ready. Start a run with: npx debutly");
  return lines.join("\n");
}

export async function doctor(): Promise<number> {
  const { chromiumInstalled } = await import("./util/chromium");
  const checks = await runChecks({ env: process.env, nodeVersion: process.versions.node, fetchFn: fetch, chromiumInstalled, readConfig: () => readConfig() });
  console.log(renderChecks(checks));
  return checks.some((c) => c.status === "fail") ? 1 : 0;
}
