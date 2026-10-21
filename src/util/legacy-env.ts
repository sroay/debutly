// Settings are named DEBUTLY_*. Debutly was called Wind Tunnel until 2026-10-03, and the WT_*
// names from then still work: each fills in its DEBUTLY_* name when that one is unset.
// Entry points import this module first, so the copy happens before anything reads a setting.

export function adoptLegacyEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  for (const [name, value] of Object.entries(env)) {
    if (!name.startsWith("WT_")) continue;
    const current = `DEBUTLY_${name.slice(3)}`;
    if (env[current] === undefined) env[current] = value;
  }
  return env;
}

adoptLegacyEnv();
