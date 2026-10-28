"use strict";
// 设置页「业务设置」组：AI 模型、运营账号、平台账号（登录）、各平台写作规范、推送设置。
// 必须在 shell/pages/settings.js 之后加载（用到 registerSettingsSection）。
(function () {
  const { h } = window.Shell;
  const api = window.app;
  const C = window.Content;
  const COLORS = [["blue", "蓝"], ["violet", "紫"], ["pink", "粉"], ["orange", "橙"], ["green", "绿"], ["teal", "青"], ["graphite", "石墨"]];

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

  // ---------------- AI 模型 ----------------
  window.Shell.registerSettingsSection({
    id: "ai", title: "AI 模型", icon: "spark", order: 1,
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

  // ---------------- 运营账号 ----------------
  window.Shell.registerSettingsSection({
    id: "accounts", title: "运营账号与定位", icon: "user", order: 2,
    render(box) {
      const list = h("div", { class: "acct-list" });
      const formBox = h("div", {});
      box.append(h("p", { class: "card-desc" }, "每个账号一套定位，写稿、改写、选题都按当前账号的人设来。选题和稿件按账号分开，素材库和 AI 模型共用。侧栏顶部可以随时切换。"), list, formBox,
        h("div", { class: "actions" }, h("button", { class: "btn", onclick: () => edit(null) }, "＋ 新增账号")));

      function draw() {
        const cur = C.currentAccountId();
        list.replaceChildren(...C.getAccounts().map((a) => h("div", { class: "acct-row" + (a.id === cur ? " current" : "") },
          h("span", { class: `acct-color accent-${a.color}` }),
          h("div", { class: "grow" },
            h("div", { class: "acct-name" }, a.name, a.id === cur ? h("span", { class: "muted small-text" }, " · 当前") : null),
            h("div", { class: "acct-sub" }, a.positioning || "还没写定位")),
          a.id === cur ? null : h("button", { class: "btn small", onclick: () => C.switchAccount(a.id) }, "切换"),
          h("button", { class: "btn small ghost", onclick: () => edit(a) }, "编辑"),
          h("button", { class: "btn small danger-ghost", onclick: () => del(a) }, "删除"))));
      }
      function edit(a) {
        const v = a || { name: "", positioning: "", audience: "", tone: "", banned: "", color: COLORS[C.getAccounts().length % COLORS.length][0] };
        const name = h("input", { class: "input", value: v.name, placeholder: "例如：小林的效率笔记" });
        const pos = h("textarea", { class: "input", rows: 2, placeholder: "写什么、给谁带来什么价值。例如：分享普通上班族能马上用上的 AI 效率工具" }); pos.value = v.positioning;
        const aud = h("textarea", { class: "input", rows: 2, placeholder: "例如：25–35 岁职场人，想提升效率但没时间研究技术" }); aud.value = v.audience;
        const tone = h("input", { class: "input", value: v.tone, placeholder: "例如：真诚、干货、略带幽默，不说教" });
        const banned = h("input", { class: "input", value: v.banned, placeholder: "可选：不想出现的词，用逗号隔开，例如：最、第一、绝对" });
        const color = C.selectEl(COLORS, v.color);
        formBox.replaceChildren(h("div", { class: "acct-form" },
          h("b", {}, a ? `编辑「${a.name}」` : "新增运营账号"),
          h("div", { class: "form-row" }, C.field("账号名", name), C.field("标记颜色", color)),
          C.field("账号定位", pos), C.field("目标读者", aud), C.field("语气风格", tone), C.field("禁用词", banned),
          h("div", { class: "actions" },
            h("button", { class: "btn primary", onclick: async () => {
              if (!name.value.trim()) { window.Shell.toast("填个账号名", "info"); name.focus(); return; }
              try {
                const saved = await C.save("accounts", { id: a ? a.id : undefined, name: name.value.trim(), positioning: pos.value.trim(), audience: aud.value.trim(), tone: tone.value.trim(), banned: banned.value.trim(), color: color.value });
                await C.loadAccounts();
                formBox.replaceChildren(); draw();
                if (!a && (await window.Shell.confirm(`已创建「${saved.name}」，现在切换过去吗？`, { okText: "切换" }))) C.switchAccount(saved.id);
                else window.Shell.toast("已保存", "success");
                C.changed("account");
              } catch (e) { C.err(e); }
            } }, "保存"),
            h("button", { class: "btn ghost", onclick: () => formBox.replaceChildren() }, "取消"))));
        name.focus();
      }
      async function del(a) {
        if (!(await window.Shell.confirm(`删除运营账号「${a.name}」？它的收藏选题和各平台登录状态也会一起清掉。`, { okText: "删除", danger: true }))) return;
        try { await C.remove("accounts", a.id); await C.loadAccounts(); draw(); C.changed("account"); C.changed("contents"); window.Shell.toast("已删除", "success"); }
        catch (e) { C.err(e); }
      }
      C.onData((what) => { if (what === "account") draw(); });
      C.loadAccounts().then(draw).catch(window.Shell.reportError);
    },
  });

  // ---------------- 平台账号（登录） ----------------
  window.Shell.registerSettingsSection({
    id: "platform-login", title: "平台账号", icon: "share", order: 3,
    render(box) {
      const head = h("p", { class: "card-desc" });
      const rows = h("div", {});
      box.append(head, rows, h("p", { class: "muted small-text" }, "登录在官方页面里完成（扫码或短信），应用只保留登录状态，不保存密码。每个运营账号的每个平台登录互相独立，不会串号。"));
      let meta = [];
      async function draw() {
        const acc = C.currentAccount();
        head.textContent = `当前运营账号「${acc ? acc.name : ""}」绑定的平台登录。切换运营账号后这里显示那个账号的登录。`;
        try {
          if (!meta.length) meta = await C.call(api.publish.meta());
          const st = await C.call(api.publish.status(C.currentAccountId()));
          rows.replaceChildren(...meta.map((p) => {
            const on = st[p.id] && st[p.id].loggedIn;
            return h("div", { class: "pf-login-row" },
              C.platformTag(p.id),
              h("div", { class: "grow" },
                h("span", { class: "login-state " + (on ? "on" : "off") }, on ? "● 已登录" : "○ 未登录"),
                p.mode === "assist" ? h("span", { class: "muted small-text" }, "  · 口播脚本：打开创作页并复制脚本") : null),
              on ? h("button", { class: "btn small ghost", onclick: () => api.publish.open(C.currentAccountId(), p.id, "home") }, "打开后台") : null,
              on && p.mode !== "assist" ? h("button", { class: "btn small ghost", onclick: () => api.publish.open(C.currentAccountId(), p.id, "drafts") }, "草稿箱") : null,
              on ? h("button", { class: "btn small danger-ghost", onclick: async () => {
                if (!(await window.Shell.confirm(`退出${p.name}？下次推送前需要重新登录。`, { okText: "退出", danger: true }))) return;
                await C.call(api.publish.logout(C.currentAccountId(), p.id)).catch(C.err); draw();
              } }, "退出")
                : h("button", { class: "btn small primary", onclick: async (e) => {
                  const b = e.currentTarget; b.disabled = true; b.textContent = "等待登录…";
                  try { const r = await C.call(api.publish.login(C.currentAccountId(), p.id)); if (r && r.loggedIn) window.Shell.toast(`${p.name}已登录`, "success"); }
                  catch (err) { C.err(err); }
                  finally { draw(); }
                } }, "登录"));
          }));
        } catch (e) { rows.replaceChildren(h("p", { class: "error" }, e.message)); }
      }
      api.publish.onStatus(() => draw());
      C.onData((what) => { if (what === "account") draw(); });
      draw();
    },
  });

  // ---------------- 写作规范 ----------------
  window.Shell.registerSettingsSection({
    id: "rules", title: "各平台写作规范", icon: "pen", order: 4,
    render(box) {
      const { row, select } = window.Shell.settingsUI;
      box.append(h("p", { class: "card-desc" }, "内置了每个平台的写法规范；这里可以补充你自己的要求（例如固定结尾、字数、必带话题），写稿和一稿多发时会优先遵守。"),
        row("默认平台", "写稿页默认选中的平台", select("defaultPlatform", Object.entries(C.PLATFORM_NAMES))));
      C.meta().then((m) => {
        for (const p of m.platforms) {
          box.append(row(p.name, h("details", { class: "rule-details" }, h("summary", {}, "查看内置规范"), h("div", { class: "muted small-text" }, ...(p.guide || []).map((g) => h("p", {}, g)))),
            textInput(`rule_${p.id}`, { multiline: true, placeholder: `补充要求，例如：结尾固定写「关注我，每天一个效率技巧」` }), { stack: true }));
        }
      }).catch(window.Shell.reportError);
    },
  });

  // ---------------- 推送设置 ----------------
  window.Shell.registerSettingsSection({
    id: "push", title: "推送到草稿箱", icon: "arrowDown", order: 5,
    render(box) {
      const { row, toggle, range } = window.Shell.settingsUI;
      box.append(
        h("p", { class: "card-desc" }, "推送只会把内容存进平台草稿箱，不会发布。每一步都会写进运行日志。"),
        row("显示推送窗口", "推送时把平台页面窗口显示出来，能看到每一步，遇到验证码也能顺手处理（推荐）", toggle("pushShowWindow")),
        row("推送成功后保留窗口", "默认存好草稿就自动关掉窗口", toggle("pushKeepOpen")),
        row("同平台间隔", "连续推送同一平台时，两篇之间至少间隔多久，避免操作过快", range("pushInterval", { min: 3, max: 120, step: 1, format: (v) => v + " 秒" })),
        row("失败截图", "推送失败时会自动截图，方便排查", h("button", { class: "btn", onclick: () => api.publish.openShots() }, "打开文件夹")));
    },
  });
})();
