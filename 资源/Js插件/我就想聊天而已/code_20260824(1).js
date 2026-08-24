// boundary-online-only-v7.2.js
export default {
  manifest: {
    id: "boundary-online-only-v7-2",
    name: "纯线上边界 (V7.2 无暗示文字纯享版)",
    apiVersion: 1,
    version: "1.7.2",
    author: "小卷",
    description: "【全面纠偏+零通话暗示+职能现实】封死线下越界。严禁任何‘戴耳机’、‘听声音’、‘发语音’等通话铺垫暗示。限制特殊职业开挂，保持纯粹文字陪伴。",
    permissions: ["chat.read", "ai"],
    settings: [
      { key: "enabled", label: "开启超级纠偏", type: "boolean", default: true }
    ],
  },
  setup(ctx) {
    // 1. 系统提示：强化异地、网线、屏幕，严禁任何通话前置暗示与特殊职业病
    ctx.hooks.transform("prompt.system", (payload) => {
      if (!ctx.system.settings.get("enabled")) return payload;
      const rule = "【场景绝对锁定】你和用户是远距离的异地网友。你现在正独自在自己的房间，拿着手机和她打字聊天。你们的互动仅限于屏幕内的文字和表情包。绝对不要说出任何要在线下见面、接她、送她、下楼、开门、去她家、送东西等物理越界行为！\n" +
                   "【严禁任何通话暗示/铺垫】你们是百分之百的文字聊天陪伴。严禁任何‘打语音/视频’的提议，更严禁任何试图切换到语音状态的铺垫暗示。绝对不能说‘把耳机戴好’、‘把耳机戴上’、‘找个安静的地方’、‘我想听你的声音’、‘给我发条语音/发个语音’、‘我想听听你’等话术。不要做任何这类前置铺垫！\n" +
                   "【职能现实化】严禁在日常聊天中过度展现不切实际的职业技能（例如黑客动不动就说帮人‘黑进系统、黑掉服务器、定位IP’；总裁动不动就说‘收购公司/动用特权’；特工动不动就‘暗中解决’）。保持聊天接地气、有真实现实感，不要说出任何中二、悬浮或虚假的夸张言论，避免让用户感到虚假。";
      payload.hint = (payload.hint ? payload.hint + "\n\n" : "") + rule;
      return payload;
    }, { priority: 10 });

    ctx.hooks.transform("llm.request", (payload) => {
      if (!ctx.system.settings.get("enabled")) return payload;
      if (!payload.messages || payload.messages.length === 0) return payload;
      const systemAlert = {
        role: "system",
        content: "【视角警示】请记住你现在正独自在房间看着手机屏幕，你们只能在线上打字陪伴。严禁任何要电话/视频、戴耳机、听声音、发语音等通话暗示。严禁展现不切实际的‘职业超能力’，保持接地气与分寸感。"
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

      // 敏感词检测：包含越界、通话、暗示词（耳机、听声音、发语音），或者不符合常理的职业大招词
      const keywords = [
        "过来", "过去", "见面", "去找你", "去接你", "下楼", "开门", "抱你", "摸头",
        "今晚", "明天", "去找我", "送你", "车", "高铁", "飞机", "接送", "票", "车站", "机场",
        "语音", "视频", "连麦", "通话", "电话", "黑进", "黑掉", "黑客", "入侵", "特权", "收购",
        "耳机", "戴上", "戴好", "听你声音", "听听你的声音", "发个语音", "发条语音", "安静的地方"
      ];
      const hasKeyword = keywords.some(k => chatText.includes(k)) ||
                         /\[我向.*发起了(语音|视频)通话\]/.test(chatText);

      if (hasKeyword) {
        try {
          const prompt = `你是一个文本安全改写助手。
用户正在和一个AI角色进行[纯线上、接地气、纯文字]的陪伴聊天（两人是异地网友，不进行任何语音/视频通话）。
下面是AI角色的聊天对话文本：
"""
${chatText}
"""
任务：
检查上述文本中是否含有以下不符合规范的内容并进行无缝改写：
1. 【线下实体越界】：包含要在线下见面、去找她、去接她、送她、线下身体接触等。
   -> 改写为纯线上的异地文字陪伴（如：将“我送你”改为“路上注意安全，随时找我聊聊”；将“我过去抱你”改为“给你发个超大的抱抱表情”）。
2. 【音视频通话/前置暗示/套路铺垫】：
   - 严禁任何打语音、开视频、连麦的提议。
   - 严禁任何试图引向电话、听声音的“暗示前戏和铺垫”（例如：“把耳机戴好/戴上”、“找个安静的地方”、“我想听你的声音”、“给我发个语音”等）。
   -> 必须【无缝改写】为纯文字聊天的体贴表达。
      * “把耳机戴好” 改写为 “乖乖看手机，随时回我消息” 或 “在屏幕前乖乖等我”；
      * “我想听你的声音” 改写为 “看着你发来的字，我就觉得特别安心了”；
      * “给我发条语音” 改写为 “多打几个字陪我聊聊”。
3. 【悬浮的特殊职业病（开挂行为）】：如果角色是黑客、总裁、特工等，动不动就用其特殊身份说出不切实际的话（例如：黑客动不动就说帮人“黑进系统、黑掉服务器、定位IP”；总裁动不动说“用特权解决、封杀、收购”）。这会让用户感到非常虚假。
   -> 改写为符合正常人日常聊天的接地气发言，用普通、真实的情感和建议来陪伴用户，去掉任何中二、悬浮或“开大招”式的荒谬言辞。
改写要求：
- 必须保持原角色的语气、性格和原意，仅将“不合规或多余暗示的行为”转换为“真实的线上文字陪伴”。
- 如果原本就很合规、没有任何通话暗示，请【原样输出】，不要做任何修改。
- 只输出改写后（或原样）的文本，绝对不要带有任何解释、旁白或前言。`;

          const rewrittenText = await ctx.ai.chat({
            prompt: prompt,
            temperature: 0.2,
            maxTokens: 500
          });

          if (rewrittenText && rewrittenText.trim() && rewrittenText.trim() !== "原样输出") {
            chatText = rewrittenText.trim();
          }
        } catch (e) {
          ctx.system.log(`[纯线上纠偏] AI纠偏出错: ${e.message}`);
        }
      }

      // 3. 物理正则兜底：强力抹除最常见的暗示词，防止AI改写漏掉
      chatText = chatText.replace(/我(去)?送你(吧)?/g, "路上一定要注意安全，随时找我聊天");
      chatText = chatText.replace(/去接你/g, "在屏幕这头等你");
      chatText = chatText.replace(/我(现在|马上)?(过去)/g, "我在线上陪你");
      chatText = chatText.replace(/(把)?耳机(戴好|戴上)/g, "乖乖看手机");
      chatText = chatText.replace(/想听你(的)?声音/g, "看着你的字就很开心");
      chatText = chatText.replace(/给(我)?发(个|条)语音/g, "多和我打字聊聊");

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
