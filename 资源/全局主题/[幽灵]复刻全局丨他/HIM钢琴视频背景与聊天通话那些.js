// HIM 视频背景 · 小手机插件（apiVersion 1）· 优化版 v1.9.1
// 安装：聊天 / 角色软件 → 设置 → 扩展插件 → 选文件（或粘贴本文件）。
// 作用：把一段视频设为小手机「主屏桌面」背景（聊天界面由全局 CSS 负责成 HIM 暖米灰，不透视频）。
//   在「本插件设置」里用下拉框选视频，也可在「自定义视频地址」手填直链。
//   ★ 小手机插件导入上限 512KB，视频不内嵌，只用地址。
//   ★ 聊天头像隐藏由全局 CSS（.chat-msg-avatar{display:none}）负责，本插件只管主屏视频背景。
//
// ── 关于视频源（重要）──
//   ①②③④ 是 4 个外链直链（网易 / PP373 / FQ / wxkb CDN），联网即可直接播，不需要本地放文件。
//   首次播放需联网且跨域可直链；背景视频渲染无需 CORS（仅作为 <video> 背景播放）。
//   第②/④个链接末尾带 #（如 ...#.mp4）：浏览器会把 # 之后当锚点剥离，实际请求的是去扩展名地址，
//   这几个 CDN 仍会按路径返回 video/mp4，所以照原样放即可正常播。
//   加载失败时，主屏底部会出现红色提醒文字（含失败地址与错误码），不再静默空白。

// ── 主屏视频选项 ──
//   4 个外链直链（zhuyitai / oilgasgpts / netease-ysf / yn12377），联网即播，无需本地放文件。
//   按 HIM 四性格排列：①温暖(钢琴阳光房) ②热烈(实验室) ③沉静(书房看书+猫) ④冷傲(西装办公室+雕像)。
const VIDEO_OPTIONS = [
  { label: "① 温暖·钢琴阳光", value: "https://file.zhuyitai.com/feedback/202608/c1f6af0c8adfd88db08216ed741aeec1.mp4" },
  { label: "② 热烈·实验室",   value: "https://cn.oilgasgpts.com/resource/profile/2026/08/19/RM1eBAP4_20260819203213A458.mp4" },
  { label: "③ 沉静·书房猫",   value: "https://nos.netease.com/ysf/f8f20d99a451179a66c2ccfc7881afbd.mp4" },
  { label: "④ 冷傲·办公室",   value: "https://www.yn12377.cn/jubao/upload/smjb/2026/08/19/a5cc571639e146e1b60c5234e536adf2.mp4" },
];

function clamp(n, lo, hi) {
  n = Number(n);
  if (isNaN(n)) n = lo;
  return Math.max(lo, Math.min(hi, n));
}
// 把图片地址安全塞进 CSS url("...")：转义反斜杠与双引号（object URL / http 直链都安全）
function cssUrl(u) {
  return String(u).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
// 把 File 读成 data URL（base64 字符串），以便写入插件设置、刷新后自动恢复。
function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error || new Error("read failed"));
    r.readAsDataURL(file);
  });
}
// 判断当前播放的视频是不是「用户上传的文件」（data: 开头），用于决定是否去掉上下米色渐变
const isUserVideo = (u) => typeof u === "string" && u.startsWith("data:");
// 上传文件写盘上限：超出则只在本会话生效、不持久化（避免撑爆插件存储 localStorage）。
const MAX_PERSIST_BYTES = 2.5 * 1024 * 1024;

// 把相对地址归一化为绝对地址（用于「同地址不重设」的可靠比较，修复原来 相对 vs 绝对 永不等 的 bug）
const normUrl = (u) => {
  try { return new URL(u, location.href).href; } catch (_) { return u; }
};

export default {
  manifest: {
    id: "him-piano-video-bg",
    name: "HIM 视频背景",
    apiVersion: 1,
    version: "1.9.2",
    author: "WorkBuddy",
    description: "把外链视频设为小手机主屏桌面背景；通话音频默认 HIM 铃声，可在设置改直链/上传音频。背景图（语音/聊天/桌面）请到手机「设置 / 外观」上传。默认 4 个外链直链（温暖/沉静/冷傲/热烈），联网即可直播。",
    permissions: ["chat.read", "ui"],
    settings: [
      {
        key: "videoName",
        label: "主屏视频（4 个外链直链，联网即可播）",
        type: "select",
        default: VIDEO_OPTIONS[0].value,
        options: VIDEO_OPTIONS,
      },
      { key: "videoUrl",  label: "自定义视频地址（留空则用上面下拉框；可填任意 mp4/webm 直链，优先级高于下拉框）", type: "text",   default: "" },
      { key: "callAudioUrl",  label: "通话音频地址（来电/拨打都用它；默认已填 HIM 提取的铃声；可改或清空，也可在下方上传手机里的音频）", type: "text",   default: "https://s3plus.meituan.net/opapisdk/op_ticket_1_885190757_1786835418992_slQ1Ailq.ogg" },
    ],
  },

  setup(ctx) {
    const S = ctx.system.settings;
    // 文件上传得到的临时地址（选手机里的视频 / 音频）。优先级最高。
    const fileVideoUrl = { v: null };
    const fileCallUrl  = { v: null };

    // —— 自动判断「对方语音 API 是否已连接 / 是否真在出声」（不给用户加开关，自己探测）——
    // 关键点：宿主没连语音 API 时，也会给 .voicecall-avatar 挂 data-speaking（纯视觉占位、实际没声音），
    // 所以不能只靠 data-speaking 决定波浪。这里真实探测音频输出：
    //   · Web Audio 主路径（宿主 TTS 默认走这条）：hook AudioContext.createBufferSource 的 start()
    //   · HTMLMediaElement 回退路径：监听 playing/pause/ended（排除我们注入的背景视频 #him-video-bg）
    // 只有「data-speaking 在场 且 真有音频在播」才让波浪起伏；否则一律平直。
    let audioPlaying = false;
    try {
      const isBg = (el) => !!(el && el.closest && el.closest("#him-video-bg"));
      const markOn  = () => { audioPlaying = true; };
      const markOff = () => { audioPlaying = false; };
      // HTMLMediaElement 路径（背景视频除外）
      const _play = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function () {
        if (!isBg(this)) markOn();
        return _play.apply(this, arguments);
      };
      document.addEventListener("playing", (e) => { if (e.target && !isBg(e.target)) markOn(); }, true);
      document.addEventListener("pause",   (e) => { if (e.target && !isBg(e.target)) markOff(); }, true);
      document.addEventListener("ended",   (e) => { if (e.target && !isBg(e.target)) markOff(); }, true);
      // Web Audio 主路径
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC && AC.prototype && AC.prototype.createBufferSource) {
        const _cbs = AC.prototype.createBufferSource;
        AC.prototype.createBufferSource = function () {
          const node = _cbs.call(this);
          const _start = node.start ? node.start.bind(node) : null;
          if (_start) node.start = function () { markOn(); return _start.apply(node, arguments); };
          try { node.addEventListener("ended", markOff); } catch (_) {}
          return node;
        };
      }
    } catch (_) {}

    // 解析当前应播放的视频地址：上传文件 > 自定义地址 > 下拉框
    const resolveUrl = () => {
      if (fileVideoUrl.v) return fileVideoUrl.v;
      const custom = String(S.get("videoUrl") || "").trim();
      if (custom) return custom;
      const sel = String(S.get("videoName") || "").trim();
      if (sel) return sel;
      return VIDEO_OPTIONS[0].value;
    };

    // —— 样式：仅主屏桌面透视频（不碰聊天 App，聊天由全局 CSS 负责成实心暖米灰）——
    const buildCSS = () => {
      let css = `
      /* HIM 视频背景层（挂在 .phone-shell 最底层，只露在主屏桌面） */
      #him-video-bg {
        position: absolute; inset: 0; z-index: 0; overflow: hidden;
        background: #EFECEA;            /* HIM 暖米灰兜底（无视频时） */
        pointer-events: none;
      }
      #him-video-bg video {
        display: block;
        width: 100%; height: 100%; object-fit: cover;
        opacity: 1;                 /* 「视频压暗」选项已移除，固定全亮（上下缘仍由暖米灰渐变柔化） */
        filter: saturate(108%);
      }
      /* 上下暖色调渐变 + 整体 35% 米色滤镜：用 HIM App 的暖米灰 #EFECEA。
         默认（下拉框/HIM 视频）带渐变 + 全屏 35% 米色；用户自己上传视频时彻底去掉米色覆盖层。 */
      #him-video-bg::after {
        content: "";
        position: absolute; inset: 0; z-index: 1; pointer-events: none;
        background-color: rgba(239,236,234,0.35);
        background-image: linear-gradient(
          to bottom,
          rgba(239,236,234,0.72) 0%,
          rgba(239,236,234,0.42) 12%,
          rgba(239,236,234,0) 28%,
          rgba(239,236,234,0) 72%,
          rgba(239,236,234,0.42) 88%,
          rgba(239,236,234,0.72) 100%
        );
      }
      #him-video-bg.no-gradient::after { background: transparent !important; }
      /* 加载失败提醒（提醒色，非纯黑） */
      #him-video-bg .him-video-err {
        position: absolute; left: 8px; right: 8px; bottom: 8px; z-index: 2;
        font-size: 11px; line-height: 1.45; color: #B5552E;
        background: rgba(255,255,255,0.74); border-radius: 8px; padding: 6px 8px;
        pointer-events: none; text-align: left;
      }
      /* 隐藏原壁纸、外壳透明，让视频在主屏桌面透出（聊天 App 是实心暖米灰，会盖住视频）。 */
      .phone-shell        { background: transparent !important; background-image: none !important; }
      .phone-shell::before{ background: transparent !important; }   /* 透明覆盖层，确保不挡视频 */
      .phone-wallpaper    { opacity: 0 !important; visibility: hidden !important; pointer-events: none !important; }
      `;
      return css;
    };

    let cssDisp = ctx.ui.injectCSS(buildCSS());

    // —— 视频元素（懒建，可热替换 src）——
    let videoEl = null;
    let appliedNorm = null;   // 已应用的（归一化）地址：用于「同地址不重设」，避免反复 reload

    // 屏上提醒 + 控制台报错（让"没显示"变成可诊断的信息，而不是静默空白）
    const showVideoError = (url, msg) => {
      const wrap = document.getElementById("him-video-bg");
      if (!wrap) return;
      let el = wrap.querySelector(".him-video-err");
      if (!el) { el = document.createElement("div"); el.className = "him-video-err"; wrap.appendChild(el); }
      el.textContent = "视频加载失败：" + (msg || "未知错误") + "  ·  " + url;
      console.error("[HIM视频背景] 视频加载失败：", url, msg || "");
    };
    const clearVideoError = () => {
      const wrap = document.getElementById("him-video-bg");
      if (wrap) { const el = wrap.querySelector(".him-video-err"); if (el) el.remove(); }
    };

    const ensureVideo = () => {
      const shell = document.querySelector(".phone-shell");
      if (!shell) return null;
      let wrap = document.getElementById("him-video-bg");
      if (!wrap) {
        wrap = document.createElement("div");
        wrap.id = "him-video-bg";
        shell.insertBefore(wrap, shell.firstChild);
      }
      if (!videoEl) {
        videoEl = document.createElement("video");
        videoEl.muted = true; videoEl.loop = true; videoEl.autoplay = true; videoEl.playsInline = true;
        videoEl.setAttribute("muted", "");
        videoEl.setAttribute("playsinline", "");
        videoEl.preload = "auto";
        // 出错 → 屏上提醒 + 控制台
        videoEl.addEventListener("error", () => {
          const err = videoEl.error;
          const code = err ? ("code " + err.code) : "";
          showVideoError(videoEl.currentSrc || videoEl.src || "(空)",
                         code + (err && err.message ? " " + err.message : ""));
        });
        // 能播了先清错误，并补一次 play（静音视频通常被允许自动播放）
        videoEl.addEventListener("loadeddata", () => { clearVideoError(); videoEl.play().catch(() => {}); });
        videoEl.addEventListener("canplay",    () => { videoEl.play().catch(() => {}); });
        wrap.appendChild(videoEl);
      }
      return videoEl;
    };

    const applyVideo = (url) => {
      if (!url) return;
      const v = ensureVideo();
      if (!v) return;
      const norm = normUrl(url);
      const wrap = document.getElementById("him-video-bg");
      // 关键：无论 src 是否变化，都先按「是否用户上传视频」刷新 no-gradient 类。
      // 否则外壳重建（ensureAttached 会新建一个无该 class 的 wrap）且地址未变触发提前
      // return 时，米色滤镜 / 渐变会重新盖在用户上传的视频上。
      if (wrap) wrap.classList.toggle("no-gradient", isUserVideo(url));
      // 关键修复：用「归一化绝对地址」比较，避免 相对路径 ≠ 绝对属性 导致每次都重设 src、
      // 视频被 1 秒轮询 + DOM 观察反复重置、永远加载不出来。
      if (norm === appliedNorm) return;
      appliedNorm = norm;
      clearVideoError();
      // 单次赋值即可（浏览器自动把相对地址解析成绝对）；随后 load() + play()
      v.src = url;
      try { v.load(); } catch (_) {}
      v.play().catch(() => {});
    };

    // 初次载入
    applyVideo(resolveUrl());

    // —— 通话音频：来电 / 拨打 统一用同一个 callAudioUrl（默认 HIM 提取的 Meituan 铃声）。
    //   接通后（"通话中/已静音"等）自动停止。
    const MEITUAN = "https://s3plus.meituan.net/opapisdk/op_ticket_1_885190757_1786835418992_slQ1Ailq.ogg";
    const getCallAudio = () => fileCallUrl.v || String(S.get("callAudioUrl") || MEITUAN).trim() || MEITUAN;
    const audioState = { el: null, playing: false, want: false };
    const getCallPhase = () => {
      const sub = document.querySelector(".gcall-topbar-sub");
      const txt = sub ? (sub.textContent || "") : "";
      if (txt.includes("正在呼叫")) return "dialing";   // 你拨打对方
      if (txt.includes("来电")) return "incoming";       // 对方打来
      return "connected";                                 // 已接通/结束
    };
    const ensureAudio = () => {
      if (!audioState.el) { audioState.el = new Audio(); audioState.el.loop = true; audioState.el.preload = "auto"; }
      return audioState.el;
    };
    const startAudio = (url) => {
      if (!url) return;
      const el = ensureAudio();
      if (el.src !== url) { el.src = url; }
      el.volume = 1;
      el.play().then(() => { audioState.playing = true; }).catch(() => {});
    };
    const stopAudio = () => {
      if (audioState.el && audioState.playing) {
        try { audioState.el.pause(); audioState.el.currentTime = 0; } catch (_) {}
        audioState.playing = false;
      }
      audioState.want = false;
    };
    const callSel = ".call-bg-default";
    const onCallChange = () => {
      if (!document.querySelector(callSel)) { stopAudio(); return; }
      const phase = getCallPhase();
      if (phase === "connected") { stopAudio(); return; }   // 接通后停
      audioState.want = true;
      startAudio(getCallAudio());                            // 来电 / 拨打 同一铃声
    };
    const ringObserver = new MutationObserver(onCallChange);
    // 接通瞬间 .gcall-topbar-sub 文本由「正在呼叫…」变为「通话中」是 characterData
    // （文本节点 nodeValue）变更，childList 观察不到，导致 onCallChange 不触发、铃声在接通后
    // 仍在循环播放。加 characterData:true 才能捕获该文本变更。
    ringObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
    // 来电没有用户手势，常被浏览器自动播放策略拦截；在首次点击/触摸时补播（如点"接听"）
    const unlockAudio = () => {
      // 仅在仍处「振铃/拨号」阶段才补播；接通后不再因任意点击重触发铃声
      if (audioState.want && !audioState.playing && getCallPhase() !== "connected") startAudio(getCallAudio());
    };
    document.addEventListener("pointerdown", unlockAudio);
    onCallChange();

    // —— 对话内「对方正在输入」三点气泡（纯 JS 插件注入，不碰 app 源码）——
    const TYPING_BUBBLE_ID = "him-inchat-typing";
    const typingCssDisp = ctx.ui.injectCSS(`
      #${TYPING_BUBBLE_ID} {
        align-self: flex-start;        /* 贴左 = 对方气泡 */
        max-width: 75%; margin: 3px 0;
        padding: 8px 14px; min-height: 38px; box-sizing: border-box;
        border-radius: 14px 14px 14px 3px;
        background: #F4F2EF; color: #2F2F2F;
        display: inline-flex; align-items: center;
        animation: him-typing-in .18s ease-out; pointer-events: none;
        box-shadow: 0 2px 6px rgba(0,0,0,.02);
      }
      @keyframes him-typing-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
      #${TYPING_BUBBLE_ID} .him-dots { display: inline-flex; gap: 5px; align-items: center; }
      #${TYPING_BUBBLE_ID} .him-dots i {
        width: 7px; height: 7px; border-radius: 50%;
        background: #C9C4BF;
        animation: him-dot-pulse 1.2s infinite ease-in-out;
      }
      #${TYPING_BUBBLE_ID} .him-dots i:nth-child(1) { animation-delay: 0s; }
      #${TYPING_BUBBLE_ID} .him-dots i:nth-child(2) { animation-delay: .2s; }
      #${TYPING_BUBBLE_ID} .him-dots i:nth-child(3) { animation-delay: .4s; }
      @keyframes him-dot-pulse {
        0%, 100% { background: #C9C4BF; }
        50%      { background: #2F2F2F; }
      }
    `);
    const getMsgList = () => document.querySelector(".chat-scroll-anchored");
    const getConvSig = () => {
      const t = document.querySelector(".chat-room-wrapper .page-title");
      const sig = t ? (t.textContent || "").trim() : "";
      if (sig) return sig;
      const list = getMsgList();
      return list ? "list:" + list.childElementCount : "none";
    };
    let bubbleConvSig = null;
    const removeTypingBubble = () => {
      const el = document.getElementById(TYPING_BUBBLE_ID);
      if (el && el.parentElement) el.parentElement.removeChild(el);
      bubbleConvSig = null;
      const list = getMsgList();
      if (list) list.querySelectorAll('[data-him-typing-hide]').forEach((n) => { n.style.display = ""; delete n.dataset.himTypingHide; });
    };
    const appendTypingBubble = (list) => {
      const b = document.createElement("div");
      b.id = TYPING_BUBBLE_ID;
      b.innerHTML = '<span class="him-dots"><i></i><i></i><i></i></span>';
      list.appendChild(b);
      list.scrollTop = list.scrollHeight;
      bubbleConvSig = getConvSig();
    };
    const showTypingBubble = () => {
      const list = getMsgList();
      if (!list || document.getElementById(TYPING_BUBBLE_ID)) return;
      appendTypingBubble(list);
    };
    const genActive = () => {
      const btn = document.querySelector('button[aria-label="停止本轮生成"]');
      if (!btn) return false;            // 按钮被移除 = 生成结束
      if (btn.disabled) return false;    // 按钮被禁用 = 生成结束
      const cs = window.getComputedStyle(btn);
      if (cs.display === "none" || cs.visibility === "hidden" || parseFloat(cs.opacity) < 0.1) return false;  // 隐藏 = 结束
      return true;
    };
    let genRAF = false;
    const syncTyping = () => {
      if (genRAF) return;
      genRAF = true;
      requestAnimationFrame(() => {
        genRAF = false;
        const list = getMsgList();
        if (!list || !genActive()) { removeTypingBubble(); return; }
        const sig = getConvSig();
        if (bubbleConvSig !== null && sig !== bubbleConvSig) removeTypingBubble();
        if (!document.getElementById(TYPING_BUBBLE_ID)) appendTypingBubble(list);
        const tail = list.querySelector(".chat-bubble-role-assistant:last-of-type");
        if (tail && tail.id !== TYPING_BUBBLE_ID) { tail.dataset.himTypingHide = "1"; tail.style.display = "none"; }
      });
    };
    const typingObserver = new MutationObserver(syncTyping);
    typingObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-label"] });
    syncTyping();
    const onWeixinGenerating = (e) => {
      const detail = (e && e.detail) || {};
      if (detail.generating) showTypingBubble(); else removeTypingBubble();
    };
    window.addEventListener("weixin-generating", onWeixinGenerating);

    // —— 语音通话声波：JS canvas 波形（#him-call-wave 注入 .voicecall-controls）——
    const waveCssDisp = ctx.ui.injectCSS(`
      #him-call-wave {
        position: absolute; left: 0; top: 18%;
        width: 100%; height: 150px; pointer-events: none; z-index: 0;
      }
    `);
    let waveCanvas = null, waveCtx = null, waveRAF = 0;
    let waveW = 0, waveH = 0, waveSpeaking = false;
    let waveRO = null, waveMO = null;
    // 波浪幅度策略（v1.9.2）：
    //  - 只有「data-speaking 在场 且 audioPlaying(真有音频在播)」时才起伏；
    //  - 没连语音 API：宿主仍会挂 data-speaking（视觉占位），但测不到音频 → audioPlaying 恒 false → 平直、不转动；
    //  - 连了 API：波浪直接跟着对方真实语音输出（出声=在说，播完=说完），说完即平；
    //  - 不再自己造「波澜→平」假节奏（那是之前一直转的根源），幅度稳定、只做平滑的升起 / 落下。
    const WAVE_PROFILE = 0.82;  // 说话时的目标幅度
    let waveLastT = 0;          // 上一帧时间戳，用于帧率无关的平滑
    let waveActiveUntil = 0;    // 去抖：宿主 data-speaking 瞬断一两帧时把「说话中」延续到此时刻
    const wave = { o1: 0, o2: 0, o3: 0, a1: 0, a2: 0, a3: 0, amp: 0 };
    const WAVE_L = {
      l1: { wl: 0.75,     awl: 1.0,  mul: 1.0  },
      l2: { wl: 0.5,      awl: 0.75, mul: 0.72 },
      l3: { wl: 0.333333, awl: 0.75, mul: 0.8  },
    };
    const waveAmpFilter = (inv, off, wl) => {
      const s = Math.sin(off / wl * Math.PI);
      return (s + 1) / 2;
    };
    const waveLayer = (ctx, w, h, cfg, off, aoff, amp, flip) => {
      const h2 = h / 2;
      ctx.beginPath(); ctx.moveTo(0, h2);
      for (let fi = -1.5; fi <= 1.5001; fi += cfg.wl) {
        const base = fi + off * cfg.wl;
        const bx = w * base, cx = w * (base + cfg.wl / 2), dx = w * (base + cfg.wl);
        const half = w * cfg.wl / 2;
        let am = amp * cfg.mul; am = am * waveAmpFilter(am, aoff + fi, cfg.awl);
        let ay = h2 - am * h2; if (flip) ay = h2 + am * h2;
        ctx.bezierCurveTo(bx + half / 5 * 2, h2, cx - half / 5 * 2, ay, cx, ay);
        ctx.bezierCurveTo(cx + half / 5 * 2, ay, dx - half / 5 * 2, h2, dx, h2);
      }
      ctx.lineTo(w, h2); ctx.lineTo(0, h2); ctx.closePath();
    };
    const waveSize = () => {
      if (!waveCanvas) return;
      const r = waveCanvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      waveW = r.width; waveH = r.height;
      const bw = Math.max(1, Math.round(waveW * dpr)), bh = Math.max(1, Math.round(waveH * dpr));
      if (waveCanvas.width !== bw || waveCanvas.height !== bh) { waveCanvas.width = bw; waveCanvas.height = bh; }
    };
    const waveSyncSpeaking = () => { waveSpeaking = !!document.querySelector('.voicecall-avatar[data-speaking]'); };
    const drawWave = () => {
      if (!waveCanvas || !waveCtx) { waveRAF = 0; return; }
      if (waveW <= 0) { waveRAF = requestAnimationFrame(drawWave); return; }
      const W = waveW, H = waveH;
      const dpr = window.devicePixelRatio || 1;
      const ctx = waveCtx; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
      const w = W, h = H, h2 = h / 2;
      // —— 说话节奏包络：波澜段 → 平段 → 波澜段 循环，段首/段尾都用 Hann 窗平滑收口，
      //     所以「一段结束 → 下一段开始」衔接处幅度都连续为 0，绝不会出现单帧突跳/卡顿 ——
      const now = (typeof performance !== "undefined" ? performance.now() : Date.now());
      const dt = waveLastT ? Math.min(32, now - waveLastT) : 16.7; waveLastT = now;
      // 是否「真在说话」：必须 ① 宿主 data-speaking 在场 且 ② 真有音频在播(audioPlaying)。
      // 没连语音 API 时 data-speaking 只是视觉占位、测不到音频 → audioPlaying 恒 false → 平直。
      const reallySpeaking = waveSpeaking && audioPlaying;
      // 去抖：音频/话术间隙会偶发瞬断一两帧，直接切断会让波浪「啪」地收一下；
      // 只有持续静默超过 220ms 才真正转入平，瞬断被吸收，波浪连续不卡。
      let active;
      if (reallySpeaking) { waveActiveUntil = now + 220; active = true; }
      else { active = now < waveActiveUntil; }
      let targetAmp;
      if (!active) {
        targetAmp = 0;                                   // 未连 API / 静默：彻底平
      } else {
        // 稳定幅度：说话时常驻、不随语音平起平落；对方说完(音频停)即平滑落回 0。
        // 不再自己造假节奏、不再无限转。
        targetAmp = WAVE_PROFILE;
      }
      // 帧率无关的平滑：dt 大（掉帧）时 k 自动变大，仍按真实时间逼近目标，不会单帧跳变
      const k = 1 - Math.exp(-dt / 90);
      wave.amp += (targetAmp - wave.amp) * k;
      // 相位也按真实时间推进（ds = dt/标准帧），掉帧时波形按真实时间补上，不再因帧率抖动而卡顿
      const ds = dt / 16.667;
      wave.o3 += 0.014 * ds; wave.a3 += 0.03 * ds; if (wave.o3 > 1) wave.o3 -= 2; if (wave.a3 > 86400) wave.a3 -= 86400;
      wave.o2 += 0.012 * ds; wave.a2 += 0.012 * ds; if (wave.o2 > 1.5) wave.o2 -= 3; if (wave.a2 > 86400) wave.a2 -= 86400;
      wave.o1 -= 0.026 * ds; wave.a1 += 0.022 * ds; if (wave.o1 < -1.5) wave.o1 += 3; if (wave.a1 > 86400) wave.a1 -= 86400;
      const A = wave.amp;
      const white = "#F6F4F2", purple = "#AAA4C4", black = "#2F2D2E";
      ctx.fillStyle = white;  waveLayer(ctx, w, h, WAVE_L.l1, wave.o1, wave.a1, A, false); ctx.fill(); waveLayer(ctx, w, h, WAVE_L.l1, wave.o1, wave.a1, A, true); ctx.fill();
      ctx.fillStyle = purple; waveLayer(ctx, w, h, WAVE_L.l2, wave.o2, wave.a2, A, false); ctx.fill(); waveLayer(ctx, w, h, WAVE_L.l2, wave.o2, wave.a2, A, true); ctx.fill();
      ctx.fillStyle = black;  waveLayer(ctx, w, h, WAVE_L.l3, wave.o3, wave.a3, A, false); ctx.fill(); waveLayer(ctx, w, h, WAVE_L.l3, wave.o3, wave.a3, A, true); ctx.fill();
      ctx.fillStyle = black; ctx.fillRect(0, h2 - 1, w, 2);
      waveRAF = requestAnimationFrame(drawWave);
    };
    const waveTeardown = () => {
      if (waveRO) { try { waveRO.disconnect(); } catch (e) {} waveRO = null; }
      if (waveMO) { try { waveMO.disconnect(); } catch (e) {} waveMO = null; }
      if (waveRAF) { cancelAnimationFrame(waveRAF); waveRAF = 0; }
      if (waveCanvas && waveCanvas.parentElement) waveCanvas.parentElement.removeChild(waveCanvas);
      waveCanvas = null; waveCtx = null; waveW = 0; waveH = 0; waveSpeaking = false; waveLastT = 0;
    };
    const ensureWave = () => {
      const root = document.querySelector(".voicecall-controls");
      if (!root) { waveTeardown(); return; }
      if (waveCanvas && (!waveCanvas.isConnected || waveCanvas.parentElement !== root)) waveTeardown();
      if (waveCanvas) return;
      waveCanvas = document.createElement("canvas"); waveCanvas.id = "him-call-wave";
      root.insertBefore(waveCanvas, root.firstChild);
      waveCtx = waveCanvas.getContext("2d");
      waveSize(); waveSyncSpeaking();
      if (typeof ResizeObserver !== "undefined") { waveRO = new ResizeObserver(() => waveSize()); waveRO.observe(waveCanvas); }
      else { window.addEventListener("resize", waveSize); }
      waveMO = new MutationObserver(() => waveSyncSpeaking());
      waveMO.observe(root, { attributes: true, subtree: true, attributeFilter: ["data-speaking"] });
      waveRAF = requestAnimationFrame(drawWave);
    };
    const callSubCssDisp = ctx.ui.injectCSS(`
      .voicecall-subtitle-mask .call-subtitle { animation: him-sub-in .35s ease-out; }
      @keyframes him-sub-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
    `);

    // —— 文件上传：视频 / 通话音频 都支持「选手机里的文件」。读成 data URL 后写入插件设置（刷新保留）——
    const attachUpload = (marker, accept, key, onPick) => {
      const labels = document.querySelectorAll("span.menu-label");
      for (const lab of labels) {
        if (!lab.textContent || !lab.textContent.includes(marker)) continue;
        const row = lab.parentElement;
        if (!row || row.querySelector("input[type=file]")) continue;
        const fi = document.createElement("input");
        fi.type = "file"; fi.accept = accept;
        fi.style.marginTop = "6px";
        const hint = document.createElement("div");
        hint.style.cssText = "font-size:11px;color:var(--him-ink-soft,#8C8682);margin-top:4px";
        const kind = accept.startsWith("video") ? "视频" : accept.startsWith("audio") ? "音频" : "图片";
        hint.textContent = "↑ 也可选手机里的" + kind + "文件（刷新后保留）";
        fi.addEventListener("change", async () => {
          const f = fi.files && fi.files[0];
          if (!f) return;
          let dataUrl;
          try { dataUrl = await fileToDataUrl(f); }
          catch (_) { hint.textContent = "读取文件失败，换一个试试"; return; }
          onPick(dataUrl, f);
          if (f.size <= MAX_PERSIST_BYTES) {
            try {
              S.set(key, dataUrl);
              hint.textContent = "已选：" + f.name + "（已保存，刷新不丢）";
            } catch (_) {
              hint.textContent = "已选：" + f.name + "（写入失败，仅本次会话生效）";
            }
          } else {
            hint.textContent = "已选：" + f.name + "（文件过大，无法持久化，仅本次会话生效）";
          }
        });
        row.appendChild(fi);
        row.appendChild(hint);
      }
    };
    const injectUploads = () => {
      attachUpload("自定义视频地址", "video/*", "videoUrl", (url) => { fileVideoUrl.v = url; applyVideo(resolveUrl()); });
      attachUpload("通话音频地址", "audio/*", "callAudioUrl", (url) => { fileCallUrl.v = url; onCallChange(); });
    };

    // 设置变化（下拉框改视频 / 自定义地址 / 通话音频）→ 实时重应用
    const offChange = S.onChange((settings) => {
      if (cssDisp && cssDisp.dispose) { try { cssDisp.dispose(); } catch (_) {} }
      cssDisp = ctx.ui.injectCSS(buildCSS());
      applyVideo(resolveUrl());
      onCallChange();
    });

    // —— 防止刷新 / 切换界面后背景消失：监听外壳重建，立即把视频层重新挂回 .phone-shell ——
    let rafPending = false;
    const ensureAttached = () => {
      const shell = document.querySelector(".phone-shell");
      if (!shell) return;
      const wrap = document.getElementById("him-video-bg");
      if (!wrap || wrap.parentElement !== shell) {
        if (wrap && wrap.parentElement) wrap.parentElement.removeChild(wrap);
        const newWrap = document.createElement("div");
        newWrap.id = "him-video-bg";
        shell.insertBefore(newWrap, shell.firstChild);
        if (videoEl) newWrap.appendChild(videoEl);   // 复用同一段 <video>，避免重载/闪烁
      }
      applyVideo(resolveUrl());
      // 复用旧 videoEl 时若被 DOM 抖动暂停，补一次播放
      if (videoEl && appliedNorm) { try { videoEl.play().catch(() => {}); } catch (_) {} }
    };
    const onDomChange = () => {
      if (rafPending) return;
      rafPending = true;
      requestAnimationFrame(() => { rafPending = false; ensureAttached(); ensureWave(); });
    };
    const domObserver = new MutationObserver(onDomChange);
    domObserver.observe(document.body, { childList: true, subtree: true });
    ensureAttached();

    // 兜底轮询（外壳偶发未触发 mutation 时）；并把「选手机文件」上传框注入到设置表单。
    const t = ctx.system.timers.setInterval(() => {
      ensureAttached();
      ensureWave();
      injectUploads();
      if (audioState.playing && (getCallPhase() === "connected" || !document.querySelector(callSel))) stopAudio();
    }, 1000);

    return () => {
      ctx.system.timers.clearInterval(t);
      if (offChange && offChange.dispose) { try { offChange.dispose(); } catch (_) {} }
      if (cssDisp && cssDisp.dispose) { try { cssDisp.dispose(); } catch (_) {} }
      if (typingCssDisp && typingCssDisp.dispose) { try { typingCssDisp.dispose(); } catch (_) {} }
      if (ringObserver && ringObserver.disconnect) { try { ringObserver.disconnect(); } catch (_) {} }
      if (domObserver && domObserver.disconnect) { try { domObserver.disconnect(); } catch (_) {} }
      if (typingObserver && typingObserver.disconnect) { try { typingObserver.disconnect(); } catch (_) {} }
      window.removeEventListener("weixin-generating", onWeixinGenerating);
      removeTypingBubble();
      document.removeEventListener("pointerdown", unlockAudio);
      if (waveRAF) { try { cancelAnimationFrame(waveRAF); } catch (_) {} }
      if (waveCanvas && waveCanvas.parentElement) { try { waveCanvas.parentElement.removeChild(waveCanvas); } catch (_) {} }
      if (waveCssDisp && waveCssDisp.dispose) { try { waveCssDisp.dispose(); } catch (_) {} }
      if (callSubCssDisp && callSubCssDisp.dispose) { try { callSubCssDisp.dispose(); } catch (_) {} }
      stopAudio();
    };
  },
};
