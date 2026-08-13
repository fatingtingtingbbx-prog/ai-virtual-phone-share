// 资源集市免账号上传/自助删除服务（部署为独立 Netlify 站点）。
// 上传：用机器人 token 在本仓库开 PR —— 管理员 merge 才上架。
// 删除：投稿时资源文件夹里写入删除凭证的哈希（.owner），上传者持凭证
// 可自助下架自己的资源（哈希比对通过后由机器人直接删除）。
//
// 环境变量：
//   SHARE_BOT_TOKEN  必填，GitHub fine-grained PAT（本仓库 Contents + Pull requests 读写）
//   SHARE_REPO       可选，默认 "xiaolongbao0709/ai-virtual-phone-share"

import { createHash } from "node:crypto";

const REPO = process.env.SHARE_REPO || "xiaolongbao0709/ai-virtual-phone-share";
const API = "https://api.github.com";
const RESOURCE_ROOT = "资源";

// 防滥用限制
const MAX_FILES = 12;
const MAX_FILE_B64 = 4 * 1024 * 1024;   // 单文件 base64 后 ≤4MB
const MAX_TOTAL_B64 = 5 * 1024 * 1024;  // 单次提交总量 ≤5MB（Netlify 请求体上限 6MB）
const MAX_TEXT = 4000;
const MAX_AVATAR_B64 = 64 * 1024;        // 头像压过的 64×64 PNG，够用了
const RATE_LIMIT_PER_HOUR = 15;

// 冷启动会清空的软频控（够挡手滑连点和无脑脚本）
const rateMap = new Map();
// 送花去重：同 IP 对同一资源每天只算一朵（同样是冷启动即清的软限制，
// 客户端本地也会记录当天已送过，双保险）
const flowerMap = new Map();
const FLOWERS_FILE = "_flowers.json";
const CONFIG_FILE = "_config.json";
const FLOWER_RATE_PER_HOUR = 30;

// ── 共同建设（代码贡献）通道 ──
// 小坊代用户把改动提交为主仓库的 PR。路径白名单 + 体积/数量/频率三重限制，
// 中转函数不放行的内容不可能进入仓库；最终把关仍是管理员在 GitHub 审 PR。
//   CONTRIB_BOT_TOKEN  可选，主仓库的 fine-grained PAT（Contents + Pull requests 读写）；
//                      缺省复用 SHARE_BOT_TOKEN（此时该 token 需同时勾选两个仓库）。
//   CONTRIB_REPO       可选，默认 "xiaolongbao0709/ai-virtual-phone"
const CONTRIB_REPO = process.env.CONTRIB_REPO || "xiaolongbao0709/ai-virtual-phone";
const CONTRIB_MAX_FILES = 6;
const CONTRIB_MAX_TOTAL_B64 = 1024 * 1024;      // 代码贡献总量 ≤1MB（够大改动，挡整仓倾倒）
const CONTRIB_RATE_PER_HOUR = 3;
// 只许改这些目录下的源码/文档；工作流、依赖清单、配置一律不收
const CONTRIB_PATH_RE = /^(components|lib|styles|docs|hooks)\/[A-Za-z0-9_\-./\u4e00-\u9fff]+\.(ts|tsx|css|md|js|mjs)$/;

// \u2500\u2500 \u627e\u56de\u4f5c\u54c1\uff08\u6240\u6709\u6743\u7533\u8bf7\uff09\u901a\u9053 \u2500\u2500
// \u4e22\u4e86\u644a\u4e3b\u94a5\u5319\u7684\u4f5c\u8005\u63d0\u4ea4\u8bc1\u660e\u6750\u6599\uff0c\u7531\u7ba1\u7406\u5458\u5728\u5c0f\u624b\u673a\u7ba1\u7406\u4e2d\u5fc3\u4eba\u5de5\u5ba1\u6838\u3002
// \u4e2d\u8f6c\u51fd\u6570\u53ea\u8d1f\u8d23\u628a\u7533\u8bf7\u5f00\u6210 PR\uff08\u5206\u652f\u4e0a\u4ec5\u653e\u8bc1\u660e\u6587\u4ef6\uff0c\u6c38\u4e0d\u78b0 .owner\uff09\uff1b
// \u901a\u8fc7\u4e0e\u5426\u3001\u6539\u5199\u6240\u6709\u6743\uff0c\u5168\u90e8\u7531\u7ba1\u7406\u5458\u7684 token \u624b\u52a8\u6267\u884c\u2014\u2014bot \u4e0d\u505a\u4efb\u4f55\u81ea\u52a8\u88c1\u51b3\u3002
const CLAIM_MAX_FILES = 6;
const CLAIM_MAX_TOTAL_B64 = 4 * 1024 * 1024;    // \u8bc1\u660e\u6750\u6599\uff08\u622a\u56fe/\u5de5\u7a0b\u6587\u4ef6\uff09\u603b\u91cf \u22644MB
const CLAIM_RATE_PER_HOUR = 2;
const CLAIM_TITLE_PREFIX = "\u3010\u627e\u56de\u7533\u8bf7\u3011";

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

/**
 * 文件名清洗：与 cleanSegment 同规则，但截断时保住扩展名。
 * 名字长到 60 字上限时直接切尾会把 ".png" 削掉，导入侧全靠扩展名判断类型
 * （PNG 角色卡尤其），削没了就再也认不出来了。
 */
function cleanFileName(value, fallback) {
    const raw = String(value ?? "").trim()
        .replace(/[\\/:*?"<>|#%\x00-\x1f]/g, "")
        .replace(/^\.+|\.+$/g, "");
    if (raw.length <= 60) return raw || fallback;
    const dot = raw.lastIndexOf(".");
    const ext = dot > 0 && raw.length - dot <= 12 ? raw.slice(dot) : "";
    return (raw.slice(0, Math.max(1, 60 - ext.length)) + ext) || fallback;
}

function encodePath(path) {
    return path.split("/").map(encodeURIComponent).join("/");
}

/** 取文件的 sha（不存在返回空），更新已有文件必须带上 */
async function fileSha(token, owner, repo, path) {
    try {
        const info = await gh(token, "GET", `/repos/${owner}/${repo}/contents/${encodePath(path)}`);
        return Array.isArray(info) ? "" : (info.sha || "");
    } catch (err) {
        if (err.status === 404) return "";
        throw err;
    }
}

/** 写文件（有则覆盖），直接提交默认分支 */
async function putFile(token, owner, repo, path, contentBase64, message) {
    const sha = await fileSha(token, owner, repo, path);
    await gh(token, "PUT", `/repos/${owner}/${repo}/contents/${encodePath(path)}`, {
        message,
        content: contentBase64.replace(/[\r\n]/g, ""),
        ...(sha ? { sha } : {}),
    });
}

/** 写文件到指定分支（有则覆盖） */
async function putFileOnBranch(token, owner, repo, branch, path, contentBase64, message) {
    let sha = "";
    try {
        const info = await gh(token, "GET", `/repos/${owner}/${repo}/contents/${encodePath(path)}?ref=${encodeURIComponent(branch)}`);
        sha = Array.isArray(info) ? "" : (info.sha || "");
    } catch (err) {
        if (err.status !== 404) throw err;
    }
    await gh(token, "PUT", `/repos/${owner}/${repo}/contents/${encodePath(path)}`, {
        message,
        branch,
        content: contentBase64.replace(/[\r\n]/g, ""),
        ...(sha ? { sha } : {}),
    });
}

/** 删文件（不存在就跳过） */
async function deleteFile(token, owner, repo, path, message) {
    const sha = await fileSha(token, owner, repo, path);
    if (!sha) return;
    await gh(token, "DELETE", `/repos/${owner}/${repo}/contents/${encodePath(path)}`, { message, sha });
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
    if (!res.ok) {
        const err = new Error(data?.message || `GitHub API ${res.status}`);
        err.status = res.status;
        throw err;
    }
    return data;
}

/**
 * 读取仓库里的集市配置。自动审核开关就存在这儿——写这个文件需要仓库写权限，
 * 所以"只有仓库所有者能开"是 GitHub 服务端在卡，不是前端自觉。
 */
async function readAutoApprove(token, owner, repo) {
    try {
        const file = await gh(token, "GET", `/repos/${owner}/${repo}/contents/${CONFIG_FILE}`);
        const cfg = JSON.parse(Buffer.from(file.content || "", "base64").toString("utf8"));
        return cfg?.autoApprove === true;
    } catch {
        // 没有配置文件、读不到、格式坏掉 —— 一律按"要人工审核"处理
        return false;
    }
}

/** PR 刚建好时 GitHub 还在算能不能合并，给它几次机会 */
async function mergeWithRetry(token, owner, repo, prNumber) {
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            await gh(token, "PUT", `/repos/${owner}/${repo}/pulls/${prNumber}/merge`, { merge_method: "merge" });
            return true;
        } catch (err) {
            if (attempt === 2) return false;
            await new Promise(resolve => setTimeout(resolve, 1200));
        }
    }
    return false;
}

async function handleUpload(token, payload) {
    const folder = cleanSegment(payload.folder, "");
    // 标题可能带贴纸/排版标记，文件夹名用安全化版本，原始标题另存 .title
    const rawTitle = String(payload.name ?? "").trim().slice(0, 80);
    const name = cleanSegment(payload.name, "");
    const author = cleanSegment(payload.author, "匿名");
    const avatarBase64 = typeof payload.avatarBase64 === "string" ? payload.avatarBase64.replace(/[\r\n]/g, "") : "";
    const description = String(payload.description ?? "").trim().slice(0, MAX_TEXT);
    // 删除凭证哈希（客户端生成凭证、只上传哈希；凭证本体只留在上传者设备里）
    const ownerKeyHash = /^[a-f0-9]{64}$/i.test(String(payload.ownerKeyHash ?? "")) ? String(payload.ownerKeyHash).toLowerCase() : "";
    const files = Array.isArray(payload.files) ? payload.files : [];
    if (!folder || !name) return json(400, { ok: false, error: "缺少分类或资源名称" });
    // 不再强制要有文件：纯图文帖（只有说明）也能发。但总得有东西可提交，
    // 否则分支上一个 commit 都没有，开 PR 会以一句看不懂的 GitHub 报错收场。
    if (files.length === 0 && !description && !ownerKeyHash) {
        return json(400, { ok: false, error: "资源不能是空的，至少要有文件或说明文字" });
    }
    if (files.length > MAX_FILES) return json(400, { ok: false, error: `文件太多（上限 ${MAX_FILES} 个）` });

    let total = 0;
    const normalized = [];
    for (const file of files) {
        const fileName = cleanFileName(file?.name, "");
        const content = String(file?.contentBase64 ?? "");
        if (!fileName || !content) return json(400, { ok: false, error: "文件名或内容为空" });
        if (!/^[A-Za-z0-9+/=\r\n]+$/.test(content)) return json(400, { ok: false, error: "文件内容必须是 base64" });
        if (content.length > MAX_FILE_B64) return json(400, { ok: false, error: `文件「${fileName}」超过大小上限` });
        total += content.length;
        normalized.push({ name: fileName, contentBase64: content.replace(/[\r\n]/g, "") });
    }
    if (total > MAX_TOTAL_B64) return json(400, { ok: false, error: "单次提交总量超限，请拆分或压缩" });

    const [owner, repo] = REPO.split("/");
    const dir = `${RESOURCE_ROOT}/${folder}/${name}`;
    const branch = `submit/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

    const mainRef = await gh(token, "GET", `/repos/${owner}/${repo}/git/ref/heads/main`);
    await gh(token, "POST", `/repos/${owner}/${repo}/git/refs`, {
        ref: `refs/heads/${branch}`,
        sha: mainRef.object.sha,
    });

    const toWrite = [...normalized];
    if (description) {
        toWrite.push({ name: "说明.txt", contentBase64: Buffer.from(description, "utf8").toString("base64") });
    }
    if (ownerKeyHash) {
        toWrite.push({ name: ".owner", contentBase64: Buffer.from(ownerKeyHash, "utf8").toString("base64") });
    }
    // 投稿人写进 .author 隐藏文件，索引会带上、详情页展示
    if (author && author !== "匿名") {
        toWrite.push({ name: ".author", contentBase64: Buffer.from(author, "utf8").toString("base64") });
    }
    // 原始标题（文件夹名被安全化后可能与它不同）
    if (rawTitle && rawTitle !== name) {
        toWrite.push({ name: ".title", contentBase64: Buffer.from(rawTitle, "utf8").toString("base64") });
    }
    // 作者头像（客户端已压成 64×64 PNG）
    if (avatarBase64 && avatarBase64.length <= MAX_AVATAR_B64) {
        toWrite.push({ name: ".avatar.png", contentBase64: avatarBase64 });
    }
    for (const file of toWrite) {
        await gh(token, "PUT", `/repos/${owner}/${repo}/contents/${encodePath(dir)}/${encodeURIComponent(file.name)}`, {
            message: `投稿：${dir}/${file.name}`,
            content: file.contentBase64,
            branch,
        });
    }

    const pr = await gh(token, "POST", `/repos/${owner}/${repo}/pulls`, {
        title: `投稿：${folder}/${name}`,
        head: branch,
        base: "main",
        body: [`来自资源集市 App 的投稿。`, ``, `- 分类：${folder}`, `- 名称：${name}`, `- 投稿人：${author}`, description ? `\n${description}` : ""].join("\n"),
    });

    // 自动审核开着就直接合并上架；合并失败（冲突等）则退回人工队列，不影响投稿
    if (await readAutoApprove(token, owner, repo)) {
        if (await mergeWithRetry(token, owner, repo, pr.number)) {
            return json(200, { ok: true, merged: true, prUrl: pr.html_url, prNumber: pr.number, path: dir });
        }
    }

    return json(200, { ok: true, merged: false, prUrl: pr.html_url, prNumber: pr.number, path: dir });
}

async function handleDelete(token, payload) {
    const path = String(payload.path ?? "").replace(/^\/+|\/+$/g, "");
    const ownerKey = String(payload.ownerKey ?? "");
    // 只允许删 资源/分类/资源名 这一层，且路径不得穿越
    if (!path.startsWith(`${RESOURCE_ROOT}/`) || path.includes("..") || path.split("/").length !== 3) {
        return json(400, { ok: false, error: "路径不合法" });
    }
    if (!ownerKey) return json(400, { ok: false, error: "缺少删除凭证" });

    const [owner, repo] = REPO.split("/");

    // 校验凭证：资源文件夹里的 .owner 存的是凭证哈希
    const verified = await verifyOwnerKey(token, owner, repo, path, ownerKey);
    if (verified) return verified;

    // 凭证通过：递归删除该资源文件夹（机器人直接提交 main）
    const removePath = async (target) => {
        const info = await gh(token, "GET", `/repos/${owner}/${repo}/contents/${encodePath(target)}`);
        const items = Array.isArray(info) ? info : [info];
        for (const item of items) {
            if (item.type === "dir") await removePath(item.path);
            else await gh(token, "DELETE", `/repos/${owner}/${repo}/contents/${encodePath(item.path)}`, {
                message: `投稿者自助下架：${path}`,
                sha: item.sha,
            });
        }
    };
    await removePath(path);
    return json(200, { ok: true });
}

/**
 * 作者自助编辑（凭删除凭证验身，改完立即生效）。
 * 可改：标题(.title)、正文(说明.txt)、投稿人(.author)、头像(.avatar.png)、
 *      增删资源文件与配图。资源文件夹路径不动——花数、凭证、已有链接都不受影响。
 */
async function handleEdit(token, payload) {
    const path = String(payload.path ?? "").replace(/^\/+|\/+$/g, "");
    const ownerKey = String(payload.ownerKey ?? "");
    if (!path.startsWith(`${RESOURCE_ROOT}/`) || path.includes("..") || path.split("/").length !== 3) {
        return json(400, { ok: false, error: "路径不合法" });
    }
    if (!ownerKey) return json(400, { ok: false, error: "缺少编辑凭证" });

    const [owner, repo] = REPO.split("/");
    const verified = await verifyOwnerKey(token, owner, repo, path, ownerKey);
    if (verified) return verified;   // 校验失败时直接返回错误响应

    const title = String(payload.title ?? "").trim().slice(0, 80);
    const description = String(payload.description ?? "").trim().slice(0, MAX_TEXT);
    const author = cleanSegment(payload.author, "");
    const avatarBase64 = typeof payload.avatarBase64 === "string" ? payload.avatarBase64.replace(/[\r\n]/g, "") : "";
    const addFiles = Array.isArray(payload.addFiles) ? payload.addFiles : [];
    const removeNames = Array.isArray(payload.removeFiles) ? payload.removeFiles : [];
    if (addFiles.length > MAX_FILES) return json(400, { ok: false, error: `文件太多（上限 ${MAX_FILES} 个）` });

    // 先删：只允许删本资源文件夹内的普通文件，隐藏文件（.owner 等）一律不给碰
    for (const raw of removeNames) {
        const fileName = String(raw ?? "").split("/").pop() || "";
        if (!fileName || fileName.startsWith(".") || fileName.includes("..")) {
            return json(400, { ok: false, error: "待删除的文件名不合法" });
        }
        await deleteFile(token, owner, repo, `${path}/${fileName}`, `编辑：删除 ${path}/${fileName}`);
    }

    // 再加：与上传同一套体积校验
    let total = 0;
    for (const file of addFiles) {
        const fileName = cleanFileName(file?.name, "");
        const content = String(file?.contentBase64 ?? "");
        if (!fileName || !content) return json(400, { ok: false, error: "文件名或内容为空" });
        if (!/^[A-Za-z0-9+/=\r\n]+$/.test(content)) return json(400, { ok: false, error: "文件内容必须是 base64" });
        if (content.length > MAX_FILE_B64) return json(400, { ok: false, error: `文件「${fileName}」超过大小上限` });
        total += content.length;
        if (total > MAX_TOTAL_B64) return json(400, { ok: false, error: "单次提交总量超限，请拆分或压缩" });
        await putFile(token, owner, repo, `${path}/${fileName}`, content, `编辑：更新 ${path}/${fileName}`);
    }

    // 文字类字段：有值就写，清空就删掉对应文件
    const dirName = path.split("/")[2];
    const textFields = [
        { name: ".title", value: title && title !== dirName ? title : "" },
        { name: "说明.txt", value: description },
        { name: ".author", value: author },
    ];
    for (const field of textFields) {
        const target = `${path}/${field.name}`;
        if (field.value) {
            await putFile(token, owner, repo, target, Buffer.from(field.value, "utf8").toString("base64"), `编辑：${target}`);
        } else {
            await deleteFile(token, owner, repo, target, `编辑：清空 ${target}`);
        }
    }
    if (avatarBase64) {
        if (avatarBase64.length > MAX_AVATAR_B64) return json(400, { ok: false, error: "头像太大" });
        await putFile(token, owner, repo, `${path}/.avatar.png`, avatarBase64, `编辑：${path}/.avatar.png`);
    }

    return json(200, { ok: true, path });
}

/** 校验删除/编辑凭证；通过返回 null，失败返回可直接下发的错误响应 */
async function verifyOwnerKey(token, owner, repo, path, ownerKey) {
    let storedHash = "";
    try {
        const ownerFile = await gh(token, "GET", `/repos/${owner}/${repo}/contents/${encodePath(path)}/.owner`);
        storedHash = Buffer.from(ownerFile.content || "", "base64").toString("utf8").trim().toLowerCase();
    } catch (err) {
        if (err.status === 404) return json(404, { ok: false, error: "该资源不存在、尚未上架，或不支持自助操作（无凭证）" });
        throw err;
    }
    const givenHash = createHash("sha256").update(ownerKey, "utf8").digest("hex");
    if (!storedHash || givenHash !== storedHash) {
        return json(403, { ok: false, error: "凭证不匹配" });
    }
    return null;
}

// 送花：把计数写进仓库根目录 _flowers.json（{资源路径: 花数}）。
// 提交信息带 [skip-index] 让索引 Actions 跳过；netlify.toml 的 ignore 规则也不会因此触发部署。
async function handleFlower(token, payload, ip) {
    const path = String(payload.path ?? "").replace(/^\/+|\/+$/g, "");
    if (!path.startsWith(`${RESOURCE_ROOT}/`) || path.includes("..") || path.split("/").length !== 3) {
        return json(400, { ok: false, error: "路径不合法" });
    }

    const day = new Date().toISOString().slice(0, 10);
    const dedupKey = `${ip}:${path}:${day}`;
    if (flowerMap.has(dedupKey)) return json(200, { ok: true, already: true });

    const [owner, repo] = REPO.split("/");

    // 资源必须真实存在，防止往计数表里塞垃圾路径
    try {
        await gh(token, "GET", `/repos/${owner}/${repo}/contents/${encodePath(path)}`);
    } catch (err) {
        if (err.status === 404) return json(404, { ok: false, error: "该资源不存在或已下架" });
        throw err;
    }

    // 读-改-写，SHA 冲突（并发送花）时重试
    for (let attempt = 0; attempt < 3; attempt++) {
        let counts = {};
        let sha;
        try {
            const file = await gh(token, "GET", `/repos/${owner}/${repo}/contents/${FLOWERS_FILE}`);
            sha = file.sha;
            try { counts = JSON.parse(Buffer.from(file.content || "", "base64").toString("utf8")); } catch { counts = {}; }
        } catch (err) {
            if (err.status !== 404) throw err;
        }
        if (typeof counts !== "object" || counts === null || Array.isArray(counts)) counts = {};
        counts[path] = (Number(counts[path]) || 0) + 1;
        try {
            await gh(token, "PUT", `/repos/${owner}/${repo}/contents/${FLOWERS_FILE}`, {
                message: `送花：${path} [skip-index]`,
                content: Buffer.from(JSON.stringify(counts, null, 2), "utf8").toString("base64"),
                ...(sha ? { sha } : {}),
            });
            flowerMap.set(dedupKey, true);
            if (flowerMap.size > 20000) flowerMap.clear();
            return json(200, { ok: true, count: counts[path] });
        } catch (err) {
            // 409/422：sha 过期（并发写），重读重试
            if (err.status !== 409 && err.status !== 422) throw err;
        }
    }
    return json(502, { ok: false, error: "送花失败：仓库繁忙，请稍后再试" });
}

/** 共同建设：把用户的改动提交为主仓库的 community PR（管理员在 GitHub 审核） */
async function handleContribute(payload) {
    const token = process.env.CONTRIB_BOT_TOKEN || process.env.SHARE_BOT_TOKEN;
    if (!token) return json(503, { ok: false, error: "贡献通道尚未配置（缺少 CONTRIB_BOT_TOKEN）" });

    const title = String(payload.title ?? "").trim().slice(0, 80);
    const summary = String(payload.summary ?? "").trim().slice(0, MAX_TEXT);
    const contributor = cleanSegment(payload.contributor, "匿名");
    const githubUser = /^[A-Za-z0-9-]{1,39}$/.test(String(payload.githubUser ?? "")) ? String(payload.githubUser) : "";
    const files = Array.isArray(payload.files) ? payload.files : [];
    if (title.length < 4) return json(400, { ok: false, error: "请写一个能说明改动的标题（至少 4 个字）" });
    if (!summary) return json(400, { ok: false, error: "请说明这个改动做了什么、为什么" });
    if (files.length === 0) return json(400, { ok: false, error: "没有要提交的文件" });
    if (files.length > CONTRIB_MAX_FILES) return json(400, { ok: false, error: `一次贡献最多 ${CONTRIB_MAX_FILES} 个文件，请拆成多次提交` });

    let total = 0;
    const normalized = [];
    for (const file of files) {
        const path = String(file?.path ?? "").trim().replace(/^\/+/, "");
        const content = String(file?.contentBase64 ?? "");
        if (path.includes("..")) return json(400, { ok: false, error: "路径不合法" });
        if (!CONTRIB_PATH_RE.test(path)) {
            return json(400, { ok: false, error: `路径「${path}」不在贡献白名单内（components/lib/styles/hooks/docs 下的源码与文档）` });
        }
        if (!content || !/^[A-Za-z0-9+/=\r\n]+$/.test(content)) return json(400, { ok: false, error: `文件「${path}」内容必须是 base64` });
        total += content.length;
        normalized.push({ path, contentBase64: content.replace(/[\r\n]/g, "") });
    }
    if (total > CONTRIB_MAX_TOTAL_B64) return json(400, { ok: false, error: "单次贡献总量超限，请拆分提交" });

    const [owner, repo] = CONTRIB_REPO.split("/");
    const branch = `community/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    const mainRef = await gh(token, "GET", `/repos/${owner}/${repo}/git/ref/heads/main`);
    await gh(token, "POST", `/repos/${owner}/${repo}/git/refs`, { ref: `refs/heads/${branch}`, sha: mainRef.object.sha });

    // 逐个写文件；作者署名进 commit（有 GitHub 名给 Co-authored-by，官方合并后计入其贡献）
    const coAuthor = githubUser ? `\n\nCo-authored-by: ${githubUser} <${githubUser}@users.noreply.github.com>` : "";
    for (const file of normalized) {
        await putFileOnBranch(token, owner, repo, branch, file.path,
            file.contentBase64, `${title}（${contributor} 经共同建设通道提交）${coAuthor}`);
    }

    const pr = await gh(token, "POST", `/repos/${owner}/${repo}/pulls`, {
        title,
        head: branch,
        base: "main",
        body: `贡献者：${contributor}${githubUser ? `（@${githubUser}）` : ""}\n\n${summary}\n\n---\n_经小手机「共同建设」通道提交_`,
    });
    // community 标签：先确保存在再打（打不上不算失败，PR 本体已建好）
    try {
        await gh(token, "POST", `/repos/${owner}/${repo}/labels`, { name: "community", color: "0e8a16", description: "社区贡献" });
    } catch (err) {
        if (err.status !== 422) { /* 已存在=422，其余忽略 */ }
    }
    try {
        await gh(token, "POST", `/repos/${owner}/${repo}/issues/${pr.number}/labels`, { labels: ["community"] });
    } catch { /* 标签失败不影响提交结果 */ }

    return json(200, { ok: true, prNumber: pr.number, prUrl: pr.html_url });
}

async function handleClaim(token, payload) {
    const entryPath = String(payload.path ?? "").trim().replace(/\/+$/, "");
    // 只认「资源/<分类>/<资源名>」两级目录；cleanSegment 同源字符集，杜绝路径穿越
    if (!/^资源\/[^/]{1,60}\/[^/]{1,60}$/.test(entryPath) || entryPath.includes("..")) {
        return json(400, { ok: false, error: "资源路径不合法" });
    }
    const ownerHash = String(payload.ownerHash ?? "").trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(ownerHash)) return json(400, { ok: false, error: "钥匙指纹不合法" });
    const nickname = cleanSegment(payload.nickname, "匿名");
    const note = String(payload.note ?? "").trim().slice(0, MAX_TEXT);
    const entryName = cleanSegment(payload.name, "") || entryPath.split("/").pop();

    const files = Array.isArray(payload.files) ? payload.files : [];
    if (files.length === 0) return json(400, { ok: false, error: "请上传证明文件（能证明作品是你创作的材料）" });
    if (files.length > CLAIM_MAX_FILES) return json(400, { ok: false, error: `证明文件最多 ${CLAIM_MAX_FILES} 个` });
    let total = 0;
    const normalized = [];
    for (const file of files) {
        const name = cleanFileName(file?.name, "");
        const content = String(file?.contentBase64 ?? "");
        if (!name) return json(400, { ok: false, error: "证明文件名不合法" });
        if (!content || !/^[A-Za-z0-9+/=\r\n]+$/.test(content)) return json(400, { ok: false, error: `文件「${name}」内容必须是 base64` });
        total += content.length;
        normalized.push({ name, contentBase64: content.replace(/[\r\n]/g, "") });
    }
    if (total > CLAIM_MAX_TOTAL_B64) return json(400, { ok: false, error: "证明文件总量超限（≤4MB），请压缩后再试" });

    const [owner, repo] = REPO.split("/");
    // 资源必须真实存在，挡住对着空路径乱开申请
    try {
        await gh(token, "GET", `/repos/${owner}/${repo}/contents/${encodePath(entryPath)}`);
    } catch {
        return json(404, { ok: false, error: "该资源不存在（可能已下架）" });
    }

    const claimId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    const branch = `claim/${claimId}`;
    const mainRef = await gh(token, "GET", `/repos/${owner}/${repo}/git/ref/heads/main`);
    await gh(token, "POST", `/repos/${owner}/${repo}/git/refs`, { ref: `refs/heads/${branch}`, sha: mainRef.object.sha });
    for (const file of normalized) {
        await putFileOnBranch(token, owner, repo, branch, `找回申请/${claimId}/${file.name}`,
            file.contentBase64, `找回申请证明：${entryName}`);
    }

    const pr = await gh(token, "POST", `/repos/${owner}/${repo}/pulls`, {
        title: `${CLAIM_TITLE_PREFIX}${entryName}`,
        head: branch,
        base: "main",
        body: [
            `资源路径：${entryPath}`,
            `申请人：${nickname}`,
            `新钥匙指纹：${ownerHash}`,
            "",
            note || "（申请人未填写备注）",
            "",
            "---",
            "_⚠️ 请勿直接合并本 PR（证明文件不应进入仓库）。请在小手机「设置 → 管理中心 → 集市审核」里查看证明并点「通过找回」，系统会改写该资源的所有权并关闭本申请。_",
        ].join("\n"),
    });
    return json(200, { ok: true, prNumber: pr.number, prUrl: pr.html_url });
}

export default async function handler(req, context) {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (req.method !== "POST") return json(405, { ok: false, error: "只接受 POST" });

    const token = process.env.SHARE_BOT_TOKEN;
    if (!token) return json(503, { ok: false, error: "上传服务尚未配置（缺少 SHARE_BOT_TOKEN）" });

    const ip = context?.ip || req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";

    let payload;
    try {
        payload = await req.json();
    } catch {
        return json(400, { ok: false, error: "请求体不是合法 JSON" });
    }

    // 频控：送花走自己的宽松额度（浏览时会频繁触发），上传/删除按每小时 15 次算，
    // 代码贡献更严（每小时 3 次），挡住脚本刷 PR。
    const hour = Math.floor(Date.now() / 3600_000);
    const isFlower = payload.action === "flower";
    const isContribute = payload.action === "contribute";
    const isClaim = payload.action === "claim";
    const rateKey = `${isFlower ? "f:" : isContribute ? "c:" : isClaim ? "r:" : ""}${ip}:${hour}`;
    const used = rateMap.get(rateKey) || 0;
    const rateCap = isFlower ? FLOWER_RATE_PER_HOUR
        : isContribute ? CONTRIB_RATE_PER_HOUR
        : isClaim ? CLAIM_RATE_PER_HOUR
        : RATE_LIMIT_PER_HOUR;
    if (used >= rateCap) {
        return json(429, { ok: false, error: "操作太频繁了，请一小时后再试" });
    }
    rateMap.set(rateKey, used + 1);
    if (rateMap.size > 5000) rateMap.clear();

    try {
        if (payload.action === "contribute") return await handleContribute(payload);
        if (payload.action === "claim") return await handleClaim(token, payload);
        if (payload.action === "flower") return await handleFlower(token, payload, ip);
        if (payload.action === "edit") return await handleEdit(token, payload);
        if (payload.action === "delete") return await handleDelete(token, payload);
        return await handleUpload(token, payload);
    } catch (err) {
        return json(502, { ok: false, error: `操作失败：${err instanceof Error ? err.message : String(err)}` });
    }
}
