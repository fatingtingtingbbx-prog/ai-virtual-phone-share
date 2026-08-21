export default {
  manifest: {
    id: "imessage-reaction",
    name: "消息表情回应",
    apiVersion: 1,
    version: "1.3.1",
    author: "小坊",
    description: "用emoji回应对方的消息",
    permissions: [
      "chat.read",
      "message.write",
      "prompt.inject",
      "storage",
      "ui.render"
    ],
    settings: [
      {
        key: "hidePlusBtn",
        label: "隐藏未使用的「+」按钮",
        type: "boolean",
        default: false,
      },
      {
        key: "sendCharSystemMsg",
        label: "角色做出回应/撤回时在聊天中显示系统通知",
        type: "boolean",
        default: true,
      },
      {
        key: "injectPrompt",
        label: "在提示词中注入回应状态与触发指令",
        type: "boolean",
        default: true,
      },
    ],
  },

  setup(ctx) {
    const rerenderMap = new Map();
    let settingsUnsubscribe = null;

    const QUICK_EMOJIS = ["❤️", "👍", "👎", "😂", "‼️", "❓", "🔥", "🥺", "🥰", "😭", "✨", "🎉", "👏"];

    // 安全转义 HTML 属性值
    const escapeHtml = (str) => {
      return String(str)
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    };

    // 校验颜色值，仅允许 #hex 或常见颜色名
    const isValidColor = (color) => {
      return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(color) ||
             /^[a-zA-Z]+$/.test(color); // 简单允许单词，实际可更严格
    };

    // 清理 emoji，限制长度，拒绝包含 HTML 标签
    const sanitizeEmoji = (emoji) => {
      if (!emoji) return "";
      // 去除 HTML 标签
      emoji = emoji.replace(/<[^>]*>/g, "").trim();
      // 限制长度为 8 个 Unicode 码点
      return [...emoji].slice(0, 8).join("");
    };

    ctx.ui.injectCSS(`
      /* 角色消息右下角挂载容器 */
      .imsg-rx-assistant-wrapper {
        position: absolute;
        bottom: 18px;
        right: -22px;
        pointer-events: auto;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      /* 用户消息左上角挂载容器 */
      .imsg-rx-user-wrapper {
        position: absolute;
        top: -40px;
        left: -26px;
        pointer-events: auto;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      /* 徽标整体外层 */
      .imsg-rx-badge-group {
        position: relative;
        display: inline-block;
        user-select: none;
        animation: imsg-badge-pop 0.18s cubic-bezier(0.175, 0.885, 0.32, 1.275);
      }
      @keyframes imsg-badge-pop {
        from { transform: scale(0.4); opacity: 0; }
        to { transform: scale(1); opacity: 1; }
      }
      /* 主圆球基础 */
      .imsg-rx-main-circle {
        box-sizing: border-box;
        border-radius: 50%;
        display: grid;
        place-items: center;
        position: relative;
        z-index: 3;
        padding: 0;
        margin: 0;
      }
      /* 角色气泡徽标：阴影落在左下角 (-2px, 3px) */
      .imsg-rx-assistant-wrapper .imsg-rx-main-circle {
        box-shadow: -2px 3px 6px rgba(0, 0, 0, 0.2), 0 0 1px rgba(0, 0, 0, 0.12);
        cursor: pointer;
        transition: transform 0.15s ease;
      }
      .imsg-rx-assistant-wrapper .imsg-rx-badge-group:active {
        transform: scale(0.88);
      }
      /* 用户气泡徽标：阴影落在右下角 (2px, 3px) */
      .imsg-rx-user-wrapper .imsg-rx-main-circle {
        box-shadow: 2px 3px 6px rgba(0, 0, 0, 0.2), 0 0 1px rgba(0, 0, 0, 0.12);
      }

      /* 角色徽标装饰圆：右下角，斜上微移 1px */
      .imsg-rx-tail-dot-asst-1 {
        position: absolute;
        border-radius: 50%;
        bottom: -2px;
        right: -2px;
        z-index: 2;
        box-shadow: -1px 1px 3px rgba(0, 0, 0, 0.15);
      }
      .imsg-rx-tail-dot-asst-2 {
        position: absolute;
        border-radius: 50%;
        bottom: 0px;
        right: 0px;
        z-index: 1;
        box-shadow: -1px 1px 2px rgba(0, 0, 0, 0.12);
      }

      /* 用户徽标装饰圆：左下角，斜上微移 1px */
      .imsg-rx-tail-dot-user-1 {
        position: absolute;
        border-radius: 50%;
        bottom: -2px;
        left: -2px;
        z-index: 2;
        box-shadow: 1px 1px 3px rgba(0, 0, 0, 0.15);
      }
      .imsg-rx-tail-dot-user-2 {
        position: absolute;
        border-radius: 50%;
        bottom: 0px;
        left: 0px;
        z-index: 1;
        box-shadow: 1px 1px 2px rgba(0, 0, 0, 0.12);
      }

      /* 内部 Emoji 图标文本：向下微移 1px */
      .imsg-rx-badge-icon {
        line-height: 1;
        display: block;
        text-align: center;
        transform: translateY(1px);
      }
      /* 常驻的灰底 + 号按钮 */
      .imsg-rx-plus-btn {
        background: #8e8e93;
        color: #ffffff;
        border-radius: 50%;
        display: grid;
        place-items: center;
        font-weight: 600;
        line-height: 1;
        cursor: pointer;
        user-select: none;
        box-shadow: 0 2px 5px rgba(0, 0, 0, 0.2);
        opacity: 0.85;
        transition: transform 0.15s ease, opacity 0.15s ease, background-color 0.15s ease;
      }
      .imsg-rx-plus-btn:hover {
        opacity: 1;
        background: #636366;
      }
      .imsg-rx-plus-btn:active {
        transform: scale(0.88);
      }
      .imsg-rx-plus-btn.imsg-invisible {
        opacity: 0 !important;
        box-shadow: none !important;
        background: transparent !important;
      }
      /* 隐藏滚动条 */
      .imsg-no-scrollbar::-webkit-scrollbar {
        display: none;
      }
      .imsg-no-scrollbar {
        -ms-overflow-style: none;
        scrollbar-width: none;
      }
    `);

    const getGlobalConfig = () => {
      const rawSize = Number(ctx.system.storage.get("global_size")) || 24;
      const rawFontSize = Number(ctx.system.storage.get("global_fontSize")) || 16;
      const rawZIndex = ctx.system.storage.get("global_zIndex") !== null ? Number(ctx.system.storage.get("global_zIndex")) : 1;
      const asstBg = ctx.system.storage.get("global_assistantBgColor") || "#ffffff";
      const userBg = ctx.system.storage.get("global_userBgColor") || "#ffffff";

      // 限制范围
      return {
        size: Math.min(64, Math.max(12, rawSize)),
        fontSize: Math.min(48, Math.max(8, rawFontSize)),
        zIndex: Math.min(9999, Math.max(0, rawZIndex)),
        assistantBg: isValidColor(asstBg) ? asstBg : "#ffffff",
        userBg: isValidColor(userBg) ? userBg : "#ffffff",
      };
    };

    const createBadgeGroup = (emoji, bgColor, type = "assistant") => {
      const cfg = getGlobalConfig();
      const mainSize = cfg.size;

      const group = document.createElement("div");
      group.className = "imsg-rx-badge-group";

      const mainCircle = document.createElement("div");
      mainCircle.className = "imsg-rx-main-circle";
      mainCircle.style.width = `${mainSize}px`;
      mainCircle.style.height = `${mainSize}px`;
      mainCircle.style.backgroundColor = bgColor;

      const icon = document.createElement("span");
      icon.className = "imsg-rx-badge-icon";
      icon.textContent = emoji; // 使用 textContent 安全渲染
      icon.style.fontSize = `${cfg.fontSize}px`;
      mainCircle.appendChild(icon);
      group.appendChild(mainCircle);

      const dot1Size = Math.max(6, Math.round(mainSize * 0.35));
      const dot2Size = Math.max(3.5, Math.round(mainSize * 0.2));

      const dot1 = document.createElement("div");
      const dot2 = document.createElement("div");
      dot1.style.width = `${dot1Size}px`;
      dot1.style.height = `${dot1Size}px`;
      dot1.style.backgroundColor = bgColor;

      dot2.style.width = `${dot2Size}px`;
      dot2.style.height = `${dot2Size}px`;
      dot2.style.backgroundColor = bgColor;

      if (type === "assistant") {
        dot1.className = "imsg-rx-tail-dot-asst-1";
        dot2.className = "imsg-rx-tail-dot-asst-2";
      } else {
        dot1.className = "imsg-rx-tail-dot-user-1";
        dot2.className = "imsg-rx-tail-dot-user-2";
      }

      group.appendChild(dot1);
      group.appendChild(dot2);

      return group;
    };

    const rerenderAll = () => {
      rerenderMap.forEach((fn) => fn());
    };

    const openReactionModal = (message, sessionId, currentEmoji) => {
      ctx.ui.openModal((modalEl, { close }) => {
        const cfg = getGlobalConfig();
        // 对动态值进行 HTML 转义
        const safeCurrentEmoji = escapeHtml(currentEmoji || "");
        const safeSize = escapeHtml(cfg.size);
        const safeFontSize = escapeHtml(cfg.fontSize);
        const safeZIndex = escapeHtml(cfg.zIndex);
        const safeAssBg = escapeHtml(cfg.assistantBg);
        const safeUserBg = escapeHtml(cfg.userBg);

        modalEl.style.maxWidth = "330px";
        modalEl.style.padding = "20px";
        modalEl.style.borderRadius = "12px";
        modalEl.style.background = "#ffffff";
        modalEl.style.boxShadow = "0 16px 42px rgba(0,0,0,0.22)";
        modalEl.style.boxSizing = "border-box";
        modalEl.style.fontFamily = "'Times New Roman', SimSun, 'Songti SC', 'STSong', serif";

        modalEl.innerHTML = `
          <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 8px;">
            <span style="font-family: 'Times New Roman', Times, serif; font-size: 24px; font-weight: bold; letter-spacing: 1.5px; color: #111111;">
              REACTION
            </span>
            <span id="imsg-modal-close-btn" style="font-family: SimSun, 'Songti SC', serif; font-size: 13px; color: #8e8e93; cursor: pointer; user-select: none; padding: 2px 4px;">
              关闭
            </span>
          </div>

          <div style="height: 1px; background: #e5e5ea; margin-bottom: 12px;"></div>

          <div id="imsg-emoji-scroll-row" class="imsg-no-scrollbar" style="display: flex; gap: 14px; overflow-x: auto; padding: 4px 2px 8px 2px; margin-bottom: 12px; -webkit-overflow-scrolling: touch;">
            ${QUICK_EMOJIS.map((em) => `<span class="imsg-quick-em" data-em="${escapeHtml(em)}" style="font-size: 22px; cursor: pointer; flex-shrink: 0; line-height: 1; user-select: none;">${escapeHtml(em)}</span>`).join("")}
          </div>

          <div style="display: flex; gap: 6px; align-items: center; margin-bottom: 18px;">
            <input id="imsg-single-input" type="text" value="${safeCurrentEmoji}" placeholder="输入 Emoji..." maxlength="6" style="flex: 1; height: 36px; padding: 0 8px; border: 1px solid #d1d1d6; border-radius: 0px; outline: none; font-family: 'Times New Roman', SimSun, serif; font-size: 15px; box-sizing: border-box; background: #fafafa;" />
            <button id="imsg-single-del-btn" style="height: 36px; padding: 0 12px; border: none; border-radius: 0px; background: #8e8e93; color: #ffffff; font-family: SimSun, 'Songti SC', serif; font-size: 15px; cursor: pointer; white-space: nowrap;">移除</button>
            <button id="imsg-single-save-btn" style="height: 36px; padding: 0 14px; border: none; border-radius: 0px; background: #000000; color: #ffffff; font-family: SimSun, 'Songti SC', serif; font-size: 15px; cursor: pointer; font-weight: 500; white-space: nowrap;">保存</button>
          </div>

          <div style="display: flex; flex-direction: column; gap: 12px; margin-bottom: 18px; padding-top: 6px; border-top: 1px dashed #e5e5ea;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span style="font-family: SimSun, 'Songti SC', serif; font-size: 15px; color: #222222;">圆形直径</span>
              <input id="cfg-size" type="number" value="${safeSize}" style="width: 80px; text-align: right; border: none; border-bottom: 1px solid #8e8e93; border-radius: 0px; outline: none; font-family: 'Times New Roman', Times, serif; font-size: 16px; background: transparent; padding: 2px 0;" />
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span style="font-family: SimSun, 'Songti SC', serif; font-size: 15px; color: #222222;">emoji字号</span>
              <input id="cfg-fontSize" type="number" value="${safeFontSize}" style="width: 80px; text-align: right; border: none; border-bottom: 1px solid #8e8e93; border-radius: 0px; outline: none; font-family: 'Times New Roman', Times, serif; font-size: 16px; background: transparent; padding: 2px 0;" />
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span style="font-family: SimSun, 'Songti SC', serif; font-size: 15px; color: #222222;">气泡层级</span>
              <input id="cfg-zIndex" type="number" value="${safeZIndex}" style="width: 80px; text-align: right; border: none; border-bottom: 1px solid #8e8e93; border-radius: 0px; outline: none; font-family: 'Times New Roman', Times, serif; font-size: 16px; background: transparent; padding: 2px 0;" />
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span style="font-family: SimSun, 'Songti SC', serif; font-size: 15px; color: #222222;">角色emoji气泡底色</span>
              <input id="cfg-assistantBg" type="text" value="${safeAssBg}" placeholder="#ffffff" style="width: 90px; text-align: right; border: none; border-bottom: 1px solid #8e8e93; border-radius: 0px; outline: none; font-family: 'Times New Roman', Times, serif; font-size: 16px; background: transparent; padding: 2px 0;" />
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span style="font-family: SimSun, 'Songti SC', serif; font-size: 15px; color: #222222;">用户emoji气泡底色</span>
              <input id="cfg-userBg" type="text" value="${safeUserBg}" placeholder="#ffffff" style="width: 90px; text-align: right; border: none; border-bottom: 1px solid #8e8e93; border-radius: 0px; outline: none; font-family: 'Times New Roman', Times, serif; font-size: 16px; background: transparent; padding: 2px 0;" />
            </div>
          </div>

          <div style="display: flex; justify-content: flex-end;">
            <button id="imsg-finish-all-btn" style="height: 34px; padding: 0 22px; border: none; border-radius: 0px; background: #000000; color: #ffffff; font-family: SimSun, 'Songti SC', serif; font-size: 15px; cursor: pointer; font-weight: 500;">
              完成
            </button>
          </div>
        `;

        modalEl.querySelector("#imsg-modal-close-btn").onclick = close;

        const inputEl = modalEl.querySelector("#imsg-single-input");
        const saveBtn = modalEl.querySelector("#imsg-single-save-btn");
        const delBtn = modalEl.querySelector("#imsg-single-del-btn");
        const finishBtn = modalEl.querySelector("#imsg-finish-all-btn");

        modalEl.querySelectorAll(".imsg-quick-em").forEach((item) => {
          item.onclick = () => {
            const em = item.getAttribute("data-em");
            inputEl.value = em;
            handleSaveSingle(em);
          };
        });

        // 1. 保存当前消息 Emoji（用户操作静默）
        const handleSaveSingle = async (val) => {
          let emoji = (val || inputEl.value).trim();
          emoji = sanitizeEmoji(emoji);
          if (!emoji) {
            ctx.ui.toast("请输入 Emoji 表情");
            return;
          }

          const key = `user_reaction_${message.id}`;
          await ctx.system.storage.set(key, emoji);

          // 将本轮记录存入私有存储，而非共享变量池
          const storageKey = `session_reactions_${sessionId}`;
          let currentRoundList = (await ctx.system.storage.get(storageKey)) || [];
          currentRoundList = currentRoundList.filter((item) => item.msgId !== message.id);
          currentRoundList.push({
            msgId: message.id,
            msgText: (message.content || "").slice(0, 30), // 仅用于提示词，不暴露给其他插件
            emoji: emoji,
            removed: false,
            time: Date.now(),
          });
          await ctx.system.storage.set(storageKey, currentRoundList);

          rerenderAll();
          ctx.ui.toast(`已回应 ${emoji}`);
          close();
        };

        // 2. 移除当前消息 Emoji（用户操作静默）
        const handleRemoveSingle = async () => {
          const key = `user_reaction_${message.id}`;
          const existingEmoji = currentEmoji || await ctx.system.storage.get(key);

          await ctx.system.storage.remove(key);

          if (existingEmoji) {
            const storageKey = `session_reactions_${sessionId}`;
            let currentRoundList = (await ctx.system.storage.get(storageKey)) || [];
            currentRoundList = currentRoundList.filter((item) => item.msgId !== message.id);
            currentRoundList.push({
              msgId: message.id,
              msgText: (message.content || "").slice(0, 30),
              emoji: existingEmoji,
              removed: true,
              time: Date.now(),
            });
            await ctx.system.storage.set(storageKey, currentRoundList);
          }

          rerenderAll();
          ctx.ui.toast("已撤回表情回应");
          close();
        };

        // 3. 保存全局配置
        const handleSaveGlobalConfig = async () => {
          let sizeVal = Number(modalEl.querySelector("#cfg-size").value) || 24;
          let fontVal = Number(modalEl.querySelector("#cfg-fontSize").value) || 16;
          let zIndexVal = Number(modalEl.querySelector("#cfg-zIndex").value) || 1;
          let asstBgVal = modalEl.querySelector("#cfg-assistantBg").value.trim() || "#ffffff";
          let userBgVal = modalEl.querySelector("#cfg-userBg").value.trim() || "#ffffff";

          // 限制范围
          sizeVal = Math.min(64, Math.max(12, sizeVal));
          fontVal = Math.min(48, Math.max(8, fontVal));
          zIndexVal = Math.min(9999, Math.max(0, zIndexVal));
          if (!isValidColor(asstBgVal)) asstBgVal = "#ffffff";
          if (!isValidColor(userBgVal)) userBgVal = "#ffffff";

          await ctx.system.storage.set("global_size", sizeVal);
          await ctx.system.storage.set("global_fontSize", fontVal);
          await ctx.system.storage.set("global_zIndex", zIndexVal);
          await ctx.system.storage.set("global_assistantBgColor", asstBgVal);
          await ctx.system.storage.set("global_userBgColor", userBgVal);

          rerenderAll();
          ctx.ui.toast("全局设置已保存");
          close();
        };

        saveBtn.onclick = () => handleSaveSingle();
        inputEl.onkeydown = (e) => {
          if (e.key === "Enter") handleSaveSingle();
        };
        delBtn.onclick = handleRemoveSingle;
        finishBtn.onclick = handleSaveGlobalConfig;

        const focusTimer = setTimeout(() => inputEl.focus(), 40);
        // 清理 timer
        const originalClose = close;
        const wrappedClose = () => {
          clearTimeout(focusTimer);
          originalClose();
        };
        // 用 wrappedClose 替换关闭按钮事件
        modalEl.querySelector("#imsg-modal-close-btn").onclick = wrappedClose;
        // 不覆盖外部 close，但后续关闭由 ctx 处理，我们只需在卸载时清理
      });
    };

    // 辅助函数：根据片段匹配用户消息，若无片段则默认最后一条
    const findTargetUserMsg = (sessionId, quoteText) => {
      const msgs = ctx.data.messages.list ? ctx.data.messages.list(sessionId) : [];
      const userMsgs = msgs.filter((m) => m.role === "user");
      if (userMsgs.length === 0) return null;

      if (quoteText && quoteText.trim()) {
        const query = quoteText.trim();
        const matched = [...userMsgs].reverse().find((m) => (m.content || "").includes(query));
        if (matched) return matched;
      }

      return userMsgs[userMsgs.length - 1];
    };

    // 拦截回复：支持 [reaction:emoji(片段)] / [reaction:emoji "片段"] / [reaction:emoji] 与撤回指令
    ctx.hooks.transform("llm.response", async (p) => {
      if (!p.text || !p.sessionId) return p;

      // 限制处理数量
      let removeMatches = [...p.text.matchAll(/\[(?:remove_reaction|撤回回应)(?:[:：\s]*(?:\(([^)]+)\)|["'“]([^"'”]+)["'”]))?\]/gi)];
      removeMatches = removeMatches.slice(0, 2); // 最多处理2个

      for (const rm of removeMatches) {
        const quote = (rm[1] || rm[2] || "").trim();
        const targetMsg = findTargetUserMsg(p.sessionId, quote);
        if (targetMsg) {
          const existed = await ctx.system.storage.get(`char_reaction_${targetMsg.id}`);
          if (existed) {
            await ctx.system.storage.remove(`char_reaction_${targetMsg.id}`);
            const rerender = rerenderMap.get(targetMsg.id);
            if (rerender) setTimeout(rerender, 10);

            if (ctx.system.settings.get("sendCharSystemMsg") !== false && ctx.data.messages.push) {
              await ctx.data.messages.push({
                sessionId: p.sessionId,
                role: "system",
                content: "对方撤回了对你消息的回应",
              });
            }
          }
        }
      }
      p.text = p.text.replace(/\[(?:remove_reaction|撤回回应)[^\]]*\]/gi, "").trim();

      // 2. 角色做出回应：[reaction:emoji(片段)] 或 [reaction:emoji "片段"] 或 [reaction:emoji]
      let addMatches = [...p.text.matchAll(/\[(?:reaction|回应)[:：]\s*([^\s()\"'\[\]]+)(?:\s*(?:\(([^)]+)\)|["'“]([^"'”]+)["'”]))?\]/gi)];
      addMatches = addMatches.slice(0, 2); // 最多处理2个

      for (const match of addMatches) {
        let emoji = (match[1] || "").trim();
        emoji = sanitizeEmoji(emoji); // 清理
        const quote = (match[2] || match[3] || "").trim();

        if (emoji) {
          const targetMsg = findTargetUserMsg(p.sessionId, quote);
          if (targetMsg) {
            await ctx.system.storage.set(`char_reaction_${targetMsg.id}`, emoji);
            const rerender = rerenderMap.get(targetMsg.id);
            if (rerender) setTimeout(rerender, 10);

            if (ctx.system.settings.get("sendCharSystemMsg") !== false && ctx.data.messages.push) {
              await ctx.data.messages.push({
                sessionId: p.sessionId,
                role: "system",
                content: `对方回应了你的消息: ${emoji}`,
              });
            }
          }
        }
      }
      p.text = p.text.replace(/\[(?:reaction|回应)[:：][^\]]+\]/gi, "").trim();

      // AI 回复完成，清空本轮累积的用户 Reaction 记录（私有存储）
      const storageKey = `session_reactions_${p.sessionId}`;
      await ctx.system.storage.remove(storageKey);

      return p;
    });

    ctx.ui.slot("message.footer", (el, props) => {
      const msg = props.message;
      const sessionId = props.sessionId;
      if (!msg) return;

      if (el.parentElement) {
        el.parentElement.style.position = "relative";
      }
      el.style.position = "relative";
      el.style.height = "0px";
      el.style.overflow = "visible";

      // 1. 角色消息（右下角：用户回应）
      if (msg.role === "assistant") {
        const wrapper = document.createElement("div");
        wrapper.className = "imsg-rx-assistant-wrapper";

        const renderAssistant = () => {
          wrapper.innerHTML = "";
          const cfg = getGlobalConfig();
          wrapper.style.zIndex = `${cfg.zIndex}`;

          const savedEmoji = ctx.system.storage.get(`user_reaction_${msg.id}`);

          if (savedEmoji) {
            const badgeGroup = createBadgeGroup(savedEmoji, cfg.assistantBg, "assistant");
            badgeGroup.title = "点击修改或移除回应";
            badgeGroup.onclick = (e) => {
              e.stopPropagation();
              openReactionModal(msg, sessionId, savedEmoji);
            };
            wrapper.appendChild(badgeGroup);
          } else {
            const isHidden = ctx.system.settings.get("hidePlusBtn") === true;
            const plusBtn = document.createElement("div");
            plusBtn.className = `imsg-rx-plus-btn ${isHidden ? "imsg-invisible" : ""}`;
            plusBtn.textContent = "+";
            plusBtn.title = "添加表情回应与设置";
            plusBtn.style.width = `${Math.max(18, cfg.size - 2)}px`;
            plusBtn.style.height = `${Math.max(18, cfg.size - 2)}px`;
            plusBtn.style.fontSize = `${Math.max(12, cfg.fontSize - 2)}px`;
            plusBtn.onclick = (e) => {
              e.stopPropagation();
              openReactionModal(msg, sessionId, null);
            };
            wrapper.appendChild(plusBtn);
          }
        };

        renderAssistant();
        rerenderMap.set(msg.id, renderAssistant);
        el.appendChild(wrapper);

        return () => {
          rerenderMap.delete(msg.id);
        };
      }

      // 2. 用户消息（左上角：角色回应）
      if (msg.role === "user") {
        const wrapper = document.createElement("div");
        wrapper.className = "imsg-rx-user-wrapper";

        const renderUser = () => {
          wrapper.innerHTML = "";
          const cfg = getGlobalConfig();
          wrapper.style.zIndex = `${cfg.zIndex}`;

          const charEmoji = ctx.system.storage.get(`char_reaction_${msg.id}`);
          if (charEmoji) {
            const badgeGroup = createBadgeGroup(charEmoji, cfg.userBg, "user");
            badgeGroup.title = "角色对你的回应";
            wrapper.appendChild(badgeGroup);
          }
        };

        renderUser();
        rerenderMap.set(msg.id, renderUser);
        el.appendChild(wrapper);

        return () => {
          rerenderMap.delete(msg.id);
        };
      }
    });

    // 提示词注入
    ctx.hooks.transform("prompt.system", (payload) => {
      if (ctx.system.settings.get("injectPrompt") === false) return payload;
      if (!payload.sessionId) return payload;

      let promptAddition = "\n\n【表情回应机制】";

      const storageKey = `session_reactions_${payload.sessionId}`;
      const roundList = ctx.system.storage.get(storageKey);
      if (roundList && roundList.length > 0) {
        const lines = roundList.map((item) => {
          if (item.removed) {
            return `- {{user}} 撤回了对你消息“${item.msgText}”做出的表情回应（原回应：${item.emoji}）`;
          }
          return `- {{user}} 对你的消息“${item.msgText}”做出了表情回应：${item.emoji}`;
        });
        promptAddition += `\n{{user}} 本轮对你消息的回应/撤回记录（请自然体会{{user}}情绪）：\n${lines.join("\n")}`;
      }

      promptAddition += `\n如果{{char}}对{{user}}刚才说的某一句话有强烈的表情反应（如喜爱、大笑、赞同、震惊等），可以在回复的最末尾附带标记：\n- 回应指定一句话：[reaction:emoji(该句部分文字)]（例如 [reaction:❤️(喜欢你)] 或 [reaction:😂] 默认上一句）\n- 撤回对某句话的回应：[remove_reaction(该句部分文字)] 或 [remove_reaction]\n系统会自动将其转化为对应气泡左上角的表情徽章，请勿在正文其他地方提及代码指令本身。`;

      payload.hint = (payload.hint || "") + promptAddition;
      return payload;
    });

    if (ctx.system.settings.onChange) {
      settingsUnsubscribe = ctx.system.settings.onChange(() => {
        rerenderAll();
      });
    }

    return () => {
      if (settingsUnsubscribe) {
        settingsUnsubscribe();
      }
      rerenderMap.clear();
    };
  },
};
