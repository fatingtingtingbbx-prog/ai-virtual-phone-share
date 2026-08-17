// HIM 视频背景 · 小手机插件（apiVersion 1）
// 安装：聊天 / 角色软件 → 设置 → 扩展插件 → 选文件（或粘贴本文件）。
// 作用：把一段视频设为小手机「主屏桌面」背景（聊天界面由全局 CSS 负责成 HIM 暖米灰，不透视频）。
//   在「本插件设置」里用下拉框选视频，也可在「自定义视频地址」手填直链。
//   ★ 小手机插件导入上限 512KB，视频不内嵌，只用地址。
//   ★ 聊天头像隐藏由全局 CSS（.chat-msg-avatar{display:none}）负责，本插件只管主屏视频背景。
//
// 关于你给的 4 个 .ts 直链：那是 MPEG-TS，Safari 能播，但 Chrome/Firefox 原生 <video> 通常
//   播不了。所以下拉框默认给的是「同内容」的 HIM mp4（已在小手机 public/videos/ 下，必播），
//   末尾另列 4 个 .ts 链接供 Safari 选用。改下拉框后桌面背景立即换。

// ── 主屏视频选项：仅保留通用 mp4（Chrome/Firefox/Safari 都必播）──
//   4 段 HIM 原生视频：wennuan=钢琴/温暖(主背景) chenjing=沉静 lengao=冷傲 relie=热烈
//   （你之前给的 4 个 .ts 直链因 Chrome/Firefox 原生 <video> 播不了已移除，避免选了不出画面）
const VIDEO_OPTIONS = [
  { label: "① 钢琴·温暖", value: "/videos/him_wennuan.mp4" },
  { label: "② 沉静",      value: "/videos/him_chenjing.mp4" },
  { label: "③ 冷傲",      value: "/videos/him_lengao.mp4" },
  { label: "④ 热烈",      value: "/videos/him_relie.mp4" },
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
// （之前用 URL.createObjectURL：那是一个刷新即失效的临时 blob 地址，且只存在内存变量里，
//   所以「上传的内容下次刷新就没了」。改成 data URL 存入插件持久化设置即可跨刷新保留。）
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
// 即便没超出，S.set 若触发配额异常也会自动降级为本会话生效。
const MAX_PERSIST_BYTES = 2.5 * 1024 * 1024;

export default {
  manifest: {
    id: "him-piano-video-bg",
    name: "HIM 视频背景",
    apiVersion: 1,
    version: "1.9.0",
    author: "WorkBuddy",
    description: "把钢琴视频设为小手机主屏桌面背景；通话音频默认 HIM 铃声，可在设置改直链/上传音频。背景图（语音/聊天/桌面）请到手机「设置 / 外观」上传。",
    permissions: ["chat.read", "ui"],
    settings: [
      {
        key: "videoName",
        label: "主屏视频（通用 mp4，Chrome/Firefox/Safari 都播）",
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
    // 背景图（语音通话背景 / 聊天背景 / 桌面壁纸）一律在手机自带「设置 / 外观」里上传，
    // 由全局 CSS 与手机原生逻辑处理，本插件只管主屏视频背景，不再重复提供上传入口。

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
      /* 隐藏原壁纸、外壳透明，让视频在主屏桌面透出（聊天 App 是实心暖米灰，会盖住视频）。
         背景图（语音通话背景 / 聊天背景 / 桌面壁纸）一律在手机自带「设置 / 外观」上传，
         本插件只管主屏视频背景，不再重复提供。 */
      .phone-shell     { background: transparent !important; background-image: none !important; }
      .phone-wallpaper { opacity: 0 !important; visibility: hidden !important; pointer-events: none !important; }
      `;
      return css;
    };

    // 用 injectCSS 返回的 Disposable 以便压暗变动时整体替换样式
    // 关键：必须确保 video 层在主屏桌面不被 .phone-wallpaper 等背景层盖住；
    //      所以壁纸用 opacity+visibility 双保险隐藏，shell 背景也强制透明。
    let cssDisp = ctx.ui.injectCSS(buildCSS());

    // —— 视频元素（懒建，可热替换 src）——
    let videoEl = null;
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
        wrap.appendChild(videoEl);
      }
      return videoEl;
    };
    const applyVideo = (url) => {
      if (!url) return;
      const v = ensureVideo();
      if (!v) return;
      // 上传文件时去掉上下米色渐变；用 HIM 视频/直链时保留渐变
      const wrap = document.getElementById("him-video-bg");
      if (wrap) wrap.classList.toggle("no-gradient", isUserVideo(url));
      if (v.getAttribute("src") === url) return;   // 同一地址不重设，避免闪烁/重载
      v.setAttribute("src", url);
      v.src = url;
      if (v.play) v.play().catch(() => {});
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
    // 关键修复：接通瞬间 .gcall-topbar-sub 文本由「正在呼叫…」变为「通话中」是 characterData
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
    //   需求：气泡要是对方「生成一条消息」的形式 —— 即插进消息列表末尾、做成对方气泡本体（贴左、对方气泡底色），
    //   像对方真的发了一条消息，而不是浮在键盘左边。
    //   防串屏：用「对话页标题(联系人名)」做会话签名；切到别的联系人时标题变化 → 立即移除气泡，绝不让它串到别的界面。
    //   信号：生成期间输入框区出现 button[aria-label="停止本轮生成"]（仅生成时存在），MutationObserver 监听其出现/消失。
    const TYPING_BUBBLE_ID = "him-inchat-typing";
    const typingCssDisp = ctx.ui.injectCSS(`
      /* 对话内对方「正在输入」三点气泡：作为对方气泡本体插入消息列表末尾（贴左、对方气泡底色），
         像对方真的发了一条消息。不做绝对定位浮层，避免跑到键盘左边。 */
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
        background: #C9C4BF;            /* 默认灰 */
        animation: him-dot-pulse 1.2s infinite ease-in-out;   /* 黑点顺序流动：一个黑两个灰 → 一个灰一个黑一个灰 → 循环 */
      }
      #${TYPING_BUBBLE_ID} .him-dots i:nth-child(1) { animation-delay: 0s; }
      #${TYPING_BUBBLE_ID} .him-dots i:nth-child(2) { animation-delay: .2s; }
      #${TYPING_BUBBLE_ID} .him-dots i:nth-child(3) { animation-delay: .4s; }
      @keyframes him-dot-pulse {
        0%, 100% { background: #C9C4BF; }   /* 灰 */
        50%      { background: #2F2F2F; }   /* 黑 */
      }
    `);
    const getMsgList = () => document.querySelector(".chat-scroll-anchored");
    // 当前会话签名：用对话页标题（联系人名）文本；切联系人时标题变化 → 用来判断三点气泡是否串到别的会话。
    const getConvSig = () => {
      const t = document.querySelector(".chat-room-wrapper .page-title");
      const sig = t ? (t.textContent || "").trim() : "";
      if (sig) return sig;
      const list = getMsgList();
      return list ? "list:" + list.childElementCount : "none";
    };
    let bubbleConvSig = null;   // 三点气泡挂上时所在的会话签名；切换会话即失效
    const removeTypingBubble = () => {
      const el = document.getElementById(TYPING_BUBBLE_ID);
      if (el && el.parentElement) el.parentElement.removeChild(el);
      bubbleConvSig = null;
      // 还原生成期间被我们临时隐藏的流式「对方气泡」（它只是空壳，真切完要让它显示出来）
      const list = getMsgList();
      if (list) list.querySelectorAll('[data-him-typing-hide]').forEach((n) => { n.style.display = ""; delete n.dataset.himTypingHide; });
    };
    const appendTypingBubble = (list) => {
      const b = document.createElement("div");
      b.id = TYPING_BUBBLE_ID;
      b.innerHTML = '<span class="him-dots"><i></i><i></i><i></i></span>';
      list.appendChild(b);                 // 插入消息列表末尾 → 作为对方气泡本体（左对齐）出现在消息流里
      list.scrollTop = list.scrollHeight;
      bubbleConvSig = getConvSig();
    };
    const showTypingBubble = () => {
      const list = getMsgList();
      if (!list || document.getElementById(TYPING_BUBBLE_ID)) return;
      appendTypingBubble(list);
    };
    // 信号：对方生成期间出现 button[aria-label="停止本轮生成"]（仅生成时存在）→ 预生成阶段显示三点；
    // 消息发完停止按钮消失 → 立刻移除三点气泡。生成期间末尾的「对方气泡」往往只是流式空壳，
    // 临时藏掉、只让三点气泡作为唯一占位，避免两者并排出现。
    // 生成是否仍在进行：停止按钮存在且「可见可点」→ 进行中；按钮被移除/禁用/隐藏 → 已结束。
    // （之前只用「按钮是否存在」判断，结果按钮在生成结束后仅被禁用(不移除)时三点气泡就卡住不消失 → 已修。）
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
        if (!list || !genActive()) { removeTypingBubble(); return; }   // 不在对话页 / 生成已结束(停止按钮移除或禁用隐藏) → 清掉（含截断消息后的残留）
        const sig = getConvSig();
        if (bubbleConvSig !== null && sig !== bubbleConvSig) removeTypingBubble();  // 切到别的联系人 → 清旧气泡，不串屏
        if (!document.getElementById(TYPING_BUBBLE_ID)) appendTypingBubble(list);   // React 重渲染擦掉时补回（限当前会话）
        // 藏掉末尾流式「对方气泡」空壳，只留三点气泡作占位（content 灌满后于生成结束再还原显示）
        const tail = list.querySelector(".chat-bubble-role-assistant:last-of-type");
        if (tail && tail.id !== TYPING_BUBBLE_ID) { tail.dataset.himTypingHide = "1"; tail.style.display = "none"; }
      });
    };
    const typingObserver = new MutationObserver(syncTyping);
    typingObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-label"] });
    syncTyping();
    // 兼容微信桥接路径（若走 weixin-bridge 会派发 weixin-generating）
    const onWeixinGenerating = (e) => {
      const detail = (e && e.detail) || {};
      if (detail.generating) showTypingBubble(); else removeTypingBubble();
    };
    window.addEventListener("weixin-generating", onWeixinGenerating);

    // —— 语音通话声波：恢复为你认定的「版本(14)」JS canvas 波形（#him-call-wave 注入 .voicecall-controls）。
    //   三层填充：白 rgb(246,244,242) / 紫 rgb(170,164,196) / 黑 rgb(47,45,46) + 中间 6px 黑基线；
    //   idle 时只剩中间黑线、说话时缎带起伏（说话判定用 .voicecall-avatar[data-speaking]）。
    //   注意：椭圆 SVG 波形已从全局 CSS 删除，此处为唯一波纹来源（你要求只要 JS 这一个）。
    const waveCssDisp = ctx.ui.injectCSS(`
      #him-call-wave {
        position: absolute; left: 0; top: 18%;
        width: 100%; height: 150px; pointer-events: none; z-index: 0;   /* 压到字幕之下，避免盖住对方消息 */
      }
    `);
    let waveCanvas = null, waveCtx = null, waveRAF = 0;
    let waveW = 0, waveH = 0, waveSpeaking = false;   // 缓存尺寸/说话态，避免每帧读 layout / 查 DOM（卡顿根因）
    let waveRO = null, waveMO = null;                 // 持有观察者，通话结束时要断开（否则每次通话累积一批，回调越跑越多 → 卡顿）
    const wave = { o1: 0, o2: 0, o3: 0, a1: 0, a2: 0, a3: 0, amp: 0 };
    const WAVE_L = {
      l1: { wl: 0.75,     awl: 1.0,  mul: 1.0  },
      l2: { wl: 0.5,      awl: 0.75, mul: 0.72 },
      l3: { wl: 0.333333, awl: 0.75, mul: 0.8  },
    };
    // 平滑空间包络：0~1 的连续正弦。波谷处幅度自然降到 0（贴回中线 = 一条线），
    // 波峰处满幅起波纹；全程连续无硬 clamp / 无平台，所以"回归成线 → 再起波纹"是平滑过渡，
    // 不会像视频重来。比原来硬压成 0 的版本（if(f<-1)f=-1 产生生硬断层）自然很多。
    const waveAmpFilter = (inv, off, wl) => {
      const s = Math.sin(off / wl * Math.PI);   // -1..1 连续
      return (s + 1) / 2;                        // 0..1：波谷=0(贴中线)，波峰=1(满幅)
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
      if (!waveCanvas || !waveCtx) { waveRAF = 0; return; }          // 已 teardown：干净停掉，由 ensureWave 重建，绝不留野循环
      if (waveW <= 0) { waveRAF = requestAnimationFrame(drawWave); return; }   // 尺寸还没量到，空转等一帧
      const W = waveW, H = waveH;
      const dpr = window.devicePixelRatio || 1;
      const ctx = waveCtx; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
      const w = W, h = H, h2 = h / 2;
      wave.amp += ((waveSpeaking ? 0.7 : 0) - wave.amp) * 0.08;
      wave.o3 += 0.014; wave.a3 += 0.03; if (wave.o3 > 1) wave.o3 -= 2; if (wave.a3 > 86400) wave.a3 -= 86400;
      wave.o2 += 0.012; wave.a2 += 0.012; if (wave.o2 > 1.5) wave.o2 -= 3; if (wave.a2 > 86400) wave.a2 -= 86400;
      wave.o1 -= 0.026; wave.a1 += 0.022; if (wave.o1 < -1.5) wave.o1 += 3; if (wave.a1 > 86400) wave.a1 -= 86400;
      const A = wave.amp;
      const white = "#F6F4F2", purple = "#AAA4C4", black = "#2F2D2E";
      ctx.fillStyle = white;  waveLayer(ctx, w, h, WAVE_L.l1, wave.o1, wave.a1, A, false); ctx.fill(); waveLayer(ctx, w, h, WAVE_L.l1, wave.o1, wave.a1, A, true); ctx.fill();
      ctx.fillStyle = purple; waveLayer(ctx, w, h, WAVE_L.l2, wave.o2, wave.a2, A, false); ctx.fill(); waveLayer(ctx, w, h, WAVE_L.l2, wave.o2, wave.a2, A, true); ctx.fill();
      ctx.fillStyle = black;  waveLayer(ctx, w, h, WAVE_L.l3, wave.o3, wave.a3, A, false); ctx.fill(); waveLayer(ctx, w, h, WAVE_L.l3, wave.o3, wave.a3, A, true); ctx.fill();
      ctx.fillStyle = black; ctx.fillRect(0, h2 - 1, w, 2);   // 中间基线（idle 时只剩这条，细线）
      waveRAF = requestAnimationFrame(drawWave);
    };
    const waveTeardown = () => {
      if (waveRO) { try { waveRO.disconnect(); } catch (e) {} waveRO = null; }
      if (waveMO) { try { waveMO.disconnect(); } catch (e) {} waveMO = null; }
      if (waveRAF) { cancelAnimationFrame(waveRAF); waveRAF = 0; }
      if (waveCanvas && waveCanvas.parentElement) waveCanvas.parentElement.removeChild(waveCanvas);
      waveCanvas = null; waveCtx = null; waveW = 0; waveH = 0; waveSpeaking = false;
    };
    const ensureWave = () => {
      const root = document.querySelector(".voicecall-controls");
      if (!root) { waveTeardown(); return; }
      // 画布被 React 重渲染挪走/移除后，旧 RAF 会一直画在「脱离文档的画布」上——
      // 表现就是波浪突然定住/掉帧。检测到就整体重建（含断开旧观察者），避免野循环叠加。
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
      waveRAF = requestAnimationFrame(drawWave);   // 此处必然无在跑的 RAF（teardown 已 cancel）
    };
    // —— 通话界面字幕：直接沿用 app 自带逻辑（chat.css:4786 用 margin-top:auto 底对齐 + overflow-auto，
    //   可上滚看最旧的通话信息）。之前我加的 justify-content:center + trimCallSubs(隐藏旧行) 会把字幕顶到上方、
    //   且破坏上滚，已撤掉。这里只保留一句淡入动画，绝不干预布局/滚动。
    const callSubCssDisp = ctx.ui.injectCSS(`
      .voicecall-subtitle-mask .call-subtitle { animation: him-sub-in .35s ease-out; }
      @keyframes him-sub-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
    `);
    // —— 文件上传：视频 / 通话音频 都支持「选手机里的文件」。
    //    读成 data URL 后写入插件设置（S.set），刷新后自动恢复（不再用一刷新就失效的 blob URL）。
    //    （插件框架只支持 url 文本框，这里在设置表单里动态注入 <input type=file>）
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
          // 持久化：把 data URL 写进插件设置，下次刷新自动恢复
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
      // 兜底轮询：即便 mutation 漏掉接通瞬间的文本变更（或返回桌面后通话界面已不在），
      // 只要仍在播放且已「接通/结束」或已无通话界面，就强制停铃，杜绝接通后/桌面上莫名响铃。
      if (audioState.playing && (getCallPhase() === "connected" || !document.querySelector(callSel))) stopAudio();
    }, 1000);

    // 聊天头像隐藏已交由全局 CSS（.chat-msg-avatar{display:none}）处理，本插件只负责主屏视频背景
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
