"use strict";
// 工作台：内容概览、本周排期、AI 状态、账号定位、最近内容、快速开始
(function () {
  const { h } = window.Shell;
  const api = window.app;
  const C = window.Content;

  window.Shell.registerPage({
    id: "home",
    title: "工作台",
    icon: "home",
    order: 10,
    render(root) {
      const { card, modules } = window.Shell;
      root.classList.add("page-wide");
      const statsBox = h("div", { class: "stat-grid" });
      const weekBox = h("div", { class: "item-list" });
      const aiBox = h("div", { class: "kv-list" });
      const brandBox = h("div", { class: "kv-list" });
      const recentBox = h("div", { class: "item-list" });
      const go = (id, payload) => () => C.open(id, payload);

      root.append(
        h("header", { class: "page-head" },
          h("div", {}, h("h1", {}, "工作台"), h("p", { class: "sub", id: "home-greet" }, "今天写点什么？")),
          h("div", { class: "actions" },
            h("button", { class: "btn primary", onclick: go("writer", { fresh: true }) }, "写一篇"),
            h("button", { class: "btn", onclick: go("topics") }, "找选题"))),
        modules(
          card({ title: "内容概览", icon: "chart" }, statsBox),
          card({ title: "未来 7 天排期", icon: "cal", actions: [h("button", { class: "btn small ghost", onclick: go("calendar") }, "打开日历")] }, weekBox),
          card({ title: "快速开始", icon: "star" },
            h("div", { class: "quick-grid" },
              quick("选题灵感", "按账号定位批量出选题", go("topics")),
              quick("AI 写稿", "选题 + 大纲 → 成稿", go("writer", { fresh: true })),
              quick("一稿多发", "一篇改成多平台版本", go("rewrite")),
              quick("稿件管理", "找稿、推送草稿箱", go("library")),
              quick("记素材", "金句、数据、链接", go("materials", { add: true })))),
          card({ title: "AI 模型", icon: "spark", actions: [h("button", { class: "btn small ghost", onclick: () => window.Shell.navigate("settings") }, "设置")] }, aiBox),
          card({ title: "当前运营账号", icon: "user", desc: "所有 AI 输出都会按这个账号的定位和语气来写，侧栏顶部可切换", actions: [h("button", { class: "btn small ghost", onclick: () => { window.Shell.navigate("settings"); setTimeout(() => document.getElementById("settings-accounts")?.scrollIntoView({ behavior: "smooth" }), 150); } }, "编辑")] }, brandBox),
          card({ title: "最近稿件", icon: "note", actions: [h("button", { class: "btn small ghost", onclick: go("library") }, "稿件管理")] }, recentBox)));

      function quick(title, desc, onclick) {
        return h("button", { class: "quick", onclick }, h("b", {}, title), h("span", { class: "muted" }, desc));
      }

      async function refresh() {
        try {
          const [st, recent, key, s] = await Promise.all([C.call(api.store.stats(C.today())), C.list("contents"), C.call(api.ai.keyInfo()), api.settings.get()]);
          statsBox.replaceChildren(
            ...[["idea", "选题"], ["draft", "草稿"], ["ready", "待发布"], ["published", "已发布"]].map(([k, l]) =>
              h("button", { class: "stat", onclick: go("calendar", { status: k }) }, h("b", {}, String(st.byStatus[k] || 0)), h("span", {}, l))),
            h("button", { class: "stat", onclick: go("materials") }, h("b", {}, String(st.materials)), h("span", {}, "素材")),
            h("button", { class: "stat", onclick: go("topics") }, h("b", {}, String(st.topics)), h("span", {}, "收藏选题")));
          const rows = [];
          if (st.overdue.length) rows.push(h("p", { class: "error small" }, `有 ${st.overdue.length} 篇已过排期日但还没发布`));
          for (const c of st.upcoming.slice(0, 8)) rows.push(itemRow(c, c.scheduledAt.slice(5).replace("-", "/")));
          if (!st.upcoming.length) rows.push(h("p", { class: "muted" }, "这周还没有排期。写好的稿子可以在日历里安排发布日期。"));
          weekBox.replaceChildren(...rows);

          const prov = (await C.meta()).providers.find((p) => p.id === s.aiProvider);
          aiBox.replaceChildren(
            kv("服务商", prov ? prov.name : s.aiProvider),
            kv("模型", s.aiModel || "未设置"),
            kv("API Key", key.set ? `已设置（…${key.tail}）` : h("span", { class: "warn" }, "未设置，AI 功能用不了")),
            h("div", { class: "actions" }, h("button", { class: "btn small", onclick: testAi }, "测试连接")));

          await C.loadAccounts();
          const a = C.currentAccount() || {};
          brandBox.replaceChildren(kv("账号", a.name || "—"), ...(a.positioning
            ? [kv("定位", a.positioning), kv("读者", a.audience || "—"), kv("语气", a.tone || "—")]
            : [h("p", { class: "muted" }, "还没填这个账号的定位。填上定位、目标读者和语气，AI 写出来会更像你。")]));

          recentBox.replaceChildren(...(recent.length ? recent.slice(0, 6).map((c) => itemRow(c, C.fmtDate(c.updatedAt)))
            : [h("p", { class: "muted" }, "还没有内容。从「找选题」或「写一篇」开始吧。")]));
        } catch (e) { window.Shell.reportError(e); }
      }
      function kv(k, v) { return h("div", { class: "kv" }, h("span", { class: "muted" }, k), h("span", {}, v)); }
      function itemRow(c, right) {
        return h("button", { class: "item", onclick: go("writer", { id: c.id }) },
          C.platformTag(c.platform), h("span", { class: "item-title" }, c.title || "未命名"), C.statusTag(c.status), h("span", { class: "muted item-right" }, right));
      }
      async function testAi() {
        const close = window.Shell.toast("正在测试连接…", "info", 0);
        try { const r = await C.call(api.ai.test()); close(); window.Shell.toast(`连接正常：${r.model}，${r.ms} ms，回复「${r.reply}」`, "success", 5000); }
        catch (e) { close(); C.err(e); }
      }
      this.refresh = refresh;
      C.onData(() => { if (window.Shell.current === "home") refresh(); });
      window.Shell.onSettings((c) => { if (Object.keys(c).some((k) => k.startsWith("ai") || k.startsWith("brand"))) refresh(); });
      refresh();
    },
    onShow() { if (this.refresh) this.refresh(); },
  });
})();
