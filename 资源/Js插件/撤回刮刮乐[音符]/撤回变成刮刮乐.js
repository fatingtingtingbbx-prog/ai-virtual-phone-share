// =============================================================
// 撤回变刮刮乐 · 小手机聊天插件 (apiVersion 1)
// 自己撤回消息后，把系统「你撤回了一条消息」原地换成一张可刮开的
// 刮刮乐，刮开露出被撤回内容（前缀固定写「我」）。撤回逻辑不变。
// =============================================================

export default {
  manifest: {
    id: "recall-scratch-card",
    name: "撤回变刮刮乐",
    apiVersion: 1,
    version: "4.3.2",
    description: "自己撤回消息后，把系统「你撤回了一条消息」换成可刮开的刮刮乐，刮开露出内容。退出聊天再进来会重新盖回涂层。",
    permissions: ["chat.read", "chat.write", "ui", "storage"],
    settings: [
      {
        key: "overlayTextMine",
        label: "「我」撤回时涂层提示",
        type: "text",
        default: "我撤回了一条信息",
        description: "你自己撤回时，灰色涂层中央显示的提示文字。留空则用默认「我撤回了一条信息」。",
      },
      {
        key: "coatingColor",
        label: "涂层颜色（十六进制）",
        type: "text",
        default: "#c8c8c8",
        description: "灰色涂层的颜色，用十六进制色值，例如 #c8c8c8、#3a7afe。填错则回退默认灰。",
      },
    ],
  },

  setup(ctx) {
    // 0) 刮开后内容前缀固定写「我」，不做任何名字识别

    // 1) 注入样式：刮刮乐居中、无头像、非气泡外观、底透明、尺寸贴合文字 -------
    ctx.ui.injectCSS(`
      /* 整行居中 + 隐藏头像 + 去掉气泡外观
         选择器特意提高特异性（.chat-msg-wrapper.rsc-row[data-role] / :not(.chat-bubble-media)），
         以压过宿主主题里同样带 !important 的规则。 */
      .chat-msg-wrapper.rsc-row[data-role] {
        justify-content: center !important;
      }
      .chat-msg-wrapper.rsc-row .chat-msg-avatar {
        display: none !important;
      }
      .chat-msg-wrapper.rsc-row .chat-msg-content-wrap {
        max-width: 100% !important;
        align-items: center !important;
        margin: 0 auto !important;
        flex: 1 1 auto !important;
        background: transparent !important;
      }
      /* 关键：系统「撤回」气泡 .chat-sys-msg 自带 rgba(0,0,0,.05) 灰底（原药丸样式），
         刮刮乐卡片是塞进该节点里的，必须把它强制透明，否则刮开后文字会浮在一层灰底上。
         同时去掉其原 padding / 圆角 / 溢出裁切，让卡片干净贴合文字。 */
      .chat-msg-wrapper.rsc-row .chat-sys-msg {
        background: transparent !important;
        padding: 0 !important;
        border-radius: 0 !important;
        overflow: visible !important;
        color: inherit !important;
      }
      .chat-msg-wrapper.rsc-row .chat-bubble-role-user:not(.chat-bubble-media),
      .chat-msg-wrapper.rsc-row .chat-bubble-role-assistant:not(.chat-bubble-media) {
        background: transparent !important;
        border: none !important;
        box-shadow: none !important;
        padding: 0 !important;
        border-radius: 0 !important;
        margin: 0 auto !important;
        max-width: 100% !important;
        width: auto !important;
        align-self: center !important;
      }

      /* 刮刮乐卡片本体（居中，区别于聊天气泡） */
      .rsc-card {
        text-align: center;
        margin: 2px auto 4px;
        max-width: min(82vw, 360px);
        user-select: none;
      }
      /* 涂层条：底透明，尺寸贴合文字（无 min 宽高、内边距收紧），露出的是聊天背景 */
      .rsc-strip {
        position: relative;
        display: inline-block;
        max-width: 100%;
        width: auto;
        border-radius: 8px;
        overflow: hidden;
        vertical-align: middle;
        background: transparent;
      }
      /* 被刮开的内容：文字居中，背景透明，padding 收紧使卡片"字体多大就多大" */
      .rsc-truth {
        position: relative;
        z-index: 1;
        display: block;
        font-size: 14px;
        font-weight: 500;
        line-height: 1.45;
        color: #333;
        text-align: center;
        white-space: pre-wrap;
        word-wrap: break-word;
        padding: 4px 12px;
        max-width: min(78vw, 340px);
        background: transparent;
      }
      .rsc-canvas {
        position: absolute;
        top: 0;
        left: 0;
        width: 100% !important;
        height: 100% !important;
        z-index: 2;
        cursor: crosshair;
        background: transparent !important;
        touch-action: none; /* 移动端刮开时不触发页面滚动 */
      }
    `);

    // 2) 把被撤回的内容整理成可展示的文本 ------------------------
    const labelForMedia = (mt) => {
      switch (mt) {
        case "image": case "sticker": return "[图片]";
        case "audio": return "[语音消息]";
        case "video": return "[视频]";
        case "media_file": return "[文件]";
        case "location": return "[位置]";
        case "red_packet": return "[红包]";
        case "transfer": return "[转账]";
        case "gift": return "[礼物]";
        case "contact_card": return "[名片]";
        default: return "";
      }
    };

    const extractText = (msg) => {
      const content = (msg && typeof msg.content === "string") ? msg.content.trim() : "";
      if (content) return content;
      const mediaLabel = labelForMedia(msg && msg.mediaType);
      return mediaLabel || "";
    };

    // 在全部会话里按 id 找到这条消息（无需当前会话 id）
    const findMessage = (id) => {
      try {
        for (const s of ctx.data.sessions.list()) {
          const m = ctx.data.messages.list(s.id).find((x) => x.id === id);
          if (m) return m;
        }
      } catch (_) { /* 忽略 */ }
      return null;
    };

    // 已完全刮开过的消息 id（同一次停留在聊天页内重渲染后保持全显，避免反复重刮）
    const revealedIds = new Set();
    // 当前已渲染的刮刮乐实例（id -> 信息），用于退出界面时强制盖回涂层
    const instances = new Map();
    // 轮询用的：上一次"可见聊天图层"
    let lastVisibleLayer = null;

    // 退出界面 / 切会话后，重新点进去要让刮刮乐恢复成没刮开（盖回涂层）。
    const resetAll = () => {
      revealedIds.clear();
      instances.forEach((inst) => {
        if (inst && inst.sysNode && inst.sysNode.isConnected && inst.redraw) {
          try { inst.redraw(); } catch (_) {}
        }
      });
    };

    // 3) 把系统「你撤回了一条消息」气泡（DOM 节点）原地换皮成刮刮乐 ----------
    // 注意：不改消息数据（isRetracted 保持 true），只在显示层把那段
    // 文字替换成可刮开的卡片；原文只存在于屏幕上的涂层之下。
    const buildCard = (sysNode, msg) => {
      sysNode.replaceChildren();

      const wrapper = sysNode.closest(".chat-msg-wrapper");
      if (wrapper) wrapper.classList.add("rsc-row");

      const card = document.createElement("div");
      card.className = "rsc-card";

      const box = document.createElement("div");
      box.className = "rsc-strip";

      const truth = document.createElement("div");
      truth.className = "rsc-truth";
      const raw = extractText(msg);

      // 刮开后内容前的称呼固定为「我」（不做任何名字识别）。
      truth.textContent = raw ? `我：${raw}` : "[消息]"; // textContent 防 XSS

      const canvas = document.createElement("canvas");
      canvas.className = "rsc-canvas";

      card.appendChild(box);
      box.appendChild(truth);
      box.appendChild(canvas);
      sysNode.appendChild(card);

      // 读取设置（实时读取，支持运行期改设置）。
      // 仅暴露「我撤回时涂层提示」+ 涂层颜色；刮痕粗细、是否自动全显为固定默认值。
      const getSettings = () => {
        const custom = (ctx.system.settings.get("overlayTextMine") || "").toString().trim();
        const rawColor = (ctx.system.settings.get("coatingColor") || "").toString().trim();
        const coatingColor = /^#[0-9a-fA-F]{3,8}$/.test(rawColor) ? rawColor : "#c8c8c8";
        return {
          brushSize: 16,        // 固定：刮痕粗细
          autoReveal: false,    // 固定：需手动把涂层刮干净，不自动全显
          revealThreshold: 100,
          overlayText: custom || "我撤回了一条信息",
          coatingColor,
        };
      };

      // 根据涂层颜色亮度，决定中央提示文字用深色还是浅色（保证可读）
      const overlayTextColor = (hex) => {
        const h = hex.replace("#", "");
        const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h.slice(0, 6);
        const r = parseInt(full.substring(0, 2), 16) || 0;
        const g = parseInt(full.substring(2, 4), 16) || 0;
        const b = parseInt(full.substring(4, 6), 16) || 0;
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        return lum > 140 ? "#333" : "#f2f2f2";
      };

      let revealed = false;

      const initRealScratch = () => {
        const w = box.offsetWidth;
        const h = box.offsetHeight;
        if (w <= 0 || h <= 0) return false;

        const dpr = window.devicePixelRatio || 2;
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        canvas.style.width = w + "px";
        canvas.style.height = h + "px";

        const cctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!cctx) return true;
        cctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        // 绘制涂层（颜色 / 水印 / 中央提示），resize+scale 之后调用
        const drawCoating = (g, cw, ch) => {
          const s = getSettings();
          g.globalCompositeOperation = "source-over";
          g.fillStyle = s.coatingColor;
          g.fillRect(0, 0, cw, ch);

          // 斜向 "SCRATCH" 水印（细体）
          g.save();
          g.font = "normal 12px sans-serif";
          g.fillStyle = "rgba(0,0,0,0.05)";
          g.rotate(-20 * Math.PI / 180);
          const diag = Math.sqrt(cw * cw + ch * ch) * 2;
          let lineIndex = 0;
          for (let y = -diag; y < diag; y += 30) {
            const rowOffset = (lineIndex % 2 === 0) ? 0 : 60;
            for (let x = -diag; x < diag; x += 120) {
              g.fillText("SCRATCH", x + rowOffset, y);
            }
            lineIndex++;
          }
          g.restore();

          // 中央提示文字（可改；颜色按涂层亮度自适应）
          g.font = "normal 13px system-ui, sans-serif";
          g.fillStyle = overlayTextColor(s.coatingColor);
          g.textAlign = "center";
          g.textBaseline = "middle";
          g.fillText(s.overlayText, cw / 2, ch / 2);
        };
        drawCoating(cctx, w, h);

        // —— 刮开交互（用 Pointer 事件统一鼠标/触摸）——
        let drawing = false;
        let scratchCount = 0;

        const getPos = (e) => {
          const r = canvas.getBoundingClientRect();
          return { x: e.clientX - r.left, y: e.clientY - r.top };
        };
        const scratch = (x, y) => {
          const s2 = getSettings();
          cctx.globalCompositeOperation = "destination-out";
          cctx.beginPath();
          cctx.arc(x, y, s2.brushSize, 0, Math.PI * 2);
          cctx.fill();
        };
        const checkReveal = () => {
          const s3 = getSettings();
          if (revealed || !s3.autoReveal) return;
          try {
            const img = cctx.getImageData(0, 0, canvas.width, canvas.height).data;
            let clear = 0;
            for (let i = 3; i < img.length; i += 4 * 8) {
              if (img[i] === 0) clear++;
            }
            const total = Math.floor(img.length / (4 * 8));
            if (total > 0 && (clear / total) * 100 >= s3.revealThreshold) {
              revealed = true;
              revealedIds.add(msg.id);
              canvas.style.transition = "opacity .5s ease";
              canvas.style.opacity = "0";
              setTimeout(() => { canvas.style.pointerEvents = "none"; }, 520);
            }
          } catch (_) { /* getImageData 偶尔受限，忽略 */ }
        };

        const start = (e) => {
          e.stopPropagation(); // 阻止冒泡到宿主的长按菜单逻辑，保证刮开顺滑
          drawing = true;
          try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
          const p = getPos(e);
          scratch(p.x, p.y);
        };
        const move = (e) => {
          if (!drawing) return;
          e.preventDefault();
          e.stopPropagation();
          const p = getPos(e);
          scratch(p.x, p.y);
          scratchCount++;
          if (scratchCount % 8 === 0) checkReveal();
        };
        const end = () => {
          if (!drawing) return;
          drawing = false;
          checkReveal();
        };

        canvas.addEventListener("pointerdown", start);
        canvas.addEventListener("pointermove", move);
        canvas.addEventListener("pointerup", end);
        canvas.addEventListener("pointercancel", end);
        canvas.addEventListener("pointerleave", end);

        // 重新盖回涂层（退出界面 / 切会话后恢复刮刮乐用）
        let redrawRetries = 0;
        const redraw = () => {
          const w2 = box.offsetWidth, h2 = box.offsetHeight;
          if (w2 <= 0 || h2 <= 0) {
            // 图层还隐藏（display:none 时尺寸为 0），等显示出来再画
            if (redrawRetries < 180) { redrawRetries++; requestAnimationFrame(redraw); }
            return;
          }
          redrawRetries = 0;
          const g2 = canvas.getContext("2d", { willReadFrequently: true });
          if (!g2) return;
          const dpr2 = window.devicePixelRatio || 2;
          canvas.width = w2 * dpr2;
          canvas.height = h2 * dpr2;
          canvas.style.width = w2 + "px";
          canvas.style.height = h2 + "px";
          g2.setTransform(dpr2, 0, 0, dpr2, 0, 0);
          g2.globalCompositeOperation = "source-over";
          drawCoating(g2, w2, h2);
          revealed = false;
          canvas.style.transition = "";
          canvas.style.opacity = "1";
          canvas.style.pointerEvents = "auto";
        };
        instances.set(msg.id, { sysNode, redraw });

        // 若本次停留在聊天页期间已刮开，直接全显（重渲染后保持）
        if (revealedIds.has(msg.id)) {
          revealed = true;
          canvas.style.opacity = "0";
          canvas.style.pointerEvents = "none";
        }

        // 卡片卸载时清理监听（DOM 被移除即视为退出）
        const onRemoved = () => {
          canvas.removeEventListener("pointerdown", start);
          canvas.removeEventListener("pointermove", move);
          canvas.removeEventListener("pointerup", end);
          canvas.removeEventListener("pointercancel", end);
          canvas.removeEventListener("pointerleave", end);
          instances.delete(msg.id);
        };
        const rmObs = new MutationObserver(() => {
          if (!sysNode.isConnected) { try { rmObs.disconnect(); } catch (_) {} onRemoved(); }
        });
        rmObs.observe(document.body, { childList: true, subtree: true });

        return onRemoved;
      };

      // 等待容器有尺寸后再初始化（布局完成后才有正确宽高）
      let attempts = 0;
      const tryInit = () => {
        if (!sysNode.isConnected) return;
        if (box.offsetWidth > 0 && box.offsetHeight > 0) {
          initRealScratch();
          return;
        }
        attempts++;
        if (attempts < 60) {
          requestAnimationFrame(tryInit);
        } else {
          setTimeout(() => { attempts = 0; tryInit(); }, 400);
        }
      };
      requestAnimationFrame(tryInit);
    };

    // 4) 扫描所有「你撤回了一条消息」系统气泡，把还没换皮的换成刮刮乐 ----------
    const scanRetracts = () => {
      let sysNodes = [];
      try {
        sysNodes = Array.from(document.querySelectorAll(".chat-sys-msg"));
      } catch (_) { return; }

      for (const node of sysNodes) {
        // 已经换皮过（含 .rsc-card）的跳过
        if (node.querySelector && node.querySelector(".rsc-card")) continue;
        const text = (node.textContent || "");
        // 只处理自己撤回；对方撤回（无撤回功能）不处理，保持原系统文案
        if (!text.includes("你撤回了一条消息")) continue;

        const wrapper = node.closest(".chat-msg-wrapper");
        if (!wrapper || !wrapper.id) continue;
        const id = wrapper.id.replace(/^message-/, "");
        if (!id) continue;

        const msg = findMessage(id);
        if (!msg) continue;
        // 已经是别的插件接管则跳过
        if (typeof msg.mediaType === "string" && msg.mediaType.startsWith("plugin:")) continue;

        buildCard(node, msg);
      }
    };

    let scanScheduled = false;
    const scheduleScan = () => {
      if (scanScheduled) return;
      scanScheduled = true;
      try {
        setTimeout(() => {
          scanScheduled = false;
          scanRetracts();
        }, 60);
      } catch (_) {
        scanScheduled = false;
      }
    };

    let observer = null;
    if (typeof document !== "undefined") {
      // 监听任何「你撤回了一条消息」气泡的出现（含重渲染导致的替换）
      observer = new MutationObserver(() => scheduleScan());
      observer.observe(document.body, { childList: true, subtree: true, characterData: true });
      scheduleScan(); // 初次也扫一遍
    }

    // 5) 轮询"当前可见聊天图层"：关闭聊天/重进/切会话都算图层切换，
    //    触发即强制盖回涂层（小手机聊天视图不卸载，只是 display 切换，故用轮询最稳）。
    const pollVisibleLayer = () => {
      let visible = null;
      try {
        const layers = document.querySelectorAll(".chat-room-layer");
        layers.forEach((l) => {
          if (l.getClientRects().length > 0) visible = l;
        });
      } catch (_) { /* 忽略 */ }
      if (visible !== lastVisibleLayer) {
        lastVisibleLayer = visible;
        if (visible) resetAll();
      }
    };
    const pollTimer = setInterval(pollVisibleLayer, 400);

    // setup 返回的函数会在插件禁用/卸载时执行
    return () => {
      if (observer) {
        try { observer.disconnect(); } catch (_) {}
        observer = null;
      }
      if (pollTimer) {
        try { clearInterval(pollTimer); } catch (_) {}
      }
      instances.clear();
      revealedIds.clear();
    };
  },
};
