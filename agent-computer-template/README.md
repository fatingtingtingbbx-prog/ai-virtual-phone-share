# AI Phone 角色电脑

这是 AI Virtual Phone 的可选「角色电脑」Cloudflare 部署模板。每位用户把它部署到自己的 Cloudflare 账号，角色才会获得独立 Linux 电脑与持久文件空间。

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/xiaolongbao0709/ai-virtual-phone-share/tree/main/agent-computer-template)

## 使用方法

1. 点击上方 **Deploy to Cloudflare**。
2. 登录你自己的 Cloudflare 账号。
3. 在部署页面为 `AGENT_TOKEN` 填写一段只由你自己保存的长随机字符串。
4. 完成部署后，复制你的 Worker 地址。
5. 回到 AI Virtual Phone 的「角色电脑」，填入 Worker 地址和同一串连接密钥并测试连接。

Cloudflare 会根据 `wrangler.jsonc` 自动创建并绑定角色电脑需要的 R2 持久存储和 Sandbox/Durable Object 资源。Sandbox/Containers 需要 Cloudflare Workers Paid 计划。

## 隐私

- 角色电脑运行在你自己的 Cloudflare 账号中。
- 不需要把 AI Virtual Phone 私有主项目公开。
- 每个角色使用独立 Sandbox 身份和独立 R2 文件前缀。
- `AGENT_TOKEN` 不应提交到 GitHub；模板只用 `.dev.vars.example` 声明部署时需要这个 secret。
