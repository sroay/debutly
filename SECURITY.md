# Security

## Reporting a vulnerability

Please don't open a public issue for security problems. Use GitHub's private reporting instead: open the repository's **Security** tab and click **Report a vulnerability**. Only the maintainer sees the report, and you'll get a reply there.

Helpful details: what is affected, how to reproduce it, and what an attacker could do with it.

## Using Debutly safely

- **Point it only at test copies of your app:** a staging site or a throwaway environment, never production. Agents create accounts, submit forms and, in test mode, pay.
- **Use test keys only** (for example Stripe `pk_test_` keys) in the environment the agents use.
- **Keep secrets in your CI's secret store**, never in the repository: your model API key, database connection string and dashboard password.
- **Set `DASHBOARD_PASSWORD`** on any deployed dashboard. Without it, a deployed dashboard refuses everyone.
