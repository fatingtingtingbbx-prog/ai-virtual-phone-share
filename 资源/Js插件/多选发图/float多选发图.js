export default {
  manifest: {
    id: "multiselect-images",
    name: "多选发图",
    apiVersion: 1,
    version: "1.0.0",
    author: "AI",
    description: "支持一次发送多张图片并自动排版，AI能够完整看到所有图片进行视觉分析。",
    permissions: ["chat.read", "ai"],
    settings: [
      { key: "compressQuality", label: "图片压缩质量 (0.1-1.0)", type: "number", default: 0.7 }
    ],
  },
  setup(ctx) {
    // 全局追踪当前所处的聊天会话 ID
    let currentSessionId = null;
    ctx.hooks.on("session.opened", (p) => {
      currentSessionId = p.sessionId;
    });

    /**
     * 辅助工具：读取并压缩图片，防止多张图 Base64 过大卡死应用
     */
    function compressImage(file, quality) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          const img = new Image();
          img.onload = () => {
            const canvas = document.createElement("canvas");
            let { width: w, height: h } = img;
            const maxDim = 1280; // 限制最大边长
            if (w > maxDim || h > maxDim) {
              if (w > h) {
                h = Math.floor(h * (maxDim / w));
                w = maxDim;
              } else {
                w = Math.floor(w * (maxDim / h));
                h = maxDim;
              }
            }
            canvas.width = w;
            canvas.height = h;
            const ctx2d = canvas.getContext("2d");
            ctx2d.drawImage(img, 0, 0, w, h);
            resolve(canvas.toDataURL("image/jpeg", quality));
          };
          img.onerror = () => resolve(e.target.result); // 出错则回退到原图
          img.src = e.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    }

    // 1. 注册自定义消息类型，用于渲染多图画廊
    ctx.ui.messageKind("multi-image", (el, msg) => {
      const images = msg.mediaData?.images || [];
      if (!images.length) {
        el.textContent = "[图片加载失败]";
        return;
      }

      // 使用 Grid 布局展示画廊
      el.style.display = "grid";
      // 1张图全宽，2张及以上分2列
      el.style.gridTemplateColumns = images.length > 1 ? "repeat(2, 1fr)" : "1fr";
      el.style.gap = "4px";
      el.style.marginTop = "4px";

      images.forEach(src => {
        const img = document.createElement("img");
        img.src = src;
        img.style.width = "100%";
        img.style.height = "100%";
        img.style.objectFit = "cover";
        img.style.borderRadius = "6px";
        img.style.cursor = "pointer";
        // 限制最高高度
        img.style.maxHeight = images.length > 1 ? "160px" : "280px";

        // 点击看大图（全屏 Modal 浮层）
        img.onclick = () => {
          ctx.ui.openModal((modalEl, { close }) => {
            modalEl.style.padding = "0";
            modalEl.style.backgroundColor = "transparent";
            modalEl.style.boxShadow = "none";
            modalEl.style.display = "flex";
            modalEl.style.justifyContent = "center";
            modalEl.style.alignItems = "center";
            modalEl.style.width = "100%";
            modalEl.style.height = "100%";

            const fullImg = document.createElement("img");
            fullImg.src = src;
            fullImg.style.maxWidth = "100vw";
            fullImg.style.maxHeight = "100vh";
            fullImg.style.objectFit = "contain";
            
            modalEl.appendChild(fullImg);
            // 点击大图自动关闭
            fullImg.onclick = (e) => {
              e.stopPropagation();
              close();
            };
          });
        };

        el.appendChild(img);
      });
    });

    // 2. 注入输入栏扩展位，提供"多选发图"按钮
    ctx.ui.slot("chat.inputToolbar", (el) => {
      const btn = document.createElement("button");
      btn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:4px;">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
          <circle cx="8.5" cy="8.5" r="1.5"></circle>
          <polyline points="21 15 16 10 5 21"></polyline>
        </svg>多选发图
      `;
      btn.style.cssText = `
        display: flex;
        align-items: center;
        background: transparent;
        border: 1px solid rgba(128,128,128,0.2);
        border-radius: 14px;
        padding: 4px 10px;
        font-size: 13px;
        cursor: pointer;
        color: inherit;
        margin-right: 8px;
        transition: opacity 0.2s;
      `;
      btn.onmouseover = () => btn.style.opacity = "0.7";
      btn.onmouseout = () => btn.style.opacity = "1";

      const input = document.createElement("input");
      input.type = "file";
      input.multiple = true;      // 关键：允许多选
      input.accept = "image/*";
      input.style.display = "none";

      input.onchange = async (e) => {
        const files = Array.from(e.target.files);
        if (!files.length) return;

        if (!currentSessionId) {
          ctx.ui.toast("找不到当前会话记录");
          return;
        }

        const toast = ctx.ui.toast(`正在处理 ${files.length} 张图片...`, { durationMs: 0 });
        try {
          const quality = ctx.system.settings.get("compressQuality") || 0.7;
          
          // 并发读取与压缩所有选择的图片
          const dataUrls = await Promise.all(
            files.map(f => compressImage(f, quality))
          );

          // 发送自定义多图消息
          ctx.data.messages.push({
            sessionId: currentSessionId,
            role: "user",
            content: `[发送了 ${files.length} 张图片]`, // 文本 fallback，也会成为给模型看的提示
            mediaType: "plugin:multi-image",
            mediaData: { images: dataUrls }
          });
        } catch (err) {
          ctx.system.log("多图处理失败", err);
          ctx.ui.toast("图片处理失败");
        } finally {
          toast.close();
          input.value = ""; // 清空以便下次还能选同个文件
        }
      };

      btn.onclick = () => input.click();
      el.appendChild(btn);
      el.appendChild(input);
    });

    // 3. 拦截即将发给大模型的请求，将多图 Base64 注入给 AI
    ctx.hooks.transform("llm.request", (payload) => {
      if (!payload.sessionId) return payload;

      // 拿到落库的所有历史消息
      const history = ctx.data.messages.list(payload.sessionId);
      let hIndex = history.length - 1;

      // 倒序对齐 payload.messages 与 history，寻找我们发出的自定义多图消息
      for (let i = payload.messages.length - 1; i >= 0; i--) {
        const msg = payload.messages[i];
        
        // 滑动寻找对应的历史节点
        while (hIndex >= 0 && (history[hIndex].role !== msg.role || history[hIndex].content !== msg.content)) {
          hIndex--;
        }

        if (hIndex >= 0) {
          const hMsg = history[hIndex];
          // 如果找到了是由本插件发出的多图消息
          if (hMsg.mediaType === "plugin:multi-image" && hMsg.mediaData?.images?.length) {
            
            // 转换为 OpenAI 支持的 Vision 数组格式
            let contentArr = [];
            if (typeof msg.content === "string") {
              contentArr.push({ type: "text", text: msg.content });
            } else if (Array.isArray(msg.content)) {
              contentArr = [...msg.content];
            }

            // 把压缩后的 Base64 依次拼接到请求体内
            hMsg.mediaData.images.forEach(dataURL => {
              contentArr.push({ type: "image_url", image_url: { url: dataURL } });
            });

            msg.content = contentArr; // 覆盖原始字符串
          }
          hIndex--;
        }
      }

      return payload;
    }, { priority: 50 }); // 设置较高中等优先级，避免与其他系统级拦截冲突
  }
};