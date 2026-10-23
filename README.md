# Debutly

[![Rehearsed with Debutly](https://debutly.dev/badge.svg)](https://debutly.dev)

**Rehearse your launch.** Debutly sends AI agents through your web app as if they were your first customers. In a real browser they sign up, confirm their email, pick a plan, invite teammates and use the product. Then they tell you what broke, where they got stuck and where they gave up, with the steps to reproduce it, screenshots, and how many agents hit each problem.

Run it before a launch, on every pull request, or on a schedule against a throwaway copy of your app.

> **Only point Debutly at a test, staging or throwaway copy of your app, never production.** Agents create accounts, submit forms and, in test mode, pay.

Website and docs: [debutly.dev](https://debutly.dev) ([quick start](https://debutly.dev/docs/quick-start)). Created by [Chetan Sroay](https://github.com/sroay). Status: early. Flags, the report format and the database schema may still change.

## What it does

- **Customers in a real browser.** Agents (Playwright and Chromium) click, type, pick options in native and custom dropdowns, upload files (a sample photo or CV made up on the spot), follow links from emails, and wait for slow pages like a person would.
- **Business crews.** With `--unit business`, an owner signs up, chooses a plan within a budget and invites teammates. Each teammate accepts by email and uses the product in their own login, so invites, roles and shared workspaces get tested too.
- **Agents with access needs.** The first agents in each run act out an access need: one hears what a screen reader would and works by keyboard only; one works at about 200% zoom; one is on a throttled connection; one reads as a non-native English speaker. The screen-reader agent hears the names the browser gives assistive technology and works by keyboard only, so controls the keyboard can't reach are reported. The low-vision agent's pages are also measured at 320 pixels wide for sideways scrolling. Findings name the related WCAG criteria, for a person to check. They are not an accessibility audit or a test with assistive technology.
- **Findings with evidence.** Server and page errors, broken journeys, pages that take over 10 s to arrive, controls that something keeps covering, unlabeled buttons and fields, and agents going round in circles. Each comes with repro steps, screenshots and a confidence level.
- **Knows a test environment from a bug.** If your app has a sandbox that records what it blocked (emails, payments, outside APIs), Debutly reads it and files failures the test environment caused separately from real bugs.
- **What buyers think.** Cheap "skeptical buyer" evaluators judge your landing and pricing pages, grounded in competitors' own pricing pages. They compare A/B variants and work at the idea stage, before anything is built.
- **A dashboard.** Runs, findings across runs (new, recurring, gone), step-by-step replays with screenshots, and spend.
- **Costs under control.** Every run prints an estimate before it starts, and `--max-cost` refuses runs that could cost more. A key with a spending limit is checked before a run starts, and if the provider runs out of credit part-way, every agent stops at its next step and the report says the run was cut short. Bring your own model key; a quick run costs cents.

## Quick start

Needs Node.js 20.12 or later. Until the first npm release, type `npx github:sroay/debutly` wherever this says `npx debutly`. In your app's folder:

```bash
npx debutly init     # a few questions, then a debutly.json
```

Put a model key in a `.env` file there (`DEBUTLY_API_KEY=sk-or-…`, from [openrouter.ai/keys](https://openrouter.ai/keys)); init keeps `.env` out of git. One key is all it needs: Debutly picks the models from it. Start a test copy of your app, then:

```bash
npx debutly doctor   # checks the key, the browser, the config and that the app answers
npx debutly          # runs the agents
```

The first run downloads Chromium (about 150 MB, once). The report lands in `.debutly/runs/<timestamp>/report.md`, next to `sessions.json`, `findings.json` and the screenshots. Flags override `debutly.json` for one run, for example `npx debutly --tier standard --max-cost 3`; `npx debutly --help` lists the commands.

`debutly.json` holds the settings, named like the flags below (`maxCost` for `--max-cost`):

```json
{
  "url": "http://localhost:3000",
  "goal": "Sign up, choose a plan and invite a teammate",
  "icp": "Owners of small marketing agencies, 2-15 people",
  "unit": "business",
  "tier": "quick",
  "maxCost": 1
}
```

## Options

- `--unit individual` (default) simulates one person per unit. `--unit business` simulates business crews: an owner and `--employees` teammates (default 2, max 4; 0 = owner only). `--agents` is the number of units. Crews need `--mailpit`.
- `--tier quick|standard|deep` sets the run size: Quick is 3 units with owners only, Standard is 10 units with 2 employees each, Deep is 30 units with 3 each. `--agents` and `--employees` override it. `--max-cost 0.50` refuses to start a run that could cost more.
- `--inclusion off` skips the inclusion needs, which are on by default. The starting need rotates daily.
- `--languages ar,en` gives the customers first languages in turn. Arabic-first agents use the site in Arabic when it offers it, write their names in Arabic script and type numbers with Arabic-Indic digits.
- `--mailpit http://127.0.0.1:54324` gives each agent its own inbox for magic links and confirmation emails, for example the Mailpit that `supabase start` runs.
- `--sandbox-outbox <url>` (with `DEBUTLY_SANDBOX_TOKEN` set) reads what your app's sandbox blocked during the run. Failures that happened while it was blocking an outside service, server errors saying a key is missing, and failures to reach a website an agent made up for its company are listed under "Caused by the test environment" instead of as findings.
- `--max-steps`, `--agent-token-cap 200000` and `--agent-minutes 15` cap each agent.
- Ctrl+C lets agents stop at their next step and still writes the report; a second Ctrl+C quits at once.

## What buyers think: perception and experiments

Besides agents who use the product, breadth evaluators judge what it shows, like skeptical buyers on a budget. Each must name at least two concrete objections before scoring, and defaults to "no". They need no browser, so hundreds cost cents.

```bash
# Your pages, grounded in competitors' own pricing pages:
npx debutly perceive --icp "…" --url https://app.test/ --url https://app.test/pricing \
  --competitors https://rival.test/pricing,https://other.test/pricing
# An experiment: which version do buyers pick? (a URL or a text file per variant)
npx debutly perceive --icp "…" --variant A=https://app.test/pricing --variant B=pricing-b.md
# Idea stage, before anything is built:
npx debutly perceive --icp "…" --file pitch.md
# After a normal run: evaluators judge the pages the agents saw
npx debutly … --evaluators 50
```

- **Sizes:** `--tier quick|standard|deep` gives 50, 300 or 1,500 evaluators.
- **The report** (`launch-readiness.md`) ranks blockers and objections, compares variants with a 95% interval (and says when a lead could be noise), and suggests fixes. It is always labelled as simulated evidence, with no conversion rates.
- **Predictions:** with `--store`, each prediction (winner, top objection, intent share) is saved. Record what really happened with `npx debutly predictions record <id> <actual>` and see accuracy with `npx debutly predictions accuracy`.

## Run it on a schedule in GitHub Actions

The safest place to run Debutly is a throwaway copy of your app, built fresh on the CI runner and deleted afterwards: your real schema, an empty database, test keys only. Your code and keys never leave your own CI. `npx debutly init` can write this workflow for you.

```yaml
# .github/workflows/debutly.yml in your app's repo, next to debutly.json
name: debutly
on:
  schedule: [{ cron: "0 4 * * 1" }]   # Mondays
  workflow_dispatch:
jobs:
  agents:
    runs-on: ubuntu-latest
    timeout-minutes: 45
    steps:
      - uses: actions/checkout@v4
      - run: |                         # start a test copy of your app (seeded database, test keys only)
          npm ci && npm run build
          PORT=3000 npm start &
      - uses: sroay/debutly@v0
        with:
          api-key: ${{ secrets.DEBUTLY_API_KEY }}
          # store-url: ${{ secrets.DEBUTLY_STORE_URL }}   # optional: record runs for the dashboard
```

The action waits for the app to answer, runs the agents with the settings in `debutly.json`, puts the report on the run's summary page and attaches the screenshots as the `debutly-report` artifact. Its inputs (`url`, `goal`, `icp`, `tier`, `max-cost`, which defaults to 1.00, and `args` for any other flags) override `debutly.json`.

## Dashboard

`dashboard/` is a Next.js app that reads the database runs are recorded into:
- **Overview:** each app's latest run, a trend of recent runs, and open bugs.
- **Runs:** every run, by app, with each business crew and agent and how far they got. Findings are split three ways: bugs in the app, doubtful, and caused by the test environment.
- **Replays:** each agent's run step by step, with the screenshot, what it did, why, and what happened next.
- **Findings:** every finding across runs, marked as new, recurring, or not in the latest run.
- **Spend:** model cost per day and app.

Any Postgres works, and a free one (Neon, Supabase) is enough. With `--store` and no S3 configured, screenshots are kept in the database as compact JPEGs and pruned after `--screenshot-days` (7 by default).

```bash
# Record a run:
npx debutly … --store "$DATABASE_URL" --app my-app
# Load earlier runs from GitHub Actions report artifacts (needs the gh CLI):
npx debutly import --store "$DATABASE_URL" --github owner/repo --app my-app
# Run the dashboard locally (DATABASE_URL in dashboard/.env.local; pglite:<folder> works without a server):
npm run dashboard
```

**Hosting on Vercel:** set the Root Directory to `dashboard` and add `DATABASE_URL` and `DASHBOARD_PASSWORD`. Connection strings can be pasted exactly as your host gives them. Without `DASHBOARD_PASSWORD`, a deployed dashboard refuses everyone; only `next dev` is open.

## Self-hosted stack and scaling out

By default a run writes files and needs nothing else. To record every run in a database and spread agents over several workers:

```bash
docker compose up -d --build                  # Postgres, Redis, S3-compatible storage, 1 worker (settings from .env)
docker compose up -d --scale worker=4         # more agents at once
docker compose --profile smoke run --rm smoke # end-to-end check, about $0.01 of model usage
```

Then add `--store postgres://debutly:debutly@localhost:5433/debutly` and `--queue redis://localhost:6380` to a run. `npx debutly cancel <runId> --store <url>` stops a run from anywhere. Workers in Docker reach public (staging) URLs; for an app running on your machine, run workers natively with `npx debutly worker`.

## Models and costs

Any OpenAI-compatible provider works (`DEBUTLY_PROVIDER=openai-compatible`, for example OpenRouter), or Anthropic (`DEBUTLY_PROVIDER=anthropic`). With OpenRouter, requests go only to providers that keep no copy of prompts and don't train on them (`DEBUTLY_ZERO_RETENTION=off` allows any); [Data and privacy](https://debutly.dev/docs/data-and-privacy) lists what leaves your machine. Set the model that drives the agents with `DEBUTLY_NAV_MODEL` and the one that judges and evaluates with `DEBUTLY_JUDGE_MODEL`.

What has worked well: `z-ai/glm-5.3-flash` with `DEBUTLY_REASONING_EFFORT=low` for the agents (allow about 40% more `--max-steps` than Gemini needs), and `deepseek/deepseek-v4-flash` for the judge and evaluators. `google/gemini-3.8-flash` is faster and needs fewer steps but costs about 4× as much per run; `DEBUTLY_NAV_ROUTING='{"order":["google-ai-studio/flex"]}'` halves its price, but Google AI Studio isn't among the providers that keep no data, so it also needs `DEBUTLY_ZERO_RETENTION=off`.

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
| xiaomi/mimo-v2.6-flash | 2 of 3 agents errored | 13.7 | $0.007 |

On a real SaaS app's nightly crew journey (2 owners, 4 teammates), GLM-5.3 Flash reached the same outcome and main finding as Gemini for $0.052 instead of $0.205, taking 224 steps instead of 128. DeepSeek V4 Flash caught the same fixture bugs as Gemini but averaged about 22 s a step, too slow to drive the agents in CI.

Compare models yourself (`model@endpoint` pins one OpenRouter provider endpoint):

```bash
node --env-file=.env --import tsx scripts/compare-models.ts z-ai/glm-5.3-flash google/gemini-3.8-flash@google-ai-studio/flex
```

`npx debutly costs --repo owner/app` shows your OpenRouter key's spend and what each app's latest nightly run cost.

## Development

```bash
git clone https://github.com/sroay/debutly.git && cd debutly && npm install
node bin/debutly.mjs --help   # the debutly command, from source
npm test                      # includes the acceptance test: every seeded fixture bug must be caught
npm run typecheck
```

`fixture/` is a small app with seeded bugs that the acceptance test runs agents against.

## Contributing and security

Contributions are welcome: see [CONTRIBUTING.md](CONTRIBUTING.md). To report a vulnerability, see [SECURITY.md](SECURITY.md) rather than opening a public issue.

## License

[AGPL-3.0](LICENSE). You can use, modify and self-host Debutly freely. If you run a modified version as a service for others, you must publish your changes under the same licence.
