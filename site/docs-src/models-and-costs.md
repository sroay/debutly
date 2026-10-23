---
title: Models and costs
description: Which models Debutly uses, what a run costs, and how spending is kept in check with estimates, caps and credit checks.
---

# Models and costs

You bring your own model key and pay your provider directly. Debutly never sees your bill.

## What a run costs

Every run prints an estimate before it starts:

```text
Estimated cost: $0.03–$0.05 (3 agents × up to 30 steps on z-ai/glm-5.3-flash)
```

With the default models, a quick run of three agents usually costs a few cents. A business crew run on a real SaaS app (2 owners, 4 teammates) cost about $0.05. The report says what each run actually cost, and `npx debutly costs` shows your OpenRouter key's spend by day, week and month.

## Keeping spending in check

- **`maxCost`** refuses to start a run whose estimate could exceed it. The GitHub Action sets it to $1.00 unless you say otherwise.
- **A key limit.** Give your OpenRouter key a monthly limit. Before each run Debutly reads what is left on it, refuses a run that can't be paid for, and warns when one might run short.
- **Running out part-way.** If the provider refuses for lack of credit during a run, every agent stops at its next step instead of each paying for a failed request, and the report says the run was cut short. On a low balance OpenRouter can refuse a request for the most it might cost; Debutly then asks again for a reply the balance covers.
- **Per-agent caps**: `maxSteps`, `agentTokenCap` and `agentMinutes`.

## The models

With an OpenRouter key, Debutly uses:

- **`z-ai/glm-5.3-flash`** for the agents, with low reasoning effort. It found as many seeded bugs as Gemini 3.8 Flash for about a quarter of the cost, taking about 40% more steps, which is why `maxSteps` defaults to 30.
- **`deepseek/deepseek-v4-flash`** to cast the customers and judge pages.

Change them with `DEBUTLY_NAV_MODEL` and `DEBUTLY_JUDGE_MODEL`. Any model on OpenRouter works, and so does any OpenAI-compatible provider (`DEBUTLY_PROVIDER=openai-compatible` and `DEBUTLY_BASE_URL`) or Anthropic (`DEBUTLY_PROVIDER=anthropic`).

Models compared on the seeded-bug fixture (5 planted bugs, 3 agents), September 2026:

| Model | Bugs found (of 5) | Seconds per step | Cost |
|---|---|---|---|
| google/gemini-3.8-flash (flex tier) | 4 | 3.1 | $0.020 |
| z-ai/glm-5.3-flash | 4 | 3.8 | $0.004 |
| tencent/hy3 | 4 | 12.4 | $0.024 |
| qwen/qwen3.8-flash | 4 | 30.0 | $0.027 |
| qwen/qwen3.7-flash | 4 | 27.8 | $0.011 |
| inclusionai/ling-3.0-flash | 3 | 5.8 | $0.003 |
| bytedance-seed/seed-2.0-mini | 2 | 6.3 | $0.009 |

`google/gemini-3.8-flash` is the fastest and needs the fewest steps; `DEBUTLY_NAV_ROUTING='{"order":["google-ai-studio/flex"]}'` halves its price, but Google AI Studio isn't among the providers that keep no data, so that also needs `DEBUTLY_ZERO_RETENTION=off` (see [Data and privacy](/docs/data-and-privacy)). To compare models on your own app, see `scripts/compare-models.ts` in the repository.
