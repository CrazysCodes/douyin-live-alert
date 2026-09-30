# 抖抖先知 / Douyin Live Alert

[![CI](https://github.com/CrazysCodes/douyin-live-alert/actions/workflows/ci.yml/badge.svg)](https://github.com/CrazysCodes/douyin-live-alert/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

匿名检测抖音主播开播状态，并通过飞书、企业微信或微信小程序发送提醒。轮询使用 HTTP 接口，不要求登录抖音，不需要 Chromium。

> 当前第一阶段：飞书机器人应用 + Cloudflare Workers/D1 免费托管。飞书官方 SDK 负责一次性扫码配置，运行时由 Worker 直接发送消息。企业微信两种通道保留配置文档，微信小程序版是后续独立发行版。

## 通知方案

| 通道 | 适合场景 | 单人可用 | 免费 Serverless | 状态 |
|---|---|---:|---:|---|
| 飞书机器人应用 | 个人扫码配置后发机器人私聊 | 是 | 是，不开启可选 IP 白名单 | 默认实现 |
| 企业微信群机器人 | 团队内部群 | 不便 | 是 | [配置文档](docs/wecom-group-bot.md) |
| 企业微信自建应用 | 直接通知指定成员 | 是 | 不适合动态出口 IP | [配置文档](docs/wecom-app.md) |
| 微信小程序 | 面向多个独立用户 | 是 | 可以 | 后续版本 |

## 架构

```text
Cloudflare Cron（每分钟）
  -> D1 取到期主播并获取调度租约
  -> 有界并发调用抖音 HTTP 接口
  -> 状态机判断 offline -> live / 直播间切换
  -> D1 幂等事件队列
  -> 飞书自建应用机器人私聊
```

第一次成功检查只建立状态基线，不发通知。重复 Cron、函数重试和相同直播间不会重复提醒；发信失败会指数退避，最多五次。

## 飞书准备

已有 App ID 时，运行下面的命令：

```powershell
npm run setup:feishu -- --app-id cli_xxx
```

脚本使用飞书官方 SDK 的 Device Authorization 流程生成授权链接。用个人飞书账号打开并确认后，会返回该账号的 `open_id`；脚本不会输出 App Secret。默认只申请机器人发消息权限 `im:message:send_as_bot`。

项目固定使用 `receive_id_type=open_id`。不要开启可选的 IP 白名单，免费 Serverless 没有固定出口 IP。

## AI 一键部署

把下面的话发给能操作终端的 AI：

> 阅读根目录 AGENTS.md 和 docs/ai-deploy.md，运行 npm install、npm test、npm run doctor。不要发送测试通知。根据 config.schema.json 只询问缺少的配置，部署飞书 Cloudflare 版，执行迁移、健康检查并添加 config/subscriptions.json 中的主播。

## 人工部署

```powershell
npm install
npm run verify

$env:CLOUDFLARE_API_TOKEN="..."
$env:CLOUDFLARE_ACCOUNT_ID="..."
$env:FEISHU_APP_ID="cli_..."
$env:FEISHU_APP_SECRET="..."
$env:FEISHU_RECEIVE_ID="扫码配置返回的 open_id"
$env:ADMIN_TOKEN="至少24位随机字符串"
npm run deploy:cloudflare
```

复制 `config/subscriptions.example.json` 为 `config/subscriptions.json`，填入主播主页链接，再运行：

```powershell
$env:WORKER_URL="https://你的Worker地址"
npm run seed:cloudflare -- config/subscriptions.json
npm run canary
```

## 开发与安全

```powershell
npm run verify
npm run check -- https://www.douyin.com/user/REPLACE_WITH_SEC_UID
```

首次部署会从公开模板生成 `apps/feishu-worker/wrangler.local.jsonc`，并把真实 D1 ID 写入这个被 Git 忽略的本地文件。生成后，本地调试与部署预检应使用：

```powershell
npx wrangler dev --config apps/feishu-worker/wrangler.local.jsonc
npm run dry-run:cloudflare
```

- 所有密钥只通过 Worker Secret/环境变量提供。
- 不要提交真实订阅列表、应用凭证或用户数据。
- 未经明确授权不发送测试通知。
- 抖音接口不是稳定的公开契约，需通过 `npm run canary` 持续观测。
- 本项目是非官方工具，与抖音、飞书、Cloudflare 均无隶属或背书关系；使用者需自行遵守相关平台规则。

MIT License
