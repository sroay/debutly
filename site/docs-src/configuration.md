---
title: Configuration
description: Every Debutly setting, in debutly.json and as a command-line flag, and the environment variables for keys, models and the run store.
---

# Configuration

A run reads its settings from `debutly.json` in the folder you run it in. Flags on the command line override the file for that run, so `npx debutly --tier standard` runs a bigger rehearsal without editing anything.

```json
{
  "$schema": "https://debutly.dev/schema.json",
  "url": "http://localhost:3000",
  "goal": "Sign up, choose a plan and invite a teammate",
  "icp": "Owners of small marketing agencies, 2 to 15 people",
  "unit": "business",
  "employees": 2,
  "tier": "quick",
  "maxCost": 1
}
```

The `$schema` line gives you completion and checking in editors that support JSON Schema, such as VS Code.

## Settings

In `debutly.json` a setting is camelCased; as a flag it is written with dashes: `maxCost` is `--max-cost`.

| Setting | Default | What it does |
|---|---|---|
| `url` | (required) | Where the test copy of your app runs. |
| `goal` | (required) | What the agents try to get done, in a sentence. |
| `icp` | (required) | Who your customers are. Debutly casts people like them. |
| `unit` | `individual` | `individual`: one person per customer. `business`: an owner and teammates per customer. See [Teams and invites](/docs/teams). |
| `tier` | `quick` | Run size. `quick`: 3 customers, owners only. `standard`: 10 customers with 2 teammates each. `deep`: 30 with 3 each. |
| `agents` | from the tier | How many customers (people or businesses). |
| `employees` | from the tier | Teammates per business, 0 to 4. |
| `maxCost` | none | Refuse to start a run that could cost more than this, in US dollars. |
| `maxSteps` | `30` | Most actions one agent takes before it stops. |
| `inclusion` | `on` | `off` leaves out the screen-reader, low-vision, slow-connection and non-native English agents. |
| `languages` | none | Your customers' first languages as codes, such as `ar,en`. Agents take them in turn, each with their browser set to their language. An Arabic-first agent switches the site to Arabic when it can, writes its name in Arabic script, and types numbers as an Arabic phone keyboard does (٠٥٠…). |
| `concurrency` | `3` | How many agents use the app at once. |
| `mailpit` | none | Address of a Mailpit mail catcher, which gives each agent an inbox for confirmation links and invites. |
| `emailDomain` | `agents.test` | The domain of the agents' email addresses. |
| `sandboxOutbox` | none | Your app's sandbox outbox, so failures the test environment caused are listed apart. See [Test environments](/docs/test-environments). |
| `app` | the repo name in GitHub Actions | The app's name in the dashboard. |
| `evaluators` | none | After the run, this many skeptical-buyer evaluators judge the pages the agents saw. See [What buyers think](/docs/buyers). |
| `agentTokenCap` | none | Most model tokens one agent may use. |
| `agentMinutes` | none | Most minutes one agent may run. |
| `screenshotDays` | `7` | Days to keep screenshots stored in the database. |

Only on the command line:

| Flag | What it does |
|---|---|
| `--out <folder>` | Where the report goes. Default: `.debutly/runs/<time>`. |
| `--store <postgres url>` | Record the run in a database for the dashboard. `DEBUTLY_STORE_URL` does the same and keeps the address out of your shell history. |
| `--queue <redis url>` | Hand the agents to workers (`npx debutly worker`) instead of running them here. |
| `--browser-state <folder>` | Keep each agent's signed-in browser (cookies, storage) there when it finishes, so `npx debutly hear` can open pages behind sign-in. It holds session cookies for your test copy: keep it out of reports and repos. |
| `--trigger`, `--ci-url` | What started the run and its CI page, for the dashboard. GitHub Actions fills these in. |

The address of a database holds a password, so `debutly.json` can't name one: set `DEBUTLY_STORE_URL` instead.

## Environment variables

Debutly reads these from your shell and from a `.env` file in the folder it runs in. Values already set in your shell win.

| Variable | What it does |
|---|---|
| `DEBUTLY_API_KEY` | Your model key. `OPENROUTER_API_KEY` or `ANTHROPIC_API_KEY` is used when this isn't set. |
| `DEBUTLY_STORE_URL` | A Postgres address to record runs in, for the dashboard. |
| `DEBUTLY_SANDBOX_TOKEN` | The token for your app's sandbox outbox. |
| `DEBUTLY_PROVIDER` | `openai-compatible` or `anthropic`. Worked out from the key when unset. |
| `DEBUTLY_BASE_URL` | The provider's API address, for `openai-compatible`. OpenRouter when the key is an OpenRouter key. |
| `DEBUTLY_NAV_MODEL` | The model that drives the agents. Default with OpenRouter: `z-ai/glm-5.3-flash`. |
| `DEBUTLY_JUDGE_MODEL` | The model that casts the customers and judges pages. Default with OpenRouter: `deepseek/deepseek-v4-flash`. |
| `DEBUTLY_REASONING_EFFORT` | `low`, `medium` or `high`: how much the agents' model thinks before each step. Default with OpenRouter: `low`. |
| `DEBUTLY_NAV_ROUTING` | OpenRouter provider routing for the agents' model, as JSON, e.g. `{"order":["google-ai-studio/flex"]}`. |
| `DEBUTLY_JUDGE_ROUTING` | The same for the judge model. |
| `DEBUTLY_ZERO_RETENTION` | With OpenRouter, requests go only to providers that keep no copy of prompts and don't train on them. `off` allows any provider. See [Data and privacy](/docs/data-and-privacy). |

A `.env` in the folder can only change where your key is sent (`DEBUTLY_BASE_URL`) if it holds the key too. That way a `.env` in a repository you cloned can't send the key from your shell somewhere else.

## Commands

| Command | What it does |
|---|---|
| `npx debutly init` | Asks a few questions and writes `debutly.json`, and a GitHub workflow if you want one. |
| `npx debutly` | Runs the agents (the same as `npx debutly run`). |
| `npx debutly doctor` | Checks the key, the browser, the config and that the app answers. |
| `npx debutly perceive` | Skeptical-buyer evaluators judge your pages, two versions of a page, or an idea. |
| `npx debutly hear [report]` | Checks a run's screen-reader findings with NVDA, on Windows. See [Reports](reports.html#heard-with-a-screen-reader). |
| `npx debutly cancel <run id> --store <url>` | Stops a recorded run from anywhere. |
| `npx debutly import` | Loads earlier runs from GitHub Actions report artifacts into the dashboard's database. |
| `npx debutly costs` | Your OpenRouter key's spend, and what each app's latest run cost. |

Press Ctrl+C once during a run and the agents stop at their next step and the report is still written. Press it again to quit at once.
