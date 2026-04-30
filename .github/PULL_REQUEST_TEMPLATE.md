<!--
Thanks for contributing! A few prompts to help reviewers understand your change.
Delete sections that don't apply.
-->

## Summary

<!-- 1-3 bullet points: what changed and why. -->

-
-
-

## Test plan

<!-- How did you verify this works? Check what applies. -->

- [ ] `npm test` passes locally
- [ ] Added or updated tests for the changed behavior
- [ ] `node --check src/*.js src/commands/*.js` passes
- [ ] `npm run audit` shows 0 high-severity issues
- [ ] Manually exercised the change end-to-end (describe below)

<!-- If manual testing was done: what did you do? -->

## Risk and rollback

<!-- For changes touching infrastructure/, scripts/, .github/workflows/, or
package.json: how would you roll this back if it breaks production? -->

## Checklist

- [ ] PR title is short (under 70 characters); details belong in the body
- [ ] No secrets, credentials, or tokens in the diff
- [ ] No personal email addresses, instance IDs, or local AWS profile names in committed files
- [ ] Updated relevant docs (`README.md`, `docs/`, inline comments where the *why* is non-obvious)
- [ ] CODEOWNERS-protected paths (`.github/`, `infrastructure/`, `scripts/`, `Dockerfile*`, `package*.json`) — flagged for maintainer review

## Related issues

<!-- "Closes #123" or "Refs #456" — leave blank if none. -->
