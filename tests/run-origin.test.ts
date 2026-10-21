import { expect, it } from "vitest";
import { runOrigin } from "../src/util/run-origin";

const actions = { GITHUB_REPOSITORY: "acme-inc/acme", GITHUB_RUN_ID: "36993189513", GITHUB_SERVER_URL: "https://github.com" };

it("reads the app, trigger and run page from GitHub Actions", () => {
  expect(runOrigin({}, { ...actions, GITHUB_EVENT_NAME: "schedule" })).toEqual({
    app: "acme",
    trigger: "nightly",
    ciUrl: "https://github.com/acme-inc/acme/actions/runs/36993189513",
  });
  expect(runOrigin({}, { ...actions, GITHUB_EVENT_NAME: "pull_request" }).trigger).toBe("pr");
  expect(runOrigin({}, { ...actions, GITHUB_EVENT_NAME: "workflow_dispatch" }).trigger).toBe("manual");
});

it("lets flags win, and calls a run outside CI local", () => {
  expect(runOrigin({ app: "globex", trigger: "manual", ciUrl: "https://ci.example/1" }, { ...actions, GITHUB_EVENT_NAME: "schedule" })).toEqual({
    app: "globex",
    trigger: "manual",
    ciUrl: "https://ci.example/1",
  });
  expect(runOrigin({ app: "initech" }, {})).toEqual({ app: "initech", trigger: "local", ciUrl: undefined });
});
