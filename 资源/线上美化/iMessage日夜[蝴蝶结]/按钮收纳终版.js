export default {
  manifest: {
    id: "collapse-bottom-toolbar",
    name: "聊天底栏按钮收纳",
    apiVersion: 1,
    version: "1.0.3",
    author: "初智齿",
    description: "多开安全版：支持多聊天室无缝切换，通过 WeakMap 独立管理各聊天室状态。",
  },
  setup(ctx) {
    // 1. 注入安全 CSS（保持不变）
    ctx.ui.injectCSS(`
      .chat-input-actions button.chat-btn-folded-hide { display: none !important; }
      .chat-input-actions button.chat-btn-hijacked svg { display: none !important; }
      .chat-input-actions button.chat-btn-hijacked::after {
        content: "⋯"; font-size: 22px; font-weight: bold;
        color: var(--c-text); line-height: 1; margin-top: -4px;
      }
      .chat-folded-popover {
        position: fixed; display: flex; align-items: center; gap: 10px;
        background: var(--c-card, #ffffff); border: 1px solid var(--c-border, rgba(0,0,0,0.12));
        padding: 6px 12px; border-radius: 20px; box-shadow: 0 4px 20px rgba(0, 0, 0, 0.18);
        z-index: 99999; animation: chatFoldedFadeIn 0.15s ease-out; touch-action: manipulation;
      }
      @keyframes chatFoldedFadeIn {
        from { opacity: 0; transform: translateY(6px); }
        to { opacity: 1; transform: translateY(0); }
      }
      .chat-folded-popover button {
        display: inline-flex; align-items: center; justify-content: center;
        background: transparent; border: none; color: var(--c-text);
        cursor: pointer; padding: 6px; border-radius: 8px; width: 36px; height: 36px; flex-shrink: 0;
      }
      .chat-folded-popover button:active { background: var(--c-input, rgba(0,0,0,0.08)); }
      .chat-folded-popover button svg { width: 24px; height: 24px; }
    `);

    let popoverEl = null;
    let bypassClickEl = null; 
    
    // 核心改动：用 WeakMap 记录每个被劫持按钮对应的折叠数据
    const hijackedMap = new WeakMap();

    const closePopover = () => {
      if (popoverEl) {
        popoverEl.remove();
        popoverEl = null;
      }
    };

    // 点击空白处关闭
    const handleGlobalClick = (e) => {
      if (!popoverEl) return;
      if (!popoverEl.contains(e.target) && !e.target.closest(".chat-btn-hijacked")) {
        closePopover();
      }
    };
    document.addEventListener("pointerdown", handleGlobalClick, true);

    // 劫持事件处理
    const captureClickListener = (e) => {
      const btn = e.currentTarget;
      if (bypassClickEl === btn) {
        bypassClickEl = null;
        return; // 放行给 React 去执行原功能
      }
      e.stopPropagation();
      e.preventDefault();

      if (popoverEl) {
        closePopover();
        return; // 如果面板是开的，点击劫持按钮就当是关闭
      }

      // 获取当前这个聊天室专属的收纳数据
      const foldedData = hijackedMap.get(btn);
      if (!foldedData) return;

      // 展开菜单
      const rect = btn.getBoundingClientRect();
      popoverEl = document.createElement("div");
      popoverEl.className = "chat-folded-popover";
      popoverEl.style.bottom = `${window.innerHeight - rect.top + 12}px`;
      popoverEl.style.left = `${Math.max(12, rect.left)}px`;

      foldedData.forEach((data) => {
        const clone = document.createElement("button");
        clone.type = "button";
        clone.title = data.title;
        clone.innerHTML = data.html;
        clone.disabled = data.el.disabled;
        if (data.el.style.opacity) clone.style.opacity = data.el.style.opacity;

        clone.addEventListener("click", (ev) => {
          ev.stopPropagation();
          closePopover();
          if (data.el === btn) {
            bypassClickEl = btn; // 给予免拦截特权
          }
          data.el.click(); 
        });
        popoverEl.appendChild(clone);
      });

      document.body.appendChild(popoverEl);
    };

    const processInputActions = () => {
      // 核心改动：获取所有的输入区域（应对多开或切换）
      const actionBars = document.querySelectorAll(".chat-input-actions");
      
      actionBars.forEach((actionsBar) => {
        const buttons = Array.from(actionsBar.querySelectorAll(":scope > button.ui-bare-btn"));
        if (buttons.length === 0) return;

        const currentFolded = [];
        
        // 分拣按钮
        buttons.forEach((btn) => {
          const title = btn.getAttribute("title") || btn.getAttribute("aria-label") || "";
          const html = btn.innerHTML;
          const isSendOrStop = title.includes("发送") || title.includes("停止") || html.includes("<polygon");
          const isTriggerAI = html.includes("M9.937") || html.includes("M20 3v4");

          if (!isSendOrStop && !isTriggerAI) {
            currentFolded.push({ el: btn, html, title });
          } else {
            // 不应被收纳的按钮，清理掉遗留状态
            btn.classList.remove("chat-btn-folded-hide", "chat-btn-hijacked");
            btn.removeEventListener("click", captureClickListener, true);
          }
        });

        if (currentFolded.length === 0) return;

        // 选第一个被收纳的按钮作为该聊天室的劫持目标
        const targetBtn = currentFolded[0].el;
        hijackedMap.set(targetBtn, currentFolded);

        // 挂载拦截器（先移再加，防止重复绑定）
        targetBtn.removeEventListener("click", captureClickListener, true);
        targetBtn.addEventListener("click", captureClickListener, true);

        // 更新该聊天室下所有按钮的状态
        currentFolded.forEach((data, idx) => {
          if (idx === 0) {
            data.el.classList.add("chat-btn-hijacked");
            data.el.classList.remove("chat-btn-folded-hide");
          } else {
            data.el.classList.add("chat-btn-folded-hide");
            data.el.classList.remove("chat-btn-hijacked");
            data.el.removeEventListener("click", captureClickListener, true); // 其他收纳按钮清理监听
          }
        });
      });
    };

    const observer = new MutationObserver(() => {
      processInputActions();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    processInputActions();

    return () => {
      observer.disconnect();
      document.removeEventListener("pointerdown", handleGlobalClick, true);
      closePopover();
      document.querySelectorAll(".chat-btn-hijacked").forEach(el => {
        el.removeEventListener("click", captureClickListener, true);
        el.classList.remove("chat-btn-hijacked");
      });
      document.querySelectorAll(".chat-btn-folded-hide").forEach(el => {
        el.classList.remove("chat-btn-folded-hide");
      });
    };
  }
};