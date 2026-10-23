---
title: Quick start
description: Your first Debutly run in about five minutes. Set up with npx debutly init, add one model key, check with npx debutly doctor and run.
---

# Quick start

Your first run takes about five minutes. You need Node.js 20.12 or later and a test copy of your app.

> **Before the first npm release**, type `npx github:sroay/debutly` wherever this page says `npx debutly`. The first time takes a minute or two while npm downloads it.

## 1. Set up

In your app's folder:

```bash
npx debutly init
```

It asks four things:

- **Where the test copy runs.** For example `http://localhost:3000`. Never your real site.
- **What the agents should try.** Sign up, buy a plan, invite a teammate, or something you describe.
- **Who your customers are.** One sentence, like "Owners of small marketing agencies, 2 to 15 people". With a key in place, init suggests one from your home page.
- **Whether they work as a team**, and the address of a mail catcher if sign-up sends a confirmation email.

It writes `debutly.json` with your answers and adds `.env` and `.debutly/` to `.gitignore`. It can also write a GitHub workflow; see [GitHub Actions](/docs/github-actions).

## 2. Add a model key

Create a key at [openrouter.ai/keys](https://openrouter.ai/keys) and put it in a file called `.env` in the same folder:

```bash
DEBUTLY_API_KEY=sk-or-v1-…
```

That is the only setting a run needs. With an OpenRouter key, Debutly uses GLM-5.3 Flash for the agents and DeepSeek V4 Flash to write the customers, the cheapest pair that worked well in our tests. If `OPENROUTER_API_KEY` or `ANTHROPIC_API_KEY` is already set in your shell, Debutly uses that.

Giving the key a monthly spending limit on OpenRouter is a good idea: Debutly reads the limit before each run and refuses to start one it can't pay for.

## 3. Check

Start your app's test copy, then:

```bash
npx debutly doctor
```

It checks Node.js, the key (without printing it), the browser, `debutly.json`, and that your app answers. Anything wrong comes with what to do about it:

```text
✓ Node.js 22.4.0
✓ API key found (https://openrouter.ai/api/v1; agents use z-ai/glm-5.3-flash)
✓ The provider accepts the API key
    $4.50 left on the key's limit; the account's own balance isn't visible here
✓ Chromium is installed
✓ debutly.json: "Sign up and invite a teammate"
✓ http://localhost:3000 answers (HTTP 200)

Ready. Start a run with: npx debutly
```

## 4. Run

```bash
npx debutly
```

The first run downloads Chromium, the browser the agents use (about 150 MB, once per machine). Then Debutly prints what the run could cost, casts the customers and lets them loose. A quick run of three agents takes a few minutes.

The report is in `.debutly/runs/<time>/report.md`, next to the screenshots and the full record of every step. [Reading the report](/docs/reports) explains it.

## Next

- Change a setting for one run with a flag: `npx debutly --tier standard --max-cost 3`. All settings are in [Configuration](/docs/configuration).
- Test sign-up emails and team invites: [Teams and invites](/docs/teams).
- Run it every week in CI: [GitHub Actions](/docs/github-actions).
