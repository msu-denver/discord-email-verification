# Contributing

Thanks for your interest in contributing! This bot powers email verification on the MSU Denver Computer Sciences Department's Discord server, but the codebase is intentionally generic enough that other educational communities can fork and adapt it.

## Reporting bugs and security issues

- **Non-security bugs:** open a GitHub issue using the [bug report template](./ISSUE_TEMPLATE/bug_report.md).
- **Security vulnerabilities:** do **not** open a public issue. See [SECURITY.md](./SECURITY.md) for the private reporting flow. The threat model lives at [docs/SECURITY.md](../docs/SECURITY.md).

## Development setup

```bash
git clone https://github.com/msu-denver/discord-email-verification.git
cd discord-email-verification
npm install
cp .env.example .env  # then edit
docker compose up -d  # LocalStack for SES simulation
npm test              # 78 tests, should all pass
npm start
```

Full local-development walkthrough is in the main [README](../README.md). Architecture, security model, and deployment runbook are in [`docs/`](../docs/).

## Pull request flow

1. Fork or branch off `main`.
2. Make your change. Keep PRs focused — one logical change per PR.
3. **Add or update tests.** New code paths need tests; refactors should keep coverage steady. The full suite is in `tests/` (Vitest).
4. Run locally before pushing:
   ```bash
   npm test                 # all tests pass on Node 20 + 22
   node --check src/*.js src/commands/*.js
   npm run audit            # 0 high-severity production vulns
   ```
5. Open a PR. CI runs on Node 20 and 22, lints, audits dependencies, runs CodeQL, and reviews any new dependencies. Deploy to AWS only fires on push to `main`.
6. Files under `.github/`, `infrastructure/`, `scripts/`, `Dockerfile*`, and `package*.json` require a [CODEOWNERS](./CODEOWNERS) review (currently `@daniel-pittman`). Other paths just need any maintainer's approval.

## Coding conventions

- **ESM throughout.** All source files use `import`/`export`. No CommonJS.
- **Config centralization.** All `process.env` access lives in `src/config.js`. Other modules import named constants from it.
- **Storage strategy pattern.** `src/storage.js` exports a singleton implementing the same interface for both DynamoDB (production) and local JSON files (development). Both backends must stay in sync — if you add a method to one, add it to the other.
- **Tests use dynamic imports** (`await import('...')`) so `vi.mock()` is in place before the module under test loads.
- **No comments explaining what code does** unless the *why* is non-obvious (a hidden constraint, a workaround, behavior that would surprise a future reader).

## What's likely to be accepted

- Bug fixes with a regression test.
- New `/admin` subcommands that follow the existing pattern.
- Hardening (rate-limit improvements, validation tightening, better error messages).
- Documentation improvements.
- Test coverage improvements.

## What needs discussion first

Open an issue before starting on:

- New external services or dependencies (every dependency expands the supply-chain surface).
- Schema changes to the DynamoDB table or LocalStorage format.
- Changes to `infrastructure/*.yaml` (production deployment).
- Changes to `.github/workflows/*.yml` (CI/CD pipeline).
- Big architectural shifts.

## Code of Conduct

This project follows the [Contributor Covenant](./CODE_OF_CONDUCT.md). By participating you agree to uphold its terms.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](../LICENSE).
