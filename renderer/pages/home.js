"use strict";
// 工作台：四步流程条（拆解 → 创作 → 草稿箱 → 发布），下面固定三列网格（同一行等高）：
//   第一行：账号数据（占两列，三项合计 + 每个号的粉丝 / 阅读 / 收益）· 今日热点（右边，占两行高）
//   第二行：待处理 · 定时自动创作
//   第三行：最近拆解 · 最近稿件 · 未来 7 天排期
(function () {
  const { h } = window.Shell;
  const api = window.app;
  const C = window.Content;
  const WD = ["", "一", "二", "三", "四", "五", "六", "日"];

  window.Shell.registerPage({
    id: "home",
    title: "工作台",
    icon: "home",
    order: 10,
    render(root) {
      const { card } = window.Shell;
      root.classList.add("page-wide");
      const flowBox = h("div", { class: "flow" });
      const todoBox = h("div", { class: "item-list" });
      const autoBox = h("div", { class: "kv-list" });
      const hotBox = h("div", { class: "hot-box" });
      const bdBox = h("div", { class: "item-list" });
      const recentBox = h("div", { class: "item-list" });
      const weekBox = h("div", { class: "item-list" });
      const statsBox = h("div", { class: "stats-box" });
      const statsBtn = h("button", { class: "btn small ghost", title: "立即重新读取所有号的数据", onclick: refreshStats }, "刷新");
      const go = (id, payload) => () => C.open(id, payload);
      const toSettings = (sec) => () => { window.Shell.openSettings(sec); };
      let hotTab = "toutiao";
      let hotData = null;

      root.append(
        h("header", { class: "page-head" },
          h("div", {}, h("h1", {}, "工作台"), h("p", { class: "sub" }, "找爆款 → 拆结构 → 写原创 → 推草稿箱")),
          h("div", { class: "actions" },
            h("button", { class: "btn primary", onclick: go("benchmark", { tab: "find" }) }, "找爆款"),
            h("button", { class: "btn", onclick: go("writer", { fresh: true }) }, "写一篇"))),
        flowBox,
        h("div", { class: "home-wrap" }, h("div", { class: "home-grid" },
          card({ title: "账号数据", icon: "user", id: "home-stats", class: "hg-stats", actions: [statsBtn, h("button", { class: "btn small ghost", onclick: toSettings("platform-login") }, "管理")] }, statsBox),
          card({ title: "今日热点", icon: "chart", id: "home-hot", class: "hg-hot", desc: "点一下就去搜这个话题的爆款", actions: [
            h("div", { class: "segmented" },
              h("button", { class: "active", dataset: { hot: "toutiao" }, onclick: (e) => pickHot("toutiao", e.currentTarget) }, "头条热榜"),
              h("button", { dataset: { hot: "baidu" }, onclick: (e) => pickHot("baidu", e.currentTarget) }, "百度热搜")),
            h("button", { class: "btn small ghost", title: "刷新", onclick: () => loadHot(true) }, "刷新")] }, hotBox),
          card({ title: "待处理", icon: "tasks", id: "home-todo", class: "hg-todo" }, todoBox),
          card({ title: "定时自动创作", icon: "clock", id: "home-auto", class: "hg-auto", actions: [h("button", { class: "btn small ghost", onclick: toSettings("auto") }, "设置")] }, autoBox),
          card({ title: "最近拆解", icon: "bookmark", class: "hg-bd", actions: [h("button", { class: "btn small ghost", onclick: go("benchmark", { tab: "library" }) }, "拆解库")] }, bdBox),
          card({ title: "最近稿件", icon: "note", class: "hg-recent", actions: [h("button", { class: "btn small ghost", onclick: go("publish", { view: "list" }) }, "全部稿件")] }, recentBox),
          card({ title: "未来 7 天排期", icon: "cal", class: "hg-week", actions: [h("button", { class: "btn small ghost", onclick: go("publish", { view: "calendar" }) }, "打开日历")] }, weekBox))));

      // ---- 账号数据 ----
      const fmtNum = (n) => (n == null ? "—" : n >= 1e4 ? C.fmtCount(Math.round(n)) : String(Math.round(n * 100) / 100));
      const fmtMoney = (n) => (n == null ? "—" : "¥" + (n >= 1e4 ? C.fmtCount(Math.round(n)) : n.toFixed(2)));
      async function loadStats() {
        try { drawStats(await C.call(api.publish.stats())); }
        catch (e) { statsBox.replaceChildren(h("p", { class: "error small" }, e.message)); }
      }
      function drawStats(d) {
        statsBtn.disabled = !!d.running;
        statsBtn.textContent = d.running ? "读取中…" : "刷新";
        const rows = d.accounts || [];
        if (!rows.some((a) => a.loggedIn)) {
          statsBox.replaceChildren(h("p", { class: "muted" }, "还没登录平台号。登录后会自动读出每个号的粉丝、阅读和收益。"),
            h("div", { class: "actions" }, h("button", { class: "btn small", onclick: toSettings("platform-login") }, "去登录")));
          return;
        }
        const t = d.totals || {};
        const tile = (label, val, sub) => h("div", { class: "stat-tile" }, h("span", { class: "muted small-text" }, label), h("b", {}, val), sub ? h("span", { class: "muted small-text" }, sub) : null);
        const totals = h("div", { class: "stat-tiles" },
          tile("粉丝合计", fmtNum(t.fans), `${t.accounts} 个号`),
          tile("阅读合计", fmtNum(t.reads)),
          tile("收益合计", fmtMoney(t.income), t.failed ? `${t.failed} 个号读取失败` : ""));
        const when = (s) => (s.at ? C.fmtAgo(s.at) : "—");
        const table = h("table", { class: "stats-table" },
          h("thead", {}, h("tr", {}, ...["平台", "账号", "粉丝", "阅读", "收益", "更新时间"].map((x) => h("th", {}, x)))),
          h("tbody", {}, ...rows.map((a) => {
            const s = a.stats || {};
            const bad = !!s.error || !a.loggedIn;
            const state = !a.loggedIn ? h("span", { class: "stat-err", title: "登录已失效" }, "登录失效")
              : s.error ? h("span", { class: "stat-err", title: s.error }, "读取失败")
              : !s.at ? h("span", { class: "muted" }, d.running ? "读取中…" : "等待读取") : null;
            return h("tr", { class: bad ? "stat-bad" : "", title: s.error || "" },
              h("td", {}, C.platformTag(a.platform)),
              h("td", { class: "stat-name" }, a.name),
              h("td", { class: "num" }, fmtNum(s.fans)),
              h("td", { class: "num" }, fmtNum(s.reads)),
              h("td", { class: "num" }, fmtMoney(s.income)),
              h("td", { class: "stat-when" }, state || "", state && s.at ? " · " : "", s.at ? h("span", { class: "muted", title: C.fmtDate(s.at) }, when(s)) : ""));
          })));
        statsBox.replaceChildren(totals, h("div", { class: "stats-scroll" }, table));
      }
      async function refreshStats() {
        try {
          const r = await C.call(api.publish.refreshStats());
          if (r && r.busy) window.Shell.toast("正在读取，等这一轮结束", "info");
          else window.Shell.toast("开始读取账号数据，进度在运行日志里", "success");
          loadStats();
        } catch (e) { C.err(e); }
      }
      api.publish.onStats(() => { loadStats(); });

      function pickHot(id, btn) {
        hotTab = id;
        for (const b of btn.parentElement.children) b.classList.toggle("active", b === btn);
        drawHot();
      }
      async function loadHot(force) {
        if (!hotData || force) hotBox.replaceChildren(h("p", { class: "muted small-text" }, "正在获取热点…"));
        try { hotData = await C.call(api.discover.hot(!!force)); drawHot(); }
        catch (e) { hotBox.replaceChildren(h("p", { class: "error small" }, e.message)); }
      }
      function drawHot() {
        if (!hotData) return;
        const list = (hotData[hotTab] || []).slice(0, 12);
        hotBox.replaceChildren(...(list.length ? [h("ol", { class: "hot-list" }, ...list.map((x, i) => h("li", {},
          h("span", { class: "hot-rank" + (i < 3 ? " top" : "") }, String(i + 1)),
          h("button", { class: "link-btn hot-title", title: "去找这个话题的爆款", onclick: go("benchmark", { tab: "find", keyword: x.title, search: true }) }, x.title),
          x.hot ? h("span", { class: "muted small-text" }, C.fmtCount(x.hot)) : null))),
          hotData.skipped ? h("p", { class: "muted small-text hot-skipped" }, `已跳过 ${hotData.skipped} 条时政新闻（设置 → 定时自动创作 可关）`) : null]
          : [h("p", { class: "muted small-text" }, (hotData.errors || []).join("；") || "暂时没取到热点")]));
      }

      async function refresh() {
        try {
          const [st, recent, key, bds, auto] = await Promise.all([C.call(api.store.stats(C.today())), C.list("contents"), C.call(api.ai.keyInfo()), C.list("breakdowns"), C.call(api.auto.status())]);
          const pas = await C.loadPlatformAccounts().catch(() => C.getPlatformAccounts());
          // ---- 四步流程条 ----
          const steps = [
            ["对标拆解", `${st.breakdowns} 篇`, "拆解库里的爆款", go("benchmark", { tab: "library" })],
            ["创作", `${(st.byStatus.draft || 0) + (st.byStatus.idea || 0)} 篇`, "选题和草稿", go("publish", { view: "list", status: "draft" })],
            ["推草稿箱", `${st.pushed} 篇`, "已存进平台草稿箱", go("publish", { view: "list", push: "saved" })],
            ["发布", `${st.byStatus.published || 0} 篇`, `待发布 ${st.byStatus.ready || 0} 篇`, go("publish", { view: "list", status: "published" })],
          ];
          flowBox.replaceChildren(...steps.flatMap(([t, n, d, fn], i) => [
            i ? h("span", { class: "flow-arrow", "aria-hidden": "true" }, "›") : null,
            h("button", { class: "flow-step", onclick: fn }, h("span", { class: "flow-no" }, String(i + 1)), h("span", { class: "flow-text" }, h("b", {}, t), h("span", { class: "flow-n" }, n), h("span", { class: "muted small-text" }, d)))]).filter(Boolean));

          // ---- 待处理 ----
          const todo = [];
          if (!key.set) todo.push(todoRow("error", "还没设置 AI 的 API Key，拆解和写稿都用不了", "去设置", toSettings("ai")));
          if (st.needsRewrite.length) todo.push(todoRow("warn", `${st.needsRewrite.length} 篇与参考原文重合度过高，需改写`, "查看", go("publish", { view: "list", push: "rewrite" })));
          if (st.pushFailed.length) todo.push(todoRow("error", `${st.pushFailed.length} 篇推送失败`, "查看", go("publish", { view: "list", push: "failed" })));
          if (st.overdue.length) todo.push(todoRow("warn", `${st.overdue.length} 篇已过排期日还没发布`, "查看", go("publish", { view: "calendar" })));
          if (!pas.some((a) => a.loggedIn)) todo.push(todoRow("info", "还没登录任何平台号，推送草稿箱前要先登录", "去登录", toSettings("platform-login")));
          todoBox.replaceChildren(...(todo.length ? todo : [h("p", { class: "muted" }, "✓ 没有待处理的事")]));

          // ---- 自动创作 ----
          const last = auto.lastRun;
          autoBox.replaceChildren(
            kv("状态", auto.running ? h("span", { class: "ok-text" }, "● 运行中") : auto.enabledCount ? h("span", { class: "ok-text" }, `已开启 ${auto.enabledCount} / ${auto.jobs.length} 个任务`) : h("span", { class: "muted" }, auto.jobs.length ? "全部未开启" : "还没有定时任务")),
            kv("下次运行", auto.next ? `${fmtNext(auto.next)}${auto.nextJob ? " · " + auto.nextJob.name : ""}` : auto.enabledCount ? "没有设置有效的时间" : "—"),
            ...auto.jobs.slice(0, 4).map((j) => kv(j.name, h("span", { class: j.enabled ? "" : "muted" },
              `${j.enabled ? "" : "（未开启）"}${j.weekdayList.length === 7 ? "每天" : "周" + j.weekdayList.map((d) => WD[d]).join("、")} ${j.timeList.join("、") || "—"} · ${C.SOURCE_NAMES[j.source]} · ${j.keywordList.length ? "「" + j.keywordList.join("、") + "」" : "今日热点"}`))),
            kv("上次", last ? `${C.fmtDate(last.startedAt)} ${last.jobName ? last.jobName + "：" : ""}${last.status === "running" ? "（运行中）" : ""}${last.summary || ""}` : "还没运行过"),
            h("p", { class: "muted small-text" }, "只存草稿不发布，应用开着才会按时跑。"),
            h("div", { class: "actions" },
              h("button", { class: "btn small", disabled: auto.running, onclick: runNow }, auto.running ? "运行中…" : "立即运行一次"),
              h("button", { class: "btn small ghost", onclick: toSettings("auto") }, auto.jobs.length ? "管理任务" : "新建任务")));

          // ---- 最近拆解 / 稿件 / 排期 ----
          bdBox.replaceChildren(...(bds.length ? bds.slice(0, 5).map((b) => h("button", { class: "item", onclick: go("benchmark", { id: b.id }) },
            h("span", { class: `pf pf-${b.platform}` }, C.SOURCE_NAMES[b.platform] || "其他"), h("span", { class: "item-title" }, b.title),
            h("span", { class: "muted item-right" }, C.fmtDate(b.createdAt))))
            : [h("p", { class: "muted" }, "还没有拆解。点右上角「找爆款」开始。")]));
          recentBox.replaceChildren(...(recent.length ? recent.slice(0, 6).map((c) => itemRow(c, C.fmtDate(c.updatedAt)))
            : [h("p", { class: "muted" }, "还没有稿件。从「对标拆解」或「写一篇」开始吧。")]));
          const rows = [];
          for (const c of st.upcoming.slice(0, 8)) rows.push(itemRow(c, c.scheduledAt.slice(5).replace("-", "/")));
          if (!st.upcoming.length) rows.push(h("p", { class: "muted" }, "未来 7 天还没有排期。在发布页的日历里安排发布日期。"));
          weekBox.replaceChildren(...rows);

        } catch (e) { window.Shell.reportError(e); }
      }
      function fmtNext(t) {
        const d = new Date(t);
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const diff = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - today) / 86400000);
        const day = diff === 0 ? "今天" : diff === 1 ? "明天" : diff === 2 ? "后天" : `${d.getMonth() + 1}月${d.getDate()}日`;
        return `${day} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
      }
      function todoRow(level, text, btn, fn) {
        return h("div", { class: "item static todo " + level }, h("span", { class: "todo-dot" }), h("span", { class: "item-title" }, text), h("button", { class: "btn small ghost", onclick: fn }, btn));
      }
      function kv(k, v) { return h("div", { class: "kv" }, h("span", { class: "muted" }, k), h("span", {}, v)); }
      function itemRow(c, right) {
        return h("button", { class: "item", onclick: go("writer", { id: c.id }) },
          C.platformTag(c.platform), h("span", { class: "item-title" }, c.title || "未命名"), c.needsRewrite ? C.rewriteTag(c) : C.statusTag(c.status), h("span", { class: "muted item-right" }, right));
      }
      async function runNow() {
        try {
          const r = await C.call(api.auto.runNow());
          if (r && r.task) window.Shell.toast("已开始自动创作，进度在运行日志里", "success");
          setTimeout(refresh, 300);
        } catch (e) { C.err(e); }
      }
      this.refresh = refresh;
      this.loadStats = loadStats;
      C.onData((what) => { if (window.Shell.current === "home" && what !== "materials") refresh(); });
      window.Shell.onSettings((c) => { if (Object.keys(c).some((k) => k.startsWith("ai") || k.startsWith("auto") || k === "currentAccount")) refresh(); });
      api.tasks.onChange((t) => { if (t.type === "auto:run" && ["done", "failed", "cancelled", "running"].includes(t.status) && window.Shell.current === "home") refresh(); });
      refresh();
      loadHot(false);
      loadStats();
    },
    onShow() { if (this.refresh) this.refresh(); if (this.loadStats) this.loadStats(); },
  });
})();
