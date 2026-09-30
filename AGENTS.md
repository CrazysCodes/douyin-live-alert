# AI agent operating contract

This repository is designed to be deployed by an AI coding agent for a human operator.

## Invariants

- Never commit notification secrets, Cloudflare tokens, Feishu secrets, WeChat secrets, or real user data.
- The default free deployment uses a Feishu bot application and direct personal messages addressed by `open_id`. Keep its optional IP allowlist disabled for Serverless deployment.
- Never send a test notification unless the human explicitly asks for one.
- A creator's first successful observation establishes a baseline. It must not send a live-started notification.
- Send a notification only for `offline -> live` or a live room id change.
- Database migrations and deployment scripts must be idempotent.
- A repeated cron invocation must not emit a duplicate notification.
- Keep the Cloudflare free-plan constraints in mind: 50 subrequests per invocation, 6 simultaneous outbound connections, and a small CPU budget.

## Standard AI workflow

1. Run `npm install`.
2. Run `npm run verify`.
3. Ask only for missing secrets described by `config.schema.json`.
4. Run `npm run setup:feishu -- --app-id cli_xxx` when `FEISHU_RECEIVE_ID` is missing; the human must approve the SDK device-authorization link.
5. Export secrets in the current shell; never write them to disk.
6. Run `npm run deploy:cloudflare`.
7. Run the health check printed by the deployment script.
8. Seed creators with `npm run seed:cloudflare -- config/subscriptions.json`.

Read `docs/ai-deploy.md` before changing deployment behavior.
