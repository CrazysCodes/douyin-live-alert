# AI deployment playbook: Feishu app on Cloudflare

Follow `AGENTS.md` first. Deploy the Feishu bot edition to Cloudflare Workers + D1 without sending a test notification.

## Required human inputs

Read `config.schema.json` and ask only for missing values: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `FEISHU_APP_ID`, `FEISHU_APP_SECRET`, `FEISHU_RECEIVE_ID`, `ADMIN_TOKEN`.

Never echo full secrets or write them to disk. If `FEISHU_RECEIVE_ID` is missing, run `npm run setup:feishu -- --app-id cli_xxx`; ask the human to approve the link in Feishu and use the returned `open_id`. Keep the optional Feishu IP allowlist disabled.

## Procedure

1. Run `npm install` and `npm run verify`.
2. If needed, run the Feishu setup command and let the human approve the device link.
3. Export required inputs in the current process only.
4. Run `npm run deploy:cloudflare`.
   The command keeps the public `wrangler.jsonc` as a template and writes the real D1 binding only to the ignored `wrangler.local.jsonc`.
5. Require HTTP 200 and `status=ok`, `channel=feishu_app` from `/health`.
6. Seed `config/subscriptions.json`, then verify `GET /api/creators` with the admin bearer token.
7. Run `npm run canary` and retain the first observation.

Do not call Feishu directly and do not simulate a live transition in production. First observation establishes a baseline without a notification. Deployment and migrations are idempotent.
