export default {
  manifest: {
    id: "chat-round-stats",
    name: "轮数统计",
    apiVersion: 1,
    version: "1.7.0",
    author: "小坊",
    description: "统计角色私聊与群聊轮数，置顶当前页面并按轮数排行",
    permissions: ["chat.read"],
  },
  setup(ctx) {
    // 加号面板坑位不传 sessionId，靠 session.opened 事件实时记录当前会话
    let currentSessionId = null;
    ctx.hooks.on("session.opened", (p) => { currentSessionId = p.sessionId; });

    ctx.ui.slot("chat.inputToolbar", (el) => {
      // 关键修正：el 是宿主塞进 slot 容器的子 div，要往上找到 .chat-input-bar 再找菜单
      const bar = el.closest(".chat-input-bar");
      const menu = bar ? bar.querySelector(".chat-plus-menu") : null;

      // 生成按钮（复用宿主的图标盒子类，样式与内置应用一致）
      const item = document.createElement("div");
      item.setAttribute("data-chat-round-stats", "1");
      item.style.cssText = "display:flex;flex-direction:column;align-items:center;gap:6px;cursor:pointer;";
      item.innerHTML = `
        <div class="chat-plus-icon-box">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--c-text)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="20" x2="18" y2="10"></line>
            <line x1="12" y1="20" x2="12" y2="4"></line>
            <line x1="6" y1="20" x2="6" y2="14"></line>
          </svg>
        </div>
        <span style="font-size:calc(11px*var(--app-text-scale,1));color:var(--c-text);white-space:nowrap;">轮数统计</span>`;
      item.addEventListener("click", () => openStats(ctx, currentSessionId));

      // 把按钮插到「语音条」图标的正后方
      const insertAfterVoice = () => {
        const voice = [...menu.querySelectorAll(".chat-plus-menu-item")].find((n) =>
          (n.querySelector("span")?.textContent || "").trim() === "语音条"
        );
        menu.insertBefore(item, voice ? voice.nextSibling : null);
      };

      if (menu) {
        insertAfterVoice();

        // 兜底：宿主 React 偶尔重绘菜单会移除外部插入的节点，这里延迟放回原位置
        let timer = null;
        let observer = null;
        if (typeof MutationObserver !== "undefined") {
          observer = new MutationObserver(() => {
            if (!item.isConnected) {
              clearTimeout(timer);
              timer = setTimeout(() => insertAfterVoice(), 0);
            }
          });
          observer.observe(menu, { childList: true });
        }
        return () => {
          if (observer) observer.disconnect();
          clearTimeout(timer);
          item.remove();
        };
      }

      // 兜底：万一找不到菜单，就渲染在 slot 里，保证入口还在
      el.appendChild(item);
      return () => item.remove();
    });
  },
};

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

// ── 统计：个体角色 + 群聊，全部进排行榜 ──
function buildStats(ctx) {
  const characters = ctx.data.characters.list() || [];
  const sessions = ctx.data.sessions.list() || [];

  const charMap = {};
  for (const c of characters) charMap[c.id] = c.name;

  const chars = {};   // charId -> { chat, manjuan, group, total }
  const groups = {};  // sessionId -> { name, total }

  for (const s of sessions) {
    const msgs = ctx.data.messages.list(s.id) || [];
    if (s.isGroup) {
      // 群聊：一轮 = 一次全员回复，按内部回复轮次去重
      const rounds = new Map();
      for (const m of msgs) {
        if (m.role !== "assistant") continue;
        if (m.origin === "custom_app" || m.origin === "custom_app_background") continue;
        const key = m.responseRoundId || m.responseBatchId || m.id;
        if (!rounds.has(key)) rounds.set(key, new Set());
        const cid = m.senderCharacterId;
        if (cid && charMap[cid]) rounds.get(key).add(cid);
      }
      groups[s.id] = { name: s.groupName || "群聊", total: rounds.size };
      for (const set of rounds.values()) {
        for (const cid of set) {
          if (!chars[cid]) chars[cid] = { chat: 0, manjuan: 0, group: 0, total: 0 };
          chars[cid].group += 1;
        }
      }
    } else {
      const cid = s.contactId;
      if (!cid || !charMap[cid]) continue;
      for (const m of msgs) {
        if (m.role !== "assistant") continue;
        if (m.origin === "custom_app" || m.origin === "custom_app_background") continue;
        if (!chars[cid]) chars[cid] = { chat: 0, manjuan: 0, group: 0, total: 0 };
        if (m.origin === "reading_discuss") chars[cid].manjuan += 1;
        else chars[cid].chat += 1;
      }
    }
  }

  for (const cid of Object.keys(chars)) {
    chars[cid].total = chars[cid].chat + chars[cid].manjuan + chars[cid].group;
  }
  return { charMap, chars, groups };
}

function openStats(ctx, currentSessionId) {
  ctx.ui.openModal((root, api) => {
    root.style.cssText = "background:var(--c-card);border-radius:20px;width:88vw;max-width:420px;max-height:82vh;display:flex;flex-direction:column;overflow:hidden;";
    root.innerHTML = `
      <div style="padding:16px;border-bottom:1px solid var(--c-card-border);text-align:center;font-weight:600;font-size:16px;color:var(--c-text-title);position:relative;flex-shrink:0;">
        聊天轮数统计
        <span data-close style="position:absolute;right:14px;top:14px;cursor:pointer;color:var(--c-icon);padding:2px 6px;">✕</span>
      </div>
      <div data-body style="padding:14px;overflow-y:auto;flex:1;min-height:0;text-align:center;color:var(--c-icon);">统计中…</div>`;
    root.querySelector("[data-close]").onclick = api.close;
    setTimeout(() => {
      root.querySelector("[data-body]").innerHTML = renderStats(ctx, currentSessionId);
    }, 30);
  });
}

function renderStats(ctx, currentSessionId) {
  const { charMap, chars, groups } = buildStats(ctx);

  const currentSession = currentSessionId ? ctx.data.sessions.get(currentSessionId) : null;
  const isCurrentGroup = !!(currentSession && currentSession.isGroup);
  const currentCharId = currentSession && !isCurrentGroup ? currentSession.contactId : null;
  const currentGroupId = isCurrentGroup ? currentSessionId : null;

  const items = [];
  for (const cid of Object.keys(chars)) {
    items.push({ kind: "char", id: cid, label: charMap[cid], total: chars[cid].total });
  }
  for (const gid of Object.keys(groups)) {
    items.push({ kind: "group", id: gid, label: groups[gid].name, total: groups[gid].total });
  }
  items.sort((a, b) => b.total - a.total || a.label.localeCompare(b.label, "zh"));

  if (items.length === 0) {
    return `<div style="padding:36px 0;font-size:13px;">没有找到有效角色的聊天记录</div>`;
  }

  const accent = "var(--c-icon-active,#246bfd)";
  let html = "";

  // ── 置顶：当前页面 ──
  if (isCurrentGroup && groups[currentGroupId]) {
    const g = groups[currentGroupId];
    html += `
      <div style="margin-bottom:14px;padding:14px;border-radius:16px;background:color-mix(in srgb, ${accent} 12%, var(--c-card));border:1px solid color-mix(in srgb, ${accent} 30%, var(--c-card-border));text-align:left;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
          <span style="font-size:11px;font-weight:600;color:#fff;background:${accent};padding:2px 8px;border-radius:999px;">当前群聊</span>
          <span style="font-weight:700;font-size:16px;color:var(--c-text-title);">${esc(g.name)}</span>
        </div>
        <span style="font-size:13px;font-weight:600;color:var(--c-text-title);">共 ${g.total} 轮</span>
      </div>`;
  } else if (currentCharId && chars[currentCharId]) {
    const st = chars[currentCharId];
    const parts = [];
    if (st.chat) parts.push(`聊天 · ${st.chat}`);
    if (st.manjuan) parts.push(`漫卷 · ${st.manjuan}`);
    if (st.group) parts.push(`群聊 · ${st.group}`);
    html += `
      <div style="margin-bottom:14px;padding:14px;border-radius:16px;background:color-mix(in srgb, ${accent} 12%, var(--c-card));border:1px solid color-mix(in srgb, ${accent} 30%, var(--c-card-border));text-align:left;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
          <span style="font-size:11px;font-weight:600;color:#fff;background:${accent};padding:2px 8px;border-radius:999px;">当前</span>
          <span style="font-weight:700;font-size:16px;color:var(--c-text-title);">${esc(charMap[currentCharId])}</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <span style="font-size:13px;font-weight:600;color:var(--c-text-title);">共 ${st.total} 轮</span>
          ${parts.map((p) => `<span style="font-size:12px;color:var(--c-text);background:var(--c-input);padding:3px 9px;border-radius:8px;">${esc(p)}</span>`).join("")}
        </div>
      </div>`;
  } else if (currentCharId) {
    html += `
      <div style="margin-bottom:14px;padding:14px;border-radius:16px;background:var(--c-input);text-align:left;font-size:13px;color:var(--c-icon);">
        当前角色暂未产生聊天记录
      </div>`;
  }

  // ── 排行榜 ──
  html += `<div style="text-align:left;font-size:12px;font-weight:600;color:var(--c-icon);margin:4px 0 2px;">轮数排行</div>`;
  const medal = ["#F5B301", "#9AA5B1", "#C98A4B"];

  items.forEach((it, idx) => {
    const rank = idx + 1;
    const showRank = rank <= 3;
    const isCur = (it.kind === "char" && it.id === currentCharId) || (it.kind === "group" && it.id === currentGroupId);

    const rankBox = showRank
      ? `<span style="flex-shrink:0;display:flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:50%;background:${medal[rank - 1]};color:#fff;font-size:12px;font-weight:700;">${rank}</span>`
      : `<span style="flex-shrink:0;display:flex;align-items:center;justify-content:center;width:24px;height:24px;"><span style="width:5px;height:5px;border-radius:50%;background:var(--c-icon);opacity:.3;"></span></span>`;

    // 名字区：名字 + 可选的「当前」小标签，都在 flex:1 里，不影响轮数对齐
    const nameCell = isCur
      ? `<span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;color:var(--c-text-title);">${esc(it.label)}</span><span style="flex-shrink:0;font-size:10px;font-weight:600;color:${accent};background:color-mix(in srgb, ${accent} 12%, transparent);padding:1px 6px;border-radius:999px;">当前</span>`
      : `<span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;color:var(--c-text-title);">${esc(it.label)}</span>`;

    html += `
      <div style="display:flex;align-items:center;gap:10px;padding:11px 6px;border-bottom:1px solid var(--c-card-border);${isCur ? `background:color-mix(in srgb, ${accent} 7%, transparent);border-radius:8px;` : ""}">
        ${rankBox}
        <div style="flex:1;min-width:0;display:flex;align-items:center;gap:6px;">${nameCell}</div>
        <span style="flex-shrink:0;min-width:52px;text-align:right;font-size:13px;font-weight:600;color:var(--c-text);white-space:nowrap;">${it.total} 轮</span>
      </div>`;
  });

  return html;
}
