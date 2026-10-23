# Rehearsals of open-source apps

Debutly rehearses well-known open-source apps here, each started from its own release images on a GitHub runner, with no changes to the app. A person checks each finding by hand, for example with a screen reader, before it is reported to the app's maintainers.

- `.github/workflows/rehearse.yml` runs one, started by hand. Choose "check-only" to start the app and check it, without any model calls.
- `<app>/start.sh` starts the app at http://localhost:3000, with Mailpit at http://localhost:8025 for the agents' email.
- `<app>/check.sh` checks the app before any model calls: for Chatwoot, a sign-up through its own API must send a confirmation email that reaches Mailpit.
- `<app>/debutly.json` holds the run's settings: who the customers are, what they try to do, and their first languages.

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
