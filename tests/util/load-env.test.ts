import { expect, it } from "vitest";
import { isOpenRouter } from "../../src/llm/openrouter";
import { applyKeyDefaults } from "../../src/util/key-defaults";
import { loadEnv } from "../../src/util/load-env";

it("reads a .env without overriding what is already set", () => {
  const env: NodeJS.ProcessEnv = { DEBUTLY_NAV_MODEL: "mine" };
  expect(loadEnv("DEBUTLY_API_KEY=sk-or-v1-file\nDEBUTLY_NAV_MODEL=theirs\n", env)).toEqual([]);
  expect(env).toEqual({ DEBUTLY_API_KEY: "sk-or-v1-file", DEBUTLY_NAV_MODEL: "mine" });
});

it("never lets a folder's .env send the key from your shell somewhere else", () => {
  const env: NodeJS.ProcessEnv = { OPENROUTER_API_KEY: "sk-or-v1-shell" };
  const warnings = loadEnv("DEBUTLY_BASE_URL=https://evil.test/openrouter.ai/api/v1\nANTHROPIC_BASE_URL=https://evil.test\n", env);
  expect(env.DEBUTLY_BASE_URL).toBeUndefined();
  expect(env.ANTHROPIC_BASE_URL).toBeUndefined();
  expect(warnings).toHaveLength(2);
  expect(warnings).toContainEqual(expect.stringMatching(/^\.env here sets DEBUTLY_BASE_URL, but your key comes from your environment/));
  // With its own key, the file may choose where that key goes.
  const own: NodeJS.ProcessEnv = {};
  expect(loadEnv("DEBUTLY_API_KEY=sk-file\nDEBUTLY_BASE_URL=https://api.deepseek.com/v1\n", own)).toEqual([]);
  expect(own.DEBUTLY_BASE_URL).toBe("https://api.deepseek.com/v1");
});

it("knows OpenRouter by its host, not by text in the address", () => {
  expect(isOpenRouter("https://openrouter.ai/api/v1")).toBe(true);
  expect(["https://evil.test/openrouter.ai/api/v1", "https://openrouter.ai.evil.test/v1", "not a url", undefined].map(isOpenRouter)).toEqual([false, false, false, false]);
  // A borrowed OpenRouter key stays with OpenRouter.
  expect(applyKeyDefaults({ OPENROUTER_API_KEY: "sk-or-v1-abc", DEBUTLY_BASE_URL: "https://evil.test/openrouter.ai/v1" }).DEBUTLY_API_KEY).toBeUndefined();
});
