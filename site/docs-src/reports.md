---
title: Reading the report
description: What Debutly's report says: findings and their severity, how sure each one is, where agents stopped, and failures the test environment caused.
---

# Reading the report

Every run writes `report.md`, with `findings.json`, `sessions.json` (every step of every agent) and a `screenshots` folder beside it. In GitHub Actions the report is on the workflow run's summary page. The report is labelled as simulated evidence: it comes from AI agents, not real customers.

## The top

How many agents ran, what the run cost, and the count of findings by severity. If the model provider ran out of credit part-way, a **Run cut short** note comes first: the agents it stopped are named, and the findings cover only the steps they took.

## Agent outcomes

One line per agent: who it was, any access need, and how it ended.

| Outcome | Meaning |
|---|---|
| `success` | It reached the goal, and said so. |
| `gave_up` | It stopped where that person would have given up, and says why. Often the most useful line in the report. |
| `budget_exhausted` | It used all its steps (`maxSteps`) or a token or time cap first. |
| `not_invited` | A teammate whose invite email never arrived. |
| `error` | Something outside your app stopped it: the model provider, or the browser. |
| `cancelled` | The run was stopped with Ctrl+C or `npx debutly cancel`. |

**Where agents stopped** lists each agent that didn't succeed, the page it was on, and its own words.

## Findings

Each finding says what went wrong, how many of the agents who reached that page ran into it, and how to reproduce it: the agent's steps, each with its reason, and a screenshot.

| Finding | What it means |
|---|---|
| HTTP error | A request returned 4xx or 5xx. 404s at addresses an agent made up itself are left out. |
| JavaScript error | An uncaught error on the page. |
| Console error | The page logged an error. |
| Can't click | Something kept covering a control, such as a cookie banner, a tour popup or a fixed bar, so a person can't press it either. |
| Unlabeled control | A button, link or field with no name, which a screen reader announces only as "button". |
| Slow page | The page took over 10 seconds to arrive. |
| Agent stuck | An agent did the same thing three times on one page and nothing changed. |

### Severity

- **Blocker**: a serious problem on a page customers must get through: sign-up, sign-in, onboarding, pricing, checkout, billing, payment or invites.
- **Major**: server errors and JavaScript errors, controls something covers, agents stuck, and pages over 30 seconds or that never arrived. A minor problem on one of the critical pages above is major too.
- **Minor**: everything else, such as a 404 for an image or an unlabeled icon button.

### Confidence

Confidence is the share of agents who reached that page and ran into the problem. Half or more is **high**, a quarter or more is **medium**, anything less is **low**. Low-confidence findings get their own section: they may be the agent's own mistake rather than your app's.

## Caused by the test environment

Failures your test copy caused, not your app: a server error saying a key is missing, a website an agent invented that the app couldn't reach, or an outside call your sandbox blocked at the same moment. They are listed last with the reason, and left out of the counts at the top. [Test environments](/docs/test-environments) explains how Debutly decides.

## In the dashboard

Recorded runs also appear in the [dashboard](/docs/dashboard), where each finding links to a step-by-step replay of the moment it happened, and findings are marked new, recurring or gone from one run to the next.

## Show that you rehearse

If your project is public, a badge in your README tells visitors you test the first-customer journey before you ship:

[![Rehearsed with Debutly](https://debutly.dev/badge.svg)](https://debutly.dev)

```markdown
[![Rehearsed with Debutly](https://debutly.dev/badge.svg)](https://debutly.dev)
```
