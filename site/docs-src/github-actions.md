---
title: GitHub Actions
description: Run Debutly's agents on a schedule in GitHub Actions against a throwaway copy of your app, with the sroay/debutly action.
---

# GitHub Actions

The safest place to run Debutly is a throwaway copy of your app, built fresh on the CI runner and thrown away afterwards: your real code and schema, an empty database, test keys only. Your code and keys never leave your own CI.

`npx debutly init` can write this workflow for you. By hand, it is three steps:

```yaml
# .github/workflows/debutly.yml, next to debutly.json
name: debutly
on:
  schedule: [{ cron: "0 4 * * 1" }]   # Mondays at 04:00 UTC
  workflow_dispatch:                 # and a "Run workflow" button
jobs:
  agents:
    runs-on: ubuntu-latest
    timeout-minutes: 45
    steps:
      - uses: actions/checkout@v4
      - run: |                         # start a test copy of your app
          npm ci && npm run build
          PORT=3000 npm start &
      - uses: sroay/debutly@v0
        with:
          api-key: ${{ secrets.DEBUTLY_API_KEY }}
```

Then add your model key as a repository secret named `DEBUTLY_API_KEY`: in your repository, **Settings → Secrets and variables → Actions → New repository secret**.

## What the action does

1. Installs Debutly and Chromium on the runner.
2. Waits for your app to answer, up to three minutes.
3. Runs the agents with the settings in `debutly.json`.
4. Puts the report on the workflow run's summary page, and attaches the screenshots and full record as an artifact called `debutly-report`.

## Inputs

Inputs override `debutly.json`, so you can keep one file and run different rehearsals from different workflows.

| Input | Default | What it does |
|---|---|---|
| `api-key` | (required) | Your model key. Always pass it from a secret. |
| `url` | `url` in debutly.json | Where the app runs on the runner. |
| `goal` | `goal` in debutly.json | What the agents try to do. |
| `icp` | `icp` in debutly.json | Who your customers are. |
| `tier` | debutly.json, then `quick` | `quick`, `standard` or `deep`. |
| `max-cost` | `1.00` | Refuse to start a run that could cost more, in US dollars. |
| `args` | none | Any other flags, e.g. `--unit business --mailpit http://127.0.0.1:54324`. |
| `wait-seconds` | `180` | How long to wait for the app to answer. |
| `store-url` | none | A Postgres address to record the run for the [dashboard](/docs/dashboard). Pass it from a secret. |

The action has one output, `report`: the folder with `report.md`, `findings.json`, `sessions.json` and the screenshots, for steps after it.

## Starting your app on the runner

The step before the action has to leave your app running. A command ending in `&` keeps running in the background for the rest of the job. Use test keys only: a payment provider's test mode, no real email sending. If your app needs a database, start one in the job too. With Supabase, `supabase start` runs the whole stack, including a mail catcher at `http://127.0.0.1:54324` that gives the agents inboxes; see the [Next.js and Supabase tutorial](/docs/tutorial-nextjs-supabase).

## When to run it

- **On a schedule**, as above. Weekly suits most apps; nightly if you ship every day.
- **On pull requests** that touch sign-up, billing or onboarding, with `on: pull_request` and a `paths:` filter.
- **Before a launch**, from the Actions tab with **Run workflow**.

In a public repository, anyone can see a workflow run's summary and download the `debutly-report` artifact, screenshots included. If the pages show anything you wouldn't publish, run it from a private repository.

A quick run takes 5 to 15 minutes of runner time. GitHub Actions is free for public repositories; private repositories use your plan's minutes.
