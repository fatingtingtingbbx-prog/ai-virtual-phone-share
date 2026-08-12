export default {
  manifest: {
    id: "hide-reasoning",
    name: "隐藏思维链",
    apiVersion: 1,
    version: "1.0.0",
    author: "穆叶",
    description: "一键隐藏 AI 的思考过程，不存入聊天记录",
    // settings 整个删掉，不用声明
  },
  setup(ctx) {
    ctx.hooks.transform("message.beforePersist", (payload) => {
      const msg = payload.message;
      if (!msg) return payload;
      msg.reasoningText = undefined;
      msg.nativeToolReasoning = undefined;
      msg.nativeToolOpenRouterReasoningDetails = undefined;
      return payload;
    });
  },
};
