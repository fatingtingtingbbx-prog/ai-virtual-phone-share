export default {
  manifest: {
    id: "chat-merge-forward",
    name: "合并转发",
    apiVersion: 1,
    version: "1.4.7",
    author: "你",
    description: "长按消息合并转发聊天记录，支持聊天备注名与群聊名称，点击卡片可查看完整记录",
    permissions: ["chat.read", "chat.write", "ui"],
    settings: [
      { key: "includeFullText", label: "附带完整文本给AI", type: "boolean", default: true },
      { key: "maxCardMessages", label: "卡片最多预览条数", type: "number", default: 30 },
    ],
  },
  setup(ctx) {
    const KIND = "forward-card";
    const mediaType = "plugin:" + KIND;

    function safe(fn) {
      try {
        return fn();
      } catch (e) {
        ctx.system.log("合并转发插件错误", e);
      }
    }

    async function resolveVal(v) {
      if (v && typeof v.then === "function") return await v;
      return v;
    }

    // 辅助文本压缩
    function summarizeText(content, limit = 120) {
      if (content == null || content === "") return "[无文本内容]";
      let text;
      if (typeof content === "string") {
        text = content;
      } else if (content.text) {
        text = content.text;
      } else if (content.content) {
        text = content.content;
      } else {
        text = JSON.stringify(content);
      }
      text = String(text).replace(/\s+/g, " ").trim();
      return text.length > limit ? text.slice(0, limit) + "…" : text;
    }

    // 安全解析媒体数据
    function parseMediaData(data) {
      if (typeof data === "string") {
        try {
          return JSON.parse(data);
        } catch {
          return {};
        }
      }
      return data || {};
    }

    // 获取完整文本内容（用于详情弹窗）
    function getFullText(content) {
      if (content == null || content === "") return "[无内容]";
      if (typeof content === "string") return content;
      if (content.text) return content.text;
      if (content.content) return content.content;
      return JSON.stringify(content);
    }

    // 打开聊天记录详情弹窗（点击卡片时触发）
    function openDetailModal(mediaDataRaw) {
      const data = parseMediaData(mediaDataRaw);
      const msgs = Array.isArray(data.messages) ? data.messages : [];
      const sourceTitle = data.sourceTitle || "聊天记录";

      ctx.ui.openModal((el, { close }) => {
        el.innerHTML = "";
        const modal = document.createElement("div");
        modal.style.cssText = `
          display: flex;
          flex-direction: column;
          width: 360px;
          max-width: 92vw;
          max-height: 70vh;
          background: #ffffff;
          border-radius: 12px;
          overflow: hidden;
          box-shadow: 0 8px 30px rgba(0,0,0,0.12);
          font-family: inherit;
        `;

        const header = document.createElement("div");
        header.style.cssText = `
          padding: 14px 16px;
          border-bottom: 1px solid #f0f0f0;
          display: flex;
          align-items: center;
          justify-content: space-between;
          background: #fafafa;
        `;
        const title = document.createElement("div");
        title.style.cssText = "font-weight: 600; font-size: 15px; color: #111827;";
        title.textContent = `${sourceTitle} 的聊天记录`;
        const closeBtn = document.createElement("button");
        closeBtn.textContent = "关闭";
        closeBtn.style.cssText = `
          border: none;
          background: transparent;
          color: #6b7280;
          font-size: 13px;
          cursor: pointer;
          padding: 4px 8px;
          border-radius: 6px;
        `;
        closeBtn.onmouseover = () => (closeBtn.style.background = "#f3f4f6");
        closeBtn.onmouseout = () => (closeBtn.style.background = "transparent");
        closeBtn.onclick = close;
        header.appendChild(title);
        header.appendChild(closeBtn);

        const listContainer = document.createElement("div");
        listContainer.style.cssText = `
          overflow-y: auto;
          padding: 10px 0;
          background: #ffffff;
        `;

        if (msgs.length === 0) {
          const empty = document.createElement("div");
          empty.textContent = "没有可显示的消息";
          empty.style.cssText = "padding: 30px; text-align: center; color: #9ca3af; font-size: 14px;";
          listContainer.appendChild(empty);
        } else {
          msgs.forEach((m) => {
            const row = document.createElement("div");
            row.style.cssText = `
              padding: 8px 16px;
              display: flex;
              flex-direction: column;
              gap: 3px;
              border-bottom: 1px solid #f5f5f5;
            `;
            const name = document.createElement("div");
            name.style.cssText = "font-weight: 600; font-size: 13px; color: #1d4ed8;";
            name.textContent = m.senderName || "未知";
            const content = document.createElement("div");
            content.style.cssText = "font-size: 13px; color: #1f2937; line-height: 1.5; white-space: pre-wrap; word-break: break-word;";
            content.textContent = getFullText(m.content);
            row.appendChild(name);
            row.appendChild(content);
            listContainer.appendChild(row);
          });
        }

        modal.appendChild(header);
        modal.appendChild(listContainer);
        el.appendChild(modal);
      });
    }

    // 1. 注册合并转发卡片渲染
    ctx.ui.messageKind(KIND, (el, msg) => {
      safe(() => {
        el.innerHTML = "";
        const data = parseMediaData(msg.mediaData);
        const msgs = Array.isArray(data.messages) ? data.messages : [];
        const max = Number(ctx.system.settings.get("maxCardMessages") || 30) || 30;
        const count = data.count || msgs.length;
        const sourceTitle = data.sourceTitle || "聊天记录";

        const card = document.createElement("div");
        card.style.cssText = `
          border: 1px solid #e5e7eb;
          border-radius: 8px;
          background: #f9fafb;
          padding: 10px 12px;
          max-width: 100%;
          box-sizing: border-box;
          cursor: pointer;
          transition: background 0.15s;
          position: relative;
          user-select: none;
        `;
        card.onmouseover = () => (card.style.background = "#f3f4f6");
        card.onmouseout = () => (card.style.background = "#f9fafb");
        card.onclick = (e) => {
          e.stopPropagation();
          openDetailModal(data);
        };

        const header = document.createElement("div");
        header.style.cssText = `
          display: flex;
          align-items: center;
          gap: 6px;
          margin-bottom: 6px;
        `;
        const icon = document.createElement("span");
        icon.textContent = "";
        icon.style.cssText = "font-size: 14px;";
        const title = document.createElement("span");
        title.style.cssText = "font-weight: 600; font-size: 13px; color: #111827; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;";
        title.textContent = `${sourceTitle} 的聊天记录`;
        const arrow = document.createElement("span");
        arrow.textContent = "›";
        arrow.style.cssText = "font-size: 18px; color: #9ca3af; line-height: 1;";
        header.appendChild(icon);
        header.appendChild(title);
        header.appendChild(arrow);
        card.appendChild(header);

        const list = document.createElement("div");
        list.style.cssText = "display: flex; flex-direction: column; gap: 4px;";
        const previewMsgs = msgs.slice(0, max);
        previewMsgs.forEach((m) => {
          const row = document.createElement("div");
          row.style.cssText = "font-size: 12px; line-height: 1.4; color: #4b5563; display: flex; gap: 5px;";
          const name = document.createElement("span");
          name.style.cssText = "font-weight: 500; color: #374151; flex-shrink: 0;";
          name.textContent = `${m.senderName || sourceTitle}:`;
          const content = document.createElement("span");
          content.style.cssText = "overflow: hidden; text-overflow: ellipsis; white-space: nowrap;";
          content.textContent = summarizeText(m.content, 100);
          row.appendChild(name);
          row.appendChild(content);
          list.appendChild(row);
        });

        if (msgs.length > max) {
          const more = document.createElement("div");
          more.style.cssText = "font-size: 11px; color: #9ca3af; margin-top: 4px;";
          more.textContent = `还有 ${msgs.length - max} 条…`;
          list.appendChild(more);
        }

        card.appendChild(list);

        const footer = document.createElement("div");
        footer.style.cssText = "font-size: 11px; color: #9ca3af; margin-top: 6px; display: flex; justify-content: space-between;";
        const countLabel = document.createElement("span");
        countLabel.textContent = `共 ${count} 条`;
        footer.appendChild(countLabel);
        card.appendChild(footer);

        el.appendChild(card);
      });
    });

    // 2. 长按消息菜单入口
    ctx.ui.messageAction({
      id: "merge-forward-action",
      label: "合并转发…",
      onSelect: (msg) => {
        safe(() => {
          const sid = msg && (msg.sessionId || msg.session_id);
          if (sid) {
            openForwardModal(sid, msg && msg.id);
          } else {
            ctx.ui.toast("未能定位当前会话", { durationMs: 2000 });
          }
        });
      },
    });

    // 3. 打开转发与多选弹窗
    async function openForwardModal(sourceSessionId, preselectedId) {
      try {
        const [msgsRaw, sessionsRaw, charsRaw, contactsRaw, groupsRaw] = await Promise.all([
          resolveVal(ctx.data.messages?.list ? ctx.data.messages.list(sourceSessionId) : []),
          resolveVal(ctx.data.sessions?.list ? ctx.data.sessions.list() : []),
          resolveVal(ctx.data.characters?.list ? ctx.data.characters.list() : []),
          resolveVal(ctx.data.contacts?.list ? ctx.data.contacts.list() : []),
          resolveVal(ctx.data.groups?.list ? ctx.data.groups.list() : []),
        ]);

        const msgs = Array.isArray(msgsRaw) ? msgsRaw : [];
        const sessions = (Array.isArray(sessionsRaw) ? sessionsRaw : []).filter((s) => s && s.id);
        const characters = Array.isArray(charsRaw) ? charsRaw : [];
        const contacts = Array.isArray(contactsRaw) ? contactsRaw : [];
        const groups = Array.isArray(groupsRaw) ? groupsRaw : [];

        const nameMap = new Map();

        characters.forEach((c) => {
          if (!c || !c.id) return;
          const charName = c.remark || c.alias || c.nickname || c.displayName || c.name;
          if (charName) nameMap.set(c.id, charName);
        });

        contacts.forEach((c) => {
          if (!c || !c.id) return;
          const remarkName = c.remark || c.alias || c.nickname || c.displayName || c.name;
          if (remarkName) {
            nameMap.set(c.id, remarkName);
            if (c.characterId) nameMap.set(c.characterId, remarkName);
            if (c.charId) nameMap.set(c.charId, remarkName);
          }
        });

        const groupMap = new Map();
        groups.forEach((g) => {
          if (!g || !g.id) return;
          const gName = g.remark || g.name || g.title || g.groupName;
          if (gName) groupMap.set(g.id, gName);
        });

        function resolveSessionTitle(s) {
          if (!s) return "当前聊天";
          if (s.isGroup || s.type === "group" || s.groupId) {
            const gid = s.groupId || s.id;
            if (groupMap.has(gid)) return groupMap.get(gid);
            if (s.groupName) return s.groupName;
            if (s.remark) return s.remark;
            if (s.title && s.title !== s.id) return s.title;
            if (s.name && s.name !== s.id) return s.name;
            return "群聊";
          }
          if (s.contactId && nameMap.has(s.contactId)) return nameMap.get(s.contactId);
          if (s.characterId && nameMap.has(s.characterId)) return nameMap.get(s.characterId);
          if (s.targetId && nameMap.has(s.targetId)) return nameMap.get(s.targetId);
          if (nameMap.has(s.id)) return nameMap.get(s.id);
          if (s.remark) return s.remark;
          if (s.title && s.title !== s.id) return s.title;
          if (s.name && s.name !== s.id) return s.name;
          if (s.character && (s.character.remark || s.character.name || s.character.displayName)) {
            return s.character.remark || s.character.name || s.character.displayName;
          }
          return "聊天";
        }

        function resolveMessageSender(m, fallbackTitle) {
          if (!m) return "未知";
          if (m.role === "user") return "我";
          if (m.role === "system") return "系统";

          const selfName = m.remark || m.senderRemark || m.senderName || m.characterName || m.authorName || m.name;
          if (selfName && selfName !== "assistant" && selfName !== "user" && selfName !== "system" && selfName !== "角色") {
            return selfName;
          }

          const cid = m.characterId || m.contactId || m.senderId || m.authorId || m.charId;
          if (cid && nameMap.has(cid)) {
            return nameMap.get(cid);
          }

          if (m.sender && (m.sender.remark || m.sender.displayName || m.sender.name)) {
            return m.sender.remark || m.sender.displayName || m.sender.name;
          }
          if (m.character && (m.character.remark || m.character.displayName || m.character.name)) {
            return m.character.remark || m.character.displayName || m.character.name;
          }

          if (fallbackTitle && fallbackTitle !== "聊天" && fallbackTitle !== "当前聊天" && fallbackTitle !== "群聊") {
            return fallbackTitle;
          }

          return fallbackTitle || "TA";
        }

        if (msgs.length === 0) {
          ctx.ui.toast("当前会话没有可转发的消息", { durationMs: 2000 });
          return;
        }

        if (sessions.length === 0) {
          ctx.ui.toast("没有可转发的目标会话", { durationMs: 2000 });
          return;
        }

        const curSessionObj = sessions.find((s) => s.id === sourceSessionId);
        const sourceTitle = resolveSessionTitle(curSessionObj);

        const selected = new Set();
        if (preselectedId) {
          selected.add(preselectedId);
        } else if (msgs.length > 0) {
          selected.add(msgs[msgs.length - 1].id);
        }

        ctx.ui.openModal((el, { close }) => {
          el.innerHTML = "";

          const modal = document.createElement("div");
          modal.style.cssText = `
            display: flex;
            flex-direction: column;
            gap: 10px;
            width: 340px;
            max-width: 90vw;
            max-height: 80vh;
            overflow-y: auto;
            box-sizing: border-box;
            color: #1f2937;
            font-family: inherit;
            background: #fff;
            padding: 16px;
            border-radius: 12px;
            box-shadow: 0 8px 30px rgba(0,0,0,0.12);
          `;

          const topBar = document.createElement("div");
          topBar.style.cssText = "display: flex; justify-content: space-between; align-items: center;";

          const title = document.createElement("div");
          title.textContent = `转发【${sourceTitle}】的消息`;
          title.style.cssText = "font-weight: 600; font-size: 14px; color: #111827; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 200px;";

          const countLabel = document.createElement("span");
          countLabel.style.cssText = "font-size: 12px; color: #6b7280;";

          topBar.appendChild(title);
          topBar.appendChild(countLabel);
          modal.appendChild(topBar);

          const toolBar = document.createElement("div");
          toolBar.style.cssText = "display: flex; justify-content: space-between; align-items: center;";

          const opGroup = document.createElement("div");
          opGroup.style.cssText = "display: flex; gap: 6px;";

          const selectAllBtn = document.createElement("button");
          selectAllBtn.textContent = "全选";
          selectAllBtn.style.cssText = "font-size: 12px; padding: 4px 10px; border-radius: 6px; border: 1px solid #e5e7eb; background: #f9fafb; cursor: pointer; color: #374151;";
          const clearBtn = document.createElement("button");
          clearBtn.textContent = "清空";
          clearBtn.style.cssText = "font-size: 12px; padding: 4px 10px; border-radius: 6px; border: 1px solid #e5e7eb; background: #f9fafb; cursor: pointer; color: #374151;";

          opGroup.appendChild(selectAllBtn);
          opGroup.appendChild(clearBtn);
          toolBar.appendChild(opGroup);
          modal.appendChild(toolBar);

          const listWrap = document.createElement("div");
          listWrap.style.cssText = `
            max-height: 220px;
            overflow-y: auto;
            border: 1px solid #e5e7eb;
            border-radius: 8px;
            padding: 4px;
            display: flex;
            flex-direction: column;
            gap: 4px;
            background: #fdfdfd;
          `;
          modal.appendChild(listWrap);

          function updateCount() {
            countLabel.textContent = `已选 ${selected.size} / ${msgs.length} 条`;
          }

          function renderList() {
            listWrap.innerHTML = "";
            const fragment = document.createDocumentFragment();

            msgs.forEach((m) => {
              const isChecked = selected.has(m.id);
              const senderName = resolveMessageSender(m, sourceTitle);

              const item = document.createElement("label");
              item.style.cssText = `
                display: flex;
                align-items: flex-start;
                gap: 8px;
                padding: 6px 8px;
                border-radius: 6px;
                cursor: pointer;
                background: ${isChecked ? "#eff6ff" : "#ffffff"};
                border: 1px solid ${isChecked ? "#bfdbfe" : "#f3f4f6"};
              `;

              const checkbox = document.createElement("input");
              checkbox.type = "checkbox";
              checkbox.checked = isChecked;
              checkbox.style.cssText = "margin-top: 3px; cursor: pointer;";
              checkbox.addEventListener("change", () => {
                if (checkbox.checked) selected.add(m.id);
                else selected.delete(m.id);
                renderList();
              });

              const info = document.createElement("div");
              info.style.cssText = "flex: 1; min-width: 0;";

              const head = document.createElement("div");
              head.style.cssText = "font-size: 11px; font-weight: 600; color: #4b5563; margin-bottom: 2px;";
              head.textContent = senderName;

              const body = document.createElement("div");
              body.style.cssText = "font-size: 12px; color: #1f2937; line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;";
              body.textContent = summarizeText(m.content, 120);

              info.appendChild(head);
              info.appendChild(body);
              item.appendChild(checkbox);
              item.appendChild(info);
              fragment.appendChild(item);
            });

            listWrap.appendChild(fragment);
            updateCount();
          }

          selectAllBtn.onclick = () => {
            msgs.forEach((m) => selected.add(m.id));
            renderList();
          };
          clearBtn.onclick = () => {
            selected.clear();
            renderList();
          };

          renderList();

          const targetSection = document.createElement("div");
          targetSection.style.cssText = "display: flex; flex-direction: column; gap: 5px;";

          const targetLabel = document.createElement("div");
          targetLabel.textContent = "转发给：";
          targetLabel.style.cssText = "font-size: 12px; font-weight: 500; color: #4b5563;";

          const select = document.createElement("select");
          select.style.cssText = `
            padding: 8px 10px;
            border-radius: 8px;
            border: 1px solid #d1d5db;
            background: #ffffff;
            font-size: 13px;
            color: #111827;
            outline: none;
          `;

          sessions.forEach((s) => {
            const opt = document.createElement("option");
            opt.value = s.id;
            let label = resolveSessionTitle(s);
            if (s.id === sourceSessionId) {
              label += "（当前聊天）";
            }
            opt.textContent = label;
            select.appendChild(opt);
          });

          targetSection.appendChild(targetLabel);
          targetSection.appendChild(select);
          modal.appendChild(targetSection);

          const footer = document.createElement("div");
          footer.style.cssText = "display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px;";

          const cancelBtn = document.createElement("button");
          cancelBtn.textContent = "取消";
          cancelBtn.style.cssText = `
            padding: 6px 14px;
            border-radius: 8px;
            border: 1px solid #d1d5db;
            background: #ffffff;
            font-size: 13px;
            color: #374151;
            cursor: pointer;
          `;
          cancelBtn.onclick = close;

          const okBtn = document.createElement("button");
          okBtn.textContent = "发送";
          okBtn.style.cssText = `
            padding: 6px 16px;
            border-radius: 8px;
            border: none;
            background: #2563eb;
            color: #ffffff;
            font-size: 13px;
            font-weight: 500;
            cursor: pointer;
          `;
          okBtn.onclick = async () => {
            try {
              const targetSessionId = select.value;
              if (!targetSessionId) {
                ctx.ui.toast("请选择目标会话", { durationMs: 2000 });
                return;
              }

              const chosen = msgs.filter((m) => selected.has(m.id));
              if (chosen.length === 0) {
                ctx.ui.toast("请至少选择一条消息", { durationMs: 2000 });
                return;
              }

              await forwardMessages(sourceSessionId, sourceTitle, targetSessionId, chosen, resolveMessageSender);
              close();
            } catch (e) {
              ctx.system.log("执行合并转发异常", e);
              ctx.ui.toast("转发失败，请查看日志", { durationMs: 2500 });
            }
          };

          footer.appendChild(cancelBtn);
          footer.appendChild(okBtn);
          modal.appendChild(footer);

          el.appendChild(modal);
        });
      } catch (e) {
        ctx.system.log("打开转发窗口失败", e);
        ctx.ui.toast("无法打开转发窗口", { durationMs: 2000 });
      }
    }

    // 4. 执行写入转发消息
    async function forwardMessages(sourceSessionId, sourceTitle, targetSessionId, msgs, resolveSenderFn) {
      const includeFull = ctx.system.settings.get("includeFullText") !== false;

      const lines = msgs
        .map((m, i) => {
          const sender = resolveSenderFn(m, sourceTitle);
          const body = summarizeText(m.content, includeFull ? 2000 : 200);
          return `${i + 1}. [${sender}] ${body}`;
        })
        .join("\n");

      const promptHeader = ` 转发了来自【${sourceTitle}】的 ${msgs.length} 条聊天记录：`;
      const content = includeFull ? `${promptHeader}\n${lines}` : promptHeader;

      const mediaData = {
        sourceSessionId,
        sourceTitle,
        count: msgs.length,
        label: "聊天记录",
        createdAt: Date.now(),
        messages: msgs.map((m) => ({
          id: m.id,
          role: m.role,
          senderName: resolveSenderFn(m, sourceTitle),
          content: m.content,
          timestamp: m.timestamp || m.createdAt || null,
        })),
      };

      const messageToPush = {
        sessionId: targetSessionId,
        role: "user",
        content,
        mediaType,
        mediaData,
      };

      await ctx.data.messages.push(messageToPush);

      // 通知聊天室与主页会话列表刷新（宿主监听该事件）
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("chat-messages-updated", { detail: { sessionId: targetSessionId } })
        );
      }

      ctx.ui.toast(`已转发 ${msgs.length} 条聊天记录`, { durationMs: 2000 });
    }
  },
};
