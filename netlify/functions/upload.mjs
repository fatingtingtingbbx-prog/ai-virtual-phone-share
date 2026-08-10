// 资源集市免账号上传服务（部署为独立 Netlify 站点）。
// 接收 App 的投稿，用机器人 token（环境变量 SHARE_BOT_TOKEN）在本仓库
// 开一个 PR —— 管理员 merge 才上架，接口本身永远不直接改 main。
//
// 环境变量：
//   SHARE_BOT_TOKEN  必填，GitHub fine-grained PAT（本仓库 Contents + Pull requests 读写）
//   SHARE_REPO       可选，默认 "xiaolongbao0709/ai-virtual-phone-share"

const REPO = process.env.SHARE_REPO || "xiaolongbao0709/ai-virtual-phone-share";
const API = "https://api.github.com";

// 防滥用限制
const MAX_FILES = 12;
const MAX_FILE_B64 = 4 * 1024 * 1024;   // 单文件 base64 后 ≤4MB
const MAX_TOTAL_B64 = 5 * 1024 * 1024;  // 单次提交总量 ≤5MB（Netlify 请求体上限 6MB）
const MAX_TEXT = 4000;
const RATE_LIMIT_PER_HOUR = 6;

// 冷启动会清空的软频控（够挡手滑连点和无脑脚本）
const rateMap = new Map();

const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
};

function json(status, body) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json", ...CORS },
    });
}

function cleanSegment(value, fallback) {
    const cleaned = String(value ?? "").trim()
        .replace(/[\\/:*?"<>|#%\x00-\x1f]/g, "")
        .replace(/^\.+|\.+$/g, "")
        .slice(0, 60);
    return cleaned || fallback;
}

async function gh(token, method, path, body) {
    const res = await fetch(`${API}${path}`, {
        method,
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
            "Content-Type": "application/json",
            "User-Agent": "aivp-share-upload",
        },
        body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.message || `GitHub API ${res.status}`);
    return data;
}

export default async function handler(req, context) {
    if (req.method === "OPTIONS") return new Response("", { status: 204, headers: CORS });
    if (req.method !== "POST") return json(405, { ok: false, error: "只接受 POST" });

    const token = process.env.SHARE_BOT_TOKEN;
    if (!token) return json(503, { ok: false, error: "上传服务尚未配置（缺少 SHARE_BOT_TOKEN）" });

    const ip = context?.ip || req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const hour = Math.floor(Date.now() / 3600_000);
    const rateKey = `${ip}:${hour}`;
    const used = rateMap.get(rateKey) || 0;
    if (used >= RATE_LIMIT_PER_HOUR) return json(429, { ok: false, error: "提交太频繁了，请一小时后再试" });
    rateMap.set(rateKey, used + 1);
    if (rateMap.size > 5000) rateMap.clear();

    let payload;
    try {
        payload = await req.json();
    } catch {
        return json(400, { ok: false, error: "请求体不是合法 JSON" });
    }

    const folder = cleanSegment(payload.folder, "");
    const name = cleanSegment(payload.name, "");
    const author = cleanSegment(payload.author, "匿名");
    const description = String(payload.description ?? "").trim().slice(0, MAX_TEXT);
    const files = Array.isArray(payload.files) ? payload.files : [];
    if (!folder || !name) return json(400, { ok: false, error: "缺少分类或资源名称" });
    if (files.length === 0) return json(400, { ok: false, error: "至少需要一个文件" });
    if (files.length > MAX_FILES) return json(400, { ok: false, error: `文件太多（上限 ${MAX_FILES} 个）` });

    let total = 0;
    const normalized = [];
    for (const file of files) {
        const fileName = cleanSegment(file?.name, "");
        const content = String(file?.contentBase64 ?? "");
        if (!fileName || !content) return json(400, { ok: false, error: "文件名或内容为空" });
        if (!/^[A-Za-z0-9+/=\r\n]+$/.test(content)) return json(400, { ok: false, error: "文件内容必须是 base64" });
        if (content.length > MAX_FILE_B64) return json(400, { ok: false, error: `文件「${fileName}」超过大小上限` });
        total += content.length;
        normalized.push({ name: fileName, contentBase64: content.replace(/[\r\n]/g, "") });
    }
    if (total > MAX_TOTAL_B64) return json(400, { ok: false, error: "单次提交总量超限，请拆分或压缩" });

    const [owner, repo] = REPO.split("/");
    const dir = `${folder}/${name}`;
    const branch = `submit/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

    try {
        const mainRef = await gh(token, "GET", `/repos/${owner}/${repo}/git/ref/heads/main`);
        await gh(token, "POST", `/repos/${owner}/${repo}/git/refs`, {
            ref: `refs/heads/${branch}`,
            sha: mainRef.object.sha,
        });

        const toWrite = [...normalized];
        if (description) {
            toWrite.push({ name: "说明.txt", contentBase64: Buffer.from(description, "utf8").toString("base64") });
        }
        for (const file of toWrite) {
            await gh(token, "PUT", `/repos/${owner}/${repo}/contents/${encodeURIComponent(dir)}/${encodeURIComponent(file.name)}`, {
                message: `投稿：${dir}/${file.name}`,
                content: file.contentBase64,
                branch,
            });
        }

        const pr = await gh(token, "POST", `/repos/${owner}/${repo}/pulls`, {
            title: `投稿：${dir}`,
            head: branch,
            base: "main",
            body: [`来自资源集市 App 的投稿。`, ``, `- 分类：${folder}`, `- 名称：${name}`, `- 投稿人：${author}`, description ? `\n${description}` : ""].join("\n"),
        });

        return json(200, { ok: true, prUrl: pr.html_url, prNumber: pr.number });
    } catch (err) {
        return json(502, { ok: false, error: `提交失败：${err instanceof Error ? err.message : String(err)}` });
    }
}
