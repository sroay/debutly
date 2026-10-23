---
title: Data and privacy
description: What leaves your machine when Debutly runs, where it goes, how to keep model providers from storing it, and how to keep real data out of a rehearsal.
---

# Data and privacy

Debutly runs on your machine or in your own CI. It has no server of its own and sends nothing to its authors. A run talks only to places you choose: your app's test copy, your model provider, and, if you set them up, your mail catcher, your sandbox outbox, your database and your S3 storage. Before a run it also reads OpenRouter's public list of model prices.

## What the model provider receives

The agents read pages as text, not pictures. For every step, the agents' model receives:

- the agent's made-up persona, its goal and the rules it follows;
- the page's address and title, its buttons, links and fields with their names and current values, and up to 2,000 characters of its visible text;
- a one-line note of each earlier step.

The judge model receives your description of your customers, to cast the agents. When evaluators judge pages, it receives those pages' text. `npx debutly init` sends up to 4,000 characters of your app's home page to it, to suggest who your customers are.

Screenshots never go to a model. They stay in the run's folder, your database or your S3 storage.

## Keeping providers from storing it

With an OpenRouter key, Debutly asks OpenRouter to route every request only to providers that **keep no copy of prompts** (zero data retention) and **don't use them for training**. On 23 October 2026 the recommended models (`z-ai/glm-5.3-flash`, `deepseek/deepseek-v4-flash` and `google/gemini-3.8-flash`) were all served that way at their usual price.

- `DEBUTLY_ZERO_RETENTION=off` allows any provider, for a model that has no such provider. Without it, a request for such a model fails with "No allowed providers are available for the selected model".
- `DEBUTLY_NAV_ROUTING` and `DEBUTLY_JUDGE_ROUTING` add OpenRouter routing of your own (JSON) to the agents' and the judge's requests.
- With Anthropic or another provider, that provider's own data terms apply; check them. Any OpenAI-compatible API works, including one you host yourself, though Debutly hasn't been tested against a self-hosted model yet.

## What the agents type

- Made-up names and details, written by the model for each persona.
- Email addresses at `agents.test`, or the domain you set with `emailDomain`. `.test` addresses can't receive real mail; your mail catcher picks it up.
- Passwords they make up, and the test card `4242 4242 4242 4242`.
- A sample photo and a sample document when a page asks for a file.

## Keep real data out

Whatever is on a page the agents visit goes to the model provider and into screenshots. So:

- **Never point Debutly at production**, or at a copy holding real customers' data. Seed the test copy with made-up data.
- **Give the test copy test keys only**, so nothing it does reaches a real payment, email or AI account.
- **Mind who can see reports.** In a public GitHub repository, workflow run summaries and the `debutly-report` artifact, screenshots included, can be seen by anyone. Use a private repository, or leave the artifact out, if pages show anything you wouldn't publish.

## Keys and passwords

- Your model key is read from your environment or a `.env` file and is never printed, not even by `npx debutly doctor`.
- A `.env` file can only change where the key is sent if it holds the key itself, so one in a repository you cloned can't send the key from your shell somewhere else.
- A database address holds a password, so it goes in `DEBUTLY_STORE_URL`, never in `debutly.json`.
- A deployed dashboard turns everyone away unless `DASHBOARD_PASSWORD` is set.
