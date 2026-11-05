# Benchmark: Debutly against human testers

Status: draft for review, 2026-11-05. Nothing here is built yet. Decisions taken from the founder on 2026-11-05 are in the last section.

## Goal

Show, with numbers, where Debutly finds problems and where it misses them, across the phases of a digital product. The result decides what to build next. "Better than human testing" stays a claim we don't make until stage 2 of this plan supports it.

## Stages

- **Stage 1 (now): Debutly alone.** Score Debutly against a written answer key of seeded bugs, per phase. No humans involved.
- **Stage 2 (when testers exist): human baseline.** Run the same brief with human testers and compare with stage 1.

## What we measure

For each tester on the same app and brief:

- **Recall:** how many of the seeded bugs it reports, out of the total.
- **Precision:** how many of its reports are real bugs, out of all its reports. A report that is not a seeded bug and not a real defect counts as a false alarm.
- **Time:** minutes from start to the last report.
- **Cost:** model spend for an agent; hourly rate times time for a person.
- **Severity fit:** whether the severity it gave matches the bug's severity in the answer key.

Agent runs vary. Earlier rehearsals of the same app went 2/3, 2/3, 1/3, 2/3 on one goal, so each agent configuration runs at least 3 times and we report the spread, not one number.

## The benchmark app

A new small app we own, built only for this benchmark, with a written answer key of bugs seeded on purpose. Each bug is tagged with the phase it belongs to, so results can be read by phase. A new app keeps the answer key out of the tests Debutly is graded on, and out of `fixture/`, which stays as it is for unit tests.

- **Idea and pricing:** a landing page whose price on the page differs from the price at checkout.
- **Build:** a form that accepts an empty required field, and a button that does nothing after a change.
- **Pre-launch:** sign-up that never sends the confirmation email, and an invite link that expires too early.
- **Launch and after:** a page that slows to over 10 seconds after 50 records, and an error shown as success.
- **Access:** a control a keyboard cannot reach, and an image with no text alternative.
- **Feel (human-only by design):** a flow that works but confuses, a label that promises the wrong thing, a success message in the wrong place. Debutly is not expected to find these in stage 1; they are listed so stage 2 can measure them.

## Who tests

- **Stage 1:** Debutly only, the pinned released version, the same brief and the same step budget, run at least 3 times per phase.
- **Stage 2:** 3 to 4 human testers who have not seen the app, given the same brief and a fixed 45-minute budget. Each signs a consent line that their reports are used in the benchmark, and works alone. No human testers exist yet, so stage 2 waits for them.

## Scoring

Done by someone who did not run the tests and does not know which tester wrote a report. Reports are matched to the answer key by a written rule, and disagreements are settled by a second person. Results are published, including the phases where Debutly loses.

## What counts as better

- **Stage 1** shows where Debutly's recall and precision are high or low, phase by phase, and what each bug costs to find. It makes no claim against humans.
- **Stage 2** compares Debutly with humans. Debutly is better in a phase when, over its runs, its recall and precision are at least the median human's, and it costs less per bug found. Feel bugs are reported separately, and the benchmark should show by how much humans win there.

## Risks

- **Seeded bugs are easier than real ones.** Bugs we plant are visible by design. Mitigation: a second app with bugs found in real launches, unseeded.
- **Small sample.** Three or four humans is thin. We state the sample size next to every number.
- **Screen-reader findings need NVDA or VoiceOver to confirm.** Mitigation: access bugs are scored with `debutly hear` and a person, not by Debutly alone.
- **Stage 1 can look like a human comparison.** Mitigation: every stage 1 table says "Debutly alone" in its heading.

## Steps

1. Build the benchmark app and its answer key, one bug per line, tagged by phase.
2. Stage 1: run Debutly 3 times on it. Record recall, precision, time, cost, per phase.
3. Score with the rule above. Publish the table, including where Debutly lost.
4. Pick the next build from the phases where Debutly is weakest.
5. Stage 2, once testers exist: run the same brief with humans, record the same measures, and compare.

## Decisions (founder, 2026-11-05)

- **Human testers:** none exist yet. Stage 2 waits for them; stage 1 goes ahead without them.
- **Benchmark app:** a new small app, built for the benchmark. Chosen because it keeps the answer key separate from our products and the tests.
- **Publishing:** yes, results may be published, including the phases where Debutly loses.
