# Security Policy

This document covers **how to report a vulnerability**. For the project's threat model and operational security posture, see [`docs/SECURITY.md`](../docs/SECURITY.md).

## Supported versions

This project ships from `main`. Only the latest commit on `main` is supported and patched. There are no long-lived release branches.

## Reporting a vulnerability

**Please do not open public issues for security vulnerabilities.** Public disclosure before a fix is in place puts the live MSU Denver Discord server (and any forks running this code) at risk.

Use one of the private channels below:

1. **Preferred — GitHub Private Vulnerability Reporting**
   - Go to the repository's [Security tab](https://github.com/msu-denver/discord-email-verification/security/advisories/new)
   - Click "Report a vulnerability"
   - GitHub will route the report directly to maintainers

2. **Email** — `dpittma8@msudenver.edu`

In your report, please include:

- A description of the issue and its impact
- Steps to reproduce (or a proof-of-concept, if applicable)
- The commit SHA you tested against
- Your assessment of severity (CVSS score is helpful but not required)

## What to expect

- **Acknowledgement** within 5 business days
- **Triage and severity assessment** within 10 business days
- **Fix or mitigation** for high/critical issues prioritized over feature work
- **Credit** in the release notes for the fix, unless you'd prefer to remain anonymous

If you don't hear back in the acknowledgement window, please escalate via email — the GitHub PVR tab can occasionally fall through the cracks during heavy notification volume.

## Out of scope

The following are not considered security vulnerabilities for this project:

- Issues that require pre-existing admin role on the Discord server (admins can already manage the bot's behavior through `/admin` commands)
- Issues that require AWS account compromise (the deploy pipeline already assumes an attacker who controls AWS has root access to the bot's infrastructure)
- DoS via Discord rate limits (Discord API constraints, not bot-specific)
- Vulnerabilities in `node_modules` already known to `npm audit` — those are tracked separately via Dependabot

## Coordinated disclosure

If you'd like to coordinate disclosure with a specific timeline (e.g., conference talks, blog posts), please mention that in your initial report. We'll work with you on a timeline that balances responsible disclosure with users' need to patch.
