export default {
  manifest: {
    id: "mark-last-consecutive",
    name: "末尾气泡标记",
    apiVersion: 1,
    version: "1.2.0",
    author: "初智齿",
    description: "精准命中连续消息组的最后一条，支持动态渲染与 AI 流式输出。",
    permissions: ["chat.read"]
  },
  setup(ctx) {
    // 核心标记逻辑
    const updateMarks = () => {
      // 1. 获取所有消息容器（而不是气泡）
      const wrappers = document.querySelectorAll('.chat-msg-wrapper');

      wrappers.forEach((wrapper, index) => {
        const nextWrapper = wrappers[index + 1];
        
        // 2. 判断当前容器是否是组内最后一条：
        //    - 没有下一个容器（列表末尾）
        //    - 或者下一个容器没有 data-consecutive 属性（说明下一条是新组的开始）
        const isLast = !nextWrapper || !nextWrapper.hasAttribute('data-consecutive');

        // 3. 找到当前容器内的气泡元素
        const bubble = wrapper.querySelector('.chat-bubble-role-user, .chat-bubble-role-assistant');
        if (!bubble) return; // 如果结构异常则跳过

        if (isLast) {
          if (bubble.getAttribute('data-last-consecutive') !== 'true') {
            bubble.setAttribute('data-last-consecutive', 'true');
          }
        } else {
          if (bubble.hasAttribute('data-last-consecutive')) {
            bubble.removeAttribute('data-last-consecutive');
          }
        }
      });
    };

    // 原有事件监听和 MutationObserver 保持不变
    setTimeout(updateMarks, 200);

    ctx.hooks.on('session.opened', () => setTimeout(updateMarks, 100));
    ctx.hooks.on('message.persisted', () => setTimeout(updateMarks, 50));
    ctx.hooks.on('message.updated', () => setTimeout(updateMarks, 50));
    ctx.hooks.on('message.deleted', () => setTimeout(updateMarks, 50));

    let streamTimer = null;
    ctx.hooks.on('llm.streamChunk', () => {
      if (streamTimer) clearTimeout(streamTimer);
      streamTimer = setTimeout(updateMarks, 100);
    });

    let moTimer = null;
    const observer = new MutationObserver(() => {
      if (moTimer) clearTimeout(moTimer);
      moTimer = setTimeout(updateMarks, 100);
    });
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      if (streamTimer) clearTimeout(streamTimer);
      if (moTimer) clearTimeout(moTimer);
      document.querySelectorAll('.chat-bubble-role-user, .chat-bubble-role-assistant').forEach(bubble => {
        bubble.removeAttribute('data-last-consecutive');
      });
    };
  }
};