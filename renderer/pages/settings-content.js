"use strict";
// 设置页「业务设置」组：AI 模型、运营账号、平台账号（多号登录）、定时自动创作、各平台写作规范、推送设置。
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
        if (!(await window.Shell.confirm(`删除运营账号「${a.name}」？它的收藏选题会一起删掉，绑定它的平台号会解除绑定（登录保留）。`, { okText: "删除", danger: true }))) return;
        try { await C.remove("accounts", a.id); await C.loadAccounts(); draw(); C.changed("account"); C.changed("contents"); window.Shell.toast("已删除", "success"); }
        catch (e) { C.err(e); }
      }
      C.onData((what) => { if (what === "account") draw(); });
      C.loadAccounts().then(draw).catch(window.Shell.reportError);
    },
  });

  // ---------------- 平台账号（同一平台可以登录多个号） ----------------
  window.Shell.registerSettingsSection({
    id: "platform-login", title: "平台账号", icon: "share", order: 3,
    render(box) {
      const rows = h("div", { class: "pa-list" });
      box.append(h("p", { class: "card-desc" }, "同一平台可以登录多个号。每个号可以改名、绑定到一个运营账号：推送时默认用绑定当前运营账号的号，也可以在创作页临时换号。登录在官方页面里完成（扫码或短信），应用只保留登录状态，不保存密码。"), rows);
      let meta = [];
      async function draw() {
        try {
          if (!meta.length) meta = await C.call(api.publish.meta());
          const list = await C.loadPlatformAccounts();
          await C.loadAccounts();
          const accs = C.getAccounts();
          rows.replaceChildren(...meta.map((p) => {
            const mine = list.filter((a) => a.platform === p.id);
            const on = mine.filter((a) => a.loggedIn);
            const off = mine.filter((a) => !a.loggedIn);
            const addBtn = h("button", { class: "btn small primary", onclick: async (e) => {
              const b = e.currentTarget; b.disabled = true; b.textContent = "等待登录…";
              try { const r = await C.call(api.publish.add(p.id)); if (r && r.loggedIn) window.Shell.toast(`${p.name}已登录，添加了「${r.account.name}」`, "success"); else if (r && !r.pending) window.Shell.toast("没有完成登录", "info"); }
              catch (err) { C.err(err); } finally { draw(); }
            } }, on.length ? "＋ 再登录一个号" : "＋ 登录");
            return h("div", { class: "pa-group" },
              h("div", { class: "pa-head" }, C.platformTag(p.id), h("span", { class: "muted small-text" }, on.length ? `已登录 ${on.length} 个号` : "未登录",
                p.mode === "assist" ? " · 口播脚本：打开创作页并复制脚本" : ""), h("span", { class: "spacer" }), addBtn),
              ...on.map((a) => paRow(a, p, accs)),
              off.length ? h("details", { class: "pa-off" }, h("summary", { class: "muted small-text" }, `${off.length} 个号登录已失效`),
                ...off.map((a) => h("div", { class: "pa-row off" }, h("span", { class: "grow" }, a.name),
                  h("button", { class: "btn small", onclick: async () => { await C.call(api.publish.relogin(a.id)).catch(C.err); draw(); } }, "重新登录"),
                  h("button", { class: "btn small danger-ghost", onclick: async () => { if (await window.Shell.confirm(`移除「${a.name}」？`, { okText: "移除", danger: true })) { await C.call(api.publish.remove(a.id)).catch(C.err); draw(); } } }, "移除")))) : null);
          }));
        } catch (e) { rows.replaceChildren(h("p", { class: "error" }, e.message)); }
      }
      function paRow(a, p, accs) {
        const name = h("input", { class: "input input-sm pa-name", value: a.name, title: "点一下改名，回车或离开保存" });
        const commit = async () => { const v = name.value.trim(); if (!v || v === a.name) { name.value = a.name; return; } await C.call(api.publish.update(a.id, { name: v })).catch(C.err); window.Shell.toast("已改名", "success", 1500); };
        name.addEventListener("change", commit);
        name.addEventListener("keydown", (e) => { if (e.key === "Enter") name.blur(); });
        const bind = C.selectEl([["", "不绑定运营账号"], ...accs.map((x) => [x.id, "绑定：" + x.name])], a.boundAccountId && accs.some((x) => x.id === a.boundAccountId) ? a.boundAccountId : "", { class: "input input-sm" });
        bind.addEventListener("change", async () => { await C.call(api.publish.update(a.id, { boundAccountId: bind.value })).catch(C.err); window.Shell.toast(bind.value ? "已绑定" : "已解除绑定", "success", 1500); });
        return h("div", { class: "pa-row" },
          h("span", { class: "login-state on" }, "●"), name, bind, h("span", { class: "spacer" }),
          h("button", { class: "btn small ghost", onclick: () => api.publish.open(a.id, "home") }, "后台"),
          p.mode !== "assist" ? h("button", { class: "btn small ghost", onclick: () => api.publish.open(a.id, "drafts") }, "草稿箱") : null,
          h("button", { class: "btn small danger-ghost", onclick: async () => {
            if (!(await window.Shell.confirm(`退出并移除${p.name}号「${a.name}」？`, { okText: "退出", danger: true }))) return;
            await C.call(api.publish.remove(a.id)).catch(C.err); draw();
          } }, "退出"));
      }
      C.onData((what) => { if (what === "account" || what === "platformAccounts") draw(); });
      draw();
    },
  });

  // ---------------- 定时自动创作 ----------------
  window.Shell.registerSettingsSection({
    id: "auto", title: "定时自动创作", icon: "spark", order: 4,
    render(box) {
      const { row, toggle, range, select } = window.Shell.settingsUI;
      const st = () => window.Shell.getSettings();
      // 多选框组：保存成逗号分隔的字符串
      function checks(key, options) {
        const wrap = h("div", { class: "check-row" });
        const draw = () => {
          const cur = new Set(String(st()[key] || "").split(/[,，\s]+/).filter(Boolean));
          wrap.replaceChildren(...options.map(([v, l]) => h("label", { class: "check" }, h("input", { type: "checkbox", value: v, checked: cur.has(String(v)),
            onchange: () => window.Shell.saveSettings({ [key]: [...wrap.querySelectorAll("input:checked")].map((i) => i.value).join(",") }) }), l)));
        };
        draw();
        window.Shell.onSettings((c) => { if (key in c && !wrap.contains(document.activeElement)) draw(); });
        return wrap;
      }
      const timesHint = h("span", { class: "muted small-text" });
      const timesIn = textInput("autoTimes", { placeholder: "例如 08:30, 20:00（可以多个，逗号隔开）" });
      const drawTimesHint = () => {
        const list = String(st().autoTimes || "").split(/[,，;；\s、]+/).filter(Boolean);
        const ok = list.filter((t) => /^(\d{1,2})[:：](\d{1,2})$/.test(t) && Number(t.split(/[:：]/)[0]) < 24 && Number(t.split(/[:：]/)[1]) < 60);
        timesHint.textContent = ok.length ? `每天 ${ok.length} 次` + (ok.length < list.length ? `（${list.length - ok.length} 个格式不对，已忽略）` : "") : "还没有有效的时间";
      };
      drawTimesHint();
      window.Shell.onSettings((c) => { if ("autoTimes" in c) drawTimesHint(); });
      const statusBox = h("div", { class: "auto-status" });
      const runBtn = h("button", { class: "btn primary", onclick: runNow }, "立即运行一次");

      box.append(
        h("p", { class: "card-desc" }, "到点自动：找爆款 → 跳过拆过的 → 拆解 → 写原创 → 推草稿箱。只存草稿不发布；与原文重合度超过上限的不推送，并标记「需改写」。应用需要开着才会运行（电脑睡眠错过的时段，醒来 15 分钟内会补跑）。"),
        row("开启", "按下面的时间自动运行", toggle("autoEnabled")),
        row("时间", timesHint, timesIn, { stack: true }),
        row("星期", "不勾 = 每天", checks("autoWeekdays", [["1", "周一"], ["2", "周二"], ["3", "周三"], ["4", "周四"], ["5", "周五"], ["6", "周六"], ["7", "周日"]]), { stack: true }),
        row("关键词", "去找哪些话题的爆款，逗号或换行隔开；按顺序搜，凑够篇数就停", textInput("autoKeywords", { placeholder: "例如：AI 工具, 职场效率", multiline: true, rows: 2 }), { stack: true }),
        row("去哪找爆款", "小红书 / 抖音需要先在「对标拆解 → 找爆款」里登录网页版", select("autoSource", [["wechat", "公众号（搜狗）"], ["toutiao", "头条"], ["baijiahao", "百家号"], ["xiaohongshu", "小红书（需登录）"], ["douyin", "抖音（需登录）"]])),
        row("只看近几天", "", select("autoDays", [[1, "近 1 天"], [3, "近 3 天"], [7, "近 7 天"], [30, "近 30 天"], [0, "不限"]], { parse: Number })),
        row("每次几篇", "每轮最多拆解并创作几篇", range("autoCount", { min: 1, max: 10, step: 1, format: (v) => v + " 篇" })),
        row("写成哪些平台", "第一个平台按骨架写原创，其余平台在它的基础上改写", checks("autoTargets", Object.entries(C.PLATFORM_NAMES)), { stack: true }),
        row("自动推草稿箱", "写好后推送到对应平台的草稿箱（用绑定当前运营账号的平台号）", toggle("autoPush")),
        row("重合度上限", "与原文重合度超过这个值就不推送、标记「需改写」（手动创作也按这个提醒）", range("overlapLimit", { min: 5, max: 90, step: 1, format: (v) => v + "%" })),
        row("运行情况", statusBox, runBtn, { stack: true }));

      async function drawStatus() {
        try {
          const a = await C.call(api.auto.status());
          runBtn.disabled = a.running;
          runBtn.textContent = a.running ? "运行中…" : "立即运行一次";
          const next = a.enabled && a.next ? new Date(a.next) : null;
          statusBox.replaceChildren(
            h("div", {}, a.enabled ? (next ? `下次运行：${next.getMonth() + 1}月${next.getDate()}日 ${String(next.getHours()).padStart(2, "0")}:${String(next.getMinutes()).padStart(2, "0")}` : "已开启，但没有有效的时间") : "未开启（「立即运行一次」不受开关影响）"),
            a.runs.length ? h("details", { class: "auto-runs" }, h("summary", {}, `最近运行（${a.runs.length}）`), ...a.runs.map((r) => h("div", { class: "auto-run" },
              h("span", { class: "muted" }, C.fmtDate(r.startedAt)), " ",
              h("span", { class: "chip static" }, r.trigger === "schedule" ? "定时" : r.trigger === "batch" ? "批量" : "手动"), " ",
              h("span", { class: r.status === "failed" ? "error-text" : "" }, r.status === "running" ? "运行中…" : r.summary || r.status)))) : h("div", { class: "muted small-text" }, "还没运行过"));
        } catch (e) { statusBox.replaceChildren(h("span", { class: "error-text" }, e.message)); }
      }
      async function runNow() {
        runBtn.disabled = true;
        try { const r = await C.call(api.auto.runNow()); if (r && r.task) window.Shell.toast("已开始，进度在运行日志里", "success"); }
        catch (e) { C.err(e); } finally { setTimeout(drawStatus, 300); }
      }
      C.onData((what) => { if (what === "auto") drawStatus(); });
      api.tasks.onChange((t) => { if (t.type === "auto:run" && ["done", "failed", "cancelled"].includes(t.status)) drawStatus(); });
      drawStatus();
    },
  });

  // ---------------- 写作规范 ----------------
  window.Shell.registerSettingsSection({
    id: "rules", title: "各平台写作规范", icon: "pen", order: 5,
    render(box) {
      const { row, select } = window.Shell.settingsUI;
      box.append(h("p", { class: "card-desc" }, "内置了每个平台的写法规范；这里可以补充你自己的要求（例如固定结尾、字数、必带话题），写稿和生成平台版本时会优先遵守。"),
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
    id: "push", title: "推送到草稿箱", icon: "arrowDown", order: 6,
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
