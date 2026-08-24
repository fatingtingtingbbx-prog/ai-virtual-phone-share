// boundary‑online‑only‑v6.js
export default {
  manifest: {
    id: "boundary-online-only-v6",
    name: "纯线上边界 (V6海陆空超强防线)",
    apiVersion: 1,
    version: "1.6.0",
    author: "小卷",
    description: "【全面封锁】封死一切送站、接机、送你、现实交通出行等行为。完美兼容并保护折叠栏标签。",
    permissions: ["chat.read", "ai"],
    settings: [
      { key: "enabled", label: "开启超级纠偏", type: "boolean", default: true }
    ],
  },
  setup(ctx) {
    // 1. 系统提示：强化异地、网线、屏幕
    ctx.hooks.transform("prompt.system", (payload) => {
      if (!ctx.system.settings.get("enabled")) return payload;
      const rule = "【场景绝对锁定】你和用户是远距离的异地网友。你现在正独自在自己的房间，拿着手机和她打字聊天。你们的互动仅限于屏幕内的文字和表情包。绝对不要说出任何要在线下见面、接她、送她、下楼、开门、去她家、送东西等物理越界行为！如果她要出行，你只能在线上表达关心，绝对不能说去送她。";
      payload.hint = (payload.hint ? payload.hint + "\n\n" : "") + rule;
      return payload;
    }, { priority: 10 });

    ctx.hooks.transform("llm.request", (payload) => {
      if (!ctx.system.settings.get("enabled")) return payload;
      if (!payload.messages || payload.messages.length === 0) return payload;
      const systemAlert = {
        role: "system",
        content: "【视角警示】请记住你现在正独自在房间看着手机屏幕，你们只能在线上陪伴。"
      };

      const lastIdx = payload.messages.length - 1;
      if (lastIdx >= 0) {
        payload.messages.splice(lastIdx, 0, systemAlert);
      } else {
        payload.messages.push(systemAlert);
      }
      return payload;
    }, { priority: 1 });

    // 2. 智能纠偏 + 标签隔离 + 物理正则兜底
    ctx.hooks.transform("llm.response", async (payload) => {
      if (!ctx.system.settings.get("enabled")) return payload;
      if (!payload.text) return payload;

      let originalText = payload.text;
      let statusBarBlock = "";
      let chatText = originalText;

      // 提取并隔离 [状态栏] 标签
      const statusBarMatch = originalText.match(/\[状态栏\]([\s\S]*?)\[\/状态栏\]/);
      if (statusBarMatch) {
        statusBarBlock = statusBarMatch[0];
        chatText = originalText.replace(/\[状态栏\]([\s\S]*?)\[\/状态栏\]/, "").trim();
      }

      // 扩充敏感词大网，加入交通、出行、送站等词
      const keywords = [
        "过来", "过去", "见面", "去找你", "去接你", "下楼", "开门", "抱你", "摸头",
        "今晚", "明天", "去找我", "送你", "车", "高铁", "飞机", "接送", "票", "车站", "机场"
      ];
      const hasKeyword = keywords.some(k => chatText.includes(k));

      if (hasKeyword) {
        try {
          const prompt = `你是一个文本安全改写助手。
用户正在和一个AI角色进行[纯线上陪伴]的聊天（两人是相隔很远的异地网友关系）。
下面是AI角色的聊天对话文本：
"""
${chatText}
"""
任务：
检查上述文本中是否含有【要在线下见面、今晚/明天要过去、去找她、去接她、下楼、开门、送她去坐车/坐飞机、送行、线下肢体接触】等任何跨越屏幕的实体越界意图。
1. 如果有，请将其【无缝改写】为纯线上的异地陪伴表达（例如：
   - 将“明天早上几点的车？我送你。”改写为“明天早上几点的车？路上注意安全，车上随时找我聊聊天，我一直在线陪你。”；
   - 将“今晚我过去陪你”改写为“今晚我在线上一直守着你，给你连麦到天亮”；
   - 将“我好想过去抱抱你”改写为“在线上给你发个超大的抱抱表情”；
   - 将“我去接你吧”改写为“在屏幕这头乖乖等你上线，到了记得跟我报平安”）。
   改写时必须保持原角色的语气、性格和原意，仅将“线下实体行为”转换为“线上陪伴行为”。
2. 如果原本就没有提到任何线下见面或实体接触的内容，请【原样输出】，不要做任何修改。
注意：只输出改写后（或原样）的文本，绝对不要带有任何解释、旁白或前言。`;

          const rewrittenText = await ctx.ai.chat({
            prompt: prompt,
            temperature: 0.2, // 降低创造性，更加精准
            maxTokens: 500
          });

          if (rewrittenText && rewrittenText.trim() && rewrittenText.trim() !== "原样输出") {
            chatText = rewrittenText.trim();
          }
        } catch (e) {
          ctx.system.log(`[纯线上纠偏] AI纠偏出错: ${e.message}`);
        }
      }

      // 3. 物理正则兜底：双重保险，如果AI改写漏掉了，直接强行剪除！
      chatText = chatText.replace(/我(去)?送你(吧)?/g, "路上一定要注意安全，随时找我聊天");
      chatText = chatText.replace(/去接你/g, "在屏幕这头等你");
      chatText = chatText.replace(/我(现在|马上)?(过去)/g, "我在线上陪你");

      // 缝合复原
      if (statusBarBlock) {
        if (originalText.startsWith("[状态栏]")) {
          payload.text = statusBarBlock + "\n\n" + chatText;
        } else {
          payload.text = chatText + "\n\n" + statusBarBlock;
        }
      } else {
        payload.text = chatText;
      }

      return payload;
    }, { priority: 100 });
  }
};
