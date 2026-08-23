export default {
  manifest: {
    id: "toolbar-collapse",
    name: "加号工具栏折叠",
    apiVersion: 1,
    version: "1.0.1",
    author: "小坊",
    description: "折叠聊天输入栏加号面板中的过多功能图标，点击展开/收起",
    permissions: [],
    settings: [
      {
        key: "visibleCount",
        label: "默认保留显示数量（默认 8 个，即前两排）",
        type: "number",
        default: 8,
      },
    ],
  },
  setup(ctx) {
    // 注入折叠与按钮样式
    ctx.ui.injectCSS(`
      .chat-plus-menu-item.__plugin_hidden_item {
        display: none !important;
      }
      .toolbar-collapse-wrap {
        width: 100%;
        padding: 4px 12px 10px 12px;
        display: flex;
        justify-content: center;
      }
      .toolbar-toggle-btn {
        width: 100%;
        max-width: 320px;
        padding: 8px 14px;
        background: rgba(125, 125, 125, 0.08);
        border: 1px dashed rgba(125, 125, 125, 0.25);
        border-radius: 12px;
        color: var(--c-text, #333);
        opacity: 0.8;
        font-size: 12px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        transition: all 0.2s ease;
        user-select: none;
      }
      .toolbar-toggle-btn:active {
        background: rgba(125, 125, 125, 0.16);
        transform: scale(0.98);
      }
    `);

    // 认领加号面板底部坑位
    ctx.ui.slot("chat.inputToolbar", (el) => {
      let isExpanded = false;

      // 创建容器与按钮
      const wrap = document.createElement("div");
      wrap.className = "toolbar-collapse-wrap";

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "toolbar-toggle-btn";
      wrap.appendChild(btn);
      el.appendChild(wrap);

      // 获取限制数量
      const getLimit = () => {
        const val = Number(ctx.system.settings.get("visibleCount"));
        return Number.isFinite(val) && val > 0 ? val : 8;
      };

      // 准确获取所有加号菜单项
      const getItems = () => {
        const bar = el.closest(".chat-input-bar") || el.parentElement;
        if (!bar) return [];
        const menu = bar.querySelector(".chat-plus-menu");
        if (!menu) return [];
        return Array.from(menu.querySelectorAll(".chat-plus-menu-item"));
      };

      // 刷新展示与隐藏状态
      const applyState = () => {
        const items = getItems();
        const limit = getLimit();
        const hiddenCount = Math.max(0, items.length - limit);

        if (hiddenCount === 0) {
          wrap.style.display = "none";
          items.forEach((item) => item.classList.remove("__plugin_hidden_item"));
          return;
        }

        wrap.style.display = "flex";

        if (isExpanded) {
          btn.innerHTML = `<span>收起功能面板</span> <span style="font-size:10px;">▲</span>`;
          items.forEach((item) => item.classList.remove("__plugin_hidden_item"));
        } else {
          btn.innerHTML = `<span>展开更多功能 (+${hiddenCount})</span> <span style="font-size:10px;">▼</span>`;
          items.forEach((item, index) => {
            if (index >= limit) {
              item.classList.add("__plugin_hidden_item");
            } else {
              item.classList.remove("__plugin_hidden_item");
            }
          });
        }
      };

      btn.addEventListener("click", () => {
        isExpanded = !isExpanded;
        applyState();
      });

      // 初始化执行
      applyState();

      // 清理逻辑：面板关闭或插件卸载时恢复展示
      return () => {
        const items = getItems();
        items.forEach((item) => item.classList.remove("__plugin_hidden_item"));
      };
    });
  },
};