// 会话管理器 · float 聊天插件
//
// 解决什么：float 至今没有删除会话的入口——下载来的群聊、试完就不用的临时
// 会话、导入重复的对话，只能一直堆在列表里。本插件补上这个口子。
//
// 怎么做到的：聊天插件与宿主同环境执行（无沙箱），但插件源码经 Blob URL 加载，
// 没有基准路径、import 不了宿主模块。所以直接用原生 IndexedDB 操作宿主的
// AiPhoneChatDB（表结构见 lib/chat-db.ts：sessions / messages / contacts）。
// **宿主一行不改**，任何版本的 float 装上就能用。
//
// 用法：装好后打开 聊天 → 我 → 高级工具 → 聊天插件，在插件设置里点
// 「打开会话管理」；或在任意聊天的设置区找到入口。

const DB_NAME = "AiPhoneChatDB";
const LS_SESSIONS_KEY = "ai_phone_chat_sessions_v1";

// ── IndexedDB 直连（不依赖 Dexie，用原生 API） ──────────────

function openDb() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error || new Error("打不开聊天数据库"));
    });
}

function txDone(tx) {
    return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error("事务被中止"));
    });
}

function getAll(store) {
    return new Promise((resolve, reject) => {
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
    });
}

/** 统计每个会话的消息条数（一次全表扫描，几万条也够快） */
async function countMessages(db) {
    const tx = db.transaction("messages", "readonly");
    const rows = await getAll(tx.objectStore("messages"));
    const map = new Map();
    for (const m of rows) {
        if (!m || !m.sessionId) continue;
        map.set(m.sessionId, (map.get(m.sessionId) || 0) + 1);
    }
    return map;
}

/**
 * 删除会话及其全部消息。
 * 顺序与宿主 deleteChatSession 一致：先删会话行，再清消息。
 * localStorage 里的会话快照（老版本迁移残留）一并同步，避免刷新后"复活"。
 */
async function deleteSessions(db, ids) {
    const idSet = new Set(ids);

    // 1) 消息：按 sessionId 索引游标删，避免把全表读进内存
    {
        const tx = db.transaction("messages", "readwrite");
        const store = tx.objectStore("messages");
        const index = store.index("sessionId");
        for (const id of ids) {
            await new Promise((resolve, reject) => {
                const req = index.openKeyCursor(IDBKeyRange.only(id));
                req.onsuccess = () => {
                    const cursor = req.result;
                    if (!cursor) { resolve(); return; }
                    store.delete(cursor.primaryKey);
                    cursor.continue();
                };
                req.onerror = () => reject(req.error);
            });
        }
        await txDone(tx);
    }

    // 2) 会话行
    {
        const tx = db.transaction("sessions", "readwrite");
        const store = tx.objectStore("sessions");
        for (const id of ids) store.delete(id);
        await txDone(tx);
    }

    // 3) localStorage 快照（存在才处理）
    try {
        const raw = window.localStorage.getItem(LS_SESSIONS_KEY);
        if (raw) {
            const list = JSON.parse(raw);
            if (Array.isArray(list)) {
                const next = list.filter(s => s && !idSet.has(s.id));
                if (next.length !== list.length) {
                    window.localStorage.setItem(LS_SESSIONS_KEY, JSON.stringify(next));
                }
            }
        }
    } catch { /* 快照坏了不影响主删除 */ }
}

// ── 界面 ────────────────────────────────────────────────

const CSS = `
/* 面板通体复用宿主自己的类（menu-group / menu-item / menu-label / menu-desc），
   主题、圆角、阴影、字号自动跟随——自己写一套只会像块外来补丁。
   这里只补宿主没有的几笔：容器尺寸、勾选圈、危险按钮。 */
/* 宿主的浮层容器是零内边距的（只给圆角+底色），四边留白得自己加，
   否则按钮和列表直接贴在圆角上。 */
.smgr-wrap{display:flex;flex-direction:column;width:min(92vw,430px);max-height:78vh;gap:2px;
  padding:16px 14px 14px;box-sizing:border-box;background:var(--c-page-body-bg,transparent)}
.smgr-scroll{flex:1;overflow-y:auto;margin:0 -4px;padding:0 4px 2px}
.smgr-item{cursor:pointer;user-select:none}
.smgr-check{width:21px;height:21px;flex:0 0 auto;align-self:center;border-radius:999px;
  display:grid;place-items:center;font-size:12px;line-height:1;
  border:1.5px solid color-mix(in srgb,var(--c-icon) 45%,transparent);
  color:transparent;transition:background .15s,border-color .15s,color .15s}
.smgr-item.sel .smgr-check{background:var(--c-text-title);border-color:var(--c-text-title);color:var(--c-panel)}
.smgr-seg{display:flex;gap:4px;padding:3px;margin:8px 0 10px;
  border-radius:var(--ui-radius-panel,12px);background:var(--c-panel)}
.smgr-seg button{flex:1;padding:7px 0;font:inherit;font-size:calc(13px*var(--app-text-scale,1));
  border:0;border-radius:9px;background:none;color:var(--c-icon);cursor:pointer;transition:background .16s,color .16s}
.smgr-seg button.on{background:var(--c-card,var(--c-page-body-bg));color:var(--c-text-title);
  font-weight:600;box-shadow:0 1px 3px rgba(0,0,0,.07)}
.smgr-foot{display:flex;gap:8px;padding-top:12px}
.smgr-foot button{flex:1;padding:11px 0;font:inherit;font-size:calc(14px*var(--app-text-scale,1));
  font-weight:500;border:0;border-radius:var(--ui-radius-panel,12px);background:var(--c-panel);
  color:var(--c-text-title);cursor:pointer;transition:opacity .15s}
.smgr-foot button[disabled]{opacity:.35;cursor:default}
.smgr-foot button.danger{background:#e5484d;color:#fff}
.smgr-exp{padding-top:12px}
.smgr-exp+.smgr-foot{padding-top:8px}
.smgr-warn{margin-top:10px;padding:10px 12px;border-radius:12px;
  font-size:calc(12.5px*var(--app-text-scale,1));line-height:1.65;
  background:color-mix(in srgb,#e5484d 12%,transparent);color:#e5484d}
`;

// ── 导出：SillyTavern 兼容的 .jsonl ────────────────────────
//
// 酒馆的聊天文件是 JSON Lines：**第一行是元数据**（user_name / character_name /
// create_date / chat_metadata），**之后每行一条消息**（name / is_user / send_date /
// mes）。这里按同一形状写出，酒馆可直接导入。
//
// 富媒体（红包/图片/语音…）在酒馆里没有对应物，降级成可读的方括号占位，
// 避免导出后是一堆空消息。

/**
 * 酒馆的 send_date 是 ISO 8601 带毫秒的 UTC 串（"2026-08-23T23:31:41.156Z"）。
 * 这是照着真机上跑的 SillyTavern 存出来的 .jsonl 对出来的，不是照旧文档写的——
 * 旧版那种 "2026-8-26 14:30:05" 人类可读格式已经不是它现在写的样子了。
 */
function stFormatDate(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toISOString();
}

const MEDIA_LABEL = {
    image: "图片", audio: "语音", video: "视频", sticker: "表情包",
    red_packet: "红包", transfer: "转账", location: "位置", poke: "拍一拍",
    quote: "引用", dice: "骰子", voice_call: "语音通话", video_call: "视频通话",
    music: "音乐", music_share: "音乐分享", gift: "礼物",
    contact_card: "名片", app_card: "卡片", payment_request: "收款请求",
    xiaohongshu_note_share: "小红书笔记",
};

/** 一条消息 → 酒馆的 mes 文本 */
// 这些是内部机括（工具调用、记忆写入请求），导出给人看没有意义
const SKIP_MEDIA = new Set(["tool_call", "tool_result", "memory_write_request"]);

function isExportable(m) {
    if (!m || m.role === "tool") return false;
    if (m.mediaType && SKIP_MEDIA.has(m.mediaType)) return false;
    if (m.isTyping) return false;
    return true;
}

/** 语音文本里混着 <#0.5#> 这类 TTS 停顿标记，导出得洗掉 */
function cleanSpeech(text) {
    return String(text || "").replace(/<#[\d.]+#>/g, "").trim();
}

/** 语音的说话内容存在 mediaData.label 上，content 是空的 */
function voiceText(m) {
    return cleanSpeech(m.mediaData?.label || m.content || "");
}

/** 给人看的时间：2026-8-26 20:10（ISO 是给酒馆读的，别混用） */
function humanTime(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 秒数 → 05:23；语音条只有几十秒，通话可能上分钟 */
function fmtDuration(sec) {
    const n = Math.max(0, Math.round(Number(sec) || 0));
    if (!n) return "";
    const mm = Math.floor(n / 60);
    return mm ? `${mm}:${String(n % 60).padStart(2, "0")}` : `${n}"`;
}

function stMessageText(m) {
    const text = cleanSpeech(m.content);
    if (m.isRetracted) return "[已撤回]";
    const d = m.mediaData || {};
    switch (m.mediaType) {
        case "quote": {
            // 被引的那句在 quotePreview 里，只写 [引用] 会看不懂在回什么
            const q = (d.quotePreview || "").trim();
            return q ? `[引用「${q}」] ${text}`.trim() : (text || "[引用]");
        }
        case "red_packet":
        case "transfer": {
            const label = MEDIA_LABEL[m.mediaType];
            const amount = d.amount != null ? ` ¥${d.amount}` : "";
            const note = (d.label || text || "").trim();
            return `[${label}${amount}]${note ? ` ${note}` : ""}`;
        }
        case "audio": {
            const dur = fmtDuration(d.voiceDuration);
            const said = voiceText(m);
            return `[语音${dur ? ` ${dur}` : ""}]${said ? ` ${said}` : ""}`;
        }
        case "voice_call":
        case "video_call": {
            const label = MEDIA_LABEL[m.mediaType];
            const dur = d.callDuration || fmtDuration(d.voiceDuration);
            return `[${label}${dur ? ` ${dur}` : ""}]${text ? ` ${text}` : ""}`;
        }
        case "media_file":
            return `[文件]${text ? ` ${text}` : ""}`;
        case "poke":
            return `[拍一拍] ${(d.pokeSender || "")}拍了拍${(d.pokeTarget || "")}`.trim();
        case "music":
        case "music_share": {
            const t = [d.musicTitle, d.musicArtist].filter(Boolean).join(" - ");
            return `[音乐]${t ? ` ${t}` : ""}`;
        }
        default: break;
    }
    if (m.mediaType && MEDIA_LABEL[m.mediaType]) {
        const label = MEDIA_LABEL[m.mediaType];
        // 图片/表情的说明文字常挂在 mediaData.label 上，content 是空的
        const note = text || (d.label || "").trim();
        return note ? `[${label}] ${note}` : `[${label}]`;
    }
    return text;
}

/**
 * 生成 jsonl 文本。
 * 群聊里每条消息的说话人可能不同（senderName），单聊则统一用角色名。
 */
function buildJsonl({ session, messages, charName, userName }) {
    const lines = [];
    lines.push(JSON.stringify({
        user_name: userName,
        character_name: charName,
        create_date: stFormatDate(session.updatedAt || new Date().toISOString()),
        chat_metadata: {
            // 留一点来源痕迹，方便日后辨认这份文件是从哪导出的
            exported_from: "float",
            session_id: session.id,
            is_group: !!session.isGroup,
        },
    }));
    for (const m of messages) {
        if (!isExportable(m) || m.role === "system") continue;   // 酒馆没有对应角色
        const mes = stMessageText(m);
        if (!mes) continue;
        const isUser = m.role === "user";
        lines.push(JSON.stringify({
            name: isUser ? userName : (m.senderName || charName),
            is_user: isUser,
            is_system: false,
            send_date: stFormatDate(m.createdAt),
            mes,
            extra: {},   // 真文件里每条都带，缺了酒馆某些扩展会读到 undefined
        }));
    }
    return lines.join("\n") + "\n";
}

// ── 导出：可自己翻的网页 ──────────────────────────────────
//
// jsonl 是给酒馆导入的，人读不了。这份 HTML 是给自己存档的：单文件、
// 双击就能看、气泡左右分栏，离线可读（不引任何外部资源）。

function esc(text) {
    return String(text ?? "")
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

/**
 * 取宿主里"我"的身份（名字、头像）。插件契约没开这个口子，
 * 但它就存在 AiPhoneKvDB 里，直接读一份，读不到就返回空。
 */
async function loadUserIdentity() {
    try {
        const db = await new Promise((res, rej) => {
            const r = indexedDB.open("AiPhoneKvDB");
            r.onsuccess = () => res(r.result);
            r.onerror = () => rej(r.error);
        });
        const raw = await new Promise((res, rej) => {
            const t = db.transaction("entries", "readonly");
            const q = t.objectStore("entries").get("ai_phone_user_identities_v1");
            q.onsuccess = () => res(q.result);
            q.onerror = () => rej(q.error);
        });
        db.close();
        const text = typeof raw === "string" ? raw : (raw && raw.value);
        const list = JSON.parse(text || "null");
        const me = Array.isArray(list) ? list[0] : null;
        return me ? { name: me.name || "", avatar: me.avatarUrl || "" } : null;
    } catch {
        return null;
    }
}

// ── 导出网页里的阅读工具条 ──────────────────────────────────
//
// 几千上万条的存档翻起来没个着落，所以页面自带：顶部读到哪儿的进度、
// 跳到第几条、全文搜索（回车逐个跳）。纯内联，离线可用。
const READER_SCRIPT = `
(function () {
  var rows = [].slice.call(document.querySelectorAll('.row[data-i]'));
  if (!rows.length) return;
  var total = rows.length;
  var bar = document.getElementById('bar');
  var dayEl = document.getElementById('day');
  var fab = document.getElementById('fab');
  var panel = document.getElementById('panel');
  var daypop = document.getElementById('daypop');
  var countEl = document.getElementById('count');
  var jump = document.getElementById('jump');
  var q = document.getElementById('q');
  var hits = document.getElementById('hits');
  var prev = document.getElementById('prev');
  var next = document.getElementById('next');

  // 读到哪儿：滚动位置换算成条数，比逐条测位置省事得多
  // 视口中线落在哪条上，就报哪条的日期——日期条滚出屏幕后也知道自己在哪天
  function dayAtCenter() {
    var mid = window.innerHeight / 2;
    var lo = 0, hi = total - 1, best = 0;
    while (lo <= hi) {
      var m = (lo + hi) >> 1;
      if (rows[m].getBoundingClientRect().top <= mid) { best = m; lo = m + 1; }
      else hi = m - 1;
    }
    return rows[best].getAttribute('data-day') || '';
  }

  function onScroll() {
    var h = document.documentElement.scrollHeight - window.innerHeight;
    var p = h > 0 ? Math.min(1, Math.max(0, window.scrollY / h)) : 0;
    bar.style.width = (p * 100).toFixed(2) + '%';
    countEl.textContent = Math.max(1, Math.round(p * total)) + ' / ' + total;
    var day = dayAtCenter();
    dayEl.textContent = day;
    // 面板开着的时候里头已经写着日期了，别再浮一个出来打架
    if (day && !panel.classList.contains('on')) {
      daypop.textContent = day;
      daypop.classList.add('show');
      clearTimeout(popTimer);
      popTimer = setTimeout(function () { daypop.classList.remove('show'); }, 1400);
    }
  }
  var popTimer = 0;
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  onScroll();
  daypop.classList.remove('show');

  function goto(n) {
    var i = Math.min(total, Math.max(1, parseInt(n, 10) || 1));
    var el = rows[i - 1];
    if (!el) return;
    el.scrollIntoView({ block: 'center' });
    el.classList.add('flash');
    setTimeout(function () { el.classList.remove('flash'); }, 1200);
  }
  jump.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { goto(jump.value); jump.blur(); }
  });

  // 搜索：把命中行收进列表，回车在命中之间轮着跳
  var found = [], cur = -1, lastQ = '';
  function search() {
    var text = q.value.trim().toLowerCase();
    if (text === lastQ) return;
    lastQ = text;
    for (var i = 0; i < rows.length; i++) rows[i].classList.remove('hit');
    found = []; cur = -1;
    if (!text) { hits.textContent = ''; return; }
    for (var j = 0; j < rows.length; j++) {
      if (rows[j].textContent.toLowerCase().indexOf(text) >= 0) {
        rows[j].classList.add('hit');
        found.push(rows[j]);
      }
    }
    hits.textContent = found.length ? ('0/' + found.length) : '无';
    if (found.length) step(1);
  }
  function step(d) {
    if (!found.length) return;
    cur = (cur + d + found.length) % found.length;
    var el = found[cur];
    el.scrollIntoView({ block: 'center' });
    hits.textContent = (cur + 1) + '/' + found.length;
  }
  function togglePanel(open) {
    var on = open === undefined ? !panel.classList.contains('on') : open;
    panel.classList.toggle('on', on);
    fab.classList.toggle('on', on);
    if (on) q.focus();
  }
  fab.addEventListener('click', function (e) { e.stopPropagation(); togglePanel(); });
  // 点面板外面收起；面板内部的点击不算
  document.addEventListener('click', function (e) {
    if (!panel.classList.contains('on')) return;
    if (!panel.contains(e.target)) togglePanel(false);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') togglePanel(false);
  });

  q.addEventListener('input', search);
  q.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); if (found.length) step(e.shiftKey ? -1 : 1); else search(); }
  });
  prev.addEventListener('click', function () { step(-1); });
  next.addEventListener('click', function () { step(1); });
})();
`;

/** 把媒体解析成可内嵌的 data URL；超预算就返回 null，让调用方退回文字占位。 */
async function embedMedia(ctx, m, budget) {
    if (budget.left <= 0) return null;
    const got = await ctx.data.messages.resolveMedia(m).catch(() => null);
    if (!got || !got.dataURL) return null;
    const cost = got.dataURL.length;
    if (cost > budget.left) { budget.skipped += 1; return null; }
    budget.left -= cost;
    return got;
}

function timeOf(d) {
    return Number.isNaN(d.getTime()) ? ""
        : `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * 头像去重：同一张头像会出现在每一条消息上，逐条内嵌 data URL 能把
 * 文件撑大十几倍。这里只登记一次，产出 CSS 类名，图放进样式表。
 */
function makeAvatarPool() {
    const byUrl = new Map();
    return {
        classFor(url) {
            if (!url) return "";
            let cls = byUrl.get(url);
            if (!cls) { cls = `av${byUrl.size}`; byUrl.set(url, cls); }
            return cls;
        },
        css() {
            const out = [];
            for (const [url, cls] of byUrl) {
                out.push(`.${cls}{background-image:url("${url.replace(/"/g, "%22")}")}`);
            }
            return out.join("\n");
        },
    };
}

function avatarTag(cls, name) {
    if (cls) return `<div class="av ${cls}"></div>`;
    // 没头像就用名字首字，别留个空洞
    return `<div class="av av-txt">${esc((name || "?").slice(0, 1))}</div>`;
}

/**
 * 生成"长得像聊天框"的存档网页：头像、气泡、内嵌图片表情、红包转账卡片。
 * 单文件、离线可读——所有图都转成 data URL 塞进 HTML，不引任何外部资源。
 * 媒体太多会把文件撑爆，所以有个总预算，超了的退回文字占位并在页脚说明。
 */
async function buildHtml({ ctx, session, messages, charName, userName, userAvatar, budgetBytes }) {
    const budget = { left: budgetBytes, skipped: 0 };
    const avatars = makeAvatarPool();
    const rows = [];
    let lastDay = "";
    let lastAt = 0;
    let bubbles = 0;

    const avatarOf = (m) => {
        if (m.role === "user") return userAvatar;
        const id = m.senderCharacterId || session.contactId;
        return (id && ctx.data.characters.get(id)?.avatar) || "";
    };

    for (const m of messages) {
        if (!isExportable(m)) continue;
        const d = new Date(m.createdAt);
        const at = d.getTime();

        const day = Number.isNaN(at) ? "" : `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
        const dayLabel = Number.isNaN(at) ? "" : `${d.getMonth() + 1}月${d.getDate()}日`;
        if (day && day !== lastDay) {
            rows.push(`<div class="stamp">${esc(day)}</div>`);
            lastDay = day;
            lastAt = at;
        } else if (at && lastAt && at - lastAt > 10 * 60 * 1000) {
            // 隔了十分钟以上插个时间条，和聊天框里一个意思
            rows.push(`<div class="stamp">${esc(timeOf(d))}</div>`);
            lastAt = at;
        }
        if (at) lastAt = at;

        // 通话在聊天里不是气泡——宿主拿到这条信号直接弹通话界面。
        // 通话里说的话本身是普通消息，已经在下面照常导出了。
        if (m.mediaType === "voice_call" || m.mediaType === "video_call") {
            const who = m.role === "user" ? userName : (m.senderName || charName);
            const label = m.mediaType === "voice_call" ? "语音通话" : "视频通话";
            const dur = m.mediaData?.callDuration || fmtDuration(m.mediaData?.voiceDuration);
            rows.push(`<div class="sys">${esc(who)} 发起了${esc(label)}${dur ? ` · ${esc(dur)}` : ""}</div>`);
            continue;
        }

        if (m.role === "system") {
            const t = stMessageText(m);
            if (t) rows.push(`<div class="sys">${esc(t)}</div>`);
            continue;
        }

        const isUser = m.role === "user";
        const who = isUser ? userName : (m.senderName || charName);
        const head = session.isGroup && !isUser ? `<div class="who">${esc(who)}</div>` : "";
        const time = timeOf(d);
        let body = "";
        let bare = false;   // 表情包、图片不套气泡底色

        const kind = m.mediaType || "";
        if (kind === "sticker" || kind === "image" || kind === "media_file") {
            const got = await embedMedia(ctx, m, budget);
            if (got && got.category === "image") {
                const cap = (m.content || m.mediaData?.label || "").trim();
                body = `<img class="pic ${kind === "sticker" ? "sticker" : ""}" src="${esc(got.dataURL)}" alt="">`
                    + (cap ? `<div class="cap">${esc(cap)}</div>` : "");
                bare = true;
            }
        } else if (kind === "audio") {
            const got = await embedMedia(ctx, m, budget);
            const dur = fmtDuration(m.mediaData?.voiceDuration);
            const said = voiceText(m);
            // 上半截是语音条（有音频就能点开听），下半截是转文字——
            // 聊天里点一下才展开的那段，存档就直接摊开
            // 语音条宽度跟着时长走，跟聊天里一个观感（封顶别让它长到天上去）
            const secs = Number(m.mediaData?.voiceDuration) || 0;
            const barW = Math.round(Math.min(190, 86 + secs * 2.6));
            body = `<div class="voice" style="width:${barW}px">`
                + `<span class="voice-i">▶</span><span class="voice-w"></span>`
                + `<span class="voice-d">${esc(dur || "语音")}</span></div>`
                + (got ? `<audio class="au" controls src="${esc(got.dataURL)}"></audio>` : "")
                + (said ? `<div class="stt">${esc(said).replace(/\n/g, "<br>")}</div>` : "");
        } else if (kind === "red_packet" || kind === "transfer") {
            const dd = m.mediaData || {};
            const amount = dd.amount != null ? `¥${dd.amount}` : "";
            const note = (dd.label || m.content || "").trim();
            body = `<div class="lucky"><div class="lucky-i">${kind === "red_packet" ? "🧧" : "💸"}</div>`
                + `<div><div class="lucky-a">${esc(amount || (kind === "red_packet" ? "红包" : "转账"))}</div>`
                + (note ? `<div class="lucky-n">${esc(note)}</div>` : "") + `</div></div>`;
            bare = true;
        }

        if (!body && kind === "quote") {
            const q = (m.mediaData?.quotePreview || "").trim();
            const own = (m.content || "").trim();
            if (q || own) {
                body = (q ? `<div class="quo">${esc(q)}</div>` : "")
                    + (own ? `<div class="text">${esc(own).replace(/\n/g, "<br>")}</div>` : "");
            }
        }

        if (!body) {
            const t = stMessageText(m);
            if (!t) continue;
            body = `<div class="text">${esc(t).replace(/\n/g, "<br>")}</div>`;
        }

        bubbles += 1;
        rows.push(
            `<div class="row ${isUser ? "me" : "ta"}" data-i="${bubbles}" data-day="${esc(dayLabel)}">`
            + avatarTag(avatars.classFor(avatarOf(m)), who)
            + `<div class="col">${head}<div class="bubble ${bare ? "bare" : ""}" title="${esc(time)}">${body}</div></div>`
            + `</div>`,
        );
    }

    const note = budget.skipped
        ? ` · ${budget.skipped} 张图太大未内嵌`
        : "";
    return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(charName)} · 聊天记录</title>
<style>
:root{color-scheme:light dark}
body{margin:0;padding:22px 14px 84px;background:#f5f4f0;color:#1d1a16;
  font:15px/1.65 -apple-system,BlinkMacSystemFont,"PingFang SC","Noto Sans SC",sans-serif}
/* 顶上一条细进度线：不占地方也挡不着谁 */
.bar-track{position:fixed;top:0;left:0;right:0;height:2px;z-index:6;
  background:rgba(128,128,128,.14)}
.bar{height:100%;width:0;background:#c2653c;transition:width .1s linear}

/* 悬浮球：抬得比较高——iOS Safari 底部地址栏和安卓手势条会盖掉屏幕
   最下面那一截，贴着底边的话根本点不到 */
.fab{position:fixed;right:16px;z-index:7;
  bottom:calc(110px + env(safe-area-inset-bottom,0px));
  width:46px;height:46px;border-radius:50%;border:0;cursor:pointer;
  display:flex;align-items:center;justify-content:center;
  background:#c2653c;color:#fff;box-shadow:0 3px 12px rgba(0,0,0,.22);
  transition:background .18s ease}
.fab.on{background:#8f4a2c}
.fab .i-close,.fab.on .i-find{display:none}
.fab.on .i-close{display:block}

/* 滚动时在球上方浮一下当前日期，停手就淡掉——不用点开也知道在哪天 */
.daypop{position:fixed;right:70px;z-index:7;
  bottom:calc(119px + env(safe-area-inset-bottom,0px));
  padding:4px 10px;border-radius:99px;font-size:12px;white-space:nowrap;
  background:rgba(30,28,26,.82);color:#fff;pointer-events:none;
  opacity:0;transition:opacity .25s ease}
.daypop.show{opacity:1}

.panel{position:fixed;right:16px;z-index:7;
  bottom:calc(166px + env(safe-area-inset-bottom,0px));
  width:min(300px,calc(100vw - 32px));padding:10px;
  border-radius:14px;background:var(--pan,#fff);
  box-shadow:0 6px 24px rgba(0,0,0,.18);
  display:none;flex-direction:column;gap:8px}
.panel.on{display:flex}
.panel-row{display:flex;gap:6px;align-items:center}
.panel input{font:inherit;font-size:13px;padding:7px 9px;
  border:1px solid rgba(128,128,128,.28);border-radius:8px;
  background:transparent;color:inherit;min-width:0}
#q{flex:1;min-width:60px}
#jump{flex:1;-moz-appearance:textfield}
#jump::-webkit-outer-spin-button,#jump::-webkit-inner-spin-button{-webkit-appearance:none;margin:0}
.panel button{flex:none;font:inherit;font-size:13px;padding:7px 10px;
  border:1px solid rgba(128,128,128,.28);border-radius:8px;
  background:transparent;color:inherit;cursor:pointer;line-height:1}
.hits,.at{font-size:11.5px;opacity:.6;white-space:nowrap;font-variant-numeric:tabular-nums}
.at{display:flex;gap:7px;align-items:baseline;margin-left:auto}
#day{font-weight:500;opacity:.9}
.row.hit .bubble{outline:2px solid #c2653c;outline-offset:2px}
.row.flash .bubble{animation:flash .9s ease-out}
@keyframes flash{from{box-shadow:0 0 0 4px rgba(194,101,60,.45)}to{box-shadow:0 0 0 4px rgba(194,101,60,0)}}
.head{max-width:640px;margin:0 auto 16px;text-align:center}
.head h1{margin:0 0 4px;font-size:19px;font-weight:600}
.head p{margin:0;font-size:12.5px;opacity:.55}
.wrap{max-width:640px;margin:0 auto;display:flex;flex-direction:column;gap:12px}
.stamp{align-self:center;margin:10px 0 2px;padding:3px 10px;border-radius:99px;
  font-size:11.5px;opacity:.5;background:rgba(128,128,128,.14)}
.sys{align-self:center;max-width:88%;text-align:center;font-size:12.5px;opacity:.55}
.row{display:flex;gap:8px;align-items:flex-start}
.row.me{flex-direction:row-reverse}
.av{width:34px;height:34px;border-radius:9px;flex:none;background:rgba(128,128,128,.16) center/cover no-repeat}
.av-txt{display:flex;align-items:center;justify-content:center;font-size:14px;opacity:.6}
.col{display:flex;flex-direction:column;max-width:74%;min-width:0}
.row.me .col{align-items:flex-end}
.who{font-size:11.5px;opacity:.5;margin:0 2px 3px}
.bubble{padding:9px 13px;border-radius:14px;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.06)}
.row.me .bubble{background:#c9e7b7}
.row .bubble.bare{background:none;box-shadow:none;padding:0}
.text{white-space:pre-wrap;word-break:break-word}
.quo{border-left:2px solid currentColor;opacity:.5;padding-left:8px;margin-bottom:5px;
  font-size:13px;line-height:1.45;max-height:3.2em;overflow:hidden}
.pic{max-width:min(100%,240px);border-radius:10px;display:block}
.pic.sticker{max-width:120px}
.cap{font-size:12px;opacity:.55;margin-top:4px}
.voice{display:flex;align-items:center;gap:8px;max-width:100%}
.voice-i{font-size:11px;opacity:.65}
.voice-w{flex:1;height:3px;border-radius:2px;background:currentColor;opacity:.28;min-width:36px}
.voice-d{font-size:12px;opacity:.6;font-variant-numeric:tabular-nums}
.stt{margin-top:7px;padding-top:7px;border-top:1px solid rgba(128,128,128,.22);
  font-size:13.5px;line-height:1.55;opacity:.85;white-space:pre-wrap;word-break:break-word}
.au{margin-top:6px;width:200px;max-width:100%;height:30px;display:block}
.call{display:flex;align-items:center;gap:7px}
.call-i{font-size:14px}
.lucky{display:flex;gap:10px;align-items:center;padding:11px 14px;border-radius:12px;
  background:linear-gradient(135deg,#e8734a,#d9542f);color:#fff;min-width:150px}
.lucky-i{font-size:22px}
.lucky-a{font-size:16px;font-weight:600}
.lucky-n{font-size:12px;opacity:.85;margin-top:2px}
.foot{max-width:640px;margin:26px auto 12px;text-align:center;font-size:11.5px;opacity:.4}
${avatars.css()}
@media (prefers-color-scheme:dark){
  body{background:#16151a;color:#e9e6e0}
  .panel{--pan:#26242c}
  .bubble{background:#26242c;box-shadow:none}
  .row.me .bubble{background:#3a5236}
  .row .bubble.bare{background:none}
}
</style></head>
<body>
<div class="bar-track"><div class="bar" id="bar"></div></div>
<div class="daypop" id="daypop"></div>
<button class="fab" id="fab" title="搜索 / 跳转" aria-label="搜索">
  <svg class="i-find" viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor"
       stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>
  <svg class="i-close" viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor"
       stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
</button>
<div class="panel" id="panel">
  <div class="panel-row">
    <input id="q" type="search" placeholder="搜索这段聊天" autocomplete="off">
    <span class="hits" id="hits"></span>
    <button id="prev" title="上一个">↑</button>
    <button id="next" title="下一个">↓</button>
  </div>
  <div class="panel-row">
    <input id="jump" type="number" min="1" max="${bubbles}" placeholder="跳到第几条" autocomplete="off">
    <span class="at"><b id="day"></b><span id="count">1 / ${bubbles}</span></span>
  </div>
</div>
<div class="head"><h1>${esc(charName)}</h1><p>${bubbles} 条消息 · 导出于 ${esc(humanTime(new Date().toISOString()))}${note}</p></div>
<div class="wrap">
${rows.join("\n")}
</div>
<div class="foot">由 float · 会话管理器导出</div>
<script>${READER_SCRIPT}</script>
</body></html>`;
}

function isIOS() {
    if (typeof navigator === "undefined") return false;
    const ua = navigator.userAgent || "";
    // iPadOS 13+ 伪装成 Mac，靠触点数才认得出来
    return /iPad|iPhone|iPod/i.test(ua)
        || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

/**
 * 触发下载。
 * iOS 上 <a download> 顶多把文件在当前页打开，存不下来，所以先走系统分享面板
 * （能"存储到文件"）；分享不可用时（局域网 http 不是安全上下文，Safari 就不给
 * 分享文件）再退回 <a download>，并把 blob 多留一会儿——Safari 消费得慢。
 */
async function downloadText(filename, text) {
    const type = filename.endsWith(".html") ? "text/html;charset=utf-8" : "application/jsonl;charset=utf-8";
    const blob = new Blob([text], { type });

    if (isIOS()) {
        const file = new File([blob], filename, { type });
        const canShare = typeof navigator.share === "function"
            && typeof navigator.canShare === "function"
            && navigator.canShare({ files: [file] });
        if (canShare) {
            try {
                await navigator.share({ files: [file] });
                return;
            } catch (e) {
                // 用户自己取消了就别再硬塞一个下载给他
                if (e && e.name === "AbortError") return;
            }
        }
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), isIOS() ? 60000 : 4000);
}

function safeName(text) {
    return String(text || "chat").replace(/[\\/:*?"<>|\s]+/g, "_").slice(0, 40);
}

function fmtTime(value) {
    if (!value) return "";
    const t = typeof value === "number" ? value : Date.parse(value);
    if (!Number.isFinite(t)) return "";
    const days = Math.floor((Date.now() - t) / 86400000);
    if (days <= 0) return "今天";
    if (days === 1) return "昨天";
    if (days < 30) return `${days} 天前`;
    return new Date(t).toLocaleDateString();
}

export default {
    manifest: {
        id: "session-manager",
        name: "会话管理器",
        version: "1.0.0",
        apiVersion: 1,
        description: "删除本地数据库内的对话，不可恢复。",
        author: "但求一睡君莫笑",
        permissions: ["chat.read", "storage", "ui"],
        settings: [
            {
                key: "userName",
                label: "导出时你的名字",
                type: "text",
                description: "留空则用小手机里「我」的身份名。写进导出文件里代表你的那一方，酒馆导入后显示为这个名字。",
            },
            {
                key: "exportMedia",
                label: "网页导出内嵌图片",
                type: "boolean",
                default: true,
                description: "把图片、表情、语音一起打包进网页，离线也能看；关掉则只留文字占位，文件小很多。",
            },
        ],
    },

    setup(ctx) {
        const disposables = [];
        disposables.push(ctx.ui.injectCSS(CSS));

        async function openManager() {
            let db;
            try {
                db = await openDb();
            } catch (e) {
                ctx.ui.toast(`打不开聊天数据库：${e.message || e}`);
                return;
            }

            // 消息计数只扫一次：两万多条消息全表扫描不便宜，
            // 而它在一次面板会话里不会变。
            const counts = await countMessages(db).catch(() => new Map());

            ctx.ui.openModal((el, api) => {
                const selected = new Set();
                let tab = "group";
                let confirming = false;
                let exporting = "";   // 正在导的格式，导出期间两个按钮都锁住

                // 必须挂 page-menu：宿主的 .menu-group 默认 opacity:0，
                // 靠 `.page-menu .menu-group` 才恢复可见（还关掉入场动画）。
                // 少了这层上下文，列表是半透明的——上一版"看着奇怪"就是这个。
                const wrap = document.createElement("div");
                wrap.className = "page-menu smgr-wrap";
                el.appendChild(wrap);

                // 单聊：session.contactId **就是** characterId（宿主 desktop-shell
                // 里也是 chars.find(c => c.id === session.contactId)）。
                const nameOf = (s) => {
                    if (s.isGroup) return s.groupName || "未命名群聊";
                    if (s.alias) return s.alias;
                    try {
                        const ch = ctx.data.characters.get(s.contactId);
                        if (ch?.name) return ch.name;
                    } catch { /* 落到下面 */ }
                    return "已删除的角色";
                };

                const all = (ctx.data.sessions.list() || [])
                    .slice()
                    .sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0));
                const groups = all.filter(s => s.isGroup);
                const privates = all.filter(s => !s.isGroup);

                // ── 骨架只建一次；之后所有交互都只改局部，不重建 DOM
                //    （上一版每次点选都整体 render()，肉眼看到的就是闪屏）
                const title = document.createElement("div");
                title.className = "settings-menu-section-title";
                title.textContent = `会话管理 · 共 ${all.length} 个`;
                wrap.appendChild(title);

                const seg = document.createElement("div");
                seg.className = "smgr-seg";
                const segBtns = {};
                for (const [key, label, arr] of [["group", "群聊", groups], ["private", "单聊", privates]]) {
                    const btn = document.createElement("button");
                    btn.textContent = `${label} ${arr.length}`;
                    btn.onclick = () => { if (tab === key) return; tab = key; selected.clear(); confirming = false; syncAll(); };
                    segBtns[key] = btn;
                    seg.appendChild(btn);
                }
                wrap.appendChild(seg);

                const scroll = document.createElement("div");
                scroll.className = "smgr-scroll";
                wrap.appendChild(scroll);

                const warn = document.createElement("div");
                warn.className = "smgr-warn";
                warn.style.display = "none";
                wrap.appendChild(warn);

                // 导出两排：上排两个格式各一个按钮，下排关闭 / 删除
                const expRow = document.createElement("div");
                expRow.className = "smgr-foot smgr-exp";
                const htmlBtn = document.createElement("button");
                const jsonlBtn = document.createElement("button");
                expRow.appendChild(htmlBtn);
                expRow.appendChild(jsonlBtn);
                wrap.appendChild(expRow);

                const foot = document.createElement("div");
                foot.className = "smgr-foot";
                const leftBtn = document.createElement("button");
                const rightBtn = document.createElement("button");
                rightBtn.className = "danger";
                foot.appendChild(leftBtn);
                foot.appendChild(rightBtn);
                wrap.appendChild(foot);

                // 两个列表各建一次，切换时只换显示，行不重建
                const listOf = (rows, emptyText) => {
                    const box = document.createElement("div");
                    box.className = "menu-group";
                    if (rows.length === 0) {
                        const empty = document.createElement("div");
                        empty.className = "ui-empty";
                        empty.style.padding = "28px 0";
                        empty.innerHTML = `<span class="menu-desc">${emptyText}</span>`;
                        box.appendChild(empty);
                        return { box, items: new Map() };
                    }
                    const items = new Map();
                    for (const s of rows) {
                        const item = document.createElement("div");
                        item.className = "menu-item smgr-item";

                        const check = document.createElement("span");
                        check.className = "smgr-check";
                        check.textContent = "✓";

                        const group = document.createElement("div");
                        group.className = "menu-label-group";
                        const name = document.createElement("span");
                        name.className = "menu-label";
                        name.textContent = nameOf(s);
                        const desc = document.createElement("span");
                        desc.className = "menu-desc";
                        const bits = [`${counts.get(s.id) || 0} 条消息`];
                        if (s.isGroup && s.participantIds?.length) bits.push(`${s.participantIds.length} 人`);
                        const when = fmtTime(s.updatedAt);
                        if (when) bits.push(when);
                        desc.textContent = bits.join(" · ");
                        group.appendChild(name);
                        group.appendChild(desc);

                        item.appendChild(check);
                        item.appendChild(group);
                        item.onclick = () => {
                            if (selected.has(s.id)) selected.delete(s.id); else selected.add(s.id);
                            item.classList.toggle("sel", selected.has(s.id));   // 只动这一行
                            if (confirming) { confirming = false; }
                            syncFoot();                                          // 只更新底部
                        };
                        items.set(s.id, item);
                        box.appendChild(item);
                    }
                    return { box, items };
                };

                const views = {
                    group: listOf(groups, "还没有群聊"),
                    private: listOf(privates, "还没有单聊"),
                };
                scroll.appendChild(views.group.box);
                scroll.appendChild(views.private.box);

                function syncFoot() {
                    segBtns.group.classList.toggle("on", tab === "group");
                    segBtns.private.classList.toggle("on", tab === "private");
                    leftBtn.textContent = confirming ? "再想想" : "关闭";
                    // 删除确认时把导出那排收起来，别让人在确认框边上误点
                    expRow.style.display = confirming ? "none" : "";
                    const n = selected.size;
                    htmlBtn.disabled = n === 0 || exporting;
                    jsonlBtn.disabled = n === 0 || exporting;
                    htmlBtn.textContent = exporting === "html" ? "导出中…" : (n ? `导出网页（${n}）` : "导出网页");
                    jsonlBtn.textContent = exporting === "jsonl" ? "导出中…" : (n ? `导出 jsonl（${n}）` : "导出 jsonl");
                    rightBtn.disabled = selected.size === 0;
                    rightBtn.textContent = confirming
                        ? "确认删除"
                        : selected.size ? `删除选中（${selected.size}）` : "删除选中";
                    if (confirming) {
                        const rows = tab === "group" ? groups : privates;
                        const total = rows.filter(s => selected.has(s.id))
                            .reduce((sum, s) => sum + (counts.get(s.id) || 0), 0);
                        warn.textContent = `将永久删除 ${selected.size} 个会话及其 ${total} 条消息。此操作不可恢复。`;
                        warn.style.display = "";
                    } else {
                        warn.style.display = "none";
                    }
                }

                function syncAll() {
                    views.group.box.style.display = tab === "group" ? "" : "none";
                    views.private.box.style.display = tab === "private" ? "" : "none";
                    for (const view of Object.values(views)) {
                        for (const [id, item] of view.items) item.classList.toggle("sel", selected.has(id));
                    }
                    syncFoot();
                }

                leftBtn.onclick = () => {
                    if (confirming) { confirming = false; syncFoot(); return; }
                    api.close();
                };
                async function runExport(fmt) {
                    const ids = [...selected];
                    if (!ids.length || exporting) return;
                    exporting = fmt;
                    syncFoot();
                    try {
                        const me = await loadUserIdentity();
                        // 设置项留空就用宿主里"我"的身份名
                        const userName = String(ctx.system.settings.get("userName") || me?.name || "我");
                        const userAvatar = me?.avatar || "";
                        const withMedia = ctx.system.settings.get("exportMedia") !== false;
                        // 内嵌媒体总预算：base64 后约 40MB，够几百张图，再多网页也打不开了
                        const budgetBytes = withMedia ? 40 * 1024 * 1024 : 0;
                        // 戳到分秒：同名文件在安卓那边会被 MediaStore 加个 " (1)"
                        // 缀到扩展名后面，把 .jsonl 变成 ".jsonl (1)"，酒馆就认不出了
                        const d = new Date();
                        const p2 = (n) => String(n).padStart(2, "0");
                        const stamp = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}`
                            + `-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
                        let done = 0;
                        for (const id of ids) {
                            const session = all.find(x => x.id === id);
                            if (!session) continue;
                            const messages = ctx.data.messages.list(id) || [];
                            const charName = nameOf(session);
                            const base = `${safeName(charName)}_${stamp}`;
                            if (fmt === "jsonl") {
                                await downloadText(`${base}.jsonl`,
                                    buildJsonl({ session, messages, charName, userName }));
                            } else {
                                await downloadText(`${base}.html`, await buildHtml({
                                    ctx, session, messages, charName, userName, userAvatar, budgetBytes,
                                }));
                            }
                            done += 1;
                            // 连着触发下载浏览器会掐掉后面的，隔一拍
                            if (ids.length > 1) await new Promise(r => setTimeout(r, 400));
                        }
                        ctx.ui.toast(`已导出 ${done} 个会话，看「下载」目录`);
                    } catch (e) {
                        ctx.ui.toast(`导出失败：${e.message || e}`);
                    } finally {
                        exporting = "";
                        syncFoot();
                    }
                }

                htmlBtn.onclick = () => runExport("html");
                jsonlBtn.onclick = () => runExport("jsonl");

                rightBtn.onclick = async () => {
                    if (!confirming) { confirming = true; syncFoot(); return; }
                    rightBtn.disabled = true;
                    rightBtn.textContent = "删除中…";
                    try {
                        const ids = [...selected];
                        await deleteSessions(db, ids);
                        ctx.system.log("deleted sessions:", ids);
                        ctx.ui.toast(`已删除 ${ids.length} 个会话`);
                        api.close();
                        // 宿主内存缓存里还留着旧会话，刷新是最干净的收尾
                        setTimeout(() => window.location.reload(), 500);
                    } catch (e) {
                        ctx.ui.toast(`删除失败：${e.message || e}`);
                        confirming = false;
                        syncFoot();
                    }
                };

                syncAll();
                return () => { wrap.remove(); };
            });
        }

        // 入口：聊天设置区里的一行，用宿主的 menu-item 结构，和周围的行长得一样
        disposables.push(ctx.ui.slot("settings.section", (el) => {
            const group = document.createElement("div");
            group.className = "menu-group";
            group.style.opacity = "1";      // 坑位不一定在 .page-menu 下，兜底
            group.style.animation = "none";
            const item = document.createElement("div");
            item.className = "menu-item";
            item.style.cursor = "pointer";
            const labels = document.createElement("div");
            labels.className = "menu-label-group";
            const label = document.createElement("span");
            label.className = "menu-label";
            label.textContent = "会话管理";
            const desc = document.createElement("span");
            desc.className = "menu-desc";
            desc.textContent = "删除不再需要的群聊或单聊";
            labels.appendChild(label);
            labels.appendChild(desc);
            const right = document.createElement("div");
            right.className = "menu-right";
            right.textContent = "›";
            item.appendChild(labels);
            item.appendChild(right);
            item.onclick = () => void openManager();
            group.appendChild(item);
            el.appendChild(group);
            return () => group.remove();
        }));

        return () => { for (const d of disposables) { try { d?.(); } catch { /* ignore */ } } };
    },
};
