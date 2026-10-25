---
title: Reading the report
description: What Debutly's report says: findings and their severity, how sure each one is, where agents stopped, and failures the test environment caused.
---

# Reading the report

Every run writes `report.md`, with `findings.json`, `sessions.json` (every step of every agent), `people.json` (the agents, to run them again) and a `screenshots` folder beside it. In GitHub Actions the report is on the workflow run's summary page. The report is labelled as simulated evidence: it comes from AI agents, not real customers.

## The top

How many agents ran, what the run cost, and the count of findings by severity. If the model provider ran out of credit part-way, a **Run cut short** note comes first: the agents it stopped are named, and the findings cover only the steps they took.

## Fix these first

Up to five things to look at, in order, so the report is useful in a couple of minutes:

1. Each agent that gave up, ran out of steps or never got its invite: where it stopped, in its own words (or its last thought, if it ran out of steps), and its last screenshot.
2. Then the blocker and major findings, those an agent that stopped ran into first, each with one line on what to do.

Minor and low-confidence findings are left for the full list below.

To see whether a fix worked, run the same agents again: `npx debutly --people <earlier report folder>/people.json`. Without it, each run meets new people, and access needs change from day to day.

## Agent outcomes

One line per agent: who it was, any access need, its first language when the run has `languages`, and how it ended.

| Outcome | Meaning |
|---|---|
| `success` | It reached the goal, and said so. |
| `gave_up` | It stopped where that person would have given up, and says why. Often the most useful line in the report. An agent about to give up on a page with a Continue, Join or Sign in button it never pressed there is asked once whether it has tried it, as a person who wanted in would. |
| `budget_exhausted` | It used all its steps (`maxSteps`) or a token or time cap first. |
| `not_invited` | A teammate whose invite email never arrived. |
| `error` | Something outside your app stopped it: the model provider, or the browser. |
| `cancelled` | The run was stopped with Ctrl+C or `npx debutly cancel`. |

**Where agents stopped** lists each agent that didn't succeed, the page it was on, and its own words.

## Findings

Each finding says what went wrong, how many of the agents who reached that page ran into it, and how to reproduce it: the agent's steps, each with its reason, and a screenshot. Pages that differ only by an id count as one page, written with `:id`: `/accounts/2/onboarding` and `/accounts/3/onboarding` are both `/accounts/:id/onboarding`.

| Finding | What it means |
|---|---|
| HTTP error | A request returned 4xx or 5xx. 404s at addresses an agent made up itself are left out. |
| JavaScript error | An uncaught error on the page. |
| Console error | The page logged an error. |
| Can't click | Something kept covering a control, such as a cookie banner, a tour popup or a fixed bar, so a person can't press it either. |
| Unlabeled control | A button, link or field with no name, which a screen reader announces only as "button". Each finding says where the control is, by the named controls around it, and which icon it shows when the page's markup names one ("the trash icon"). Controls that Tab can't reach (disabled, or out of the tab order) and controls that have only a description are reported apart, as minor. |
| Named only by its placeholder | A field with no label, which a screen reader names by its placeholder (a password's dots read as "13 bullet"). The placeholder is gone once someone types. |
| Slow page | The page took over 10 seconds to arrive. It says what its scripts and styles weighed by then, and when most came uncompressed, that a test copy served straight from its container can be heavier than the real site. |
| Agent stuck | An agent did the same thing three times on one page and nothing changed. |
| Can't reach with the keyboard | The screen-reader agent couldn't move focus to a control: it isn't in the tab order. |
| Enter doesn't press a button | The screen-reader agent pressed Enter on a button and nothing happened; Space pressed it. Most keyboard users press Enter, and stop there. Debutly tries Space only when Enter left the page looking exactly the same and sent nothing, so a button is never pressed twice. |
| Keyboard focus hidden | A control with keyboard focus was entirely covered by something else. |
| Scrolls sideways at 320 pixels | At 400% zoom the page is wider than the window. |
| Language | The page doesn't say its language, or an Arabic page says another language or runs left to right. |
| Zoom stopped | The page's viewport setting stops pinch-zoom on phones (`user-scalable=no`, or `maximum-scale` under 2). |

### Access needs: what is measured and what is acted out

The first agents in each run take on one access need each, rotating daily, so a quick run of three agents covers three of the four.

- **Measured on every page, whoever visits it.**
  - Controls with no name, by the name the browser itself gives assistive technology (Chromium's accessibility tree).
  - Whether the page says what language it is in, and whether it lets people pinch-zoom on a phone (WCAG 1.4.4).
  - On a page that is mostly Arabic, whether it says so and runs right to left.
  - Clicks that land on something covering the control, and how long the first page takes to arrive.
- **The screen-reader agent** hears what the browser tells assistive technology: each control's role and name, without the controls hidden from it. It works **by keyboard only**: it moves focus to a control, as Tab would, and presses Enter or Space.
  - A control outside the tab order is one it can't use, and is reported (related to WCAG 2.1.1).
  - So is a focused control that something entirely hides (WCAG 2.4.11).
  - **Not checked:** the order Tab moves through, whether focus is visible, or what a screen reader would read aloud and when. Items inside lists, menus, tabs and radio groups, which keyboards reach with the arrow keys, are still chosen as a mouse would.
- **The low-vision agent** works in a 640×400 window, which lays pages out as 200% zoom does on a laptop.
  - As it arrives on each page, its window is narrowed for a moment to 320 CSS pixels wide (400% zoom), measured, and widened again. Nothing is opened twice.
  - A page that scrolls sideways at that width is reported (WCAG 1.4.10), with the element that sticks out. A data table or other content that needs two dimensions is marked as possibly allowed.
  - It doesn't model eyesight or contrast.
- **The slow-connection agent's** network really is throttled, to 500 kbit/s with 400 ms round trips.
- **The non-native English agent** is acted out entirely by the model.
- **First languages.** With `languages` (such as `ar,en`), agents also take customers' first languages in turn, with their browser set to that language, so a site that follows the browser shows it. An Arabic-first agent switches the site to Arabic when it can, writes its name in Arabic script and types numbers with Arabic-Indic digits, which some forms wrongly refuse. When a form refuses a request (400 or 422) just after an agent typed Arabic into it, the finding says what was typed into which field. Every page is checked for its language and, if mostly Arabic, its direction, whichever agent visits it.

Findings like these name the WCAG 2.2 success criteria they relate to, with a link to W3C's explanation of each: 1.3.1, 1.4.4, 1.4.10, 2.1.1, 2.4.4, 2.4.11, 3.1.1, 3.3.2 and 4.1.2. They point to things a person should check, with assistive technology where it matters. A run with no such findings says nothing about conformance with WCAG or any accessibility standard.

### Heard with a screen reader

What Chromium tells assistive technology is close to what a screen reader says, but not the same. On three open-source apps, real NVDA didn't bear out about a third of the unnamed-control findings, and showed problems the browser's names hid. `npx debutly hear` checks a run's screen-reader findings with a real screen reader before you report them: NVDA on Windows, or VoiceOver on macOS.

1. Run the agents and keep their signed-in browsers: `npx debutly --browser-state .debutly/browser-state`. The folder holds the agents' session cookies for your test copy, so don't upload it or commit it.
2. On Windows or macOS, with the app still running, install Guidepup and set up the screen reader for automation (once): `npm i -D @guidepup/guidepup` then `npx @guidepup/setup`. On a Mac this asks you to allow VoiceOver to be controlled by AppleScript, and your terminal to control the computer (Accessibility).
3. Run `npx debutly hear .debutly/runs/<run> --browser-state .debutly/browser-state`.

The screen reader starts, and Chrome opens each page that had a screen-reader finding. Tab is pressed through each page from the top until it has been round twice (arriving on a page, NVDA sometimes names the first field only on the way round again), and Debutly notes which control had focus at each press. Each finding gets a verdict from what the screen reader said about that very control:

- **confirmed:** the screen reader said what the finding says. For example "button" with no name, or a field named by its placeholder ("john at doe dot com, edit").
- **not confirmed:** Tab never reached the control, or did reach one the finding said it couldn't.
- **check by ear:** it said something a person should judge.
- **not on the page:** the control wasn't there when the page was opened again, or the page led elsewhere (often a sign-in page, without `--browser-state`).

The report gets a "Heard with a screen reader" section, and `heard.json` beside it. The screen reader takes over the screen while it works, so use a machine you aren't using, such as a Windows or macOS GitHub runner. VoiceOver is checked with Chrome, which Debutly uses; most VoiceOver users browse with Safari, which can announce some controls differently.

On the same app, NVDA gave the clearest results. VoiceOver on GitHub's Mac runners left more findings to check by ear, as it sometimes spoke late or about something else on the screen. Neither gave a verdict the other contradicted. With both, the first field on a page, reached from the browser's toolbar, can be announced only as where focus went ("form landmark"); Debutly hears it again on its own, and if that still doesn't name a control, leaves it to check by ear.

### Severity

- **Blocker**: a serious problem on a page customers must get through: sign-up, sign-in, onboarding, pricing, checkout, billing, payment or invites.
- **Major**: server errors and JavaScript errors, controls something covers, controls the keyboard can't reach, Arabic shown left to right, agents stuck, and pages over 30 seconds or that never arrived. A minor problem on one of the critical pages above is major too.
- **Minor**: everything else, such as a 404 for an image or an unlabeled icon button.

### Confidence

Findings the browser measures (unlabeled controls, covered controls, keyboard reach and focus, reflow, language) are high confidence: one measurement is enough. For the rest, confidence is the share of agents who reached that page and ran into the problem. Half or more is **high**, a quarter or more is **medium**, anything less is **low**. Low-confidence findings get their own section: they may be the agent's own mistake rather than your app's.

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
