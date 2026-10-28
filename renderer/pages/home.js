"use strict";
// 工作台：四步流程条（拆解 → 创作 → 草稿箱 → 发布）、待处理、自动创作状态、今日热点、最近拆解、最近稿件、7 天排期、
// 各平台登录号数、当前运营账号
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
      const { card, modules } = window.Shell;
      root.classList.add("page-wide");
      const flowBox = h("div", { class: "flow" });
      const todoBox = h("div", { class: "item-list" });
      const autoBox = h("div", { class: "kv-list" });
      const hotBox = h("div", { class: "hot-box" });
      const bdBox = h("div", { class: "item-list" });
      const recentBox = h("div", { class: "item-list" });
      const weekBox = h("div", { class: "item-list" });
      const pfBox = h("div", { class: "kv-list" });
      const brandBox = h("div", { class: "kv-list" });
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
        modules(
          card({ title: "待处理", icon: "tasks", id: "home-todo" }, todoBox),
          card({ title: "定时自动创作", icon: "spark", id: "home-auto", actions: [h("button", { class: "btn small ghost", onclick: toSettings("auto") }, "设置")] }, autoBox),
          card({ title: "今日热点", icon: "chart", id: "home-hot", desc: "点一下就去搜这个话题的爆款", actions: [
            h("div", { class: "segmented" },
              h("button", { class: "active", dataset: { hot: "toutiao" }, onclick: (e) => pickHot("toutiao", e.currentTarget) }, "头条热榜"),
              h("button", { dataset: { hot: "baidu" }, onclick: (e) => pickHot("baidu", e.currentTarget) }, "百度热搜")),
            h("button", { class: "btn small ghost", title: "刷新", onclick: () => loadHot(true) }, "刷新")] }, hotBox),
          card({ title: "最近拆解", icon: "bookmark", actions: [h("button", { class: "btn small ghost", onclick: go("benchmark", { tab: "library" }) }, "拆解库")] }, bdBox),
          card({ title: "最近稿件", icon: "note", actions: [h("button", { class: "btn small ghost", onclick: go("publish", { view: "list" }) }, "全部稿件")] }, recentBox),
          card({ title: "未来 7 天排期", icon: "cal", actions: [h("button", { class: "btn small ghost", onclick: go("publish", { view: "calendar" }) }, "打开日历")] }, weekBox),
          card({ title: "平台账号", icon: "share", actions: [h("button", { class: "btn small ghost", onclick: toSettings("platform-login") }, "管理")] }, pfBox),
          card({ title: "当前运营账号", icon: "user", desc: "所有 AI 输出都按这个账号的定位和语气来写，侧栏顶部可切换", actions: [h("button", { class: "btn small ghost", onclick: toSettings("accounts") }, "编辑")] }, brandBox)));

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
          x.hot ? h("span", { class: "muted small-text" }, C.fmtCount(x.hot)) : null)))]
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
            h("p", { class: "muted small-text" }, "只存草稿不发布；重合度过高的不推送并标记「需改写」。需要应用开着才会按时运行。"),
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

          // ---- 平台账号 ----
          pfBox.replaceChildren(...Object.entries(C.PLATFORM_NAMES).map(([id, name]) => {
            const n = pas.filter((a) => a.platform === id && a.loggedIn).length;
            return kv(name, n ? `已登录 ${n} 个号` : h("span", { class: "muted" }, "未登录"));
          }));

          await C.loadAccounts();
          const a = C.currentAccount() || {};
          const bound = pas.filter((p) => p.boundAccountId === a.id && p.loggedIn);
          brandBox.replaceChildren(kv("账号", a.name || "—"), ...(a.positioning
            ? [kv("定位", a.positioning), kv("读者", a.audience || "—"), kv("语气", a.tone || "—")]
            : [h("p", { class: "muted" }, "还没填这个账号的定位。填上定位、目标读者和语气，AI 写出来会更像你。")]),
          kv("绑定的平台号", bound.length ? bound.map((p) => `${C.platformName(p.platform)}·${p.name}`).join("、") : h("span", { class: "muted" }, "无")));
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
      C.onData((what) => { if (window.Shell.current === "home" && what !== "materials") refresh(); });
      window.Shell.onSettings((c) => { if (Object.keys(c).some((k) => k.startsWith("ai") || k.startsWith("auto") || k === "currentAccount")) refresh(); });
      api.tasks.onChange((t) => { if (t.type === "auto:run" && ["done", "failed", "cancelled", "running"].includes(t.status) && window.Shell.current === "home") refresh(); });
      refresh();
      loadHot(false);
    },
    onShow() { if (this.refresh) this.refresh(); },
  });
})();
