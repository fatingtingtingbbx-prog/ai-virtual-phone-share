export default {
  manifest: {
    id: "device-battery",
    name: "设备电量感知",
    apiVersion: 1,
    version: "1.1.0",
    author: "穆叶",
    description:
      "让角色知道手机电量，低电量且未充电时每隔一段时间提醒，并在状态变化时弹出提示",
    permissions: ["battery.read"],
    settings: [
      {
        key: "enableReminder",
        label: "启用低电量提醒",
        type: "boolean",
        default: true,
      },
      {
        key: "threshold",
        label: "低电量提醒阈值（%）",
        type: "number",
        default: 20,
      },
      {
        key: "alertInterval",
        label: "提醒间隔（分钟）",
        type: "number",
        default: 30,
      },
    ],
  },
  setup(ctx) {
    let battery = null;
    const unsubList = [];

    // 控制低电量 Toast 只提醒一次，直到条件解除
    let lowBatteryToastShown = false;
    // 记录上一次的充电状态，用于检测“接入电源”的瞬间
    let wasCharging = null;

    // 更新变量池，并处理 Toast 提示
    function updateBatteryVars() {
      if (!battery) return;
      const level = Math.round(battery.level * 100);
      const charging = battery.charging;
      ctx.data.variables.set("battery.level", level, "global");
      ctx.data.variables.set("battery.charging", charging, "global");

      const threshold = ctx.system.settings.get("threshold") ?? 20;
      const remindEnabled = ctx.system.settings.get("enableReminder") !== false;

      // 只有启用提醒时才执行 Toast 提示
      if (remindEnabled) {
        // 1. 低电量 Toast：首次跌破阈值且未充电时提醒
        if (!charging && level < threshold && !lowBatteryToastShown) {
          ctx.ui.toast(`当前手机电量为${level}%，请及时充电`, {
            durationMs: 4000,
          });
          lowBatteryToastShown = true;
        }
        // 当条件解除（回升到阈值以上或接入电源），重置低电量提醒标记，允许下次再提醒
        if ((level >= threshold || charging) && lowBatteryToastShown) {
          lowBatteryToastShown = false;
        }

        // 2. 接入电源 Toast：从未充电变为充电时提示
        if (wasCharging === false && charging) {
          ctx.ui.toast("手机已接入电源", { durationMs: 3000 });
        }
      }

      // 更新充电状态记录（首次调用时 wasCharging 为 null，直接赋值而不提示）
      wasCharging = charging;

      // 原有逻辑：条件不再满足时清除间隔提醒计时器
      if (level >= threshold || charging || !remindEnabled) {
        ctx.system.storage.remove("lastLowBatteryAlert");
      }
    }

    // 提示词注入：始终注入基础电量信息，提醒内容受开关控制
    const unregPrompt = ctx.hooks.transform("prompt.system", (p) => {
      const level = ctx.data.variables.get("battery.level", "global");
      if (level == null) return p;

      const charging = ctx.data.variables.get("battery.charging", "global");
      const status = charging ? "正在充电" : "未充电";
      let hintText = `\n[系统信息] 当前手机剩余电量：${level}%，${status}。`;

      const remindEnabled =
        ctx.system.settings.get("enableReminder") !== false;
      if (remindEnabled) {
        const threshold = ctx.system.settings.get("threshold") ?? 20;
        const intervalMin = ctx.system.settings.get("alertInterval") ?? 30;

        // 低电量且未充电时，按间隔周期注入提醒提示词
        if (level < threshold && !charging) {
          const now = Date.now();
          const lastAlert = ctx.system.storage.get("lastLowBatteryAlert");
          if (!lastAlert || now - lastAlert > intervalMin * 60000) {
            hintText += `\n[系统重要提醒] {{user}}手机电量仅剩${level}%，请立刻在回复中提醒{{user}}及时充电。`;
            ctx.system.storage.set("lastLowBatteryAlert", now);
          }
        }
      }

      p.hint = (p.hint || "") + hintText;
      return p;
    });
    unsubList.push(unregPrompt);

    // 监听设置变化：阈值、间隔或提醒开关变动时，重置提醒计时器以便新规则立即生效
    const unsubSetting = ctx.system.settings.onChange((key) => {
      if (
        key === "threshold" ||
        key === "alertInterval" ||
        key === "enableReminder"
      ) {
        ctx.system.storage.remove("lastLowBatteryAlert");
      }
    });
    unsubList.push(unsubSetting);

    // 初始化电池监听
    if (navigator && typeof navigator.getBattery === "function") {
      navigator
        .getBattery()
        .then((bm) => {
          battery = bm;
          // 初始化充电状态记录，避免首次触发错误的“已接入电源”提示
          wasCharging = battery.charging;
          updateBatteryVars();
          const level = Math.round(battery.level * 100);
          const status = battery.charging ? "充电中" : "未充电";
          ctx.ui.toast(`🔋 电量读取成功：${level}%，${status}`, {
            durationMs: 3000,
          });

          battery.addEventListener("levelchange", updateBatteryVars);
          battery.addEventListener("chargingchange", updateBatteryVars);
        })
        .catch(() => {
          ctx.ui.toast("⚠️ 电量信息不可用（被宿主限制或API不支持）", {
            durationMs: 5000,
          });
        });
    } else {
      ctx.ui.toast("⚠️ 当前环境不支持电池API", { durationMs: 5000 });
    }

    return () => {
      if (battery) {
        battery.removeEventListener("levelchange", updateBatteryVars);
        battery.removeEventListener("chargingchange", updateBatteryVars);
      }
      unsubList.forEach((fn) => fn());
    };
  },
};
