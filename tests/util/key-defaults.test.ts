import { expect, it } from "vitest";
import { applyKeyDefaults, OPENROUTER_DEFAULTS } from "../../src/util/key-defaults";

it("needs nothing but an OpenRouter key", () => {
  expect(applyKeyDefaults({ DEBUTLY_API_KEY: "sk-or-v1-abc" })).toEqual({ DEBUTLY_API_KEY: "sk-or-v1-abc", ...OPENROUTER_DEFAULTS });
});

it("reads a key other tools already use", () => {
  expect(applyKeyDefaults({ OPENROUTER_API_KEY: "sk-or-v1-abc" }).DEBUTLY_NAV_MODEL).toBe("z-ai/glm-5.3-flash");
  const anthropic = applyKeyDefaults({ ANTHROPIC_API_KEY: "sk-ant-abc" });
  expect(anthropic).toMatchObject({ DEBUTLY_API_KEY: "sk-ant-abc", DEBUTLY_PROVIDER: "anthropic" });
  expect(anthropic.DEBUTLY_BASE_URL).toBeUndefined();
});

it("leaves whatever is set alone", () => {
  const env = applyKeyDefaults({ DEBUTLY_API_KEY: "sk-or-v1-abc", DEBUTLY_NAV_MODEL: "google/gemini-3.8-flash", DEBUTLY_REASONING_EFFORT: "" });
  expect(env.DEBUTLY_NAV_MODEL).toBe("google/gemini-3.8-flash");
  expect(env.DEBUTLY_REASONING_EFFORT).toBe("");
  // Another provider's address: OpenRouter's model names would mean nothing there.
  const elsewhere = applyKeyDefaults({ DEBUTLY_API_KEY: "sk-or-v1-abc", DEBUTLY_BASE_URL: "https://api.deepseek.com/v1" });
  expect(elsewhere.DEBUTLY_NAV_MODEL).toBeUndefined();
  // A key it doesn't recognise gets no guesses.
  expect(applyKeyDefaults({ DEBUTLY_API_KEY: "abc" })).toEqual({ DEBUTLY_API_KEY: "abc" });
});
