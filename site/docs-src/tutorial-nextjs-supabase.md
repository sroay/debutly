---
title: "Tutorial: a Next.js and Supabase app"
description: Rehearse sign-up, email confirmation and onboarding of a Next.js app with Supabase Auth, on your machine and then in GitHub Actions.
---

# Tutorial: a Next.js and Supabase app

This tutorial rehearses the first minutes of a Next.js app that uses Supabase Auth: sign up, confirm the email, finish onboarding. Everything runs on a local Supabase stack, so no real user, email or payment is touched.

You need the app's code, Node.js 20.12 or later, the [Supabase CLI](https://supabase.com/docs/guides/local-development) and Docker.

## 1. Start a local Supabase

In the app's folder:

```bash
supabase start
```

It starts the database, Auth and Studio, applies your migrations, and starts **Mailpit**, a mail catcher, on `http://127.0.0.1:54324`. Every email Auth sends ends up there instead of in a real inbox. `supabase status` prints the local API address and keys.

Supabase leaves email confirmation off locally. To rehearse it, turn it on in `supabase/config.toml` and restart with `supabase stop && supabase start`:

```toml
[auth.email]
enable_confirmations = true
```

## 2. Point the app at it

Put the local address and anon key from `supabase status` in `.env.local`, then start the app:

```bash
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<the anon key from supabase status>
```

```bash
npm run dev
```

Use test keys for anything else the app calls, such as a payment provider's test mode.

## 3. Set up Debutly

```bash
npx debutly init
```

- App address: `http://localhost:3000`.
- Goal: "Sign up and get to the main screen", or describe your onboarding.
- Customers: who your app is for.
- Mail catcher: `http://127.0.0.1:54324`.

Add your key to `.env` (`DEBUTLY_API_KEY=sk-or-…`), then check and run:

```bash
npx debutly doctor
npx debutly
```

Each agent signs up with its own address, opens the confirmation email in Mailpit, follows the link and carries on. If an agent says the email never came, check that Auth sends mail and that `enable_confirmations` is on.

## 4. Run it in GitHub Actions

The same stack runs on a GitHub runner, fresh each time:

```yaml
name: debutly
on:
  schedule: [{ cron: "0 4 * * 1" }]
  workflow_dispatch:
jobs:
  agents:
    runs-on: ubuntu-latest
    timeout-minutes: 45
    steps:
      - uses: actions/checkout@v4
      - uses: supabase/setup-cli@v1
        with:
          version: latest
      - name: Start Supabase and the app
        run: |
          supabase start
          eval "$(supabase status -o env)"
          echo "NEXT_PUBLIC_SUPABASE_URL=$API_URL" >> .env.local
          echo "NEXT_PUBLIC_SUPABASE_ANON_KEY=$ANON_KEY" >> .env.local
          npm ci && npm run build
          PORT=3000 npm start &
      - uses: sroay/debutly@v0
        with:
          api-key: ${{ secrets.DEBUTLY_API_KEY }}
```

`debutly.json` already names the mail catcher, so the agents get inboxes here too. Run `supabase status -o env` once on your machine to check the variable names your CLI version prints.
