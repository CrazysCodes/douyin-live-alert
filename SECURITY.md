# Security policy

Please report vulnerabilities privately to the repository owner instead of opening a public issue containing secrets or user data.

## Secret handling

The following values must never be committed:

- Cloudflare API tokens
- WeCom robot webhook URLs
- WeCom application secrets
- WeChat mini-program AppSecret values
- Admin bearer tokens
- Real subscription files or user databases

If a webhook or token is exposed, rotate it immediately. Git history rewriting alone does not revoke a leaked credential.

## Supported deployment

The current supported open-source milestone is the Cloudflare Workers + D1 Feishu bot application deployment on the latest tagged release. WeCom variants are documented as optional community integrations and are not bundled in the current release.
