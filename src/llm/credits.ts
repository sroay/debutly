import type { CostEstimate } from "../cost/estimate";
import { isOpenRouter } from "./openrouter";

/**
 * What an OpenRouter key may still spend, in USD, from GET /key. Null when the key has no limit,
 * the provider isn't OpenRouter, or the lookup fails: the account's own balance needs a
 * management key, so a key limit is the only balance an ordinary key can see.
 */
export async function keyCreditsLeft(baseUrl: string, apiKey: string, fetchFn: typeof fetch = fetch): Promise<number | null> {
  if (!isOpenRouter(baseUrl)) return null;
  try {
    const res = await fetchFn(`${baseUrl.replace(/\/+$/, "")}/key`, { headers: { authorization: `Bearer ${apiKey}` } });
    if (!res.ok) return null;
    const { data } = (await res.json()) as { data?: { limit_remaining?: number | null } };
    return typeof data?.limit_remaining === "number" ? data.limit_remaining : null;
  } catch {
    return null;
  }
}

/**
 * Before a run: refuse one the key can't pay for even at the low estimate (agents would stop
 * part-way, 2026-10-21), and warn when the high estimate is more than is left.
 */
export function creditCheck(left: number | null, estimate: CostEstimate | null): { refuse?: string; warn?: string } {
  if (left === null || !estimate) return {};
  const usd = (n: number) => `$${n.toFixed(2)}`;
  if (left < estimate.low) {
    return { refuse: `the API key has ${usd(left)} left and this run needs at least ${usd(estimate.low)}. Top up, or raise the key's limit, then run again.` };
  }
  if (left < estimate.high) {
    return { warn: `the API key has ${usd(left)} left and this run could cost up to ${usd(estimate.high)}; agents may stop part-way.` };
  }
  return {};
}
