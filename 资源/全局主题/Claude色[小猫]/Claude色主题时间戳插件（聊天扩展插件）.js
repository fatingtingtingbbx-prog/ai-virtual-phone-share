// 气泡上方时间戳插件（apiVersion 1）v1.8.1
// 功能：在「每一轮首发消息」（对方 + 自己）的气泡正上方、紧贴气泡显示日期+时间。
//   对方贴左、自己贴右；文字边缘精确对齐气泡边缘。
//   格式固定 YY/MM/DD HH:MM（如 26/06/29 22:30）。
// 时间来源：原生居中时间胶囊（.chat-sys-msg / 线下模式 .chat-offline-time）。
//   原生对「今天」只输出 "01:25"（无年月日），本插件一律反推/兜底成带年月日的 YY/MM/DD HH:MM。
//   居中系统时间本身保持不变；不触碰任何项目源码。纯插件、独立 .js。
// === v1.8.1 改动：语音转文字（.voice-msg-text-bubble）不显示时间戳，遇到直接跳过。===
// === v1.8.0 改动：心声（.chat-thought-card）不显示时间戳，遇到直接跳过。===
// === v1.7.0 改动（边缘对齐）：气泡是「按内容宽度」渲染的（不撑满整列），旧版时间戳用
//   width:100% 撑满整列，当时间戳文字比气泡宽时就会比气泡宽出一截→边缘对不上。
//   新版在插入后用 JS 把时间戳宽度精确卡成气泡的 getBoundingClientRect().width，
//   左右边缘与气泡完全一致；align-self 控制贴左/贴右。===
export default {
    manifest: {
    id: "bubble-timestamp",
    name: "气泡上方时间戳",
    apiVersion: 1,
    version: "1.8.1",
    author: "Claude",
    description: "在对方与自己每一轮首发消息的气泡正上方、紧贴气泡显示 YY/MM/DD HH:MM 时间戳（居中系统时间保持不变）。对方贴左、自己贴右，文字边缘对齐气泡。",
    permissions: ["chat.read"],
    settings: [
      { key: "enabled", label: "开启气泡上方时间", type: "boolean", default: true },
    ],
  },

  setup(ctx) {
    const MARK = "data-plugin-ts";
    let raf = 0;

    // 每一轮首发：chat-msg-wrapper，排除 system / 思维链触发行 / 连续(折叠头像)行
    const SEL = '.chat-msg-wrapper[data-role]:not([data-role="system"]):not([data-reasoning-row]):not([data-consecutive])';

    const pad = (n) => (n < 10 ? "0" + n : "" + n);
    const yyOf = (d) => String(d.getFullYear()).slice(-2);

    // 把原生相对时间文本反推成 YY/MM/DD HH:MM
    function reformat(raw) {
      raw = (raw || "").trim();
      if (!raw) return "";
      const tm = raw.match(/(\d{1,2}):(\d{2})/);
      if (!tm) return raw;                       // 没有冒号时间，无法反推，原样返回
      const time = `${pad(+tm[1])}:${tm[2]}`;     // 原生已是 24h，补零到两位
      const now = new Date();

      // 跨年：2026年6月29日 22:30
      const ymd = raw.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
      if (ymd) return `${ymd[1].slice(-2)}/${pad(+ymd[2])}/${pad(+ymd[3])} ${time}`;

      // 同年：6月29日 22:30
      const md = raw.match(/(\d{1,2})月(\d{1,2})日/);
      if (md) return `${yyOf(now)}/${pad(+md[1])}/${pad(+md[2])} ${time}`;

      // 昨天 22:30
      if (raw.indexOf("昨天") === 0) {
        const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
        return `${yyOf(d)}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${time}`;
      }

      // 周一..周日 09:00（原生只在最近 7 天内用此格式，反推最近一次该星期）
      const W = { "星期日": 0, "星期一": 1, "星期二": 2, "星期三": 3, "星期四": 4, "星期五": 5, "星期六": 6 };
      for (const k in W) {
        if (raw.indexOf(k) === 0) {
          const diff = (now.getDay() - W[k] + 7) % 7; // 0..6 天前
          const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - diff);
          return `${yyOf(d)}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${time}`;
        }
      }

      // 今天（仅 HH:MM）：用当前日期兜底，保证一定有年月日
      return `${yyOf(now)}/${pad(now.getMonth() + 1)}/${pad(now.getDate())} ${time}`;
    }

    // 取本条首发消息的真实时间文本：
    //   优先同容器内时间胶囊；否则向上回溯最近一条（兼容「今天连续对话只有首条有胶囊」的情况）。
    //   只认时间胶囊（.justify-center .chat-sys-msg 与 线下模式 .chat-offline-time），
    //   规避 system / 撤回 等普通 chat-sys-msg。
    function nearestTimeText(wrapper) {
      const container = wrapper.parentElement;
      const grab = (c) => {
        if (!c) return "";
        const el = c.querySelector(".justify-center .chat-sys-msg") || c.querySelector(".chat-offline-time");
        return el ? (el.textContent || "").trim() : "";
      };
      let t = grab(container);
      if (t) return t;
      let sib = container ? container.previousElementSibling : null;
      while (sib) {
        t = grab(sib);
        if (t) return t;
        sib = sib.previousElementSibling;
      }
      return "";
    }

    // 极端兜底：完全定位不到任何时间时，用当前日期时间（今天的消息绝大多数准确）
    function fallbackNow() {
      const now = new Date();
      return `${yyOf(now)}/${pad(now.getMonth() + 1)}/${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
    }

    function injectFor(wrapper) {
      try {
        if (!wrapper || wrapper.getAttribute(MARK)) return;
        // 心声（inner monologue / thought card）不显示时间戳
        if (wrapper.querySelector(".chat-thought-card")) return;
        // 语音转文字（.voice-msg-text-bubble）不显示时间戳
        if (wrapper.querySelector(".voice-msg-text-bubble")) return;
        const role = wrapper.getAttribute("data-role");
        const raw = nearestTimeText(wrapper);
        let text = raw ? reformat(raw) : "";
        if (!text) text = fallbackNow();           // 兜底：保证年月日一定显示
        wrapper.setAttribute(MARK, role || "1");

        const el = document.createElement("div");
        el.className = "plugin-msg-time plugin-msg-time--" + (role === "user" ? "user" : "assistant");
        el.textContent = text;                     // text 必为 YY/MM/DD HH:MM

        // 关键：插到「气泡元素本身」(.chat-bubble-role-*) 的正前方，
        // 这样时间戳紧贴气泡上方（群聊也会落在 sender-name 之下、气泡之上）。
        // 插完用 JS 把时间戳宽度精确卡成气泡宽度 → 左右边缘与气泡完全对齐。
        // 极少见（空气泡等）无 content-wrap / 无气泡时，回退到 content-wrap 列首或 wrapper 之前。
        const contentWrap = wrapper.querySelector(".chat-msg-content-wrap");
        const bubble = contentWrap && contentWrap.querySelector(".chat-bubble-role-user, .chat-bubble-role-assistant");
        if (bubble) {
          contentWrap.insertBefore(el, bubble);
          const syncWidth = () => {
            try {
              const w = bubble.getBoundingClientRect().width;
              if (w > 0) el.style.width = w + "px";   // 时间戳宽度 = 气泡宽度，边缘对齐
            } catch (e) {}
          };
          requestAnimationFrame(syncWidth);
          setTimeout(syncWidth, 300); // 兜底：字体/布局晚到时再校一次
        } else if (contentWrap) {
          contentWrap.insertBefore(el, contentWrap.firstChild);
        } else {
          wrapper.parentNode.insertBefore(el, wrapper);
        }
      } catch (e) { /* 单条失败不影响其他 */ }
    }

    function scan(root) {
      try {
        if (!root) return;
        if (ctx.system && ctx.system.settings && ctx.system.settings.get("enabled") === false) return;
        root.querySelectorAll(SEL).forEach(injectFor);
      } catch (e) { /* 忽略整段异常 */ }
    }

    function scheduleScan() {
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; scan(document); });
    }

    const obs = new MutationObserver(scheduleScan);
    obs.observe(document.body, { childList: true, subtree: true });

    // 多事件名兜底：不同 API 版本事件名可能不同，确保一定触发扫描
    const fire = () => { scan(document); let i = 0; const t = setInterval(() => { scan(document); if (++i >= 10) clearInterval(t); }, 200); };
    try { ctx.hooks.on("session.opened", fire); } catch (e) {}
    try { ctx.hooks.on("chat.session.opened", fire); } catch (e) {}
    try { ctx.hooks.on("message.received", fire); } catch (e) {}
    try { ctx.hooks.on("message.sent", fire); } catch (e) {}
    fire(); // 立即扫一次

    // 窗口尺寸变化（旋转/分屏）后，气泡宽度可能变，重新把时间戳宽度卡成气泡宽度
    try {
      window.addEventListener("resize", () => {
        document.querySelectorAll(".plugin-msg-time").forEach((ts) => {
          const cw = ts.parentElement;
          const b = cw && cw.querySelector(".chat-bubble-role-user, .chat-bubble-role-assistant");
          if (b) { const w = b.getBoundingClientRect().width; if (w > 0) ts.style.width = w + "px"; }
        });
      });
    } catch (e) {}

    ctx.ui.injectCSS(`
      /* 时间戳插在气泡(.chat-bubble-role-*)正前方：紧贴气泡上方。
         宽度由 JS 精确卡成气泡宽度（el.style.width），故左右边缘与气泡完全一致；
         align-self 控制贴左(对方)/贴右(自己)，text-align 让文字贴对应边缘。 */
      .plugin-msg-time {
        font-size: 11px;
        line-height: 1.05;
        color: #9a8f82;
        margin: 0 !important;
        margin-bottom: 2px !important;   /* 与气泡之间留 2px，时间戳落在气泡正上方 2px 处 */
        padding: 0 !important;
        letter-spacing: .02em;
        user-select: none;
        pointer-events: none;
        white-space: nowrap;
        align-self: flex-start;          /* 默认贴左（对方首发），JS 会设具体宽度 */
      }
      .plugin-msg-time--assistant { text-align: left; }
      .plugin-msg-time--user      { text-align: right; align-self: flex-end; }
    `);
  },
};
