export default {
  manifest: {
    id: "wechat-style-forward",
    name: "微信式合并转发",
    apiVersion: 1,
    version: "6.6.0",
    author: "倚枫歌",
    description: "最终完美版：发送秒显、列表预览完美、彻底透明化专属气泡。长按单选普通转发，多选合并转发。",
    permissions: ["chat.read"],
    settings: [
      { key: "previewCount", label: "卡片预览条数", type: "number", default: 3 },
      { key: "showTimestamp", label: "显示消息时间", type: "boolean", default: false },
      { key: "bubbleColor", label: "气泡背景色", type: "select", default: "#ffffff", options: [{ value: "#ffffff", label: "白色" }, { value: "#d1f5d3", label: "浅绿" }, { value: "#e8f6e8", label: "极浅绿" }, { value: "#f0f8f0", label: "浅草绿" }, { value: "#f5f5f5", label: "浅灰" }] },
      { key: "headerColor", label: "卡片头部文字颜色", type: "select", default: "#1f2b22", options: [{ value: "#1f2b22", label: "深灰" }, { value: "#2b4a33", label: "深绿" }, { value: "#3d6b46", label: "绿色" }, { value: "#000000", label: "黑色" }] },
      { key: "borderColor", label: "卡片边框颜色", type: "select", default: "#d9ebd9", options: [{ value: "#d9ebd9", label: "浅绿" }, { value: "#cdeecf", label: "淡绿" }, { value: "#e0e0e0", label: "浅灰" }, { value: "#b8d8b8", label: "中绿" }] },
      { key: "excludeCurrent", label: "选择会话时排除当前会话", type: "boolean", default: true },
    ],
  },
  setup(ctx) {
    ctx.ui.injectCSS(`
      .wsf-modal{background:#fff;border-radius:18px;max-width:400px;width:90vw;max-height:70vh;display:flex;flex-direction:column;padding:16px;box-shadow:0 8px 30px rgba(0,0,0,0.15);font-family:sans-serif;color:#1f2b22;}
      .wsf-title{font-size:16px;font-weight:600;color:#2b4a33;margin-bottom:12px;text-align:center;}
      .wsf-list{flex:1;overflow-y:auto;background:#fafdfa;border-radius:12px;border:1px solid #d9ebd9;margin-bottom:12px;min-height:200px;}
      .wsf-item{display:flex;align-items:center;padding:10px 14px;border-bottom:1px solid #edf5ed;cursor:pointer;font-size:14px;}
      .wsf-item:last-child{border-bottom:none;} .wsf-item:hover{background:#e8f6e8;}
      .wsf-check{width:20px;height:20px;border-radius:50%;border:2px solid #b8d8b8;margin-right:12px;display:flex;align-items:center;justify-content:center;flex-shrink:0;background:#fff;}
      .wsf-check.checked{background:#7ecb89;border-color:#7ecb89;} .wsf-check.checked::after{content:"✓";color:#fff;font-size:14px;font-weight:bold;}
      .wsf-content{flex:1;display:flex;flex-direction:column;min-width:0;}
      .wsf-role{font-size:11px;color:#8aa792;margin-bottom:2px;}
      .wsf-text{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:13px;}
      .wsf-time{font-size:10px;color:#a0b8a0;margin-left:8px;white-space:nowrap;flex-shrink:0;}
      .wsf-media{color:#6b8f71;font-style:italic;font-size:12px;}
      .wsf-footer{display:flex;gap:10px;justify-content:flex-end;}
      .wsf-btn{padding:9px 18px;border-radius:16px;border:none;cursor:pointer;font-size:14px;font-weight:500;}
      .wsf-btn-cancel{background:#eef3ee;color:#4a5f4d;} .wsf-btn-send{background:#7ecb89;color:#fff;}
      
      /* 🔥 气泡透明魔法：直接向外穿透杀死背景和小尾巴 */
      .wcf-hide-pseudo::before, .wcf-hide-pseudo::after { display: none !important; content: none !important; }
      .wcf-plugin-container { font-size:14px !important; line-height:normal !important; color:#1f2b22 !important; display:block; text-align:left; }
      
      .wcf-card{background:var(--card-bg,#fff);border:1px solid var(--card-border,#d9ebd9);border-radius:16px;padding:10px 12px;min-width:200px;max-width:280px;cursor:pointer;box-shadow:0 1px 3px rgba(0,0,0,0.06);font-family:sans-serif;}
      .wcf-card-title{font-size:13px;font-weight:600;color:var(--card-header,#1f2b22);margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid rgba(0,0,0,0.05);display:flex;align-items:center;gap:5px;}
      .wcf-card-title .wcf-dot{width:6px;height:6px;border-radius:50%;background:#7ecb89;display:inline-block;flex-shrink:0;}
      .wcf-preview-list{display:flex;flex-direction:column;gap:6px;}
      .wcf-preview-item{display:flex;align-items:baseline;gap:6px;font-size:12px;color:#3d4f42;}
      .wcf-preview-sender{font-weight:500;color:#2b4a33;white-space:nowrap;flex-shrink:0;}
      .wcf-preview-text{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;}
      .wcf-preview-media{color:#6b8f71;font-style:italic;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
      .wcf-more-info{margin-top:6px;font-size:11px;color:#8aa792;text-align:center;}
      
      .wcf-expand-modal{max-width:90vw;width:420px;max-height:80vh;overflow-y:auto;background:#f4fbf4;border-radius:18px;padding:16px;}
      .wcf-expand-title{font-size:16px;font-weight:600;color:#2b4a33;margin-bottom:12px;text-align:center;}
      .wcf-expand-msg{background:#fff;border-radius:12px;padding:10px;margin-bottom:8px;border:1px solid #d9ebd9;text-align:left;}
      .wcf-expand-role{font-size:11px;color:#8aa792;margin-bottom:4px;}
      .wcf-expand-text{white-space:pre-wrap;word-break:break-word;font-size:14px;color:#1f2b22;}
      .wcf-expand-img{max-width:100%;border-radius:10px;cursor:zoom-in;display:block;margin-top:6px;}
    `);

    function getDisplayName(session) {
      if (!session) return "未知会话";
      if (session.isGroup) return session.name || session.groupName || session.topic || "群聊";
      try {
        const chars = ctx.data.characters.list() || [];
        const char = chars.find(c => c.id === (session.characterId || session.contactId));
        if (char && char.name) return char.name;
      } catch (e) {}
      if (session.contactId) {
        try {
          const contacts = ctx.data.contacts.list() || [];
          const contact = contacts.find(c => c.id === session.contactId || c.contactId === session.contactId);
          if (contact && (contact.remark || contact.name || contact.nickname || contact.alias)) return contact.remark || contact.name || contact.nickname || contact.alias;
        } catch (e) {}
      }
      return session.remark || session.alias || session.nickname || session.displayName || session.name || "对方";
    }

    function extractSenderName(msg) {
      if (!msg) return null;
      for (const f of ["senderName", "sender", "senderNickname", "userName", "authorName"]) {
        if (msg[f] && String(msg[f]).trim()) return String(msg[f]).trim();
      }
      if (msg.senderId) {
        try {
          const contacts = ctx.data.contacts.list() || [];
          const c = contacts.find(c => c.id === msg.senderId || c.contactId === msg.senderId);
          if (c && (c.remark || c.name)) return c.remark || c.name;
        } catch (e) {}
      }
      return null;
    }

    function formatTime(timestamp) {
      if (!timestamp) return null;
      try {
        const d = new Date(timestamp), now = new Date();
        const hrs = String(d.getHours()).padStart(2, '0'), mins = String(d.getMinutes()).padStart(2, '0');
        if (d.toDateString() === now.toDateString()) return `${hrs}:${mins}`;
        return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${hrs}:${mins}`;
      } catch (e) { return null; }
    }

    function renderForwardCard(el, forwardData) {
      const messages = Array.isArray(forwardData.messages) ? forwardData.messages : [];
      const settings = ctx.system.settings;
      const previewCount = Number(settings.get("previewCount") || 3);

      let container = el.querySelector('.wcf-plugin-container');
      if (!container) {
        container = document.createElement('div');
        container.className = 'wcf-plugin-container wcf-magic-wrapper';
        el.appendChild(container);
      }
      container.innerHTML = ''; 

      const card = document.createElement('div');
      card.className = 'wcf-card';
      card.style.setProperty('--card-bg', settings.get('bubbleColor') || '#ffffff');
      card.style.setProperty('--card-border', settings.get('borderColor') || '#d9ebd9');
      card.style.setProperty('--card-header', settings.get('headerColor') || '#1f2b22');
      container.appendChild(card);

      const titleDiv = document.createElement('div');
      titleDiv.className = 'wcf-card-title';
      titleDiv.style.color = 'var(--card-header)';
      const dot = document.createElement('span');
      dot.className = 'wcf-dot';
      titleDiv.appendChild(dot);
      titleDiv.appendChild(document.createTextNode(forwardData.title || '聊天记录'));
      card.appendChild(titleDiv);

      const previewList = document.createElement('div');
      previewList.className = 'wcf-preview-list';
      card.appendChild(previewList);

      const showMsgs = previewCount > 0 ? messages.slice(0, previewCount) : messages;
      showMsgs.forEach(m => {
        const item = document.createElement('div');
        item.className = 'wcf-preview-item';
        const sender = document.createElement('span');
        sender.className = 'wcf-preview-sender';
        let displayRole = (forwardData.isGroup && m._senderName) ? m._senderName : (m._displayRole || (m.role === 'user' ? '我' : (m.role === 'assistant' ? '对方' : '系统')));
        sender.textContent = displayRole + ':';
        item.appendChild(sender);

        if (m.content && String(m.content).trim()) {
          const textSpan = document.createElement('span');
          textSpan.className = 'wcf-preview-text';
          const text = String(m.content).replace(/\n/g, ' ');
          textSpan.textContent = text.length > 60 ? text.slice(0, 60) + '…' : text;
          item.appendChild(textSpan);
        } else if (m.mediaType || m.mediaData) {
          const mediaSpan = document.createElement('span');
          mediaSpan.className = 'wcf-preview-media';
          mediaSpan.textContent = '[图片/媒体]';
          item.appendChild(mediaSpan);
        } else {
          const emptySpan = document.createElement('span');
          emptySpan.className = 'wcf-preview-text';
          emptySpan.textContent = '[空消息]';
          item.appendChild(emptySpan);
        }
        previewList.appendChild(item);
      });

      if (messages.length > showMsgs.length) {
        const moreDiv = document.createElement('div');
        moreDiv.className = 'wcf-more-info';
        moreDiv.textContent = `共 ${messages.length} 条，点击查看全部`;
        card.appendChild(moreDiv);
      } else {
        const moreDiv = document.createElement('div');
        moreDiv.className = 'wcf-more-info';
        moreDiv.textContent = '点击查看详情';
        card.appendChild(moreDiv);
      }

      card.addEventListener('click', (e) => {
        e.stopPropagation();
        openExpandModal(messages, forwardData.title || '聊天记录', forwardData.isGroup);
      });

      // 🔥 气泡绝杀：主动寻找父级气泡变透明，并删掉共存的原生文字
      requestAnimationFrame(() => {
        try {
          // 1. 删掉旁边宿主渲染的 "[聊天记录]" 文字
          let p = el.parentElement;
          if (p) {
            p.childNodes.forEach(n => {
              if (n.nodeType === 3 && n.nodeValue.includes('[聊天记录]')) n.nodeValue = '';
            });
          }
          // 2. 向上寻找带有背景色的气泡，直接扒光
          let curr = el;
          for (let i = 0; i < 5; i++) {
            if (!curr) break;
            let bg = window.getComputedStyle(curr).backgroundColor;
            if (bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
              curr.style.setProperty('background', 'transparent', 'important');
              curr.style.setProperty('box-shadow', 'none', 'important');
              curr.style.setProperty('border', 'none', 'important');
              curr.classList.add('wcf-hide-pseudo'); // 隐藏小尾巴
              break; // 扒完最近的气泡就停手，免得误伤页面
            }
            curr = curr.parentElement;
          }
        } catch (e) {}
      });
    }

    function openExpandModal(messages, title, isGroup) {
      ctx.ui.openModal((modalEl, { close }) => {
        modalEl.className = 'wcf-expand-modal';
        const titleEl = document.createElement('div');
        titleEl.className = 'wcf-expand-title';
        titleEl.textContent = title;
        modalEl.appendChild(titleEl);

        const listEl = document.createElement('div');
        modalEl.appendChild(listEl);

        messages.forEach(m => {
          const msgDiv = document.createElement('div');
          msgDiv.className = 'wcf-expand-msg';
          const roleDiv = document.createElement('div');
          roleDiv.className = 'wcf-expand-role';
          let displayRole = (isGroup && m._senderName) ? m._senderName : (m._displayRole || (m.role === 'user' ? '我' : (m.role === 'assistant' ? '对方' : '系统')));
          roleDiv.textContent = displayRole + (m.createdAt ? ' · ' + formatTime(m.createdAt) : '');
          msgDiv.appendChild(roleDiv);

          if (m.content && String(m.content).trim()) {
            const textDiv = document.createElement('div');
            textDiv.className = 'wcf-expand-text';
            textDiv.textContent = String(m.content);
            msgDiv.appendChild(textDiv);
          }

          if (m.mediaType || m.mediaData) {
            const mediaContainer = document.createElement('div');
            mediaContainer.textContent = '加载图片中…';
            msgDiv.appendChild(mediaContainer);
            ctx.data.messages.resolveMedia(m).then(res => {
              if (res && res.category === 'image' && res.dataURL) {
                const img = document.createElement('img');
                img.className = 'wcf-expand-img';
                img.src = res.dataURL;
                img.addEventListener('click', () => {
                  ctx.ui.openModal((imgModal, { close: imgClose }) => {
                    imgModal.style.cssText = 'background:transparent;box-shadow:none;padding:0;';
                    const bigImg = document.createElement('img');
                    bigImg.style.cssText = 'max-width:90vw;max-height:80vh;border-radius:12px;';
                    bigImg.src = res.dataURL;
                    bigImg.addEventListener('click', imgClose);
                    imgModal.appendChild(bigImg);
                  });
                });
                mediaContainer.replaceWith(img);
              } else {
                mediaContainer.textContent = '[暂不支持预览的媒体]';
              }
            }).catch(() => { mediaContainer.textContent = '[媒体加载失败]'; });
          }
          listEl.appendChild(msgDiv);
        });

        const closeBtn = document.createElement('button');
        closeBtn.className = 'wsf-btn wsf-btn-cancel';
        closeBtn.textContent = '关闭';
        closeBtn.style.cssText = 'margin-top:12px;width:100%;';
        closeBtn.addEventListener('click', close);
        modalEl.appendChild(closeBtn);
      });
    }

    function openMultiSelect(sessionId, currentMsgId) {
      ctx.ui.openModal((modalEl, { close }) => {
        modalEl.className = 'wsf-modal';
        const title = document.createElement('div');
        title.className = 'wsf-title';
        title.textContent = '选择要转发的消息';
        modalEl.appendChild(title);

        const listEl = document.createElement('div');
        listEl.className = 'wsf-list';
        modalEl.appendChild(listEl);

        let allMessages = [];
        try { allMessages = ctx.data.messages.list(sessionId) || []; } catch (e) {
          listEl.innerHTML = '<div style="padding:20px;text-align:center;color:#8aa792;">加载消息失败</div>'; return;
        }

        const filtered = allMessages.filter(m => m.mediaType !== 'plugin:wechat-style-forward');
        filtered.sort((a, b) => (a.createdAt || a.timestamp || 0) - (b.createdAt || b.timestamp || 0));

        const selected = new Set();
        if (currentMsgId && filtered.some(m => m.id === currentMsgId)) selected.add(currentMsgId);

        if (filtered.length === 0) {
          listEl.innerHTML = '<div style="padding:20px;text-align:center;color:#8aa792;">没有可转发的消息</div>'; return;
        }

        let sourceSession = null;
        try { sourceSession = ctx.data.sessions.get(sessionId); } catch (e) {}

        let targetItemEl = null;
        filtered.forEach(m => {
          const item = document.createElement('div');
          item.className = 'wsf-item';
          const check = document.createElement('div');
          check.className = 'wsf-check' + (selected.has(m.id) ? ' checked' : '');
          item.appendChild(check);

          const contentDiv = document.createElement('div');
          contentDiv.className = 'wsf-content';
          const roleDiv = document.createElement('div');
          roleDiv.className = 'wsf-role';
          roleDiv.textContent = m.role === 'user' ? '我' : (m.role === 'assistant' ? (sourceSession && sourceSession.isGroup ? (extractSenderName(m) || '群成员') : (sourceSession ? getDisplayName(sourceSession) : '对方')) : '系统');
          contentDiv.appendChild(roleDiv);

          const textDiv = document.createElement('div');
          textDiv.className = 'wsf-text';
          if (m.content && String(m.content).trim()) {
            textDiv.textContent = String(m.content).replace(/\n/g, ' ').slice(0, 80);
          } else if (m.mediaType || m.mediaData) {
            textDiv.className = 'wsf-media';
            textDiv.textContent = '[图片/媒体]';
          } else {
            textDiv.textContent = '[空消息]';
          }
          contentDiv.appendChild(textDiv);

          const timeStr = formatTime(m.createdAt || m.timestamp);
          if (timeStr) {
            const timeSpan = document.createElement('span');
            timeSpan.className = 'wsf-time';
            timeSpan.textContent = timeStr;
            contentDiv.appendChild(timeSpan);
          }

          item.appendChild(contentDiv);
          item.addEventListener('click', () => {
            if (selected.has(m.id)) { selected.delete(m.id); check.classList.remove('checked'); }
            else { selected.add(m.id); check.classList.add('checked'); }
          });
          listEl.appendChild(item);
          if (m.id === currentMsgId) targetItemEl = item;
        });

        if (targetItemEl) setTimeout(() => targetItemEl.scrollIntoView({ block: 'center' }), 50);

        const footer = document.createElement('div');
        footer.className = 'wsf-footer';
        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'wsf-btn wsf-btn-cancel';
        cancelBtn.textContent = '取消';
        cancelBtn.addEventListener('click', close);
        footer.appendChild(cancelBtn);

        const sendBtn = document.createElement('button');
        sendBtn.className = 'wsf-btn wsf-btn-send';
        sendBtn.textContent = '转发';
        sendBtn.addEventListener('click', () => {
          const selectedMsgs = filtered.filter(m => selected.has(m.id));
          if (selectedMsgs.length === 0) { ctx.ui.toast('请至少选择一条消息'); return; }
          close();
          openTargetSelector(selectedMsgs, sourceSession);
        });
        footer.appendChild(sendBtn);
        modalEl.appendChild(footer);
      });
    }

    function openTargetSelector(selectedMsgs, sourceSession) {
      ctx.ui.openModal((modalEl, { close }) => {
        modalEl.className = 'wsf-modal';
        const title = document.createElement('div');
        title.className = 'wsf-title';
        title.textContent = '选择要发送的会话';
        modalEl.appendChild(title);

        const listEl = document.createElement('div');
        listEl.className = 'wsf-list';
        modalEl.appendChild(listEl);

        const excludeCurrent = ctx.system.settings.get('excludeCurrent') === true;
        const currentSessionId = sourceSession ? sourceSession.id : null;

        let sessions = [];
        try { sessions = ctx.data.sessions.list() || []; } catch (e) {
          listEl.innerHTML = '<div style="padding:20px;text-align:center;color:#8aa792;">加载会话失败</div>'; return;
        }

        const filteredSessions = sessions.filter(s => !excludeCurrent || s.id !== currentSessionId);
        if (filteredSessions.length === 0) {
          listEl.innerHTML = '<div style="padding:20px;text-align:center;color:#8aa792;">没有可转发的会话</div>'; return;
        }

        filteredSessions.forEach(session => {
          const item = document.createElement('div');
          item.className = 'wsf-item';
          const contentDiv = document.createElement('div');
          contentDiv.className = 'wsf-content';
          const nameDiv = document.createElement('div');
          nameDiv.className = 'wsf-text';
          nameDiv.textContent = getDisplayName(session);
          contentDiv.appendChild(nameDiv);
          item.appendChild(contentDiv);

          item.addEventListener('click', async () => {
            try {
              const snapshots = selectedMsgs.map(m => {
                const snap = Object.assign({}, m); delete snap.id;
                if (snap.role === 'user') { snap._displayRole = '我'; }
                else if (snap.role === 'assistant') {
                  if (sourceSession && sourceSession.isGroup) {
                    snap._displayRole = extractSenderName(snap) || '群成员';
                    snap._senderName = snap._displayRole;
                  } else { snap._displayRole = sourceSession ? getDisplayName(sourceSession) : '对方'; }
                } else { snap._displayRole = '系统'; }
                return snap;
              });

              let dynamicTitle = '聊天记录';
              if (sourceSession) {
                const peerName = getDisplayName(sourceSession);
                dynamicTitle = sourceSession.isGroup ? peerName + '的聊天记录' : '我与' + peerName + '的聊天记录';
              }

              // 🔥 终极秒显+完美列表预览方案：
              // 使用 plugin: 协议让宿主秒显，同时携带 content 让列表预览完美！
              await ctx.data.messages.push({
                sessionId: session.id,
                role: 'user',
                content: '[聊天记录]', 
                mediaType: 'plugin:wechat-style-forward',
                mediaData: { title: dynamicTitle, createdAt: Date.now(), isGroup: sourceSession ? sourceSession.isGroup : false, messages: snapshots }
              });
              
              ctx.ui.toast('已发送到 ' + getDisplayName(session));
              close();
            } catch (e) { ctx.ui.toast('发送失败：' + (e.message || e)); }
          });
          listEl.appendChild(item);
        });

        const footer = document.createElement('div');
        footer.className = 'wsf-footer';
        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'wsf-btn wsf-btn-cancel';
        cancelBtn.textContent = '取消';
        cancelBtn.addEventListener('click', close);
        footer.appendChild(cancelBtn);
        modalEl.appendChild(footer);
      });
    }

    function openSingleTargetSelector(msg, sourceSession) {
      ctx.ui.openModal((modalEl, { close }) => {
        modalEl.className = 'wsf-modal';
        const title = document.createElement('div');
        title.className = 'wsf-title';
        title.textContent = '选择要发送的会话';
        modalEl.appendChild(title);

        const listEl = document.createElement('div');
        listEl.className = 'wsf-list';
        modalEl.appendChild(listEl);

        const excludeCurrent = ctx.system.settings.get('excludeCurrent') === true;
        const currentSessionId = sourceSession ? sourceSession.id : null;

        let sessions = [];
        try { sessions = ctx.data.sessions.list() || []; } catch (e) {}
        const filteredSessions = sessions.filter(s => !excludeCurrent || s.id !== currentSessionId);

        filteredSessions.forEach(session => {
          const item = document.createElement('div');
          item.className = 'wsf-item';
          const contentDiv = document.createElement('div');
          contentDiv.className = 'wsf-content';
          const nameDiv = document.createElement('div');
          nameDiv.className = 'wsf-text';
          nameDiv.textContent = getDisplayName(session);
          contentDiv.appendChild(nameDiv);
          item.appendChild(contentDiv);

          item.addEventListener('click', async () => {
            try {
              await ctx.data.messages.push({
                sessionId: session.id, role: 'user', content: msg.content, mediaType: msg.mediaType, mediaData: msg.mediaData
              });
              ctx.ui.toast('已转发到 ' + getDisplayName(session));
              close();
            } catch (e) { ctx.ui.toast('转发失败：' + (e.message || e)); }
          });
          listEl.appendChild(item);
        });

        const footer = document.createElement('div');
        footer.className = 'wsf-footer';
        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'wsf-btn wsf-btn-cancel';
        cancelBtn.textContent = '取消';
        cancelBtn.addEventListener('click', close);
        footer.appendChild(cancelBtn);
        modalEl.appendChild(footer);
      });
    }

    // ---------- 注册 UI 扩展 ----------
    // 接管 plugin:wechat-style-forward 的渲染，实现秒出
    ctx.ui.messageKind('wechat-style-forward', (el, msg) => {
      try { if (msg.mediaData) renderForwardCard(el, msg.mediaData); } catch (e) {}
    });

    ctx.ui.messageAction({
      id: 'wechat-style-forward.multi-select',
      label: '多选',
      filter: (msg) => !(msg && msg.mediaType === 'plugin:wechat-style-forward'),
      onSelect: (msg) => {
        if (!msg || !msg.sessionId) { ctx.ui.toast('无法获取消息会话'); return; }
        openMultiSelect(msg.sessionId, msg.id);
      }
    });

    ctx.ui.messageAction({
      id: 'wechat-style-forward.forward-single',
      label: '转发',
      filter: (msg) => !(msg && msg.mediaType === 'plugin:wechat-style-forward'),
      onSelect: (msg) => {
        if (!msg || !msg.sessionId) { ctx.ui.toast('无法获取消息会话'); return; }
        let sourceSession = null;
        try { sourceSession = ctx.data.sessions.get(msg.sessionId); } catch (e) {}
        openSingleTargetSelector(msg, sourceSession);
      }
    });
  }
};