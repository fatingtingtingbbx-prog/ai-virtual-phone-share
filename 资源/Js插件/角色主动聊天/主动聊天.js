export default {
  manifest: {
    id: "auto-poke-ultimate",
    name: "角色主动出击 (拟真保活版)",
    apiVersion: 1,
    version: "5.0.0",
    description: "全面保活、独立作息！严守关系边界拒绝OOC，会像真人一样连发短句找你。",
    settings: [
      { key: "globalEnabled", label: "全局总开关 (关闭则全员静默)", type: "boolean", default: true },
      { key: "promptContext", label: "给AI的额外指令", type: "text", default: "请主动找话题或者表达你的情绪，符合你的人设。" }
    ],
  },
  setup(ctx) {
    // 注入好看的 UI 样式
    ctx.ui.injectCSS(`
      .poke-panel { background: #ffffff; border-radius: 16px; box-shadow: 0 4px 20px rgba(0,0,0,0.06); padding: 20px; margin-top: 16px; font-family: system-ui, -apple-system, sans-serif; border: 1px solid #f0f0f0; }
      .poke-title { font-size: 16px; font-weight: 600; margin: 0 0 16px 0; display: flex; align-items: center; color: #1a1a1a; gap: 8px; }
      .poke-group { margin-bottom: 16px; display: flex; flex-direction: column; gap: 8px; }
      .poke-label { font-size: 13px; color: #666; font-weight: 500; }
      .poke-control { width: 100%; padding: 10px 12px; border-radius: 10px; border: 1px solid #e0e0e0; background: #fafafa; font-size: 14px; color: #333; outline: none; transition: all 0.2s ease; box-sizing: border-box; }
      .poke-control:focus { border-color: #999; background: #fff; box-shadow: 0 0 0 3px rgba(0,0,0,0.03); }
      .poke-row { display: flex; align-items: center; gap: 12px; }
      .poke-btn { background: #1a1a1a; color: #fff; border: none; padding: 12px; border-radius: 10px; font-size: 14px; font-weight: 600; cursor: pointer; transition: transform 0.1s, background 0.2s; text-align: center; margin-top: 8px; }
      .poke-btn:hover { background: #333; }
      .poke-btn:active { transform: scale(0.98); }
      .dark-mode .poke-panel { background: #222; border-color: #333; }
      .dark-mode .poke-title, .dark-mode .poke-control { color: #eee; }
      .dark-mode .poke-control { background: #1a1a1a; border-color: #444; }
      .dark-mode .poke-btn { background: #eee; color: #222; }
    `);
    // 读取角色的专属配置
    function getCharConfig(charId) {
      return {
        freq: ctx.data.variables.get("poke_freq", "character", charId) || "disabled",
        sleepStart: ctx.data.variables.get("poke_sleep_start", "character", charId) || "23:00",
        sleepEnd: ctx.data.variables.get("poke_sleep_end", "character", charId) || "07:00"
      };
    }
    // 根据频率算出随机延迟（毫秒）
    function getDelayMs(freq) {
      let minH = 0, maxH = 0;
      switch(freq) {
        case "clingy":      minH = 5/60;  maxH = 10/60; break; // 5分 - 10分
        case "extreme":     minH = 10/60; maxH = 30/60; break; // 10分 - 30分
        case "ultra_high":  minH = 30/60; maxH = 1;     break; // 30分 - 1时
        case "high":        minH = 1;     maxH = 3;     break; // 1时 - 3时
        case "medium":      minH = 3;     maxH = 5;     break; // 3时 - 5时
        case "low":         minH = 5;     maxH = 8;     break; // 5时 - 8时
        case "ultra_low":   minH = 8;     maxH = 10;    break; // 8时 - 10时
        case "indifferent": minH = 10;    maxH = 24;    break; // 10时 - 24时
        default: return null;
      }
      const hours = minH + Math.random() * (maxH - minH);
      return Math.floor(hours * 3600000);
    }
    // 检查是否在睡眠时间
    function isSleeping(config) {
      const d = new Date();
      const curr = d.getHours() * 60 + d.getMinutes();
      const [sh, sm] = config.sleepStart.split(":").map(Number);
      const [eh, em] = config.sleepEnd.split(":").map(Number);
      const startMins = sh * 60 + sm;
      const endMins = eh * 60 + em;
      if (startMins < endMins) return curr >= startMins && curr < endMins;
      return curr >= startMins || curr < endMins;
    }
    // 重置倒计时（写入持久化变量，保活核心）
    function resetTimer(sessionId, charId) {
      const config = getCharConfig(charId);
      if (config.freq === "disabled") return;
      
      const delay = getDelayMs(config.freq);
      if (delay) {
        ctx.data.variables.set("poke_last_chat", Date.now(), "session", sessionId);
        ctx.data.variables.set("poke_target_delay", delay, "session", sessionId);
      }
    }
    // 监听消息落地：只要有聊天（不管是你发的还是AI发的），就重新计算忍耐时间
    ctx.hooks.on("message.persisted", (p) => {
      if (!p.message || !p.message.sessionId) return;
      const session = ctx.data.sessions.get(p.message.sessionId);
      if (session && !session.isGroup) resetTimer(session.id, session.contactId);
    });
    // 守护进程：每 1 分钟巡逻一次
    ctx.system.timers.setInterval(async () => {
      if (!ctx.system.settings.get("globalEnabled")) return;
      
      const now = Date.now();
      const sessions = ctx.data.sessions.list();
      for (const session of sessions) {
        if (session.isGroup) continue;
        
        const charId = session.contactId;
        const config = getCharConfig(charId);
        if (config.freq === "disabled") continue;
        const lastChat = ctx.data.variables.get("poke_last_chat", "session", session.id);
        const targetDelay = ctx.data.variables.get("poke_target_delay", "session", session.id);
        if (!lastChat || !targetDelay) {
          resetTimer(session.id, charId);
          continue;
        }
        // 冷场时间还没到
        if (now < lastChat + targetDelay) continue;
        // 时间到了，但角色在睡觉，等醒了再说
        if (isSleeping(config)) continue;
        // 准备发消息！先把时间推迟，防止 AI 思考期间重复触发
        ctx.data.variables.set("poke_last_chat", now + 99999999, "session", session.id);
        try {
          const msgs = ctx.data.messages.list(session.id);
          const char = ctx.data.characters.get(charId);
          if (!char) continue;
          const recentMsgs = msgs.slice(-8).map(m => 
            `${m.role === "user" ? "用户" : char.name}: ${m.content}`
          ).join("\n");
          const extraPrompt = ctx.system.settings.get("promptContext");
          
          // 核心指令：严守边界 + 连发短句机制
          const prompt = `你是${char.name}，人设：\n${char.persona || char.briefPersona || "无"}\n\n近期聊天记录（用于判断当前语境和关系）：\n${recentMsgs}\n\n` +
            `【必遵核心规则】\n` +
            `1. 严格遵守当前你与用户的关系状态和认识程度！例如：如果只是网友或者网恋未面基，绝不可提及奔现或知晓对方现实信息（绝对禁止无端掉马）；禁止全知视角：只能根据已有记录、记忆和你的人设聊天，严禁开启上帝视角；禁止无中生有编造未发生的事或你不可能知道的事情。\n` +
            `2. 必须符合日常手机聊天习惯，像真人一样发短句，绝对不要发长篇大论或散文式的回复。\n` +
            `3. 如果你想分多条消息连发（模拟真人连续按回车发送），请务必用 ||| 将每条短句隔开（例如：在吗？|||刚才碰到件超好笑的事|||猜猜是什么）。\n\n` +
            `系统提示：用户有段时间没理你了，请根据人设主动找用户。${extraPrompt}\n注意：直接输出你要发送的内容，绝不要包含前缀、动作描写或心理描写。`;
          const reply = await ctx.ai.chat({ prompt, temperature: 0.8 });
          
          if (reply && reply.trim()) {
            // 清理可能带有的引号，并按 ||| 截断成多条消息
            const cleanReply = reply.trim().replace(/^["']|["']$/g, '');
            const msgsToSend = cleanReply.split('|||').map(s => s.trim()).filter(s => s);
            
            if (msgsToSend.length > 0) {
              // 模拟真人连发，每条消息间隔 1.5 ~ 2.5 秒
              let delayTime = 0;
              for (const text of msgsToSend) {
                ctx.system.timers.setTimeout(() => {
                  ctx.data.messages.push({
                    sessionId: session.id,
                    role: "assistant",
                    content: text
                  });
                }, delayTime);
                delayTime += 1500 + Math.random() * 1000; 
              }
            } else {
              resetTimer(session.id, charId);
            }
          } else {
            resetTimer(session.id, charId);
          }
        } catch (err) {
          ctx.system.log("主动发消息失败", err);
          // 失败的话，5 分钟后再试
          ctx.data.variables.set("poke_last_chat", now - targetDelay + 300000, "session", session.id);
        }
      }
    }, 60000);
    // 渲染高颜值设置面板
    ctx.ui.slot("settings.section", (el) => {
      const chars = ctx.data.characters.list();
      const optionsHtml = chars.map(c => `<option value="${c.id}">${c.name}</option>`).join("");
      
      el.innerHTML = `
        <div class="poke-panel">
          <h3 class="poke-title">✨ 角色独立出击设置</h3>
          
          <div class="poke-group">
            <label class="poke-label">选择要设置的角色</label>
            <select id="poke-char-select" class="poke-control">
              <option value="">-- 请选择 --</option>
              ${optionsHtml}
            </select>
          </div>
          
          <div id="poke-char-config" style="display:none; flex-direction:column; gap:16px;">
            <div class="poke-group">
              <label class="poke-label">主动频率 (每次触发会在区间内随机波动)</label>
              <select id="poke-freq" class="poke-control">
                <option value="disabled">关闭 (不会主动找你)</option>
                <option value="clingy">纯粘人精来的 (5分钟 - 10分钟)</option>
                <option value="extreme">极高 (10分钟 - 30分钟)</option>
                <option value="ultra_high">超高 (30分钟 - 1小时)</option>
                <option value="high">高 (1小时 - 3小时)</option>
                <option value="medium">中 (3小时 - 5小时)</option>
                <option value="low">低 (5小时 - 8小时)</option>
                <option value="ultra_low">超低 (8小时 - 10小时)</option>
                <option value="indifferent">你情感淡漠吧 (10小时 - 24小时)</option>
              </select>
            </div>
            
            <div class="poke-group">
              <label class="poke-label">睡眠免打扰时间 (期间绝对安静)</label>
              <div class="poke-row">
                <input type="time" id="poke-sleep-start" class="poke-control">
                <span style="color:#888; font-size:14px;">至</span>
                <input type="time" id="poke-sleep-end" class="poke-control">
              </div>
            </div>
            
            <button id="poke-save-btn" class="poke-btn">保存该角色设置</button>
          </div>
        </div>
      `;
      const selectEl = el.querySelector("#poke-char-select");
      const configEl = el.querySelector("#poke-char-config");
      const freqEl = el.querySelector("#poke-freq");
      const startEl = el.querySelector("#poke-sleep-start");
      const endEl = el.querySelector("#poke-sleep-end");
      const saveBtn = el.querySelector("#poke-save-btn");
      // 切换角色时回显数据
      selectEl.addEventListener("change", () => {
        const charId = selectEl.value;
        if (!charId) {
          configEl.style.display = "none";
          return;
        }
        configEl.style.display = "flex";
        freqEl.value = ctx.data.variables.get("poke_freq", "character", charId) || "disabled";
        startEl.value = ctx.data.variables.get("poke_sleep_start", "character", charId) || "23:00";
        endEl.value = ctx.data.variables.get("poke_sleep_end", "character", charId) || "07:00";
      });
      // 保存配置
      saveBtn.addEventListener("click", () => {
        const charId = selectEl.value;
        if (!charId) return;
        ctx.data.variables.set("poke_freq", freqEl.value, "character", charId);
        ctx.data.variables.set("poke_sleep_start", startEl.value, "character", charId);
        ctx.data.variables.set("poke_sleep_end", endEl.value, "character", charId);
        
        const targetSession = ctx.data.sessions.list().find(s => !s.isGroup && s.contactId === charId);
        if (targetSession) resetTimer(targetSession.id, charId);
        ctx.ui.toast("设置保存完毕，坐等贴贴啦！✨");
      });
    });
  }
};
