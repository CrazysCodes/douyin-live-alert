# Open-source release checklist

Run this list before creating a public repository or release. Do not publish automatically.

## Repository hygiene

- [x] MIT license, security policy, contribution guide, and AI agent contract are present.
- [x] Real subscriptions, Wrangler state, logs, environment files, and local D1 bindings are ignored.
- [x] Public `wrangler.jsonc` contains a D1 placeholder; deployment-specific IDs stay in ignored `wrangler.local.jsonc`.
- [x] High-confidence credential scan of Git candidate files contains no real credentials or production identifiers.
- [x] Review the final staged diff once a first commit is prepared.

## Verification

- [x] `npm run verify` passes on Node.js 22 or newer.
- [x] Cloudflare Worker dry-run succeeds with the ignored local configuration.
- [x] `npm audit --audit-level=high` reports zero vulnerabilities.
- [x] GitHub Actions runs verification and the high-severity dependency audit.
- [x] Dependabot monitors npm and GitHub Actions dependencies weekly.

## Runtime safety

- [x] First observation establishes a baseline without sending a notification.
- [x] Only `offline -> live` and live-room changes create alerts.
- [x] D1 event keys and scheduler leases prevent duplicate notifications.
- [x] Polling and delivery concurrency are bounded for the Cloudflare free plan.
- [x] Sustained production observation shows fresh cycles, successful creator checks, and no queue backlog; the maintainer accepted the result for the initial release.

## Human-controlled release steps

- [x] Choose the public repository owner/name and update repository links.
- [x] Create the public repository and first commit only after final human approval.
- [ ] Create a tagged release and release notes.
- [ ] Publish `docs/sharing-post-draft.md` only after final human review.
