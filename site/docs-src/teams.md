---
title: Teams and invites
description: Rehearse a B2B launch with business crews. An owner signs up and pays, invites teammates by email, and each teammate joins in their own browser.
---

# Teams and invites

Many products are bought by one person and used by a team. With `"unit": "business"`, each customer is a small company: an owner and their teammates.

```json
{
  "unit": "business",
  "employees": 2,
  "mailpit": "http://127.0.0.1:54324",
  "goal": "Sign up, choose a plan and invite your teammates"
}
```

## How a crew runs

1. Debutly casts a business: its name, what kind of company it is, its size, a monthly budget for tools like yours, and a goal.
2. **The owner** goes first. They decide which plan and how many seats to buy, within the budget, and are told to invite their teammates at their email addresses once they're set up.
3. **Each teammate** whose invite reached their inbox then starts in their own browser, with no shared login. They accept the invite, set up their account and check they landed in the company's workspace, not an empty one of their own. Then they do one task someone in their role would do.
4. A teammate whose invite never arrived is reported as `not_invited`, with the reason. That is often the finding: the invite flow is broken.

The report has one line per business: whether the owner got through, and whether the team got in.

## What crews need

- **A mail catcher.** Invites arrive by email, so set `mailpit` to a [Mailpit](https://mailpit.axllent.org) your test copy sends its mail to. Without one, teammates can't receive invites and are recorded as not invited.
- **Teammates per business.** `employees` is 0 to 4. The `quick` tier has none, so set `employees` (init sets 2), or use the `standard` (2) or `deep` (3) tier.
- **Room for more agents.** A crew of an owner and two teammates is three agents, so a run of 3 businesses is 9 agents. The cost estimate printed before each run counts them all.

## What crews find

Things a single-user test can't: invites that expire or never send, teammates who land in their own empty workspace, seats that don't match the plan, roles that can't do their job, and settings only the owner can reach.
