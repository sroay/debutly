---
title: Troubleshooting
description: Fixes for the problems people hit most with Debutly. Keys and credits, agents that can't get past email or sign-in, slow pages and the browser download.
---

# Troubleshooting

Start with `npx debutly doctor`: it checks most of what can go wrong and says what to do.

## "No model API key"

Put `DEBUTLY_API_KEY=…` in a `.env` file in the folder you run Debutly in, or set `OPENROUTER_API_KEY` in your shell. Get a key at [openrouter.ai/keys](https://openrouter.ai/keys).

## "The provider rejects the API key"

The key is wrong, revoked or cut short. Copy it again in full, or create a new one.

## "The AI provider account is out of credits"

Top up on OpenRouter, or raise the key's limit, and run again. If it happened part-way, the report starts with **Run cut short** and names the agents that stopped. Debutly checks a key's limit before a run, so give your key one to be told before a run starts instead.

## "No allowed providers are available for the selected model"

With OpenRouter, Debutly only uses providers that keep no copy of your prompts, and the model you chose has none. Pick one of the recommended models, or set `DEBUTLY_ZERO_RETENTION=off` to allow any provider. See [Data and privacy](/docs/data-and-privacy).

## "Refusing to start: this run could cost up to…"

The estimate is above `maxCost`. Raise `maxCost`, or make the run smaller with `--agents`, `--max-steps` or a smaller `--tier`.

## "Nothing answers at http://localhost:3000"

Start your app first, and check the address and port in `debutly.json`. In GitHub Actions, the step before the action must leave the app running; the action waits up to `wait-seconds` (180) for it.

## Agents never confirm their email

They need a mail catcher: set `mailpit` to your Mailpit's address, and make sure your test copy sends its email there. Without one, they can't open confirmation links or invites. See [Test environments](/docs/test-environments#email).

## Agents can't sign in with Google, GitHub and the like

Social sign-in goes to another company's real sign-in page, which agents can't and shouldn't get through. Give your test copy email sign-up, or a test-only sign-in.

## Teammates are "not_invited"

Their invite email didn't reach Mailpit by the time the owner finished. Check that the owner reached the invite step (its steps are in the report), and that invite emails go to the mail catcher. If the owner did invite them, that is a finding.

## An agent ran out of steps

`budget_exhausted` means it used all of `maxSteps` (30). A long journey may need more: `--max-steps 50`. If it spent them going round in circles, the findings usually say why, such as a control something covers.

## Lots of "Caused by the test environment"

That is your test copy working as intended: no real keys, outside calls blocked. Those failures are kept out of your findings. If one hides a real bug, check it on a staging copy with the real integration in test mode.

## Downloading Chromium fails

The first run downloads it with Playwright. Behind a proxy or firewall, run `npx playwright install chromium` yourself, or set `PLAYWRIGHT_DOWNLOAD_HOST`. On Linux CI, `npx playwright install --with-deps chromium` adds the system libraries it needs; the GitHub Action does this for you.

## ".env here sets DEBUTLY_BASE_URL, but your key comes from your environment"

A `.env` in the folder tried to change where your key is sent while the key itself came from your shell. Debutly ignores the address so a `.env` in a repository you cloned can't send your key elsewhere. Put the key in the same `.env` if you meant it.

## Still stuck

[Open an issue](https://github.com/sroay/debutly/issues) with the command you ran and its output. Leave out your key and any database addresses.
