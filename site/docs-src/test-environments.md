---
title: Test environments
description: Where to point Debutly's agents, never production, and how a sandbox outbox lets Debutly tell test-environment failures from real bugs.
---

# Test environments

> **Never point Debutly at production.** The agents create accounts, fill in forms, upload files and pay. They do it the way customers would, so on your real app they would leave real accounts, send real emails and, without test keys, try to charge real cards.

Whatever is on the pages the agents visit is sent to your model provider and kept in screenshots, so give the test copy made-up data only. [Data and privacy](/docs/data-and-privacy) lists exactly what leaves your machine.

## Good places to run

- **Your machine.** Your app running locally with a local database and test keys.
- **A staging site** that is yours to fill with test accounts.
- **A throwaway copy in CI**, built on the runner and deleted afterwards. This is the safest: an empty database every time, so every run starts like launch day. See [GitHub Actions](/docs/github-actions).

`npx debutly doctor` warns when an address doesn't look like a local, staging or test copy.

## What the agents will and won't do

- They pay only with the test card `4242 4242 4242 4242`, which payment providers' test modes accept and live modes refuse.
- They never press a button or choose an option that deletes, removes, deactivates, closes an account or cancels a subscription. The attempt is recorded and refused.
- They won't type in another site's address. They only leave your app by clicking a link on your pages or in their own emails.
- They can attach files: a sample photo and a sample document, made up on the spot.

## Email

Agents can only confirm an email or accept an invite if they can read their mail. Give them a mail catcher: run [Mailpit](https://mailpit.axllent.org), point your app's email sending at it, and set `mailpit` in `debutly.json` to its address. Each agent gets its own address, like `maya.u1-o.k3x9@agents.test`, and reads only its own mail. `supabase start` runs Mailpit for you on `http://127.0.0.1:54324`.

## Telling test-environment failures from bugs

A good test copy has no real keys: it can't send real email, charge cards or call paid APIs. Your app may fail when it tries, and those failures aren't bugs your customers will see. Debutly files them under **Caused by the test environment** instead of in your findings when:

- the app's server error says a key or setting is missing, such as "No Gemini API key configured" or "OPENAI_API_KEY is not set";
- the app couldn't reach a website an agent made up for its company (agents invent their businesses, websites included);
- your app's sandbox was blocking an outside call, or faking an AI answer, at the moment the failure happened.

The first two need nothing from you. The last needs a **sandbox outbox**.

### The sandbox outbox

A sandbox is the part of your test copy that intercepts outside calls: it records an email instead of sending it, or blocks a call to a payment API. If it keeps a list of what it did, Debutly can read it after the run. Expose that list at an address in your test copy, and set `sandboxOutbox` to it and `DEBUTLY_SANDBOX_TOKEN` to a token only the test copy and Debutly share.

Debutly asks for everything since the run started:

```http
GET /api/sandbox/outbox?since=2026-10-22T04:00:00.000Z
Authorization: Bearer <DEBUTLY_SANDBOX_TOKEN>
```

and expects JSON like this:

```json
{
  "entries": [
    {
      "outcome": "blocked",
      "channel": "payment",
      "host": "api.stripe.com",
      "url": "https://api.stripe.com/v1/charges",
      "summary": "charge for the Team plan",
      "created_at": "2026-10-22T04:03:12.481Z"
    },
    {
      "outcome": "faked",
      "channel": "email",
      "host": "api.resend.com",
      "recipient": "maya.u1-o.k3x9@agents.test",
      "summary": "Confirm your email",
      "created_at": "2026-10-22T04:01:40.022Z"
    }
  ]
}
```

- `outcome` is `blocked` (the call was refused) or `faked` (the sandbox answered in its place).
- `channel` says what kind of call it was: `email`, `payment`, `ai` or anything else.
- `host`, `url`, `recipient`, `summary` and `rule` (which of your sandbox's rules applied) are shown in the dashboard. Only `outcome`, `host` and `created_at` are required.

A server error from your app counts as the test environment's doing when every time it happened, the sandbox blocked a call, or faked an AI answer, within two seconds of it. Faked emails don't count: your app was told they were sent. Only build the outbox into the test copy, never into production.
