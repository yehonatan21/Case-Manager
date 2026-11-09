# Security policy

## Reporting a problem

If you find a security problem in Case Manager, please report it privately, not in a public issue:

- On GitHub: **Security and quality → [Report a vulnerability](https://github.com/yehonatan21/Case-Manager/security/advisories/new)**
  in this repository (only the owner sees the report), or
- Contact the repository owner ([@yehonatan21](https://github.com/yehonatan21)) directly.

Include what you found, how to reproduce it and what it could affect. You'll get an answer within 5 working days,
and we'll tell you when it's fixed. Please don't access other people's data, and give us a reasonable time to fix
the problem before telling anyone else.

## Supported versions

Only the latest release (the `main` branch, deployed to production) gets security fixes.

## How the app protects data

- Sign-in with single-use codes stored only as hashes, or Google; rate limits on sign-in and AI use.
- Same-origin checks on every change, role-based permissions on every case, and an audit log.
- Stored files and saved integration keys are encrypted; payment and messaging webhooks are verified.
- Personal details are removed from text before it's sent to the AI provider.
- Nightly encrypted backups of the database, each restored into an empty database to test it.
- Dependencies are watched by Dependabot, and every change goes through type checks, tests and browser tests.
