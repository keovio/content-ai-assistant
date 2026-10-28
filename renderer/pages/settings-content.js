"use strict";
// 设置页里的两个分组：AI 模型、账号定位。必须在 shell/pages/settings.js 之后加载（用到 registerSettingsSection）。
(function () {
  const { h } = window.Shell;
  const api = window.app;
  const C = window.Content;

  // 文本设置项：失焦或回车时保存
  function textInput(key, { placeholder = "", multiline = false, rows = 2 } = {}) {
    const el = h(multiline ? "textarea" : "input", { class: "input", placeholder, rows: multiline ? rows : undefined });
    el.value = window.Shell.getSettings()[key] || "";
    const commit = () => { if (el.value !== (window.Shell.getSettings()[key] || "")) window.Shell.saveSettings({ [key]: el.value.trim() }); };
    el.addEventListener("change", commit);
    if (!multiline) el.addEventListener("keydown", (e) => { if (e.key === "Enter") commit(); });
    window.Shell.onSettings((c, s) => { if (key in c && document.activeElement !== el) el.value = s[key] || ""; });
    return el;
  }

  window.Shell.registerSettingsSection({
    id: "ai", title: "AI 模型", icon: "spark", order: 5,
    render(box) {
      const { row, range } = window.Shell.settingsUI;
      const provSel = h("select", { class: "input" });
      const keyIn = h("input", { class: "input", type: "password", placeholder: "粘贴 API Key", autocomplete: "off" });
      const keyState = h("span", { class: "muted small-text" });
      const testOut = h("span", { class: "muted small-text" });

      C.meta().then((m) => {
        provSel.replaceChildren(...m.providers.map((p) => h("option", { value: p.id }, p.name)));
        provSel.value = window.Shell.getSettings().aiProvider;
      }).catch(window.Shell.reportError);
      provSel.addEventListener("change", () => C.call(api.ai.useProvider(provSel.value)).catch(C.err));
      window.Shell.onSettings((c, s) => { if ("aiProvider" in c) provSel.value = s.aiProvider; });

      async function showKey() {
        try {
          const k = await C.call(api.ai.keyInfo());
          keyState.textContent = k.set ? `已保存（…${k.tail}）${k.encrypted ? "，已用系统钥匙串加密" : "，系统不支持加密，仅做了编码"}` : "还没有保存 API Key";
        } catch (e) { keyState.textContent = e.message; }
      }
      const saveKey = async () => {
        if (!keyIn.value.trim()) { window.Shell.toast("先粘贴 API Key", "info"); return; }
        try { await C.call(api.ai.setKey(keyIn.value.trim())); keyIn.value = ""; window.Shell.toast("API Key 已保存", "success"); showKey(); } catch (e) { C.err(e); }
      };
      keyIn.addEventListener("keydown", (e) => { if (e.key === "Enter") saveKey(); });
      showKey();

      box.append(
        row("服务商", "选一个预设会自动填好接口地址和常用模型；其他 OpenAI 兼容服务选「自定义」", provSel),
        row("接口地址", "OpenAI 兼容的 Base URL，例如 https://api.deepseek.com", textInput("aiBaseUrl", { placeholder: "https://…" }), { stack: true }),
        row("模型", "例如 deepseek-chat、qwen-plus、moonshot-v1-8k、glm-4-flash", textInput("aiModel", { placeholder: "模型名" })),
        row("API Key", keyState, h("div", { class: "actions" }, keyIn,
          h("button", { class: "btn", onclick: saveKey }, "保存"),
          h("button", { class: "btn ghost", onclick: async () => {
            if (!(await window.Shell.confirm("清除已保存的 API Key？"))) return;
            await C.call(api.ai.setKey("")).catch(C.err); showKey();
          } }, "清除")), { stack: true }),
        row("创意程度", "越高越发散，越低越稳。写稿建议 0.7", range("aiTemperature", { min: 0, max: 1.5, step: 0.1, format: (v) => v.toFixed(1) })),
        row("测试连接", testOut, h("button", { class: "btn", onclick: async (e) => {
          const b = e.currentTarget; b.disabled = true; testOut.textContent = "正在测试…";
          try { const r = await C.call(api.ai.test()); testOut.textContent = `连接正常：${r.model}，${r.ms} ms，回复「${r.reply}」`; }
          catch (err) { testOut.textContent = err.message; }
          finally { b.disabled = false; }
        } }, "测试")));
    },
  });

  window.Shell.registerSettingsSection({
    id: "brand", title: "账号定位", icon: "user", order: 6,
    render(box) {
      const { row, select } = window.Shell.settingsUI;
      box.append(
        h("p", { class: "card-desc" }, "这些信息会写进每一次 AI 请求，让选题和文章都贴合你的账号。"),
        row("账号名", null, textInput("brandName", { placeholder: "例如：小林的效率笔记" })),
        row("账号定位", "写什么、给谁带来什么价值", textInput("brandPositioning", { multiline: true, placeholder: "例如：分享普通上班族能马上用上的 AI 效率工具和方法" }), { stack: true }),
        row("目标读者", null, textInput("brandAudience", { multiline: true, placeholder: "例如：25–35 岁的职场人，想提升效率但没时间研究技术" }), { stack: true }),
        row("语气风格", null, textInput("brandTone", { placeholder: "例如：真诚、干货、略带幽默，不说教" }), { stack: true }),
        row("默认平台", "写稿页默认选中的平台", select("defaultPlatform", Object.entries(C.PLATFORM_NAMES))));
    },
  });
})();
