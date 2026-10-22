---
title: Debutly docs
description: How to rehearse your launch with Debutly. AI agents use a test copy of your web app like its first customers and report what broke.
---

# Debutly docs

Debutly sends AI agents through a test copy of your web app, as if they were your first customers. In a real browser they sign up, confirm their email, pick a plan, invite teammates and use the product. Then they tell you what broke, where they got stuck and where they gave up, with the steps to reproduce each problem and screenshots.

It runs on your machine or in your own GitHub Actions, with your own model key. A quick run costs a few cents.

## Start here

- **[Quick start](/docs/quick-start).** Your first run in about five minutes: `npx debutly init`, a key, `npx debutly`.
- **[GitHub Actions](/docs/github-actions).** Run the agents on a schedule against a throwaway copy of your app.
- **[Reading the report](/docs/reports).** What each finding means, how sure Debutly is, and what it leaves out.

## What you need

- Node.js 20.12 or later.
- A model key. An [OpenRouter](https://openrouter.ai/keys) key is the simplest: one key, and Debutly picks models that are cheap and good at this. An Anthropic key works too.
- A test copy of your app: on your machine, a staging site, or one built fresh in CI.

> **Never point Debutly at production.** Agents create accounts, submit forms and pay with test cards. Use a local, staging or throwaway copy with test keys. [Test environments](/docs/test-environments) explains how to set one up.

## How a run works

1. Debutly reads who your customers are and what they should get done, and casts made-up customers like them: owners with budgets, their teammates, and people who use the web differently.
2. Each agent gets its own browser and, if you have a mail catcher, its own inbox. It reads the screen, decides what that person would do next and does it, one step at a time.
3. Debutly watches for server errors, page errors, controls that can't be pressed, unlabeled buttons, slow pages and agents going round in circles.
4. You get a report: every problem with how many agents hit it, the steps to reproduce it and screenshots. Failures your test environment caused are listed apart.

Every run includes a screen-reader user, someone with low vision, someone on a slow connection and a non-native English speaker, so accessibility problems show up next to the rest.
