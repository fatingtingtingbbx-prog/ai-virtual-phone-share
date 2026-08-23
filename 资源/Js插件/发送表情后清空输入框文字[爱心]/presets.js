export default {
  manifest: {
    id: "sticker-input-cleaner-v2",
    name: "发表情后清空输入框",
    apiVersion: 1,
    version: "1.0.1",
    author: "吕布",
    description: "解决发送表情包后的文字残留问题",
  },
  setup(ctx) {
    // 核心函数：模拟人类的“全选并删除”操作
    const humanLikeClear = () => {
      // 找到所有可能的输入框（文本框、单行框、富文本框）
      const inputs = document.querySelectorAll('textarea, input, [contenteditable="true"]');
      
      inputs.forEach(el => {
        // 排除掉隐藏的框，只处理当前可见的输入框
        if (el.offsetWidth === 0 || el.offsetHeight === 0) return;

        try {
          el.focus();
          
          // --- 核心技巧：使用浏览器原生的命令机制 ---
          // 这会触发宿主框架的所有监听器，就像是你亲手删掉的一样
          if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
            el.select(); // 全选文字
            document.execCommand('delete', false, null); // 执行删除指令
          } else {
            // 针对富文本框 (contenteditable)
            const range = document.createRange();
            range.selectNodeContents(el);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
            document.execCommand('delete', false, null);
          }

          // --- 兜底补丁：如果上面没清空掉，再强制清一次并触发事件 ---
          if (el.value || el.innerHTML) {
            el.value = '';
            el.innerHTML = '';
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }
        } catch (err) {
          console.error("清空失败:", err);
        }
      });
    };

    // 监听消息落库事件（这是确认消息已发出的最稳妥点）
    ctx.hooks.on("message.persisted", (payload) => {
      const msg = payload.message;
      // 只要是用户发的消息（包含表情包指令）
      if (msg && msg.role === "user") {
        // 设置多个时间点“补刀”，防止宿主异步把文字又塞回去
        // 立即执行一次，50ms执行一次，200ms执行一次
        humanLikeClear();
        setTimeout(humanLikeClear, 50);
        setTimeout(humanLikeClear, 200);
      }
    });

    // 额外监听发送动作的前置触发
    ctx.hooks.transform("user.beforeSend", (payload) => {
      // 准备发送的一瞬间也执行清空
      setTimeout(humanLikeClear, 0);
      return payload;
    });
  },
};