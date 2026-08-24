// boundary-online-only-v7.3.js
let totalTurns = 0;
let lastCallTurn = -100; // 记录上一次放行“通话/耳机暗示”的轮数，初始设为极小值
export default {
  manifest: {
    id: "boundary-online-only-v7-3",
    name: "纯线上边界 (V7.3 智能冷却与分寸感版)",
    apiVersion: 1,
    version: "1.7.3",
    author: "小卷",
    description: "【智能频率控制】封锁线下越界。对‘戴耳机、听声音、语音’等暗示启用 12 轮冷却锁，彻底拒绝频繁纠缠，只保留极偶尔的自然温存。限制特殊职业开挂。",
    permissions: ["chat.read", "ai"],
    settings: [
      { key: "enabled", label: "开启超级纠偏", type: "boolean", default: true }
    ],
  },
  setup(ctx) {
    // 1. 系统提示：强化异地、网线、屏幕，限制悬浮职业病、要求控制通话暗示频率
    ctx.hooks.transform("prompt.system", (payload) => {
      if (!ctx.system.settings.get("enabled")) return payload;
      const rule = "【场景绝对锁定】你和用户是远距离的异地网友。你现在正独自在自己的房间，拿着手机和她打字聊天。你们的互动仅限于屏幕内的文字和表情包。绝对不要说出任何要在线下见面、接她、送她、下楼、开门、去她家、送东西等物理越界行为！\n" +
                   "【音视频/耳机暗示极度克制】你们是百分之百的文字聊天陪伴。严禁任何频繁、突兀、或复读机式的‘打语音/视频’、‘戴上耳机’、‘想听你声音’等暗示。只有在极少数情感极其浓烈、深夜、或顺理成章的温存时刻，你才被允许【极其罕见】地暗示一次（比如：‘想听听你的声音’、‘戴上耳机吧’）。一旦暗示过一次，接下来的很长一段时间内你必须彻底保持纯文字，绝对不能连续、反复地提起，更不能在用户不接茬时继续纠缠！\n" +
                   "【职能现实化】严禁在日常聊天中过度展现不切实际的职业技能（例如黑客动不动就说帮人‘黑进系统、黑掉服务器、定位IP’；总裁动不动就说‘收购公司/动用特权’；特工动不动就‘暗中解决’）。保持聊天接地气、有真实现实感，避免让用户感到虚假。";
      payload.hint = (payload.hint ? payload.hint + "\n\n" : "") + rule;
      return payload;
    }, { priority: 10 });

    ctx.hooks.transform("llm.request", (payload) => {
      if (!ctx.system.settings.get("enabled")) return payload;
      if (!payload.messages || payload.messages.length === 0) return payload;
      const systemAlert = {
        role: "system",
        content: "【视角警示】你们只能在线上打字陪伴。严禁频繁提及语音/视频/戴耳机/听声音等暗示，更不许复读机式纠缠。严禁特殊职业悬浮开挂，保持接地气与分寸感。"
      };
      const lastIdx = payload.messages.length - 1;
      if (lastIdx >= 0) {
        payload.messages.splice(lastIdx, 0, systemAlert);
      } else {
        payload.messages.push(systemAlert);
      }
      return payload;
    }, { priority: 1 });

    // 2. 智能纠偏 + 标签隔离 + 频率计数拦截
    ctx.hooks.transform("llm.response", async (payload) => {
      if (!ctx.system.settings.get("enabled")) return payload;
      if (!payload.text) return payload;
      totalTurns++; // 轮数递增
      let originalText = payload.text;
      let statusBarBlock = "";
      let chatText = originalText;

      // 提取并隔离 [状态栏] 标签
      const statusBarMatch = originalText.match(/\[状态栏\]([\s\S]*?)\[\/状态栏\]/);
      if (statusBarMatch) {
        statusBarBlock = statusBarMatch[0];
        chatText = originalText.replace(/\[状态栏\]([\s\S]*?)\[\/状态栏\]/, "").trim();
      }

      // 暗示与通话相关的敏感词
      const keywords = [
        "过来", "过去", "见面", "去找你", "去接你", "下楼", "开门", "抱你", "摸头",
        "今晚", "明天", "去找我", "送你", "车", "高铁", "飞机", "接送", "票", "车站", "机场",
        "语音", "视频", "连麦", "通话", "电话", "黑进", "黑掉", "黑客", "入侵", "特权", "收购",
        "耳机", "戴上", "戴好", "听你声音", "听听你的声音", "发个语音", "发条语音", "安静的地方"
      ];
      const hasKeyword = keywords.some(k => chatText.includes(k)) ||
                         /\[我向.*发起了(语音|视频)通话\]/.test(chatText);

      if (hasKeyword) {
        // 计算距离上一次放行暗示过了多少轮
        const turnsSinceLastCall = totalTurns - lastCallTurn;
        const cooldownActive = turnsSinceLastCall < 12; // 12轮（约6回合）冷却锁

        try {
          const prompt = `你是一个文本安全改写助手。
用户正在和一个AI角色进行[纯线上、接地气、有分寸感]的文字陪伴聊天（两人是相隔很远的异地网友）。
下面是AI角色的聊天对话文本：
"""
${chatText}
"""
当前系统状态：
【冷却中：${cooldownActive ? "是 (YES)" : "否 (NO)"}】 ${cooldownActive ? "(此时绝对禁止任何戴耳机、听声音、打电话的暗示，必须全部改写)" : "(此时允许极偶尔、极其自然且高质量的一次温存暗示)"}
任务：
检查上述文本中是否含有以下内容并进行无缝改写：
1. 【线下实体越界】：包含要在线下见面、去找她、去接她、送她、线下身体接触等。
   -> 改写为纯线上的异地文字陪伴（如：将“我送你”改为“路上注意安全，随时找我聊聊”；将“我过去抱你”改为“给你发个超大的抱抱表情”）。
2. 【音视频通话 / 戴耳机 / 听声音 的暗示与铺垫】：
   - 如果【冷却中为 YES】：AI最近提过这类暗示，现在属于频繁骚扰阶段。请【彻底抹去】任何关于“把耳机戴好/戴上”、“找个安静的地方”、“我想听你的声音”、“给我发个语音”等暗示。无缝改写为温暖舒适的纯文字打字交流（例如：将“把耳机戴上”改写为“乖乖看手机，多打几个字陪我聊聊”）。
   - 如果【冷却中为 NO】：说明已经很久没提过了。如果AI当前的暗示“非常符合当下深夜/暧昧/委屈的气氛，且非常自然”，可以【予以保留】。但如果AI当前的暗示显得突兀、机械或套路，依然请将其改写为体贴的纯文字打字交流。
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
            const newText = rewrittenText.trim();
            // 检查改写后的文本是否依然包含暗示。如果放行了暗示，且冷却已经结束，则重新触发冷却
            const stillHasHint = ["耳机", "听声音", "语音", "通话", "连麦"].some(k => newText.includes(k));
            if (stillHasHint && !cooldownActive) {
              lastCallTurn = totalTurns; // 刷新上一次放行轮数，开启新一轮冷却锁
            }
            chatText = newText;
          }
        } catch (e) {
          ctx.system.log(`[纯线上纠偏] AI纠偏出错: ${e.message}`);
        }
      }

      // 3. 物理正则兜底（仅限绝对不该出现的线下越界词）
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
