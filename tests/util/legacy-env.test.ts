import { expect, it } from "vitest";
import { adoptLegacyEnv } from "../../src/util/legacy-env";
import { createLlms } from "../../src/llm/factory";

it("fills each DEBUTLY_* setting from its old WT_* name when unset", () => {
  const env = adoptLegacyEnv({ WT_API_KEY: "old", WT_NAV_MODEL: "a", DEBUTLY_NAV_MODEL: "b", OTHER: "x" });
  expect(env).toMatchObject({ DEBUTLY_API_KEY: "old", DEBUTLY_NAV_MODEL: "b", OTHER: "x" });
  expect(env.DEBUTLY_OTHER).toBeUndefined();
});

it("lets a .env from before the rename still configure the models", () => {
  const env = adoptLegacyEnv({
    WT_API_KEY: "k",
    WT_PROVIDER: "openai-compatible",
    WT_BASE_URL: "https://x.test/v1",
    WT_NAV_MODEL: "a",
    WT_JUDGE_MODEL: "b",
  });
  expect(() => createLlms(env)).not.toThrow();
});
