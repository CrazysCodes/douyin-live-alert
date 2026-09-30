# 企业微信自建应用

该通道能以应用身份通知指定成员，适合不想建群的企业。通常需要 CorpID、AgentID、Secret、成员 UserID，并在企业微信后台配置 API 接收地址的可信 IP。

因为 Cloudflare Workers 默认没有专属固定出口 IP，该方案更适合有固定公网 IP 的 VPS、云服务器或 NAT 网关。如果公网 IP 变化，需同步更新企业微信的可信 IP。

当前仓库不内置该适配器；如需要，请提 Issue，说明服务器形态和预期接收人。
