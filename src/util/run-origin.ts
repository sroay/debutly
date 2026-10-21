// Which app a run tested, what started it and where its CI run lives, so the dashboard can
// group runs by app and link back. Flags win; in GitHub Actions the rest comes from its own
// variables, so a workflow needs no extra arguments.

export interface RunOrigin {
  app?: string;
  trigger?: string;
  ciUrl?: string;
}

const TRIGGERS: Record<string, string> = {
  schedule: "nightly",
  pull_request: "pr",
  pull_request_target: "pr",
  workflow_dispatch: "manual",
  push: "push",
};

export function runOrigin(flags: { app?: string; trigger?: string; ciUrl?: string }, env: Record<string, string | undefined>): RunOrigin {
  const repo = env.GITHUB_REPOSITORY;
  const inCi = !!(repo && env.GITHUB_RUN_ID);
  return {
    app: flags.app ?? (repo ? repo.split("/").pop() : undefined),
    trigger: flags.trigger ?? (inCi ? (TRIGGERS[env.GITHUB_EVENT_NAME ?? ""] ?? env.GITHUB_EVENT_NAME) : "local"),
    ciUrl: flags.ciUrl ?? (inCi ? `${env.GITHUB_SERVER_URL ?? "https://github.com"}/${repo}/actions/runs/${env.GITHUB_RUN_ID}` : undefined),
  };
}
