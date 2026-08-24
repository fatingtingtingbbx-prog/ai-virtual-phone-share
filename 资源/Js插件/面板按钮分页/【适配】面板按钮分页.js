export default {
  manifest: {
    id: "plus-menu-pager",
    name: "面板按钮分页",
    apiVersion: 1,
    version: "1.3.3",
    author: "穆叶",
    description: "把更多功能面板按钮进行分页，支持左右滑动切换，兼容第三方菜单按钮",
    permissions: ["ui.injectCSS", "system.settings"],
    settings: [
      { key: "columns", label: "每页列数", type: "number", default: 4 },
      { key: "rows", label: "每页行数", type: "number", default: 2 },
      { key: "showDots", label: "显示分页指示点", type: "boolean", default: true },
      { key: "swipeThreshold", label: "滑动切换阈值(px)", type: "number", default: 50 },
    ],
  },

  setup(ctx) {
    const settings = ctx.system.settings;

    ctx.ui.injectCSS(`
      .chat-plus-menu[data-plus-pager-applied] {
        display: block !important;
        overflow: hidden !important;
        position: relative !important;
        touch-action: pan-y;
        user-select: none;
        -webkit-user-select: none;
      }
      .chat-plus-menu[data-plus-pager-applied] .plus-menu-pager-track {
        display: flex;
        will-change: transform;
        transition: transform .28s ease;
      }
      .chat-plus-menu[data-plus-pager-applied] .plus-menu-page {
        flex: 0 0 auto;
        display: grid;
        gap: 10px;
        box-sizing: border-box;
      }
      .chat-plus-menu[data-plus-pager-applied] .plus-menu-placeholder {
        visibility: hidden;
        pointer-events: none;
      }
      .chat-plus-menu[data-plus-pager-applied] .plus-menu-pager-dots {
        display: flex;
        justify-content: center;
        gap: 6px;
        padding: 6px 0 2px;
        position: absolute;
        bottom: 4px;
        left: 0;
        right: 0;
        pointer-events: none;
      }
      .chat-plus-menu[data-plus-pager-applied] .plus-menu-pager-dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: var(--c-text, #888);
        opacity: .3;
        transition: opacity .2s;
        pointer-events: auto;
        cursor: pointer;
      }
      .chat-plus-menu[data-plus-pager-applied] .plus-menu-pager-dot.active {
        opacity: .9;
      }
    `);

    function getContentWidth(menu) {
      const style = getComputedStyle(menu);
      const padLeft = parseFloat(style.paddingLeft) || 0;
      const padRight = parseFloat(style.paddingRight) || 0;
      return menu.clientWidth - padLeft - padRight;
    }

    // ---------- 点击抑制逻辑（滑动后短暂阻止误触） ----------
    let suppressClickHandler = null;
    let clickSuppressionTimer = null;

    function suppressNextClick() {
      // 移除旧的捕获器和定时器
      if (suppressClickHandler) {
        document.removeEventListener("click", suppressClickHandler, true);
        suppressClickHandler = null;
      }
      if (clickSuppressionTimer) {
        clearTimeout(clickSuppressionTimer);
        clickSuppressionTimer = null;
      }

      suppressClickHandler = (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        // 清理自身
        document.removeEventListener("click", suppressClickHandler, true);
        suppressClickHandler = null;
        if (clickSuppressionTimer) {
          clearTimeout(clickSuppressionTimer);
          clickSuppressionTimer = null;
        }
      };
      document.addEventListener("click", suppressClickHandler, true);

      // 若指定时间内没有 click，则自动移除捕获器，避免影响后续正常点击
      clickSuppressionTimer = setTimeout(() => {
        if (suppressClickHandler) {
          document.removeEventListener("click", suppressClickHandler, true);
          suppressClickHandler = null;
        }
        clickSuppressionTimer = null;
      }, 350);
    }

    // ---------- 鼠标拖拽状态 ----------
    let activeMouseDragState = null;

    function onDocumentMouseMove(e) {
      if (!activeMouseDragState) return;
      const state = activeMouseDragState;
      const dx = e.clientX - state.startX;
      const dy = e.clientY - state.startY;
      if (!state.moved && (Math.abs(dx) > 5 || Math.abs(dy) > 5)) {
        state.moved = true;
      }
    }

    function onDocumentMouseUp(e) {
      if (!activeMouseDragState) return;
      const state = activeMouseDragState;
      const dx = e.clientX - state.startX;
      const dy = e.clientY - state.startY;

      if (state.moved && Math.abs(dx) > state.threshold && Math.abs(dx) > Math.abs(dy) * 1.5) {
        const total = state.pages.length;
        const canNext = dx < 0 && state.currentPage < total - 1;
        const canPrev = dx > 0 && state.currentPage > 0;
        if (canNext || canPrev) {
          state.currentPage += canNext ? 1 : -1;
          updateDimensions(state.menu);
          suppressNextClick(); // 关键：滑动翻页后抑制下一次点击
        }
      }

      state.isDragging = false;
      activeMouseDragState = null;
    }

    document.addEventListener("mousemove", onDocumentMouseMove);
    document.addEventListener("mouseup", onDocumentMouseUp);

    // ---------- 销毁分页器 ----------
    function destroyPager(menu) {
      if (!menu || !menu.dataset.plusPagerApplied) return;

      const state = menu.__plusPagerState;
      if (state && state.handlers) {
        if (state.handlers.touchstart) menu.removeEventListener("touchstart", state.handlers.touchstart);
        if (state.handlers.touchmove) menu.removeEventListener("touchmove", state.handlers.touchmove);
        if (state.handlers.touchend) menu.removeEventListener("touchend", state.handlers.touchend);
        if (state.handlers.mousedown) menu.removeEventListener("mousedown", state.handlers.mousedown);
      }

      if (state && state.observer) {
        state.observer.disconnect();
      }

      if (activeMouseDragState === state) {
        activeMouseDragState = null;
      }

      const track = menu.querySelector(".plus-menu-pager-track");
      const dots = menu.querySelector(".plus-menu-pager-dots");

      // 从 track 中提取所有真实菜单项（排除占位符），并移回 menu 的尾部
      if (track) {
        const realItems = [];
        Array.from(track.children).forEach((page) => {
          Array.from(page.children).forEach((child) => {
            if (!child.classList.contains("plus-menu-placeholder")) {
              realItems.push(child);
            }
          });
        });
        realItems.forEach((item) => menu.appendChild(item));
        track.remove();
      }

      if (dots) dots.remove();

      delete menu.dataset.plusPagerApplied;
      delete menu.__plusPagerState;
    }

    // ---------- 更新尺寸和位置 ----------
    function updateDimensions(menu) {
      const state = menu.__plusPagerState;
      if (!state) return;

      const width = getContentWidth(menu);
      if (!width) return;

      // 宽度变化时才重新设置轨道和页面宽度，减少强制回流
      if (width !== state.lastWidth) {
        state.track.style.width = width * state.pages.length + "px";
        state.pages.forEach((page) => {
          page.style.width = width + "px";
        });
        state.lastWidth = width;
      }

      state.track.style.transform = `translateX(${-state.currentPage * width}px)`;

      if (state.dots && state.dots.children.length) {
        Array.from(state.dots.children).forEach((dot, i) => {
          dot.classList.toggle("active", i === state.currentPage);
        });
      }
    }

    // ---------- 初始化分页器 ----------
    function initPager(menu) {
      if (!menu) return;

      if (menu.dataset.plusPagerApplied && menu.querySelector(".plus-menu-pager-track")) {
        updateDimensions(menu);
        return;
      }

      if (menu.dataset.plusPagerApplied && !menu.querySelector(".plus-menu-pager-track")) {
        destroyPager(menu);
      }

      // 清理残留 track（正常不会发生）
      const oldTrack = menu.querySelector(".plus-menu-pager-track");
      if (oldTrack) {
        Array.from(oldTrack.children).forEach((page) => {
          Array.from(page.children).forEach((child) => {
            if (!child.classList.contains("plus-menu-placeholder")) {
              menu.appendChild(child);
            }
          });
        });
        oldTrack.remove();
        const dots = menu.querySelector(".plus-menu-pager-dots");
        if (dots) dots.remove();
      }

      // 收集所有直接子元素作为菜单项，排除分页插件自己的 track 和 dots
      const items = Array.from(menu.children).filter((el) => {
        if (el.classList && (el.classList.contains("plus-menu-pager-track") || el.classList.contains("plus-menu-pager-dots"))) {
          return false;
        }
        return true;
      });

      if (items.length === 0) return;

      const rawColumns = Number(settings.get("columns"));
      const rawRows = Number(settings.get("rows"));
      // 限制最大列/行，防止极端设置导致性能问题
      const columns = Math.min(12, Number.isFinite(rawColumns) && rawColumns > 0 ? Math.floor(rawColumns) : 4);
      const rows = Math.min(6, Number.isFinite(rawRows) && rawRows > 0 ? Math.floor(rawRows) : 2);
      const perPage = Math.max(1, columns * rows);

      const pages = [];
      for (let i = 0; i < items.length; i += perPage) {
        pages.push(items.slice(i, i + perPage));
      }
      if (pages.length === 0) return;

      const track = document.createElement("div");
      track.className = "plus-menu-pager-track";

      pages.forEach((pageItems) => {
        const page = document.createElement("div");
        page.className = "plus-menu-page";
        page.style.gridTemplateColumns = `repeat(${columns}, 1fr)`;
        page.style.gridTemplateRows = `repeat(${rows}, 1fr)`;

        pageItems.forEach((item) => page.appendChild(item));

        for (let j = pageItems.length; j < perPage; j++) {
          const placeholder = document.createElement("div");
          placeholder.className = "plus-menu-placeholder";
          page.appendChild(placeholder);
        }

        track.appendChild(page);
      });

      menu.insertBefore(track, menu.firstChild);

      let dots = null;
      if (settings.get("showDots") !== false) {
        dots = document.createElement("div");
        dots.className = "plus-menu-pager-dots";
        for (let i = 0; i < pages.length; i++) {
          const dot = document.createElement("span");
          dot.className = "plus-menu-pager-dot";
          if (i === 0) dot.classList.add("active");
          dot.addEventListener("click", (e) => {
            e.stopPropagation();
            const state = menu.__plusPagerState;
            if (!state) return;
            state.currentPage = i;
            updateDimensions(menu);
          });
          dots.appendChild(dot);
        }
        menu.appendChild(dots);
      }

      const rawThreshold = Number(settings.get("swipeThreshold"));
      const threshold = Number.isFinite(rawThreshold) && rawThreshold > 0 ? rawThreshold : 50;

      const state = {
        menu,
        track,
        pages: Array.from(track.children).filter((el) => el.classList.contains("plus-menu-page")),
        currentPage: 0,
        isDragging: false,
        startX: 0,
        startY: 0,
        moved: false,
        dots,
        handlers: {},
        observer: null,
        itemsCount: items.length,
        threshold,
        lastWidth: 0, // 缓存上次宽度
      };
      menu.__plusPagerState = state;
      menu.dataset.plusPagerApplied = "1";

      // 触摸事件
      const onTouchStart = (e) => {
        if (e.touches.length > 1) return; // 忽略多指
        const touch = e.touches[0];
        state.startX = touch.clientX;
        state.startY = touch.clientY;
        state.moved = false;
        state.isDragging = true;
      };

      const onTouchMove = (e) => {
        if (!state.isDragging || e.touches.length > 1) return;
        const touch = e.touches[0];
        const dx = touch.clientX - state.startX;
        const dy = touch.clientY - state.startY;

        if (!state.moved && (Math.abs(dx) > 5 || Math.abs(dy) > 5)) {
          state.moved = true;
        }

        if (state.moved && Math.abs(dx) > 5 && Math.abs(dx) > Math.abs(dy) * 1.5) {
          e.preventDefault();
        }
      };

      const onTouchEnd = (e) => {
        if (!state.isDragging) return;
        state.isDragging = false;

        const touch = e.changedTouches[0];
        const dx = touch.clientX - state.startX;
        const dy = touch.clientY - state.startY;

        if (state.moved && Math.abs(dx) > state.threshold && Math.abs(dx) > Math.abs(dy) * 1.5) {
          const total = state.pages.length;
          const canNext = dx < 0 && state.currentPage < total - 1;
          const canPrev = dx > 0 && state.currentPage > 0;
          if (canNext || canPrev) {
            state.currentPage += canNext ? 1 : -1;
            updateDimensions(menu);
            suppressNextClick(); // 关键：触摸滑动翻页后抑制误触
          }
        }
      };

      // 鼠标事件
      const onMouseDown = (e) => {
        if (e.button !== 0) return;
        state.startX = e.clientX;
        state.startY = e.clientY;
        state.moved = false;
        state.isDragging = true;
        activeMouseDragState = state;
      };

      menu.addEventListener("touchstart", onTouchStart, { passive: true });
      menu.addEventListener("touchmove", onTouchMove, { passive: false });
      menu.addEventListener("touchend", onTouchEnd, { passive: true });
      menu.addEventListener("mousedown", onMouseDown);

      state.handlers = {
        touchstart: onTouchStart,
        touchmove: onTouchMove,
        touchend: onTouchEnd,
        mousedown: onMouseDown,
      };

      // ResizeObserver
      if (typeof ResizeObserver !== "undefined") {
        const observer = new ResizeObserver(() => {
          if (menu.isConnected) {
            updateDimensions(menu);
          } else {
            observer.disconnect();
          }
        });
        observer.observe(menu);
        state.observer = observer;
      }

      // 初始布局重试
      let attempts = 0;
      const tryLayout = () => {
        const width = getContentWidth(menu);
        if (width > 0) {
          updateDimensions(menu);
        } else if (attempts < 10) {
          attempts++;
          requestAnimationFrame(tryLayout);
        }
      };
      requestAnimationFrame(tryLayout);
    }

    // ---------- 扫描并处理所有菜单 ----------
    function processMenus() {
      document.querySelectorAll(".chat-plus-menu").forEach((menu) => {
        if (!menu.dataset.plusPagerApplied || !menu.querySelector(".plus-menu-pager-track")) {
          initPager(menu);
        } else {
          const state = menu.__plusPagerState;
          if (!state) {
            initPager(menu);
            return;
          }
          const currentItems = Array.from(menu.querySelectorAll(".plus-menu-page > *")).filter(
            (el) => !el.classList.contains("plus-menu-placeholder")
          );
          if (currentItems.length !== state.itemsCount) {
            destroyPager(menu);
            initPager(menu);
          } else {
            updateDimensions(menu);
          }
        }
      });
    }

    // ---------- MutationObserver 节流 ----------
    let processMenusRafId = null;
    function scheduleProcessMenus() {
      if (processMenusRafId) return;
      processMenusRafId = requestAnimationFrame(() => {
        processMenusRafId = null;
        processMenus();
      });
    }

    const mutationObserver = new MutationObserver((mutations) => {
      let relevant = false;
      for (const mutation of mutations) {
        if (mutation.target && mutation.target.closest && mutation.target.closest(".chat-plus-menu")) {
          relevant = true;
          break;
        }
        for (const node of mutation.addedNodes) {
          if (node.nodeType === 1 && (node.matches?.(".chat-plus-menu") || node.querySelector?.(".chat-plus-menu"))) {
            relevant = true;
            break;
          }
        }
        for (const node of mutation.removedNodes) {
          if (node.nodeType === 1 && (node.matches?.(".chat-plus-menu") || node.querySelector?.(".chat-plus-menu"))) {
            relevant = true;
            break;
          }
        }
        if (relevant) break;
      }
      if (relevant) {
        scheduleProcessMenus();
      }
    });

    let started = false;
    function start() {
      if (started) return;
      started = true;
      if (document.body) {
        mutationObserver.observe(document.body, { childList: true, subtree: true });
        scheduleProcessMenus();
      }
    }

    const offReady = ctx.hooks.on("app.ready", start);
    if (document.body) start();

    const offSettings = ctx.system.settings.onChange(() => {
      document.querySelectorAll(".chat-plus-menu[data-plus-pager-applied]").forEach(destroyPager);
      scheduleProcessMenus();
    });

    // 清理函数
    return () => {
      if (typeof offReady === "function") offReady();
      mutationObserver.disconnect();
      if (typeof offSettings === "function") offSettings();

      if (processMenusRafId) {
        cancelAnimationFrame(processMenusRafId);
        processMenusRafId = null;
      }
      if (clickSuppressionTimer) {
        clearTimeout(clickSuppressionTimer);
        clickSuppressionTimer = null;
      }
      if (suppressClickHandler) {
        document.removeEventListener("click", suppressClickHandler, true);
        suppressClickHandler = null;
      }

      document.querySelectorAll(".chat-plus-menu[data-plus-pager-applied]").forEach(destroyPager);
      document.removeEventListener("mousemove", onDocumentMouseMove);
      document.removeEventListener("mouseup", onDocumentMouseUp);
      activeMouseDragState = null;
    };
  },
};
