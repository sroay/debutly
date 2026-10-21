# Contributing

Thanks for helping improve Debutly. Bug reports, ideas and pull requests are all welcome.

## Getting set up

```bash
npm install
npx playwright install chromium
npm test          # includes the acceptance test against the seeded-bug fixture app
npm run typecheck
```

Most tests need no model key; they use scripted model replies. Real runs need a key in `.env` (see `.env.example`).

## Pull requests

- Keep each pull request to one change, and say what it fixes or adds and why.
- Add or update tests for behaviour you change. The acceptance test must keep catching every seeded bug in `fixture/`.
- Never commit secrets, real customer data or anything from a production system. Test data uses made-up names (Acme, Globex, Initech).

## Licence of contributions

Debutly is licensed under [AGPL-3.0](LICENSE). By submitting a contribution, you agree that it is licensed under AGPL-3.0, and you grant the project's maintainer (Chetan Sroay) a perpetual, worldwide, non-exclusive, royalty-free licence to use, modify and relicense your contribution, including in commercial versions of Debutly.
