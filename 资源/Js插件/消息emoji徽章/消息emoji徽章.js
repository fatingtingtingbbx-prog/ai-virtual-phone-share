const FIELDS = [
  { key: "applyTo", label: "作用对象", type: "select", default: "all", options: [
    { value: "user", label: "仅用户发送的消息" },
    { value: "assistant", label: "仅角色回复" },
    { value: "all", label: "用户与角色都处理" },
  ]},
  { key: "size", label: "圆形直径（px）", type: "number", default: 24 },
  { key: "fontSize", label: "emoji 字号（px）", type: "number", default: 16 },
  { key: "overlap", label: "压入气泡的深度（px）", type: "number", default: -15 },
  { key: "zIndex", label: "徽章层级（z-index）", type: "number", default: 1 },
];

// 末尾 emoji 串（含肤色/变体/ZWJ/国旗）
const EMOJI_RUN_RE = /([\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}\u{1F3FB}-\u{1F3FF}\u{1F1E6}-\u{1F1FF}]+)\s*$/u;
// 单个独立 emoji（不含 ZWJ 分支，ZWJ 已在提取前排除）
const ONE_EMOJI_RE = /(?:[\u{1F1E6}-\u{1F1FF}]{2}|[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}])(?:\u{FE0F}|\u{1F3FB}-\u{1F3FF})?/gu;

export default {
  manifest: {
    id: "tail-emoji-badge",
    name: "消息 Emoji 徽章",
    apiVersion: 1,
    version: "1.3.3",
    author: "小坊",
    description: "提取每条消息末尾最后一个独立 emoji 成徽章；点击 emoji 徽章或管理页按钮可实时调整设置",
    permissions: ["ui"],
  },

  setup(ctx) {
    function getSetting(key) {
      const v = ctx.system.settings.get(key);
      if (v === undefined || v === null) {
        const def = FIELDS.find(f => f.key === key);
        return def ? def.default : undefined;
      }
      return v;
    }

    function num(key, fallback) {
      const v = Number(getSetting(key));
      return Number.isFinite(v) ? v : fallback;
    }

    function shouldHandle(role) {
      if (role !== "user" && role !== "assistant") return false;
      const mode = String(getSetting("applyTo") ?? "all");
      if (mode === "all") return true;
      return role === mode;
    }

    // 检测字符串中是否存在非空白、非零宽、非 emoji 的字符（即普通文字）
    function hasNonEmojiText(str) {
      return /[^\s\u200B\u200C\u200D\uFEFF\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}\u{1F3FB}-\u{1F3FF}\u{1F1E6}-\u{1F1FF}]/u.test(str);
    }

    // 提取末尾 emoji：仅当末尾是单个独立 emoji，且前面有文字内容时才提取
    function extractTailEmoji(content) {
      // 清理末尾常见的零宽字符，避免阻断匹配
      const cleaned = (content || "").replace(/[\u200B\u200C\u200D\uFEFF]+$/gu, "");
      const runMatch = cleaned.match(EMOJI_RUN_RE);
      if (!runMatch) return null;
      const run = runMatch[1];
      if (run.includes("\u200D")) return null; // 含 ZWJ 的复杂 emoji 不提取
      const parts = run.match(ONE_EMOJI_RE);
      if (!parts || parts.length !== 1) return null; // 连续两个或更多 emoji 不提取
      const emoji = parts[0];
      const rest = cleaned.slice(0, cleaned.length - runMatch[0].length).replace(/\s+$/, "");
      if (!rest || !hasNonEmojiText(rest)) return null; // 前面必须有非 emoji 的文字
      return emoji;
    }

    // 在气泡 DOM 里隐藏末尾那一个 emoji；返回恢复函数
    function hideEmojiInBubble(bubbleEl, emoji) {
      const hidden = [];
      const restore = () => {
        hidden.forEach(span => {
          const parent = span.parentNode;
          if (!parent) return;
          while (span.firstChild) parent.insertBefore(span.firstChild, span);
          parent.removeChild(span);
        });
        hidden.length = 0;
      };
      if (!bubbleEl || typeof document.createTreeWalker !== "function") return restore;

      const walker = document.createTreeWalker(bubbleEl, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          const parent = node.parentElement;
          if (parent && (parent.tagName === "STYLE" || parent.tagName === "SCRIPT")) {
            return NodeFilter.FILTER_REJECT;
          }
          return node.nodeValue && node.nodeValue.length ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
        },
      });

      const textNodes = [];
      let n;
      while ((n = walker.nextNode())) textNodes.push(n);
      if (textNodes.length === 0) return restore;

      let target = null;
      let targetIdx = -1;
      for (const node of textNodes) {
        const val = node.nodeValue;
        const idx = val.lastIndexOf(emoji);
        if (idx === -1) continue;
        if (/\S/.test(val.slice(idx + emoji.length))) continue; // emoji 后面只能有空白
        target = node;
        targetIdx = idx;
      }
      if (!target) return restore;

      const tail = target.splitText(targetIdx);
      tail.splitText(emoji.length);
      const span = document.createElement("span");
      span.style.display = "none";
      tail.parentNode.insertBefore(span, tail);
      span.appendChild(tail);
      hidden.push(span);
      return restore;
    }

    // 设置弹窗：徽章点击 / 管理页按钮共用
    let settingsModal = null;
    function openSettings() {
      if (settingsModal) { try { settingsModal.close(); } catch {} settingsModal = null; }
      settingsModal = ctx.ui.openModal((root, api) => {
        root.textContent = "";
        root.style.width = "min(340px, 100%)";
        root.style.padding = "18px 20px";
        root.style.fontFamily = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
        root.style.fontSize = "15px";

        const title = document.createElement("div");
        title.textContent = "尾缀 Emoji 徽章设置";
        title.style.cssText = "font-weight:600;font-size:17px;margin-bottom:16px;";
        root.appendChild(title);

        for (const field of FIELDS) {
          const row = document.createElement("label");
          row.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px;font-size:15px;";
          const label = document.createElement("span");
          label.textContent = field.label;
          row.appendChild(label);

          if (field.type === "select") {
            const sel = document.createElement("select");
            sel.style.cssText = "font-size:15px;padding:6px 9px;border-radius:8px;border:1px solid rgba(0,0,0,.15);";
            for (const opt of field.options) {
              const o = document.createElement("option");
              o.value = opt.value;
              o.textContent = opt.label;
              sel.appendChild(o);
            }
            sel.value = String(getSetting(field.key) ?? field.default);
            sel.addEventListener("change", () => ctx.system.settings.set(field.key, sel.value));
            row.appendChild(sel);
          } else if (field.type === "number") {
            const input = document.createElement("input");
            input.type = "number";
            input.style.cssText = "font-size:15px;padding:6px 9px;border-radius:8px;border:1px solid rgba(0,0,0,.15);width:92px;";
            input.value = String(getSetting(field.key) ?? field.default);
            input.addEventListener("change", () => {
              const n = Number(input.value);
              ctx.system.settings.set(field.key, Number.isFinite(n) ? n : field.default);
            });
            row.appendChild(input);
          }
          root.appendChild(row);
        }

        const done = document.createElement("button");
        done.textContent = "完成";
        done.style.cssText = "margin-top:8px;width:100%;padding:10px;border-radius:10px;border:none;background:#1677ff;color:#fff;font-size:16px;font-weight:500;cursor:pointer;";
        done.addEventListener("click", () => api.close());
        root.appendChild(done);

        return () => { settingsModal = null; };
      });
    }

    // 管理页启动位置：settings.section 放一个整行「修改设置」按钮
    ctx.ui.slot("settings.section", (el) => {
      el.textContent = "";

      const btn = document.createElement("button");
      btn.style.cssText = "width:100%;display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-radius:10px;border:1px solid color-mix(in srgb, var(--c-card-border,#ddd) 60%, transparent);background:transparent;color:var(--c-text,#111);font-size:16px;cursor:pointer;";

      const label = document.createElement("span");
      label.textContent = "修改设置";
      label.style.cssText = "font-weight:700;";
      btn.appendChild(label);

      const svgNS = "http://www.w3.org/2000/svg";
      const svg = document.createElementNS(svgNS, "svg");
      svg.setAttribute("width", "18");
      svg.setAttribute("height", "18");
      svg.setAttribute("viewBox", "0 0 24 24");
      svg.setAttribute("fill", "none");
      svg.setAttribute("stroke", "currentColor");
      svg.setAttribute("stroke-width", "2");
      svg.setAttribute("stroke-linecap", "round");
      svg.setAttribute("stroke-linejoin", "round");
      svg.setAttribute("aria-hidden", "true");
      svg.style.flex = "0 0 auto";

      const path = document.createElementNS(svgNS, "path");
      path.setAttribute("d", "M9 18l6-6-6-6");
      svg.appendChild(path);

      btn.appendChild(svg);
      btn.addEventListener("click", () => openSettings());
      el.appendChild(btn);

      return () => { el.textContent = ""; };
    });

    ctx.ui.slot("message.footer", (el, props) => {
      const msg = props && props.message;
      if (!msg || !msg.id) return;

      let restoreHidden = () => {};

      function render() {
        restoreHidden();
        restoreHidden = () => {};
        el.textContent = "";
        el.style.cssText = "";

        if (!shouldHandle(msg.role)) return;

        // 兼容字符串和数组内容（多行消息常见为数组）
        let content = "";
        if (typeof msg.content === "string") {
          content = msg.content;
        } else if (Array.isArray(msg.content)) {
          content = msg.content.join("\n");
        }

        const emoji = extractTailEmoji(content);
        if (!emoji) return;

        const size = num("size", 22);
        const fontSize = num("fontSize", 16);
        const overlap = num("overlap", -15);
        const z = num("zIndex", 1);
        const isUser = msg.role === "user";

        el.style.cssText = "position:relative;z-index:" + z + ";height:0;overflow:visible;";

        const badge = document.createElement("span");
        badge.textContent = emoji;
        badge.title = "点击调整徽章设置";
        badge.style.cssText =
          "position:absolute;display:inline-flex;align-items:center;justify-content:center;" +
          "width:" + size + "px;height:" + size + "px;" +
          "background:#fff;border-radius:50%;" +
          "font-size:" + fontSize + "px;line-height:1;" +
          // 根据角色设置阴影方向：用户徽章在左，阴影左下；角色徽章在右，阴影右下
          (isUser ? "box-shadow:-2px 2px 4px rgba(0,0,0,.22);" : "box-shadow:2px 2px 4px rgba(0,0,0,.22);") +
          "bottom:" + overlap + "px;" +
          (isUser ? "left:-16px;" : "right:-16px;") +
          "z-index:" + z + ";cursor:pointer;";
        badge.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          openSettings();
        });
        el.appendChild(badge);

        // 正确找到气泡：footer 槽位容器的前一个兄弟才是气泡
        const slotContainer = el.closest('[data-chat-plugin-slot="message.footer"]');
        const bubbleEl = slotContainer ? slotContainer.previousElementSibling : null;
        restoreHidden = hideEmojiInBubble(bubbleEl, emoji);
      }

      render();
      const offSettings = ctx.system.settings.onChange(() => render());
      return () => { offSettings(); restoreHidden(); };
    });
  },
};
