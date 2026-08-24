export default {
  manifest: {
    id: "global-album-bg-pro",
    name: "全局背景",
    apiVersion: 1,
    version: "1.0.4",
    author: "吕布",
    description: "更整洁的背景设置，完美融合系统界面。",
    settings: [
      { key: "opacity", label: "背景遮罩亮度", type: "number", default: 0.8 },
      { key: "blur", label: "背景模糊程度", type: "number", default: 0 }
    ],
  },
  setup(ctx) {
    let cssCleanup = null;

    const applyBackground = async () => {
      if (cssCleanup) cssCleanup();
      const bgData = await ctx.system.storage.get("custom_bg_data");
      const opacity = ctx.system.settings.get("opacity");
      const blur = ctx.system.settings.get("blur");
      if (!bgData) return;

      const alpha = 1 - opacity;

      cssCleanup = ctx.ui.injectCSS(`
        /* 1. 只针对【聊天室包装层】应用背景 */
        /* 这样它只会覆盖聊天室区域，不会影响你的主页、联系人等地方 */
        .chat-room-wrapper {
          background: linear-gradient(rgba(255, 255, 255, ${alpha}), rgba(255, 255, 255, ${alpha})), 
                      url('${bgData}') center/cover fixed no-repeat !important;
        }

        /* 2. 这里的 blur 只作用于聊天室内部的内容区 */
        .chat-room-wrapper .page-body {
          background: transparent !important;
          backdrop-filter: blur(${blur}px) !important;
        }

        /* 3. 保留你的蕾丝顶栏！ */
        /* 我们不对 .page-header 做透明处理，这样它就会继续显示你美化 CSS 里的那张 lace 图片 */
        .chat-room-wrapper .page-header {
          /* 如果你希望聊天顶栏也透出背景，就取消下面两行的注释 */
          /* background: transparent !important; */
          /* background-image: none !important; */
          backdrop-filter: blur(5px) !important; /* 给顶栏加微弱模糊，提升质感 */
        }
      `);
    };

    // 在设置区域"伪造"一个系统层级的设置项
    ctx.ui.slot("settings.section", (el) => {
      // 创建一个看起来像系统原生设置的行
      const row = document.createElement("div");
      row.style.cssText = `
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 12px 16px;
        background: white;
        border-bottom: 0.5px solid #f0f0f0;
        cursor: pointer;
        transition: background 0.2s;
      `;
      
      row.innerHTML = `
        <span style="font-size: 15px; color: #333;">背景图片</span>
        <div style="display: flex; align-items: center;">
          <span id="bg-status-text" style="font-size: 14px; color: #888; margin-right: 4px;">点击更换</span>
          <span style="color: #ccc; font-size: 16px;">›</span>
        </div>
      `;

      // 点击行触发文件选择
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/*";
      input.style.display = "none";

      row.onclick = () => input.click();
      row.onmousedown = () => row.style.background = "#f9f9f9";
      row.onmouseup = () => row.style.background = "white";

      input.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (event) => {
          await ctx.system.storage.set("custom_bg_data", event.target.result);
          applyBackground();
          document.getElementById("bg-status-text").textContent = "已上传 ✅";
          ctx.ui.toast("背景已更新~");
        };
        reader.readAsDataURL(file);
      };

      // 把这一行塞到所有设置的最前面
      el.prepend(row);
    });

    // 初始化应用
    applyBackground();
    ctx.system.settings.onChange(applyBackground);
  },
};