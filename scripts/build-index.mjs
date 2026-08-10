// 扫描仓库目录生成 _index.json（时间索引）。
// 文件夹结构不做任何限制：根目录每个可见文件夹都是一个分类，
// 分类下每个子文件夹或孤立文件是一条资源。由 GitHub Actions 在 push 后自动执行。
import { execSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const IMAGE_RE = /\.(jpe?g|png|webp|gif)$/i;
const DESC_NAMES = ["说明.txt", "readme.md", "README.md", "readme.txt"];
const SKIP_DIRS = new Set([".git", ".github", "scripts", "node_modules"]);
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

const folders = [];
const entries = [];

for (const folder of readdirSync(".").sort()) {
    if (SKIP_DIRS.has(folder) || folder.startsWith(".") || folder.startsWith("_")) continue;
    if (!statSync(folder).isDirectory()) continue;

    let count = 0;
    for (const item of readdirSync(folder).sort()) {
        if (item.startsWith(".")) continue;
        const itemPath = join(folder, item);
        if (statSync(itemPath).isDirectory()) {
            // 子文件夹式资源
            const inner = readdirSync(itemPath).filter(f => !f.startsWith(".")).sort();
            const images = inner.filter(f => IMAGE_RE.test(f)).map(f => `${itemPath}/${f}`);
            const descNames = new Set(DESC_NAMES.map(n => n.toLowerCase()));
            const files = inner
                .filter(f => !IMAGE_RE.test(f) && !descNames.has(f.toLowerCase()))
                .map(f => `${itemPath}/${f}`);
            entries.push({
                folder,
                name: item,
                type: "dir",
                path: itemPath,
                files,
                images,
                description: readDesc(itemPath),
                updatedAt: gitDate(itemPath),
            });
        } else {
            // 孤立文件式资源
            entries.push({
                folder,
                name: item.replace(/\.[^.]+$/, ""),
                type: "file",
                path: itemPath,
                files: [itemPath],
                images: [],
                description: "",
                updatedAt: gitDate(itemPath),
            });
        }
        count++;
    }
    folders.push({ name: folder, count });
}

writeFileSync("_index.json", JSON.stringify({
    schema: "ai_phone_share_index",
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    folders,
    entries,
}, null, 2));
console.log(`_index.json: ${folders.length} folders, ${entries.length} entries`);
