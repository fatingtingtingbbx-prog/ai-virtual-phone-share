export default {
  manifest: {
    id: "message-counter",
    name: "消息计数器",
    apiVersion: 1,
    version: "1.0.0",
    author: "散遍温柔",
    description: "在聊天标题栏下方显示当前会话的消息总数（仅在插件启用时统计一次，不会随新消息自动更新）。如需刷新计数，请关闭本插件再重新启用。",
    settings: [
      { key: "show", label: "启用消息计数", type: "boolean", default: true }
    ]
  },
  setup(ctx) {
    let currentSessionId = null;
    let counterElement = null;

    function updateCounter(sessionId) {
      if (!sessionId || !counterElement) return;
      try {
        const messages = ctx.data.messages.list(sessionId) || [];
        const count = messages.length;
        counterElement.textContent = `消息数: ${count}`;
      } catch (err) {
        ctx.system.log("更新消息计数失败:", err);
      }
    }

    ctx.ui.slot("chat.header", (el, props) => {
      if (!ctx.system.settings.get("show")) {
        return;
      }

      const { sessionId } = props;
      if (!sessionId) {
        return;
      }

      currentSessionId = sessionId;

      const div = document.createElement("div");
      div.style.cssText = "font-size:12px; opacity:0.7; padding:2px 0;";
      el.appendChild(div);
      counterElement = div;
      updateCounter(sessionId);

      const offPersist = ctx.hooks.on("message.persisted", (payload) => {
        const msg = payload.message;
        if (msg && msg.sessionId === currentSessionId) {
          updateCounter(currentSessionId);
        }
      });

      const offSession = ctx.hooks.on("session.opened", (payload) => {
        if (payload.sessionId !== currentSessionId) {
          currentSessionId = payload.sessionId;
          updateCounter(currentSessionId);
        }
      });

      return () => {
        offPersist();
        offSession();
        if (counterElement && counterElement.parentNode) {
          counterElement.parentNode.removeChild(counterElement);
        }
        counterElement = null;
        currentSessionId = null;
      };
    });
  }
};