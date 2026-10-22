---
title: What buyers think
description: Skeptical-buyer evaluators judge your landing and pricing pages against competitors, compare two versions of a page, and test an idea before it is built.
---

# What buyers think

The agents in a normal run use your product. **Evaluators** judge what it says: skeptical buyers on a budget who read your landing and pricing pages and decide whether they'd buy. They need no browser, so even hundreds cost cents. Each one must name at least two concrete objections before giving a score, and leans towards "no".

## Your pages

```bash
npx debutly perceive --icp "Owners of small marketing agencies" \
  --url https://staging.example.com/ --url https://staging.example.com/pricing \
  --competitors https://rival.example/pricing,https://other.example/pricing
```

With `--competitors`, evaluators judge you next to what your buyers would compare you with, read from those companies' own pricing pages.

## Two versions: which do buyers pick?

```bash
npx debutly perceive --icp "…" --variant A=https://staging.example.com/pricing --variant B=pricing-b.md
```

Each variant is an address or a text file. Every evaluator sees both and picks one, or neither. The report says which won, with a 95% interval, and says so when the lead could be noise.

## Before anything is built

```bash
npx debutly perceive --icp "…" --file pitch.md
```

A pitch, a landing page draft or a one-pager in a text file is enough.

## After a run

Add `--evaluators 50` (or `"evaluators": 50`) to a normal run, and evaluators judge the pages the agents saw.

## The report

`launch-readiness.md` ranks the blockers and the objections buyers raised most, compares variants, and suggests fixes. It never shows a conversion rate: it is simulated evidence, and says so.

| Option | What it does |
|---|---|
| `--tier quick\|standard\|deep` | 50, 300 or 1,500 evaluators. |
| `--evaluators N` | Exactly N evaluators. |
| `--max-cost USD` | Refuse to start if it could cost more. |
| `--store <postgres url>` | Record the run and its predictions. |

With `--store`, each prediction (the winner, the top objection, the share who would buy) is saved. Record what really happened with `npx debutly predictions record <id> <actual>`, and `npx debutly predictions accuracy` shows how often the evaluators were right.
