// 底栏宠物 · 小手机聊天插件（apiVersion 1）
// 聊天输入栏上方一只左右走动、到边翻转的小宠物。
// 用户输入时切换为静止图并停住，输入结束继续走。点击会跳两下。
// 图片走外链（不内嵌）：WALK/IDLE 为默认图，BURST 为连续点击触发图，STARTUP_A/B 为走动中偶发随机状态图。
// 这 5 张图都可在插件「自定义宠物图片」面板里上传替换（走动/静止/点击爆发/随机起动A/随机起动B）。
// 若某张外链在 app 里加载不出来，多半是该图床在 webview 内做了防盗链，换成 postimg 等可外链图床即可。
//
// 重要：小猫只会出现在「聊天消息界面」——即页面上存在可见的 .chat-input-bar（聊天输入栏）时。
// 其余界面（聊天列表、通讯录、设置、搜索等）一律不显示。小猫锚定到该输入栏正上方。
// 之所以不用 chat.inputToolbar 坑位，是因为该坑位仅在"+"面板展开时才渲染，平时不挂载。
export default {
  manifest: {
    id: "bottom-bar-pet",
    name: "底栏宠物",
    apiVersion: 1,
    version: "1.4.0",
    author: "用户",
    description: "聊天输入栏上方一只左右走动、到边翻转、输入时静止的小宠物。点击会跳两下。",
    settings: [
      { key: "speed", label: "移动速度（数字，越小越慢）", type: "number", default: 15 },
      { key: "verticalOffset", label: "离底栏的距离(px，越大越靠下)", type: "number", default: 0 },
      { key: "imageSize", label: "图片大小(px，越小越小，默认34)", type: "number", default: 34 },
    ],
  },
  setup(ctx) {
    const WALK_SRC = "https://zkaicc.huilan.com/aicc/api/aicc-file/miniofile/preViewPicture/aicc/71G55kRR_1786448391994.png";
    const IDLE_SRC = "https://cac.opple.com/yc-media/getFile?id=e01f949c613e4add8621fdaba4ba3e5f#.png";
    // 连续点击 4~5 下时，图片暂时变成这张
    const BURST_SRC = "https://www.lnjubao.cn/minio-jbpt/upload/20260811/edac7c48967dab963cd16afcfe731abb.png";
    // 随机状态图之一（用户指定）
    const STARTUP_A = "https://cdncs.ykt.cbern.com.cn/v0.1/download?path=/zxx_feedback/qdqqd/1786448054276.png";
    const STARTUP_B = "https://cac.opple.com/yc-media/getFile?id=593531468e8f4650801b54d795a32985#.png";

    const num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
    const getSetting = (k, d) => { const v = ctx.system.settings.get(k); return (v === undefined || v === null || v === "") ? d : v; };
    const getCustom = (key) => { const v = ctx.system.storage.get(key); return v || ""; };
    const resolveImg = (builtin, key) => getCustom(key) || builtin;

    // 图片高度（可随「图片大小」设置实时变化），默认 34（比原来的 26 大一点）
    let H = num(getSetting("imageSize", 34), 34);

    // 临时图片覆盖（连续点击爆发 / 随机起动），到期自动恢复成走路/静止图
    let tempSrc = null, tempUntil = 0;
    const setTempImage = (src, ms) => { tempSrc = src; tempUntil = performance.now() + ms; };

    // 键盘是否真正升起：移动端软键盘会挤占可视视口高度（visualViewport.height 变小），
    // 用它判断比单纯"输入框是否聚焦"更准——收起键盘但光标仍在时，视口已恢复，应让小猫继续走。
    let keyboardUp = false;
    const vv = window.visualViewport;
    const checkKeyboard = () => { if (vv) keyboardUp = vv.height < window.innerHeight * 0.8; };
    if (vv) { vv.addEventListener("resize", checkKeyboard); vv.addEventListener("scroll", checkKeyboard); checkKeyboard(); }

    // 输入框选择器：不少聊天界面用 contenteditable 富文本输入框（不是 textarea/input）
    const INPUT_SEL = "textarea, input, [contenteditable]:not([contenteditable='false'])";

    // 元素是否真的可见（没被隐藏、且在视口内）——用来排除"被压在下面/已滚走"的旧会话输入栏。
    const isVisible = (el) => {
      if (!el || !el.getBoundingClientRect) return false;
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden" || cs.opacity === "0") return false;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return false;
      // 完全在视口外（整块被推走/滚走）视为不可见
      if (r.bottom <= 0 || r.top >= window.innerHeight || r.right <= 0 || r.left >= window.innerWidth) return false;
      return true;
    };

    // 锚点元素：只在「聊天消息界面」内找 .chat-input-bar（聊天输入栏）。
    // 在「可见」的输入栏里，挑「水平中心最靠近屏幕中心」的那个——小手机切会话是推入式导航，
    // 旧会话的聊天室 DOM 还留在页面里、其输入栏也还在，但被推到了屏幕一侧（水平偏离中心）；
    // 当前正在聊的会话是居中显示的，所以「中心最靠屏幕中心」= 你正在看的那个人，旧栏自然被排除。
    // 找不到可见的聊天输入栏（如聊天列表/通讯录/设置等非聊天界面）→ 返回 null，小猫隐藏。
    const getAnchor = () => {
      const vw = window.innerWidth;
      const bars = document.querySelectorAll(".chat-input-bar");
      let best = null, bestScore = Infinity;
      bars.forEach((el) => {
        if (!isVisible(el)) return;
        const r = el.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const score = Math.abs(cx - vw / 2);   // 越居中 = 越像当前会话
        if (score < bestScore) { bestScore = score; best = el; }
      });
      return best;
    };

    // 当前页面是否还有可见的 .chat-input-bar（判断仍在聊天界面内，还是已离开到别的界面）
    const anyVisibleChatBar = () => {
      const bars = document.querySelectorAll(".chat-input-bar");
      for (const el of bars) if (isVisible(el)) return true;
      return false;
    };

    // 输入中判定：
    //  - 桌面端（无 visualViewport 收缩）：输入框聚焦即视为输入中 → 静止图。
    //  - 移动端：必须键盘真正升起（且输入框聚焦）才算输入中；仅光标在、键盘已收起则恢复走动。
    const isTyping = () => {
      const bar = getAnchor();
      if (!bar) return false;
      const ta = (bar.matches && bar.matches(INPUT_SEL)) ? bar : bar.querySelector(INPUT_SEL);
      const focused = !!(ta && document.activeElement === ta);
      if (!vv) return focused;
      return focused && keyboardUp;
    };

    // ---- 小猫 DOM：优先挂进小手机 .phone-shell（手机屏）里，用手机屏本地坐标定位 ——
    // 小猫始终在手机内、贴在输入栏上方、并被手机壳 overflow:hidden 裁切住，绝不会溢出到手机壳外。
    // 找不到 .phone-shell（纯全屏/移动端）时退回 document.body 用视口坐标。 ----
    const wrap = document.createElement("div");
    wrap.style.cssText = "position:fixed; inset:0; pointer-events:none; z-index:2147482000; display:none;";
    const img = document.createElement("img");
    img.alt = "底栏宠物";
    img.src = resolveImg(WALK_SRC, "walkImage");
    img.style.cssText = "position:absolute; bottom:0; left:0; height:" + H + "px; width:auto; pointer-events:auto; cursor:pointer; user-select:none; -webkit-user-drag:none;";
    let bouncing = false;
    let clickCount = 0, lastClickAt = 0;
    img.addEventListener("click", () => {
      const now = performance.now();
      if (now - lastClickAt > 1500) clickCount = 0;   // 隔超过 1.5s 没点 → 重新计数（保证"连续"）
      lastClickAt = now;
      clickCount++;
      bounce();
      if (clickCount >= 4) {                            // 连续点 4~5 下
        clickCount = 0;
        setTempImage(getCustom("burstImage") || BURST_SRC, 2500);  // 优先用用户上传的爆发图，2.5s 后恢复
      }
    });
    wrap.appendChild(img);

    // 把小猫挂到合适的容器：优先 .phone-shell（手机屏），否则回退 document.body。
    // 切会话/切界面时容器可能变化，每帧 ensureParent 重新挂回，避免被重渲染丢掉。
    const getShell = () => document.querySelector(".phone-shell");
    const ensureParent = () => {
      const shell = getShell();
      const target = shell || document.body;
      if (wrap.parentNode !== target) target.appendChild(wrap);
      wrap.style.position = shell ? "absolute" : "fixed";
    };
    ensureParent();

    // 起动时随机图改为「小猫首次出现时」触发（见 frame 内 startupDone 逻辑），
    // 否则插件加载后 3.5s 已过、用户还没打开聊天，随机图永远看不见。

    let x = 12, dir = 1, rafId = 0, bounceRAF = 0, nextRandomAt = 0;
    let lastBarRect = null, lastBarAt = 0;   // 上次成功定位到的输入栏视口矩形 + 时间戳，切会话瞬间兜底用

    function bounce() {
      bouncing = true;
      cancelAnimationFrame(bounceRAF);
      const start = performance.now(), dur = 520, peak = -(H * 0.5);
      const step = (t) => {
        const p = Math.min(1, (t - start) / dur);
        const y = Math.sin(p * Math.PI * 2) * peak * (1 - p);
        img.style.transform = "scaleX(" + (dir === -1 ? -1 : 1) + ") translateY(" + y.toFixed(1) + "px)";
        if (p < 1) bounceRAF = requestAnimationFrame(step);
        else { img.style.transform = "scaleX(" + (dir === -1 ? -1 : 1) + ")"; bouncing = false; }
      };
      bounceRAF = requestAnimationFrame(step);
    }

    function frame() {
      const t = performance.now();
      const bar = getAnchor();
      if (bar) {
        lastBarRect = bar.getBoundingClientRect();
        lastBarAt = t;
      } else if (lastBarRect && t - lastBarAt < 600 && anyVisibleChatBar()) {
        // 仅在「仍是聊天界面、只是切会话动画途中旧栏滑走新栏未居中」时，短暂沿用上次位置防闪一下。
        // 一旦页面里已无可见聊天输入栏（离开聊天界面，如切到通讯录/设置/聊天列表），立即隐藏，绝不在其他界面出现。
      } else {
        lastBarRect = null;
        wrap.style.display = "none"; rafId = requestAnimationFrame(frame); return;
      }

      wrap.style.display = "block";
      ensureParent();

      // 每帧读取「图片大小」设置，改完即时生效
      H = num(getSetting("imageSize", 34), 34);
      img.style.height = H + "px";
      const vOff = num(getSetting("verticalOffset", 0), 0);

      // 定位参考系：优先手机屏 .phone-shell（小猫在其内部、用本地坐标，保证始终在手机内、
      // 被手机壳裁切，绝不会溢出到手机壳外）；否则退回整页视口。
      const shell = getShell();
      const ref = shell || document.documentElement;
      const refRect = ref.getBoundingClientRect();
      const refH = ref.clientHeight || refRect.height;
      // 手机屏若被 transform:scale 缩放，把视口坐标换算回本地坐标（宽高比统一）
      const scale = (ref.offsetWidth && refRect.width) ? refRect.width / ref.offsetWidth : 1;

      const br = lastBarRect;
      const relTop = (br.top - refRect.top) / scale;
      const relLeft = (br.left - refRect.left) / scale;
      const relRight = (br.right - refRect.left) / scale;

      // 小猫底边对齐输入栏顶边（贴在输入栏正上方，本地坐标，绝不会跑出手机壳）
      img.style.bottom = (refH - relTop + vOff) + "px";

      // 水平范围限制在输入栏宽度内（用真实渲染宽度做夹紧）
      const imgW = (img.getBoundingClientRect().width || H) / scale;
      const minX = relLeft + 6;
      const maxX = relRight - imgW - 6;

      const typing = isTyping();
      const now = performance.now();

      // 走动中偶发随机状态：每 6~10s 检查一次，约一半概率当场换张随机图（A/B）显示 3.5s 后恢复
      if (!typing && !bouncing && !(tempSrc && now < tempUntil) && now >= nextRandomAt) {
        if (Math.random() < 0.5) {
          const pickA = getCustom("startupAImage") || STARTUP_A;
          const pickB = getCustom("startupBImage") || STARTUP_B;
          setTempImage(Math.random() < 0.5 ? pickA : pickB, 3500);
        }
        nextRandomAt = now + 6000 + Math.random() * 4000;   // 下次检查 6~10s 后
      }

      if (typing) {
        // 一打开键盘（聚焦）立刻清掉临时图（爆发/随机），强制切换成静止图
        tempSrc = null;
        const want = resolveImg(IDLE_SRC, "idleImage");
        if (img.getAttribute("src") !== want) img.src = want;
      } else if (tempSrc && now < tempUntil) {
        // 临时图片（连续点击爆发 / 随机起动）优先显示
        if (img.getAttribute("src") !== tempSrc) img.src = tempSrc;
      } else {
        tempSrc = null;
        const want = resolveImg(WALK_SRC, "walkImage");
        if (img.getAttribute("src") !== want) img.src = want;
      }

      if (typing || bouncing) {
        // 静止 / 跳跃中：保持当前位置，只做边界夹紧
        if (x < minX) x = minX;
        if (x > maxX) x = maxX;
      } else {
        const speed = num(getSetting("speed", 15), 15);
        x += dir * (speed / 60) * 2;
        if (x <= minX) { x = minX; dir = 1; }
        if (x >= maxX) { x = maxX; dir = -1; }
      }

      img.style.left = x + "px";
      if (!bouncing) img.style.transform = "scaleX(" + (dir === -1 ? -1 : 1) + ")";
      rafId = requestAnimationFrame(frame);
    }
    rafId = requestAnimationFrame(frame);

    // 自定义图片：折叠面板，默认收起，点击展开才出现
    const unregSettings = ctx.ui.slot("settings.section", (el) => {
      const root = document.createElement("div");
      root.style.cssText = "border:1px solid #e7e0f2; border-radius:10px; padding:6px; margin-top:8px;";
      const toggle = document.createElement("button");
      toggle.textContent = "自定义宠物图片 ▶";
      toggle.style.cssText = "width:100%; text-align:left; background:#f4eefb; border:none; border-radius:8px; padding:9px 10px; font-size:13px; cursor:pointer; color:#5a3e6e;";
      const panel = document.createElement("div");
      panel.style.cssText = "display:none; margin-top:8px;";

      function makeRow(label, key) {
        const row = document.createElement("div");
        row.style.cssText = "margin-bottom:8px;";
        const lab = document.createElement("div"); lab.textContent = label; lab.style.cssText = "font-size:12px; opacity:.7; margin-bottom:4px;";
        const file = document.createElement("input"); file.type = "file"; file.accept = "image/*";
        const url = document.createElement("input"); url.type = "text"; url.placeholder = "或粘贴图片URL"; url.value = getCustom(key);
        url.style.cssText = "width:100%; box-sizing:border-box; margin-top:4px; padding:6px; border:1px solid #ddd; border-radius:6px; font-size:12px;";
        const status = document.createElement("div"); status.style.cssText = "font-size:11px; color:#2e8b57; margin-top:3px; min-height:14px;";
        file.onchange = () => { const f = file.files[0]; if (!f) return; const r = new FileReader(); r.onload = () => { ctx.system.storage.set(key, r.result); status.textContent = "已保存，下条消息即时生效"; }; r.readAsDataURL(f); };
        url.onchange = () => { ctx.system.storage.set(key, url.value.trim()); status.textContent = "已保存，下条消息即时生效"; };
        row.append(lab, file, url, status);
        return row;
      }
      panel.append(
        makeRow("走动图", "walkImage"),
        makeRow("静止图", "idleImage"),
        makeRow("点击爆发图", "burstImage"),
        makeRow("随机起动图 A", "startupAImage"),
        makeRow("随机起动图 B", "startupBImage")
      );
      toggle.onclick = () => {
        const open = panel.style.display !== "none";
        panel.style.display = open ? "none" : "block";
        toggle.textContent = open ? "自定义宠物图片 ▶" : "自定义宠物图片 ▼";
      };
      root.append(toggle, panel);
      el.appendChild(root);
    });

    ctx.ui.toast("底栏宠物已启动 ✓");

    return () => {
      cancelAnimationFrame(rafId);
      cancelAnimationFrame(bounceRAF);
      if (vv) { vv.removeEventListener("resize", checkKeyboard); vv.removeEventListener("scroll", checkKeyboard); }
      if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
      if (typeof unregSettings === "function") unregSettings();
    };
  },
};
