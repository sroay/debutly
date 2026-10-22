---
title: The dashboard
description: Record Debutly runs in Postgres and browse them in the dashboard. Runs, findings across runs, step-by-step replays with screenshots, and spend.
---

# The dashboard

Recorded runs can be browsed in the Debutly dashboard:

- **Overview**: each app's latest run, a trend of recent runs and open bugs.
- **Runs**: every run, its businesses and agents and how far they got. Findings are split into bugs in the app, doubtful ones, and ones the test environment caused.
- **Replays**: each agent's run step by step, with the screenshot, what it did, why, and what happened next.
- **Findings**: every finding across runs, marked new, recurring or gone in the latest run.
- **Spend**: model cost per day and per app.

## Record your runs

Any Postgres database works, and a free one from [Neon](https://neon.tech) or [Supabase](https://supabase.com) is plenty. Put its address in `DEBUTLY_STORE_URL`, in `.env` locally or as a secret in CI, and every run is recorded as it happens:

```bash
DEBUTLY_STORE_URL=postgres://user:password@host/db
```

In GitHub Actions, pass it to the action with `store-url: ${{ secrets.DEBUTLY_STORE_URL }}`. Runs are labelled with the app's name, from `app` in `debutly.json` or, in GitHub Actions, the repository's name. Screenshots are kept in the database as small JPEGs and removed after `screenshotDays` (7 by default).

Runs from before you set this up can be loaded from GitHub Actions report artifacts, with the [GitHub CLI](https://cli.github.com) signed in:

```bash
npx debutly import --store "$DEBUTLY_STORE_URL" --github owner/repo --app my-app
```

## Run the dashboard

The dashboard is a Next.js app in the `dashboard` folder of the [repository](https://github.com/sroay/debutly).

Locally:

```bash
git clone https://github.com/sroay/debutly.git && cd debutly && npm install
echo "DATABASE_URL=postgres://…" > dashboard/.env.local
npm run dashboard
```

`DATABASE_URL` can also be `pglite:<folder>`, a database in a local folder with no server.

On [Vercel](https://vercel.com): import the repository, set **Root Directory** to `dashboard`, and add two environment variables: `DATABASE_URL`, and `DASHBOARD_PASSWORD`, the one password that opens it. Without `DASHBOARD_PASSWORD` a deployed dashboard turns everyone away; only `npm run dashboard` on your machine is open.
