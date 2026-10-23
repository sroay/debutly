# Rehearsals of open-source apps

Debutly rehearses well-known open-source apps here, each started from its own release images on a GitHub runner, with no changes to the app. A person checks each finding by hand, for example with a screen reader, before it is reported to the app's maintainers.

- `.github/workflows/rehearse.yml` runs one, started by hand. Choose "check-only" to start the app and check it, without any model calls.
- `<app>/start.sh` starts the app at http://localhost:3000, with Mailpit at http://localhost:8025 for the agents' email. Cal.diy has no recent release image, so its script builds it from source at a pinned commit first.
- `<app>/check.sh` checks the app before any model calls: for Chatwoot, a sign-up through its own API must send a confirmation email that reaches Mailpit.
- `<app>/debutly.json` holds the run's settings: who the customers are, what they try to do, and their first languages.

## Checking findings by hand

Set "serve-minutes" (up to 90) to keep the app online instead of running agents. `serve.sh` gives the app and its Mailpit temporary https addresses (Cloudflare quick tunnels), so a person can sign up, read the emails and check each finding in their own browser and screen reader. The mailbox takes a generated login. The addresses and that login are masked in the log and uploaded sealed (artifact "sealed-addresses"); read them with:

```bash
bash rehearsals/unseal.sh --links <private key> "$(cat sealed.txt)"
```

## Hearing findings with a real screen reader

`.github/workflows/screen-reader.yml` checks screen-reader findings with NVDA on a Windows runner, driven by [Guidepup](https://www.guidepup.dev). A Linux job serves the app behind temporary addresses while the Windows job signs up by code, goes through the app's set-up screens and records what NVDA says at each press of Tab (`screen-reader/checks/`). The Windows job makes a key pair for the run, the addresses are sealed to it, and the transcripts are sealed like reports. "smoke" checks NVDA itself, with no app.

## Reports are sealed

This repository is public, and so are its workflow artifacts. Findings on someone else's app shouldn't be published before a person has checked them, so `seal.sh` encrypts each report for the holder of the private half of `report-key.pem`. To read one, download the artifact, unzip it and run:

```bash
bash rehearsals/unseal.sh <private key> <unzipped artifact folder> <output folder>
```

## Apps

| App | What the agents try | Languages |
|---|---|---|
| [Chatwoot](https://github.com/chatwoot/chatwoot) v4.19.0 | Three people each sign up, confirm their email, and set up a website live-chat inbox | Arabic, English |
| [Twenty](https://github.com/twentyhq/twenty) v2.50.0 | One company: the owner creates the workspace, adds three customers and invites two colleagues, who join and do a task | Arabic, English |
| [Cal.diy](https://github.com/calcom/cal.diy) at 0f19cc4 (19 Oct 2026) | Three people each sign up, set their hours, create a 30-minute appointment type and book it from their public page | Arabic, English |
