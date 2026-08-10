# ai-virtual-phone-share · 资源集市仓库

小手机「资源集市」App 的资源仓库。市场页经 jsDelivr CDN 读取本仓库，**文件夹结构完全自由** —— 根目录建什么文件夹，市场首页就显示什么文件夹。

## 投稿格式

一个资源 = 分类文件夹下的**一个子文件夹**（推荐）或**一个孤立文件**：

```
预设/
├── 日常向预设/            ← 子文件夹式资源（推荐）
│   ├── 日常向.json         ← 资源本体（可多个）
│   ├── 说明.txt            ← 可选：说明文字（列表里显示摘要）
│   └── 封面.jpg            ← 可选：图片（可多张，列表里显示第一张）
└── 极简预设.json           ← 孤立文件式资源（纯文字条目）
```

- 说明文件：`说明.txt` 或 `README.md`（子文件夹内）
- 图片：`jpg / jpeg / png / webp / gif`，建议单张 ≤ 300KB
- 资源本体：各功能页导出的文件原样上传即可（预设/正则/世界书/角色卡 JSON、角色卡 PNG、CSS 文本、应用 zip、游戏/剧场草稿 JSON、插件 JS）

## 索引

`_index.json` 由 GitHub Actions 在每次 push 后自动重建（含每条资源的更新时间、说明摘要、图片列表），**不要手改**。

## 限制

- jsDelivr 单文件上限 20MB
- CDN 对 `@main` 有缓存（最长约 12 小时）；急刷可访问
  `https://purge.jsdelivr.net/gh/xiaolongbao0709/ai-virtual-phone-share@main/_index.json`

## 应用内上传（上传服务）

本仓库同时是免账号上传服务的代码载体：`netlify/functions/upload.mjs`。

部署方式（管理员一次性操作）：
1. Netlify → Add new site → Import from Git → 选本仓库（站名建议 `aivp-share`）
2. Site settings → Environment variables 添加 `SHARE_BOT_TOKEN`
   （GitHub fine-grained PAT，仅授权本仓库的 Contents 与 Pull requests 读写）
3. 完成。App 内上传接口地址即 `https://<站名>.netlify.app/.netlify/functions/upload`

安全设计：接口只会开 PR（待审核），永远不直接改 main；管理员 merge 才上架。
含单文件/总量体积限制与 IP 频控。
