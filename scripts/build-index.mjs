// 扫描仓库 资源/ 目录生成 _index.json（时间索引）。
// 资源统一放在 资源/ 下：资源/<分类>/<资源子文件夹或孤立文件>。
// 分类文件夹不做任何限制，由 GitHub Actions 在 push 后自动执行。
import { execSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = "资源";
const IMAGE_RE = /\.(jpe?g|png|webp|gif)$/i;
// 图片当资源本体投稿时（PNG 角色卡、表情包、贴纸），App 会给文件名加 .asset 标记。
// 带标记的图片进 files（详情页可选中、下载、导入），没标记的照旧进 images（只展示）。
// 规则与 App 的 lib/resource-hub-types.ts 保持一致，改这里记得同步那边。
const ASSET_IMAGE_RE = /\.asset\.[^.]+$/i;
const isPreviewImage = name => IMAGE_RE.test(name) && !ASSET_IMAGE_RE.test(name);
const DESC_NAMES = ["说明.txt", "readme.md", "README.md", "readme.txt"];
const DESC_MAX = 600;

function gitDate(path) {
    try {
        const out = execSync(`git log -1 --format=%cI -- "${path.replace(/"/g, '\\"')}"`, { encoding: "utf8" }).trim();
        return out || null;
    } catch {
        return null;
    }
}

function readDesc(dir) {
    for (const name of DESC_NAMES) {
        const p = join(dir, name);
        if (existsSync(p)) {
            try {
                return readFileSync(p, "utf8").trim().slice(0, DESC_MAX);
            } catch { /* 跳过坏文件 */ }
        }
    }
    return "";
}

// 投稿人：上传时写入的 .author 隐藏文件（没有就不显示）
function readAuthor(dir) {
    return readSmallFile(join(dir, ".author"), 40);
}

// 展示标题：.title 存的是带贴纸/排版标记的原始标题，文件夹名只是它的安全化版本。
// 这样作者改标题不用挪文件夹（花数、删除凭证、已有链接都不受影响）。
function readTitle(dir, fallback) {
    return readSmallFile(join(dir, ".title"), 80) || fallback;
}

function readSmallFile(path, max) {
    if (!existsSync(path)) return "";
    try {
        return readFileSync(path, "utf8").trim().slice(0, max);
    } catch {
        return "";
    }
}

const folders = [];
const entries = [];

if (existsSync(ROOT)) {
    for (const folder of readdirSync(ROOT).sort()) {
        if (folder.startsWith(".")) continue;
        const folderPath = join(ROOT, folder);
        if (!statSync(folderPath).isDirectory()) continue;

        let count = 0;
        for (const item of readdirSync(folderPath).sort()) {
            if (item.startsWith(".")) continue;
            const itemPath = join(folderPath, item);
            if (statSync(itemPath).isDirectory()) {
                // 子文件夹式资源（.owner 等隐藏文件不进清单）
                const inner = readdirSync(itemPath).filter(f => !f.startsWith(".")).sort();
                const images = inner.filter(f => isPreviewImage(f)).map(f => `${itemPath}/${f}`);
                const descNames = new Set(DESC_NAMES.map(n => n.toLowerCase()));
                const files = inner
                    .filter(f => !isPreviewImage(f) && !descNames.has(f.toLowerCase()))
                    .map(f => `${itemPath}/${f}`);
                const avatar = existsSync(join(itemPath, ".avatar.png")) ? `${itemPath}/.avatar.png` : "";
                // 发布者钥匙的指纹：换设备的人拿钥匙一算就知道哪些资源是自己的，
                // 不用逐个去仓库探测。指纹本来就在公开仓库里，放进索引不多泄露任何东西。
                const ownerHash = readSmallFile(join(itemPath, ".owner"), 64).toLowerCase();
                entries.push({
                    folder,
                    name: readTitle(itemPath, item),
                    dirName: item,
                    type: "dir",
                    path: itemPath,
                    files,
                    images,
                    description: readDesc(itemPath),
                    author: readAuthor(itemPath),
                    avatar,
                    ownerHash,
                    updatedAt: gitDate(itemPath),
                });
            } else {
                // 孤立文件式资源
                entries.push({
                    folder,
                    name: item.replace(/\.[^.]+$/, ""),
                    dirName: item,
                    type: "file",
                    path: itemPath,
                    files: [itemPath],
                    images: [],
                    description: "",
                    author: "",
                    avatar: "",
                    ownerHash: "",
                    updatedAt: gitDate(itemPath),
                });
            }
            count++;
        }
        folders.push({ name: folder, count });
    }
}

writeFileSync("_index.json", JSON.stringify({
    schema: "ai_phone_share_index",
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    folders,
    entries,
}, null, 2));
console.log(`_index.json: ${folders.length} folders, ${entries.length} entries`);
