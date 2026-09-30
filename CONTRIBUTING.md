# Contributing

Thanks for helping improve Douyin Live Alert.

## Before opening a pull request

1. Read `AGENTS.md`, especially the notification and idempotency invariants.
2. Run `npm ci`, `npm test`, and `npm run doctor` with Node.js 22 or newer.
3. Do not include credentials, real receiver IDs, real subscription lists, D1 data, Wrangler state, or production database IDs.
4. Add tests for changes to live-state detection, event idempotency, retry behavior, or management APIs.
5. Never test by manufacturing a production live transition or sending an unsolicited notification.

## Bug reports

Please include sanitized logs, runtime version, deployment target, and a minimal reproduction. Remove cookies, tokens, webhook URLs, account IDs, receiver IDs, `sec_uid` values, and personal data before posting.

Security issues should follow `SECURITY.md` instead of being posted publicly.
