/**
 * 记忆共享与实时同步插件 (apiVersion: 1)
 */
export default {
  manifest: {
    id: "memory-transfer-plugin",
    name: "记忆实时同步",
    apiVersion: 1,
    version: "1.5.0",
    author: "小坊",
    description: "在两个角色之间建立双向绑定，使他们的长期记忆、核心记忆以及最新短期聊天事件保持完全一致。",
    settings: [
      {
        key: "recentCount",
        label: "共享短期记忆消息数",
        type: "number",
        default: 10,
      }
    ],
  },

  setup(ctx) {
    const DB_NAME = "ai_phone_memory_db_v1";
    const STORE_NAME = "memories";
    const STORAGE_KEY = "active_memory_sync_pairs";

    // 内存中缓存的同步关系: { [charId]: [targetCharId, ...] }
    let syncPairs = {};
    let isSyncing = false; // 防止重入锁

    // 从存储中加载同步配对
    async function initSyncPairs() {
      const stored = await ctx.system.storage.get(STORAGE_KEY);
      if (stored) {
        try {
          syncPairs = JSON.parse(stored);
        } catch (e) {
          syncPairs = {};
        }
      }
    }

    // 保存同步配对
    async function saveSyncPairs(pairs) {
      syncPairs = pairs;
      await ctx.system.storage.set(STORAGE_KEY, JSON.stringify(pairs));
    }

    // 辅助函数：打开记忆数据库
    function openMemoryDb() {
      return new Promise((resolve, reject) => {
        if (typeof indexedDB === "undefined") {
          return reject(new Error("IndexedDB 不可用"));
        }
        const req = indexedDB.open(DB_NAME);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }

    // 辅助函数：加载指定角色的所有数据库记忆
    async function loadCharacterMemories(characterId) {
      const db = await openMemoryDb();
      return new Promise((resolve, reject) => {
        try {
          const tx = db.transaction(STORE_NAME, "readonly");
          const store = tx.objectStore(STORE_NAME);
          const req = store.getAll();
          req.onsuccess = () => {
            const all = req.result || [];
            const filtered = all.filter((m) => m.characterId === characterId);
            resolve(filtered);
          };
          req.onerror = () => reject(req.error);
        } catch (e) {
          reject(e);
        } finally {
          db.close();
        }
      });
    }

    // ── 格式化指定绑定的角色B的短期记忆文本 ──
    function getCharacterShortTermText(charId, limit) {
      const characters = ctx.data.characters.list() || [];
      const char = characters.find((c) => c.id === charId);
      if (!char) return "";

      const sessions = ctx.data.sessions.list() || [];
      const charSession = sessions.find((s) => !s.isGroup && s.contactId === charId);
      if (!charSession) return "";

      const messages = ctx.data.messages.list(charSession.id) || [];
      const recentMsgs = messages
        .filter(
          (m) =>
            m.content &&
            m.content.trim() &&
            m.mediaType !== "memory_write_request" &&
            m.mediaType !== "tool_notice"
        )
        .slice(-limit);

      if (recentMsgs.length === 0) return "";

      const formatted = recentMsgs
        .map((m) => {
          const sender = m.role === "assistant" ? (char.name || "角色") : "用户";
          return `${sender}: ${m.content.trim()}`;
        })
        .join("\n");

      return `【这是 ${char.name || "绑定角色"} 的短期记忆】\n${formatted}`;
    }

    // ── 拦截 LLM 请求，重构短期记忆大版块 ──
    ctx.hooks.transform("llm.request", async (payload) => {
      if (!payload.sessionId || !payload.messages) return payload;

      const session = ctx.data.sessions.get(payload.sessionId);
      const charAId = session?.contactId;
      if (!charAId) return payload;

      const targets = syncPairs[charAId] || [];
      if (targets.length === 0) return payload;

      const characters = ctx.data.characters.list() || [];
      const charA = characters.find((c) => c.id === charAId);
      const charAName = charA ? charA.name : "当前角色";

      // 读取限制设置
      const limitSetting = ctx.system.settings.get("recentCount");
      const limit = typeof limitSetting === "number" && limitSetting > 0 ? limitSetting : 10;

      // 组装所有绑定角色 B 的短期记忆大版块
      let bMemoriesText = "";
      targets.forEach((targetId) => {
        const text = getCharacterShortTermText(targetId, limit);
        if (text) {
          bMemoriesText += text + "\n\n";
        }
      });

      if (!bMemoriesText) return payload;

      // 构造插入内容：B的短期大版块 + A的短期大版块头部标识
      const replacement = `${bMemoriesText}【这是 ${charAName} 的短期记忆】\n<shortTermMemory>`;

      // 在消息历史中寻找包含 <shortTermMemory> 标签的 System 消息并替换之
      payload.messages = payload.messages.map((msg) => {
        if (typeof msg.content === "string" && msg.content.includes("<shortTermMemory>")) {
          return {
            ...msg,
            content: msg.content.replace("<shortTermMemory>", replacement),
          };
        } else if (Array.isArray(msg.content)) {
          const newContent = msg.content.map((part) => {
            if (part.type === "text" && part.text.includes("<shortTermMemory>")) {
              return {
                ...part,
                text: part.text.replace("<shortTermMemory>", replacement),
              };
            }
            return part;
          });
          return { ...msg, content: newContent };
        }
        return msg;
      });

      return payload;
    });


    // ── 底层数据库变更拦截（长期/核心记忆实时同步） ──

    // 拦截写入
    const originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      if (
        this.name === STORE_NAME &&
        value &&
        typeof value === "object" &&
        value.characterId &&
        !isSyncing
      ) {
        const sourceCharId = value.characterId;
        const targets = syncPairs[sourceCharId];
        if (targets && targets.length > 0) {
          const store = this;
          targets.forEach((targetId) => {
            const cleanId = value.id.split("_sync_")[0];
            const clonedId = `${cleanId}_sync_${targetId}`;
            
            const clonedValue = {
              ...value,
              id: clonedId,
              characterId: targetId,
              metadata: {
                ...(value.metadata || {}),
                syncSourceId: value.id,
                syncSourceChar: sourceCharId,
              },
            };

            isSyncing = true;
            try {
              originalPut.call(store, clonedValue);
            } catch (e) {
              console.error("Memory Sync Error (put):", e);
            } finally {
              isSyncing = false;
            }
          });
        }
      }
      return originalPut.apply(this, arguments);
    };

    // 拦截删除
    const originalDelete = IDBObjectStore.prototype.delete;
    IDBObjectStore.prototype.delete = function (key) {
      if (this.name === STORE_NAME && typeof key === "string" && !isSyncing) {
        const store = this;
        Object.keys(syncPairs).forEach((sourceId) => {
          const targets = syncPairs[sourceId] || [];
          targets.forEach((targetId) => {
            const cleanKey = key.split("_sync_")[0];
            const clonedId = `${cleanKey}_sync_${targetId}`;
            isSyncing = true;
            try {
              originalDelete.call(store, clonedId);
            } catch (e) {
              // 忽略静默异常
            } finally {
              isSyncing = false;
            }
          });
        });
      }
      return originalDelete.apply(this, arguments);
    };

    // ── 历史记忆双向合并对齐 ──
    async function alignHistoricalMemories(charA, charB) {
      const memsA = await loadCharacterMemories(charA);
      const memsB = await loadCharacterMemories(charB);

      const db = await openMemoryDb();
      return new Promise((resolve, reject) => {
        try {
          const tx = db.transaction(STORE_NAME, "readwrite");
          const store = tx.objectStore(STORE_NAME);

          const getCleanId = (id) => id.split("_sync_")[0];
          const keysA = new Set(memsA.map((m) => getCleanId(m.id)));
          const keysB = new Set(memsB.map((m) => getCleanId(m.id)));

          let writeCount = 0;

          memsA.forEach((mem) => {
            const cleanId = getCleanId(mem.id);
            if (!keysB.has(cleanId)) {
              const cloned = {
                ...mem,
                id: `${cleanId}_sync_${charB}`,
                characterId: charB,
              };
              store.put(cloned);
              writeCount++;
            }
          });

          memsB.forEach((mem) => {
            const cleanId = getCleanId(mem.id);
            if (!keysA.has(cleanId)) {
              const cloned = {
                ...mem,
                id: `${cleanId}_sync_${charA}`,
                characterId: charA,
              };
              store.put(cloned);
              writeCount++;
            }
          });

          tx.oncomplete = () => {
            db.close();
            resolve(writeCount);
          };
          tx.onerror = () => {
            db.close();
            reject(tx.error);
          };
        } catch (e) {
          db.close();
          reject(e);
        }
      });
    }

    // 初始化加载
    initSyncPairs();

    // ── UI 交互模块（纯净黑白灰、无 Emoji） ──
    function openTransferModal() {
      ctx.ui.openModal(async (el, { close }) => {
        el.style.maxWidth = "380px";
        el.style.padding = "24px";
        el.style.borderRadius = "8px";
        el.style.backgroundColor = "#ffffff";
        el.style.boxShadow = "0 4px 20px rgba(0, 0, 0, 0.08)";
        el.style.fontFamily = "-apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif";

        const characters = ctx.data.characters.list() || [];

        if (characters.length < 2) {
          el.innerHTML = `
            <div style="font-size: 14px; font-weight: 600; color: #000000; margin-bottom: 12px; letter-spacing: -0.2px;">记忆实时同步</div>
            <div style="font-size: 12px; color: #666666; line-height: 1.6; margin-bottom: 20px;">
              当前系统内的角色数量不足 2 个。请先创建或导入更多角色。
            </div>
            <div style="display: flex; justify-content: flex-end;">
              <button id="close-btn" style="padding: 6px 14px; font-size: 12px; border-radius: 4px; border: 1px solid #e5e5e5; background: #ffffff; color: #000000; cursor: pointer;">关闭</button>
            </div>
          `;
          el.querySelector("#close-btn").onclick = close;
          return;
        }

        el.innerHTML = `
          <div style="font-size: 15px; font-weight: 600; color: #000000; margin-bottom: 4px; letter-spacing: -0.2px;">记忆实时同步</div>
          <div style="font-size: 11px; color: #888888; margin-bottom: 20px; line-height: 1.5;">
            在两名角色间建立双向绑定。绑定后，任何一方产生的新记忆（短期、长期、核心）和聊天事件都将实时同步共享。
          </div>

          <div style="display: flex; flex-direction: column; gap: 16px;">
            <div>
              <label style="display: block; font-size: 11px; font-weight: 600; text-transform: uppercase; margin-bottom: 6px; color: #333333; letter-spacing: 0.5px;">选择角色一</label>
              <select id="char-a" style="width: 100%; padding: 8px 10px; border-radius: 4px; border: 1px solid #e5e5e5; font-size: 12px; background: #ffffff; color: #000000; outline: none;">
                ${characters.map((c) => `<option value="${c.id}">${c.name || "未命名"}</option>`).join("")}
              </select>
              <div id="char-a-count" style="font-size: 11px; color: #888888; margin-top: 4px;">读取中...</div>
            </div>

            <div style="height: 1px; background: #f0f0f0; margin: 2px 0;"></div>

            <div>
              <label style="display: block; font-size: 11px; font-weight: 600; text-transform: uppercase; margin-bottom: 6px; color: #333333; letter-spacing: 0.5px;">选择角色二</label>
              <select id="char-b" style="width: 100%; padding: 8px 10px; border-radius: 4px; border: 1px solid #e5e5e5; font-size: 12px; background: #ffffff; color: #000000; outline: none;">
                ${characters.map((c, i) => `<option value="${c.id}" ${i === 1 ? "selected" : ""}>${c.name || "未命名"}</option>`).join("")}
              </select>
              <div id="char-b-count" style="font-size: 11px; color: #888888; margin-top: 4px;">读取中...</div>
            </div>

            <div style="height: 1px; background: #f0f0f0; margin: 2px 0;"></div>

            <div>
              <label style="display: block; font-size: 11px; font-weight: 600; text-transform: uppercase; margin-bottom: 6px; color: #333333; letter-spacing: 0.5px;">共享短期记忆条数</label>
              <input id="recent-count-input" type="number" min="1" max="50" style="width: 100%; padding: 8px 10px; border-radius: 4px; border: 1px solid #e5e5e5; font-size: 12px; background: #ffffff; color: #000000; outline: none;" />
              <div style="font-size: 11px; color: #888888; margin-top: 4px;">设置两名角色各自读取对方最新短期聊天事件的条数</div>
            </div>

            <div id="status-box" style="font-size: 11px; color: #ff3b30; min-height: 16px; line-height: 1.5;"></div>

            <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px;">
              <button id="unbind-btn" style="padding: 7px 14px; border-radius: 4px; border: 1px solid #ff3b30; background: #ffffff; color: #ff3b30; font-size: 12px; cursor: pointer; display: none;">解除绑定</button>
              <button id="cancel-btn" style="padding: 7px 14px; border-radius: 4px; border: 1px solid #e5e5e5; background: #ffffff; color: #666666; font-size: 12px; cursor: pointer;">取消</button>
              <button id="sync-btn" style="padding: 7px 16px; border-radius: 4px; border: none; background: #000000; color: #ffffff; font-size: 12px; font-weight: 500; cursor: pointer;">绑定并同步</button>
            </div>
          </div>
        `;

        const charASelect = el.querySelector("#char-a");
        const charBSelect = el.querySelector("#char-b");
        const countA = el.querySelector("#char-a-count");
        const countB = el.querySelector("#char-b-count");
        const statusBox = el.querySelector("#status-box");
        const syncBtn = el.querySelector("#sync-btn");
        const unbindBtn = el.querySelector("#unbind-btn");
        const cancelBtn = el.querySelector("#cancel-btn");
        const recentCountInput = el.querySelector("#recent-count-input");

        // 初始化读取当前的设置值
        const currentLimit = ctx.system.settings.get("recentCount") || 10;
        recentCountInput.value = currentLimit;

        // 输入框变化时保存设置
        recentCountInput.onchange = () => {
          let val = parseInt(recentCountInput.value, 10);
          if (isNaN(val) || val < 1) val = 10;
          recentCountInput.value = val;
          ctx.system.settings.set("recentCount", val);
        };

        cancelBtn.onclick = close;

        async function updateView() {
          const aId = charASelect.value;
          const bId = charBSelect.value;

          countA.textContent = "读取中...";
          countB.textContent = "读取中...";

          try {
            const listA = await loadCharacterMemories(aId);
            countA.textContent = `当前记忆数: ${listA.length}`;
          } catch (e) {
            countA.textContent = "读取失败";
          }

          try {
            const listB = await loadCharacterMemories(bId);
            countB.textContent = `当前记忆数: ${listB.length}`;
          } catch (e) {
            countB.textContent = "读取失败";
          }

          const aTargets = syncPairs[aId] || [];
          if (aTargets.includes(bId)) {
            statusBox.style.color = "#34c759";
            statusBox.textContent = "状态: 已建立实时同步绑定";
            syncBtn.style.display = "none";
            unbindBtn.style.display = "block";
          } else {
            statusBox.style.color = "#ff3b30";
            statusBox.textContent = "";
            syncBtn.style.display = "block";
            unbindBtn.style.display = "none";

            if (aId === bId) {
              statusBox.textContent = "错误: 无法与自身建立同步";
              syncBtn.disabled = true;
              syncBtn.style.background = "#f5f5f5";
              syncBtn.style.color = "#cccccc";
            } else {
              syncBtn.disabled = false;
              syncBtn.style.background = "#000000";
              syncBtn.style.color = "#ffffff";
            }
          }
        }

        charASelect.onchange = updateView;
        charBSelect.onchange = updateView;
        await updateView();

        // 绑定动作
        syncBtn.onclick = async () => {
          const aId = charASelect.value;
          const bId = charBSelect.value;

          if (aId === bId) return;

          statusBox.style.color = "#000000";
          statusBox.textContent = "正在双向合并历史数据...";
          syncBtn.disabled = true;

          try {
            const copiedCount = await alignHistoricalMemories(aId, bId);

            const updatedPairs = { ...syncPairs };
            if (!updatedPairs[aId]) updatedPairs[aId] = [];
            if (!updatedPairs[aId].includes(bId)) updatedPairs[aId].push(bId);

            if (!updatedPairs[bId]) updatedPairs[bId] = [];
            if (!updatedPairs[bId].includes(aId)) updatedPairs[bId].push(aId);

            await saveSyncPairs(updatedPairs);

            ctx.ui.toast(`同步成功，已双向对齐 ${copiedCount} 条历史记忆`);
            close();
          } catch (err) {
            statusBox.style.color = "#ff3b30";
            statusBox.textContent = "同步失败: " + (err.message || String(err));
            syncBtn.disabled = false;
          }
        };

        // 解除绑定动作
        unbindBtn.onclick = async () => {
          const aId = charASelect.value;
          const bId = charBSelect.value;

          const updatedPairs = { ...syncPairs };
          if (updatedPairs[aId]) {
            updatedPairs[aId] = updatedPairs[aId].filter((id) => id !== bId);
            if (updatedPairs[aId].length === 0) delete updatedPairs[aId];
          }
          if (updatedPairs[bId]) {
            updatedPairs[bId] = updatedPairs[bId].filter((id) => id !== aId);
            if (updatedPairs[bId].length === 0) delete updatedPairs[bId];
          }

          await saveSyncPairs(updatedPairs);
          ctx.ui.toast("已解除两角色的同步绑定");
          close();
        };
      });
    }

    // ── 插件设置界面入口 ──
    ctx.ui.slot("settings.section", (el) => {
      el.innerHTML = `
        <div style="padding: 16px; background: #ffffff; border: 1px solid #e5e5e5; border-radius: 6px; margin-bottom: 16px; font-family: -apple-system, BlinkMacSystemFont, sans-serif;">
          <div style="font-size: 13px; font-weight: 600; color: #000000; margin-bottom: 4px; letter-spacing: -0.1px;">记忆同步管理</div>
          <div style="font-size: 11px; color: #666666; margin-bottom: 12px; line-height: 1.4;">
            配置角色之间的记忆实时同步与双向绑定，使其长期、核心记忆以及最新短期聊天事件保持全量对齐。
          </div>
          <button id="open-transfer-modal-btn" style="padding: 6px 14px; background: #000000; color: #ffffff; border: none; border-radius: 4px; font-size: 12px; font-weight: 500; cursor: pointer; transition: background 0.2s;">
            配置实时同步
          </button>
        </div>
      `;
      const btn = el.querySelector("#open-transfer-modal-btn");
      if (btn) btn.onclick = openTransferModal;
    });
  },
};