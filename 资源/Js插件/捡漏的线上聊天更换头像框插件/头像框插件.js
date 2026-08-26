export default {
  manifest: {
    id: "avatar-frame-customizer-pro",
    name: "头像框更换工具 Pro",
    apiVersion: 1,
    version: "2.7.5",
    author: "倚枫歌",
    description: "为角色和用户分别设置配套头像框，支持预设管理、按角色分配、折叠面板，修复多会话刷新与顶部遮挡",
    permissions: [],
    settings: [],
  },

  setup(ctx) {
    const DEFAULT_FRAME_STYLE = {
      url: "",
      size: 110,
      offsetX: 0,
      offsetY: 0,
      opacity: 100,
    };

    const MIN_SIZE = 50, MAX_SIZE = 250;
    const MIN_OFFSET = -80, MAX_OFFSET = 80;
    const MAX_FILE_SIZE = 3 * 1024 * 1024;

    let config = {
      presets: [],
      assignments: {},
      defaultPresetId: null,
    };

    let settingsSlotCleanup = null;
    let sessionCharCache = new Map();
    let settingsCollapsed = false;
    let observer = null;
    let scrollHandler = null;
    let scrollTimer = null;

    /* ================= 存储读写 ================= */
    function loadConfig() {
      try {
        const saved = ctx.system.storage.get("avatarFrameProConfig");
        if (saved && typeof saved === "object") {
          config.presets = Array.isArray(saved.presets) ? saved.presets : [];
          config.assignments = saved.assignments && typeof saved.assignments === "object" ? saved.assignments : {};
          config.defaultPresetId = saved.defaultPresetId || null;
          config.presets.forEach(p => {
            p.char = { ...DEFAULT_FRAME_STYLE, ...(p.char || {}) };
            p.user = { ...DEFAULT_FRAME_STYLE, ...(p.user || {}) };
            p.char.size = Number(p.char.size) || DEFAULT_FRAME_STYLE.size;
            p.char.offsetX = Number(p.char.offsetX) || 0;
            p.char.offsetY = Number(p.char.offsetY) || 0;
            p.char.opacity = Number(p.char.opacity) || 100;
            p.user.size = Number(p.user.size) || DEFAULT_FRAME_STYLE.size;
            p.user.offsetX = Number(p.user.offsetX) || 0;
            p.user.offsetY = Number(p.user.offsetY) || 0;
            p.user.opacity = Number(p.user.opacity) || 100;
          });
        }
        settingsCollapsed = ctx.system.storage.get("avatarFrameSettingsCollapsed") === true;
      } catch (e) {
        ctx.system.log("加载配置失败:", e);
      }
    }

    function saveConfig() {
      try {
        ctx.system.storage.set("avatarFrameProConfig", config);
      } catch (e) {
        ctx.system.log("保存配置失败:", e);
      }
    }

    function saveCollapsedState() {
      try {
        ctx.system.storage.set("avatarFrameSettingsCollapsed", settingsCollapsed);
      } catch (e) {}
    }

    function generateId() {
      return 'p_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
    }

    /* ================= 生成动态CSS ================= */
    function generateFrameCSS() {
      let css = '';

      css += `
.chat-msg-wrapper[data-avatar-frame-char] .chat-msg-avatar,
.chat-msg-wrapper[data-avatar-frame-user] .chat-msg-avatar {
  position: relative !important;
  overflow: visible !important;
}
`;

      config.presets.forEach(p => {
        if (!p.id) return;
        if (p.char.url) {
          css += `
.chat-msg-wrapper[data-avatar-frame-char="${p.id}"] .chat-msg-avatar::after {
  content: '';
  position: absolute;
  left: calc(50% + ${p.char.offsetX}px);
  top: calc(50% + ${p.char.offsetY}px);
  width: ${p.char.size}%;
  height: ${p.char.size}%;
  transform: translate(-50%, -50%);
  background-image: url('${p.char.url.replace(/'/g, "\\'")}');
  background-size: contain;
  background-repeat: no-repeat;
  background-position: center;
  opacity: ${p.char.opacity / 100};
  pointer-events: none;
  z-index: 999;
}`;
        }
        if (p.user.url) {
          css += `
.chat-msg-wrapper[data-avatar-frame-user="${p.id}"] .chat-msg-avatar::after {
  content: '';
  position: absolute;
  left: calc(50% + ${p.user.offsetX}px);
  top: calc(50% + ${p.user.offsetY}px);
  width: ${p.user.size}%;
  height: ${p.user.size}%;
  transform: translate(-50%, -50%);
  background-image: url('${p.user.url.replace(/'/g, "\\'")}');
  background-size: contain;
  background-repeat: no-repeat;
  background-position: center;
  opacity: ${p.user.opacity / 100};
  pointer-events: none;
  z-index: 999;
}`;
        }
      });

      return css;
    }

    let styleElement = null;
    function applyFrameCSS() {
      if (!styleElement) {
        styleElement = document.createElement('style');
        styleElement.id = 'avatar-frame-pro-dynamic-style';
        document.head.appendChild(styleElement);
      }
      styleElement.textContent = generateFrameCSS();
    }

    function removeFrameCSS() {
      if (styleElement && styleElement.parentNode) {
        styleElement.remove();
      }
      styleElement = null;
    }

    /* ================= 判断角色并设置 data 属性（含严格区域检测） ================= */
    function applyFrameToWrapper(wrapper) {
      if (!wrapper) return;

      const avatarContainer = wrapper.querySelector('.chat-msg-avatar');
      if (!avatarContainer) return;

      // 获取滚动容器
      const scrollContainer = document.querySelector('.chat-scroll-anchored');
      if (!scrollContainer) return;

      const containerRect = scrollContainer.getBoundingClientRect();
      const wrapperRect = wrapper.getBoundingClientRect();

      // 如果消息完全在滚动容器之外（顶部或底部），移除头像框
      if (wrapperRect.bottom <= containerRect.top || wrapperRect.top >= containerRect.bottom) {
        removeFrameFromWrapper(wrapper);
        return;
      }

      // 检查头像是否可见（连续发言隐藏头像时，头像容器可能被隐藏或尺寸为0）
      const avatarRect = avatarContainer.getBoundingClientRect();
      const avatarVisible = avatarRect.width > 0 && avatarRect.height > 0 && avatarContainer.offsetParent !== null;

      // 清除已有标记
      delete wrapper.dataset.avatarFrameChar;
      delete wrapper.dataset.avatarFrameUser;

      // 如果头像不可见，直接返回
      if (!avatarVisible) return;

      // ========== 顶部遮挡检测：覆盖所有可能的顶部元素 ==========
      const topSelectors = [
        '.page-header',
        '.chat-header',
        '.page-title',
        '.chat-room-wrapper > .page-header',
        '.chat-room-wrapper > .chat-header',
        '.top-bar',
        '[class*="header"]'
      ];

      for (const selector of topSelectors) {
        const topElement = document.querySelector(selector);
        if (topElement) {
          const topRect = topElement.getBoundingClientRect();
          // 如果头像容器与顶部元素在垂直方向上有重叠
          if (avatarRect.bottom > topRect.top && avatarRect.top < topRect.bottom) {
            removeFrameFromWrapper(wrapper);
            return;
          }
        }
      }

      // ========== 底部输入栏遮挡检测 ==========
      const inputBar = document.querySelector('.chat-input-bar');
      if (inputBar) {
        const inputRect = inputBar.getBoundingClientRect();
        if (avatarRect.top < inputRect.bottom && avatarRect.bottom > inputRect.top) {
          removeFrameFromWrapper(wrapper);
          return;
        }
      }

      // 判断角色
      let role = null;
      if (wrapper.querySelector('.chat-bubble-role-user')) role = 'user';
      else if (wrapper.querySelector('.chat-bubble-role-assistant')) role = 'assistant';
      if (!role && wrapper.querySelector('.chat-offline-entry[data-role="user"]')) role = 'user';
      if (!role && wrapper.querySelector('.chat-offline-entry[data-role="assistant"]')) role = 'assistant';
      if (!role && wrapper.dataset.role) role = wrapper.dataset.role;
      
      if (!role) {
        const parent = avatarContainer.parentElement;
        if (parent && (parent.classList.contains('chat-msg-wrapper-user') || parent.classList.contains('user'))) role = 'user';
        else if (parent && (parent.classList.contains('chat-msg-wrapper-assistant') || parent.classList.contains('assistant'))) role = 'assistant';
      }
      if (!role) return;

      let presetId = null;

      if (role === 'assistant') {
        const charId = wrapper.dataset.characterId || wrapper.getAttribute('data-character-id');
        if (charId && config.assignments[charId]) {
          presetId = config.assignments[charId];
        } else if (config.defaultPresetId) {
          presetId = config.defaultPresetId;
        }
        if (presetId && config.presets.find(p => p.id === presetId)?.char.url) {
          wrapper.dataset.avatarFrameChar = presetId;
        }
      } else if (role === 'user') {
        const sessionContainer = wrapper.closest('[data-session-id]');
        const sessionId = sessionContainer?.dataset.sessionId;
        if (sessionId) {
          const charId = sessionCharCache.get(sessionId);
          if (charId && config.assignments[charId]) {
            presetId = config.assignments[charId];
          } else if (config.defaultPresetId) {
            presetId = config.defaultPresetId;
          }
        } else if (config.defaultPresetId) {
          presetId = config.defaultPresetId;
        }
        if (presetId && config.presets.find(p => p.id === presetId)?.user.url) {
          wrapper.dataset.avatarFrameUser = presetId;
        }
      }
    }

    function removeFrameFromWrapper(wrapper) {
      const avatarContainer = wrapper.querySelector('.chat-msg-avatar');
      if (avatarContainer) {
        const old = avatarContainer.querySelector('.afc-frame-overlay');
        if (old) old.remove();
        if (avatarContainer.style.position === 'relative') {
          avatarContainer.style.position = '';
        }
      }
      delete wrapper.dataset.avatarFrameChar;
      delete wrapper.dataset.avatarFrameUser;
    }

    /* ================= 扫描所有消息 ================= */
    function scanAndApplyAll() {
      document.querySelectorAll('.chat-msg-wrapper').forEach(applyFrameToWrapper);
    }

    /* ================= MutationObserver（轻量） ================= */
    function startObserver() {
      if (observer) return;
      const targetNode = document.querySelector('.chat-scroll-anchored') || document.body;
      observer = new MutationObserver((mutations) => {
        clearTimeout(observer._timer);
        observer._timer = setTimeout(() => {
          const addedWrappers = new Set();
          mutations.forEach(mutation => {
            if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
              mutation.addedNodes.forEach(node => {
                if (node.nodeType === 1) {
                  if (node.classList?.contains('chat-msg-wrapper')) {
                    addedWrappers.add(node);
                  } else {
                    node.querySelectorAll?.('.chat-msg-wrapper').forEach(w => addedWrappers.add(w));
                  }
                }
              });
            }
          });
          addedWrappers.forEach(applyFrameToWrapper);
        }, 200);
      });
      observer.observe(targetNode, { childList: true, subtree: true });
    }

    function stopObserver() {
      if (observer) {
        clearTimeout(observer._timer);
        observer.disconnect();
        observer = null;
      }
    }

    /* ================= 滚动监听（滚动区域边界检测） ================= */
    function startScrollListener() {
      if (scrollHandler) return;
      scrollHandler = () => {
        if (scrollTimer) clearTimeout(scrollTimer);
        scrollTimer = setTimeout(() => {
          scanAndApplyAll();
        }, 150);
      };
      const scrollContainer = document.querySelector('.chat-scroll-anchored');
      if (scrollContainer) {
        scrollContainer.addEventListener('scroll', scrollHandler);
      }
      window.addEventListener('scroll', scrollHandler, true);
    }

    function stopScrollListener() {
      if (scrollHandler) {
        const scrollContainer = document.querySelector('.chat-scroll-anchored');
        if (scrollContainer) {
          scrollContainer.removeEventListener('scroll', scrollHandler);
        }
        window.removeEventListener('scroll', scrollHandler, true);
        scrollHandler = null;
      }
      if (scrollTimer) {
        clearTimeout(scrollTimer);
        scrollTimer = null;
      }
    }

    /* ================= 设置界面（保持不变） ================= */
    ctx.ui.injectCSS(`
      .afc-pro-settings { font-family: 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif; padding: 16px 18px; max-width: 680px; }
      .afc-pro-settings .afc-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
      .afc-pro-settings h3 { font-size: 20px; font-weight: 600; margin: 0; color: #e0e0e0; display: flex; align-items: center; gap: 8px; }
      .afc-pro-settings h3::before { content: '🎨'; font-size: 22px; }
      .afc-collapse-btn { background: transparent; border: 1px solid #555; color: #ccc; border-radius: 6px; padding: 5px 12px; cursor: pointer; font-size: 13px; }
      .afc-collapse-btn:hover { background: #333; }
      .afc-pro-content.collapsed { display: none; }
      .afc-pro-section { margin-bottom: 20px; border: 1px solid #2a2a4a; border-radius: 12px; padding: 16px; background: rgba(255,255,255,0.02); }
      .afc-pro-section-title { font-size: 15px; font-weight: 600; color: #ccc; margin-bottom: 12px; }
      .afc-pro-row { display: flex; flex-direction: column; margin-bottom: 10px; }
      .afc-pro-row label { font-size: 13px; color: #bbb; margin-bottom: 4px; }
      .afc-pro-row input[type="text"], .afc-pro-row textarea { padding: 8px 12px; border-radius: 6px; border: 1px solid #3a3a5a; background: #0d0d1a; color: #e0e0e0; font-size: 13px; outline: none; resize: vertical; }
      .afc-pro-row input[type="range"] { width: 100%; height: 6px; -webkit-appearance: none; background: #2a2a4a; border-radius: 3px; outline: none; }
      .afc-pro-row input[type="range"]::-webkit-slider-thumb { -webkit-appearance: none; width: 16px; height: 16px; border-radius: 50%; background: #667eea; cursor: pointer; }
      .afc-pro-val { color: #8899ee; margin-left: 8px; }
      .afc-pro-preview { display: flex; align-items: center; gap: 20px; margin: 10px 0; padding: 10px; background: rgba(255,255,255,0.03); border-radius: 8px; }
      .afc-pro-preview-item { display: flex; flex-direction: column; align-items: center; gap: 6px; }
      .afc-pro-preview-avatar-wrapper { position: relative; width: 60px; height: 60px; }
      .afc-pro-preview-avatar { width: 100%; height: 100%; border-radius: 50%; background: #aaa; display: flex; align-items: center; justify-content: center; font-size: 24px; }
      .afc-pro-preview-frame { position: absolute; left: 50%; top: 50%; width: 100%; height: 100%; transform: translate(-50%, -50%); background-size: contain; background-repeat: no-repeat; background-position: center; pointer-events: none; }
      .afc-pro-btn { padding: 6px 12px; border-radius: 6px; border: none; cursor: pointer; font-size: 13px; color: #fff; }
      .afc-pro-btn-primary { background: #667eea; }
      .afc-pro-btn-danger { background: #a33; }
      .afc-pro-btn-outline { background: transparent; border: 1px solid #555; color: #ccc; }
      .afc-pro-preset-item { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; background: rgba(255,255,255,0.03); border-radius: 8px; margin-bottom: 8px; }
      .afc-pro-assign-row { display: flex; align-items: center; gap: 10px; padding: 6px 0; border-bottom: 1px solid #222; }
      .afc-pro-select { padding: 5px 8px; border-radius: 5px; border: 1px solid #3a3a5a; background: #0d0d1a; color: #e0e0e0; font-size: 12px; outline: none; }
      .afc-pro-file-input-wrapper { position: relative; display: inline-block; }
      .afc-pro-file-input-wrapper input[type="file"] { position: absolute; opacity: 0; width: 100%; height: 100%; cursor: pointer; }
      .afc-pro-file-btn { display: inline-block; padding: 6px 12px; background: #2a2a4a; color: #ccc; border-radius: 4px; cursor: pointer; font-size: 12px; }
    `);

    // 设置界面渲染（保持不变）
    settingsSlotCleanup = ctx.ui.slot("settings.section", (el, props) => {
      el.innerHTML = "";
      const container = document.createElement("div");
      container.className = "afc-pro-settings";

      const header = document.createElement("div");
      header.className = "afc-header";
      const title = document.createElement("h3");
      title.textContent = "头像框 Pro 管理";
      const collapseBtn = document.createElement("button");
      collapseBtn.className = "afc-collapse-btn";
      collapseBtn.textContent = settingsCollapsed ? "展开" : "收起";
      header.appendChild(title);
      header.appendChild(collapseBtn);
      container.appendChild(header);

      const contentDiv = document.createElement("div");
      contentDiv.className = "afc-pro-content" + (settingsCollapsed ? " collapsed" : "");
      container.appendChild(contentDiv);

      // 预设管理
      const presetsSection = document.createElement("div");
      presetsSection.className = "afc-pro-section";
      presetsSection.innerHTML = '<div class="afc-pro-section-title">📦 预设管理</div>';
      const presetsList = document.createElement("div");
      presetsSection.appendChild(presetsList);
      const addPresetBtn = document.createElement("button");
      addPresetBtn.className = "afc-pro-btn afc-pro-btn-primary";
      addPresetBtn.textContent = "+ 新建预设";
      addPresetBtn.addEventListener("click", () => createPresetEditor(null));
      presetsSection.appendChild(addPresetBtn);
      contentDiv.appendChild(presetsSection);

      // 角色卡分配
      const assignSection = document.createElement("div");
      assignSection.className = "afc-pro-section";
      assignSection.innerHTML = '<div class="afc-pro-section-title">👥 角色卡分配</div>';
      const assignList = document.createElement("div");
      assignSection.appendChild(assignList);

      const defaultRow = document.createElement("div");
      defaultRow.className = "afc-pro-row";
      defaultRow.innerHTML = '<label>默认预设（未分配时使用）</label>';
      const defaultSelect = document.createElement("select");
      defaultSelect.className = "afc-pro-select";
      defaultSelect.innerHTML = '<option value="">无</option>';
      config.presets.forEach(p => {
        const opt = document.createElement("option");
        opt.value = p.id;
        opt.textContent = p.name;
        if (config.defaultPresetId === p.id) opt.selected = true;
        defaultSelect.appendChild(opt);
      });
      defaultSelect.addEventListener("change", () => {
        config.defaultPresetId = defaultSelect.value || null;
        saveConfig();
        applyFrameCSS();
        scanAndApplyAll();
        renderDefaultSelect();
      });
      defaultRow.appendChild(defaultSelect);
      assignSection.appendChild(defaultRow);
      assignSection.appendChild(assignList);
      contentDiv.appendChild(assignSection);

      el.appendChild(container);

      collapseBtn.addEventListener("click", () => {
        settingsCollapsed = !settingsCollapsed;
        saveCollapsedState();
        contentDiv.classList.toggle("collapsed", settingsCollapsed);
        collapseBtn.textContent = settingsCollapsed ? "展开" : "收起";
      });

      function renderPresetsList() {
        presetsList.innerHTML = "";
        if (config.presets.length === 0) {
          presetsList.innerHTML = '<div style="color:#777;font-size:13px;padding:8px;">暂无预设</div>';
          return;
        }
        config.presets.forEach(p => {
          const item = document.createElement("div");
          item.className = "afc-pro-preset-item";
          const nameSpan = document.createElement("span");
          nameSpan.textContent = p.name;
          const actions = document.createElement("span");
          actions.style.display = "flex";
          actions.style.gap = "8px";
          const editBtn = document.createElement("button");
          editBtn.className = "afc-pro-btn afc-pro-btn-outline";
          editBtn.textContent = "编辑";
          editBtn.addEventListener("click", () => createPresetEditor(p.id));
          const deleteBtn = document.createElement("button");
          deleteBtn.className = "afc-pro-btn afc-pro-btn-danger";
          deleteBtn.textContent = "删除";
          deleteBtn.addEventListener("click", () => {
            if (confirm(`删除预设 "${p.name}"？`)) {
              config.presets = config.presets.filter(x => x.id !== p.id);
              Object.keys(config.assignments).forEach(cid => {
                if (config.assignments[cid] === p.id) delete config.assignments[cid];
              });
              if (config.defaultPresetId === p.id) config.defaultPresetId = null;
              saveConfig();
              applyFrameCSS();
              renderPresetsList();
              renderAssignList();
              renderDefaultSelect();
              scanAndApplyAll();
            }
          });
          actions.appendChild(editBtn);
          actions.appendChild(deleteBtn);
          item.appendChild(nameSpan);
          item.appendChild(actions);
          presetsList.appendChild(item);
        });
      }

      function renderAssignList() {
        assignList.innerHTML = "";
        const characters = ctx.data.characters.list();
        characters.forEach(char => {
          const row = document.createElement("div");
          row.className = "afc-pro-assign-row";
          const nameSpan = document.createElement("span");
          nameSpan.className = "char-name";
          nameSpan.textContent = char.name || char.id;
          const select = document.createElement("select");
          select.className = "afc-pro-select";
          select.innerHTML = '<option value="">跟随默认</option>';
          config.presets.forEach(p => {
            const opt = document.createElement("option");
            opt.value = p.id;
            opt.textContent = p.name;
            if (config.assignments[char.id] === p.id) opt.selected = true;
            select.appendChild(opt);
          });
          if (config.assignments[char.id] && !config.presets.find(p => p.id === config.assignments[char.id])) {
            const opt = document.createElement("option");
            opt.value = config.assignments[char.id];
            opt.textContent = "（已删除）";
            opt.selected = true;
            opt.disabled = true;
            select.appendChild(opt);
          }
          select.addEventListener("change", () => {
            if (select.value === "") {
              delete config.assignments[char.id];
            } else {
              config.assignments[char.id] = select.value;
            }
            saveConfig();
            scanAndApplyAll();
          });
          row.appendChild(nameSpan);
          row.appendChild(select);
          assignList.appendChild(row);
        });
      }

      function renderDefaultSelect() {
        defaultSelect.innerHTML = '<option value="">无</option>';
        config.presets.forEach(p => {
          const opt = document.createElement("option");
          opt.value = p.id;
          opt.textContent = p.name;
          if (config.defaultPresetId === p.id) opt.selected = true;
          defaultSelect.appendChild(opt);
        });
      }

      function createPresetEditor(presetId) {
        const editingPreset = presetId ? config.presets.find(p => p.id === presetId) : null;
        const isNew = !editingPreset;
        const tempPreset = {
          id: editingPreset ? editingPreset.id : generateId(),
          name: editingPreset ? editingPreset.name : "新预设",
          char: { ...DEFAULT_FRAME_STYLE, ...(editingPreset?.char || {}) },
          user: { ...DEFAULT_FRAME_STYLE, ...(editingPreset?.user || {}) },
        };

        ctx.ui.openModal((modalEl, { close }) => {
          modalEl.innerHTML = "";
          const editorContainer = document.createElement("div");
          editorContainer.style.padding = "24px";
          editorContainer.style.maxWidth = "600px";
          editorContainer.style.width = "90vw";
          editorContainer.style.maxHeight = "85vh";
          editorContainer.style.overflowY = "auto";

          const editorTitle = document.createElement("h3");
          editorTitle.textContent = isNew ? "新建预设" : `编辑预设：${tempPreset.name}`;
          editorContainer.appendChild(editorTitle);

          const nameRow = document.createElement("div");
          nameRow.className = "afc-pro-row";
          nameRow.innerHTML = '<label>预设名称</label>';
          const nameInput = document.createElement("input");
          nameInput.type = "text";
          nameInput.value = tempPreset.name;
          nameRow.appendChild(nameInput);
          editorContainer.appendChild(nameRow);

          function createFrameEditor(roleLabel, frameObj) {
            const wrapper = document.createElement("div");
            wrapper.style.border = "1px solid #333";
            wrapper.style.borderRadius = "8px";
            wrapper.style.padding = "12px";
            wrapper.style.marginBottom = "16px";
            wrapper.innerHTML = `<strong>${roleLabel}</strong>`;

            const previewDiv = document.createElement("div");
            previewDiv.className = "afc-pro-preview";
            const previewItem = document.createElement("div");
            previewItem.className = "afc-pro-preview-item";
            previewItem.innerHTML = `<span class="label">${roleLabel}</span>`;
            const avatarWrapper = document.createElement("div");
            avatarWrapper.className = "afc-pro-preview-avatar-wrapper";
            const avatar = document.createElement("div");
            avatar.className = "afc-pro-preview-avatar";
            avatar.textContent = roleLabel.includes("角色") ? "🤖" : "👤";
            const frameOverlay = document.createElement("div");
            frameOverlay.className = "afc-pro-preview-frame";
            avatarWrapper.appendChild(avatar);
            avatarWrapper.appendChild(frameOverlay);
            previewItem.appendChild(avatarWrapper);
            previewDiv.appendChild(previewItem);
            wrapper.appendChild(previewDiv);

            function updatePreview() {
              frameOverlay.style.backgroundImage = frameObj.url ? `url('${frameObj.url.replace(/'/g, "\\'")}')` : 'none';
              frameOverlay.style.width = `${frameObj.size}%`;
              frameOverlay.style.height = `${frameObj.size}%`;
              frameOverlay.style.left = `calc(50% + ${frameObj.offsetX}px)`;
              frameOverlay.style.top = `calc(50% + ${frameObj.offsetY}px)`;
              frameOverlay.style.opacity = frameObj.opacity / 100;
            }
            updatePreview();

            const urlRow = document.createElement("div");
            urlRow.className = "afc-pro-row";
            urlRow.innerHTML = '<label>图片链接</label>';
            const urlInput = document.createElement("textarea");
            urlInput.rows = 2;
            urlInput.value = frameObj.url;
            urlInput.addEventListener("input", () => {
              frameObj.url = urlInput.value.trim();
              updatePreview();
            });
            urlRow.appendChild(urlInput);
            wrapper.appendChild(urlRow);

            const uploadWrapper = document.createElement("div");
            uploadWrapper.className = "afc-pro-file-input-wrapper";
            const fileInput = document.createElement("input");
            fileInput.type = "file";
            fileInput.accept = "image/*";
            const fileBtn = document.createElement("span");
            fileBtn.className = "afc-pro-file-btn";
            fileBtn.textContent = "📁 本地上传";
            uploadWrapper.appendChild(fileInput);
            uploadWrapper.appendChild(fileBtn);
            fileInput.addEventListener("change", () => {
              const file = fileInput.files[0];
              if (!file) return;
              if (file.size > MAX_FILE_SIZE) {
                ctx.ui.toast("文件过大，请选择小于3MB的图片");
                return;
              }
              const reader = new FileReader();
              reader.onload = e => {
                frameObj.url = e.target.result;
                urlInput.value = frameObj.url;
                updatePreview();
                ctx.ui.toast("图片已读取");
              };
              reader.readAsDataURL(file);
              fileInput.value = "";
            });
            wrapper.appendChild(uploadWrapper);

            function addSlider(label, key, min, max, step, value, suffix) {
              const row = document.createElement("div");
              row.className = "afc-pro-row";
              row.innerHTML = `<label>${label} <span class="afc-pro-val">${value}${suffix}</span></label>`;
              const slider = document.createElement("input");
              slider.type = "range";
              slider.min = String(min);
              slider.max = String(max);
              slider.step = String(step);
              slider.value = String(value);
              slider.addEventListener("input", () => {
                const val = Number(slider.value);
                frameObj[key] = val;
                row.querySelector('.afc-pro-val').textContent = val + suffix;
                updatePreview();
              });
              row.appendChild(slider);
              wrapper.appendChild(row);
            }

            addSlider("大小 (%)", "size", MIN_SIZE, MAX_SIZE, 1, frameObj.size, "%");
            addSlider("水平偏移 (px)", "offsetX", MIN_OFFSET, MAX_OFFSET, 1, frameObj.offsetX, "px");
            addSlider("垂直偏移 (px)", "offsetY", MIN_OFFSET, MAX_OFFSET, 1, frameObj.offsetY, "px");
            addSlider("透明度 (%)", "opacity", 0, 100, 1, frameObj.opacity, "%");

            return wrapper;
          }

          const charEditor = createFrameEditor("角色 (Char)", tempPreset.char);
          const userEditor = createFrameEditor("用户 (User)", tempPreset.user);
          editorContainer.appendChild(charEditor);
          editorContainer.appendChild(userEditor);

          const saveBtn = document.createElement("button");
          saveBtn.className = "afc-pro-btn afc-pro-btn-primary";
          saveBtn.textContent = "保存预设";
          saveBtn.style.marginTop = "8px";
          saveBtn.addEventListener("click", () => {
            tempPreset.name = nameInput.value.trim() || "未命名预设";
            if (isNew) {
              config.presets.push(tempPreset);
            } else {
              const idx = config.presets.findIndex(p => p.id === tempPreset.id);
              if (idx !== -1) config.presets[idx] = tempPreset;
            }
            saveConfig();
            applyFrameCSS();
            close();
            renderPresetsList();
            renderAssignList();
            renderDefaultSelect();
            scanAndApplyAll();
          });
          editorContainer.appendChild(saveBtn);

          modalEl.appendChild(editorContainer);
        });
      }

      renderPresetsList();
      renderAssignList();
    });

    /* ================= 会话事件：切换联系人时重新扫描 ================= */
    ctx.hooks.on("session.opened", (payload) => {
      const { sessionId, isGroup } = payload;
      if (!isGroup) {
        try {
          const session = ctx.data.sessions.get(sessionId);
          if (session && session.characterId) {
            sessionCharCache.set(sessionId, session.characterId);
          }
        } catch (e) {}
      }
      // 切换会话后，延迟一下等待DOM更新，然后全量扫描
      setTimeout(() => {
        scanAndApplyAll();
      }, 300);
    });

    /* ================= 初始化 ================= */
    loadConfig();
    try {
      const sessions = ctx.data.sessions.list();
      sessions.forEach(s => {
        if (s.id && s.characterId) {
          sessionCharCache.set(s.id, s.characterId);
        }
      });
    } catch (e) {}

    applyFrameCSS();

    setTimeout(() => {
      scanAndApplyAll();
      startObserver();
      startScrollListener();
    }, 500);

    /* ================= 清理 ================= */
    return function cleanup() {
      stopObserver();
      stopScrollListener();
      removeFrameCSS();
      if (typeof settingsSlotCleanup === "function") {
        settingsSlotCleanup();
        settingsSlotCleanup = null;
      }
      sessionCharCache.clear();
    };
  },
};