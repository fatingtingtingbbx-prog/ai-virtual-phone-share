export default {
  manifest: {
    id: "png-chara-parser",
    name: "PNG角色卡解析器",
    apiVersion: 1,
    version: "1.0.0",
    author: "小卷",
    description: "在聊天界面增加一个按钮，直接选择PNG图片并解析出角色卡数据。",
  },
  setup(ctx) {
    // 注入全局样式
    ctx.ui.injectCSS(`
      .png-parser-btn {
        background: #f0f2f5;
        border: 1px solid #ddd;
        border-radius: 20px;
        padding: 5px 12px;
        font-size: 13px;
        color: #555;
        cursor: pointer;
        margin: 5px 0;
        display: inline-flex;
        align-items: center;
        gap: 4px;
      }
      .png-parser-btn:active { background: #e0e2e5; }
      .png-parser-modal {
        padding: 20px;
        background: #fff;
        border-radius: 12px;
        max-height: 80vh;
        overflow-y: auto;
        font-size: 14px;
        line-height: 1.6;
        word-break: break-word;
      }
      .png-parser-modal h4 { margin: 0 0 15px 0; color: #333; font-size: 16px; border-bottom: 1px solid #eee; padding-bottom: 8px;}
      .png-parser-field { margin-bottom: 12px; }
      .png-parser-label { font-weight: bold; color: #4a90e2; font-size: 13px; display: block; margin-bottom: 4px;}
      .png-parser-value { background: #f8f9fa; padding: 8px 12px; border-radius: 6px; border: 1px solid #eee; white-space: pre-wrap; user-select: text; }
      .png-parser-empty { color: #888; text-align: center; padding: 20px 0; }
    `);
// 在输入框上方增加一个按钮
    ctx.ui.slot("chat.inputToolbar", (el) => {
      const btnLabel = document.createElement("label");
      btnLabel.className = "png-parser-btn";
      btnLabel.innerHTML = '🔍 解析PNG角色卡<input type="file" accept=".png" style="display:none">';
      
      const fileInput = btnLabel.querySelector("input");
      
      fileInput.addEventListener("change", (e) => {
        const file = e.target.files[0];
        if (!file) return;
        fileInput.value = ''; // 清空，允许重复选同一张图
const toast = ctx.ui.toast("解析中...", { durationMs: 0 });
        
        const reader = new FileReader();
        reader.onload = (evt) => {
          try {
             parsePng(evt.target.result, file.name);
          } catch(err) {
             ctx.ui.toast("解析失败：" + err.message);
          } finally {
             toast.close();
          }
        };
        reader.onerror = () => { toast.close(); ctx.ui.toast("读取文件失败"); };
        reader.readAsArrayBuffer(file);
      });
el.appendChild(btnLabel);
      return () => { el.innerHTML = ""; }; // 清理
    });
    
    function b64DecodeUnicode(str) {
      try {
          return decodeURIComponent(atob(str).split('').map(function(c) {
              return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
          }).join(''));
      } catch (e) {
          return atob(str);
      }
    }
    
    function escapeHtml(unsafe) {
        return (unsafe || '').replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
    }
function parsePng(buffer, filename) {
        const view = new DataView(buffer);
        const uint8 = new Uint8Array(buffer);
if (view.getUint32(0) !== 0x89504e47) {
            ctx.ui.toast("不是有效的PNG文件！");
            return;
        }
let offset = 8;
        let found = false;
        let charaData = null;
while (offset < view.byteLength) {
            const length = view.getUint32(offset);
            const type = String.fromCharCode(...uint8.slice(offset + 4, offset + 8));
            const dataOffset = offset + 8;
if (type === 'tEXt' || type === 'iTXt') {
                const chunkData = uint8.slice(dataOffset, dataOffset + length);
                const nullIdx = chunkData.indexOf(0);
                if (nullIdx !== -1) {
                    const keyword = String.fromCharCode(...chunkData.slice(0, nullIdx));
                    if (keyword === 'chara') {
                        const textData = chunkData.slice(nullIdx + 1);
                        const base64Str = new TextDecoder('utf-8').decode(textData).replace(/\0/g, '');
                        const jsonStr = b64DecodeUnicode(base64Str);
                        charaData = JSON.parse(jsonStr);
                        found = true;
                        break;
                    }
                }
            }
            offset += 12 + length;
        }
if (!found) {
            ctx.ui.toast("没找到角色卡数据，可能是普通图片或被压缩过啦~");
            return;
        }
        
        showResultModal(charaData, filename);
    }
    
    function showResultModal(rawJson, filename) {
       const data = rawJson.data ? rawJson.data : rawJson;
       
       ctx.ui.openModal((el, { close }) => {
          let html = `<div class="png-parser-modal">
            <h4>解析结果：${escapeHtml(filename)}</h4>`;
            
          if(data.name) html += `<div class="png-parser-field"><span class="png-parser-label">名字</span><div class="png-parser-value">${escapeHtml(data.name)}</div></div>`;
          if(data.description) html += `<div class="png-parser-field"><span class="png-parser-label">人设 (Persona)</span><div class="png-parser-value">${escapeHtml(data.description)}</div></div>`;
          if(data.personality) html += `<div class="png-parser-field"><span class="png-parser-label">性格 (Personality)</span><div class="png-parser-value">${escapeHtml(data.personality)}</div></div>`;
          if(data.first_mes) html += `<div class="png-parser-field"><span class="png-parser-label">首条消息 (First Mes)</span><div class="png-parser-value">${escapeHtml(data.first_mes)}</div></div>`;
          if(data.mes_example) html += `<div class="png-parser-field"><span class="png-parser-label">对话示例 (Mes Example)</span><div class="png-parser-value">${escapeHtml(data.mes_example)}</div></div>`;
          if(data.scenario) html += `<div class="png-parser-field"><span class="png-parser-label">世界观/场景 (Scenario)</span><div class="png-parser-value">${escapeHtml(data.scenario)}</div></div>`;
          
          html += `</div>`;
          
          el.innerHTML = html;
       });
    }
  },
};
