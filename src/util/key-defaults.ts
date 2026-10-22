// One key is enough. Whatever is unset is filled in from the key itself: an OpenRouter key
// (sk-or-…) gets the models that worked best in our comparisons, an Anthropic key (sk-ant-…)
// the Anthropic provider. OPENROUTER_API_KEY and ANTHROPIC_API_KEY are read when
// DEBUTLY_API_KEY isn't set, so a key already in the environment for other tools just works.
// Anything set explicitly wins. Entry points import this right after legacy-env.

export const OPENROUTER_DEFAULTS = {
  DEBUTLY_PROVIDER: "openai-compatible",
  DEBUTLY_BASE_URL: "https://openrouter.ai/api/v1",
  DEBUTLY_NAV_MODEL: "z-ai/glm-5.3-flash",
  DEBUTLY_JUDGE_MODEL: "deepseek/deepseek-v4-flash",
  DEBUTLY_REASONING_EFFORT: "low",
} as const;

export function applyKeyDefaults(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  if (!env.DEBUTLY_API_KEY) {
    const key = env.OPENROUTER_API_KEY || env.ANTHROPIC_API_KEY;
    if (key) env.DEBUTLY_API_KEY = key;
  }
  const key = env.DEBUTLY_API_KEY ?? "";
  if (!env.DEBUTLY_PROVIDER && key.startsWith("sk-ant-")) env.DEBUTLY_PROVIDER = "anthropic";
  const openRouter = key.startsWith("sk-or-") && (!env.DEBUTLY_PROVIDER || env.DEBUTLY_PROVIDER === "openai-compatible") && (!env.DEBUTLY_BASE_URL || /openrouter\.ai/.test(env.DEBUTLY_BASE_URL));
  if (openRouter) {
    // Set to empty is set: DEBUTLY_REASONING_EFFORT= turns reasoning control off.
    for (const [name, value] of Object.entries(OPENROUTER_DEFAULTS)) if (env[name] === undefined) env[name] = value;
  }
  return env;
}

applyKeyDefaults();
