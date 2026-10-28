"use strict";
// 发布：当前运营账号的所有稿件。两种视图：
//   列表：搜索、按平台 / 状态 / 推送情况筛选（含「需改写」「推送失败」）；改状态、排期、编辑、推送草稿箱、打开草稿箱、删除；勾选批量推送
//   日历：月视图看排期，把卡片拖到另一天就改发布日期，双击空白处新建
(function () {
  const { h } = window.Shell;
  const api = window.app;
  const C = window.Content;
  const WEEK = ["一", "二", "三", "四", "五", "六", "日"];

  window.Shell.registerPage({
    id: "publish",
    title: "发布",
    icon: "cal",
    order: 40,
    render(root) {
      const { card } = window.Shell;
      root.classList.add("page-wide");
      let view = "list";
      const listView = h("div", {});
      const calView = h("div", { hidden: true });
      const viewTabs = C.tabs([["list", "列表"], ["calendar", "日历"]], (id) => { view = id; listView.hidden = id !== "list"; calView.hidden = id !== "calendar"; refresh(); });
      viewTabs.el.querySelector("[data-tab='list']").classList.add("active");

      root.append(
        h("header", { class: "page-head" },
          h("div", {}, h("h1", {}, "发布"), h("p", { class: "sub" }, "管理所有稿件：排期、推送到平台草稿箱（只存草稿，不会发布）")),
          h("div", { class: "actions" }, viewTabs.el, h("button", { class: "btn primary", onclick: () => C.open("writer", { fresh: true }) }, "写新稿"))),
        listView, calView);

      // ================= 列表 =================
      const q = h("input", { class: "input grow", type: "search", placeholder: "搜索标题、正文、标签…" });
      const pfSel = C.selectEl(C.platformOptions(true), "");
      const stSel = C.selectEl(C.statusOptions(true), "");
      const pushSel = C.selectEl([["", "全部推送状态"], ["none", "未推送"], ["saved", "已存草稿"], ["unknown", "待确认"], ["failed", "推送失败"], ["rewrite", "需改写"]], "");
      const allBox = h("input", { type: "checkbox", title: "全选" });
      const batchBtn = h("button", { class: "btn small primary", disabled: true, onclick: batchPush }, "推送选中");
      const count = h("span", { class: "muted small-text" });
      const listEl = h("div", { class: "lib-list" });
      const selected = new Set();
      let rows = [];
      let all = [];
      listView.append(card({ title: "", class: "lib-card" },
        h("div", { class: "toolbar lib-toolbar" }, q, pfSel, stSel, pushSel),
        h("div", { class: "lib-head" }, h("label", { class: "check" }, allBox, "全选"), count, h("span", { class: "spacer" }), batchBtn),
        listEl));

      const pushState = (c) => { const r = c.pushes && c.pushes[c.platform]; return r ? r.status : "none"; };
      async function refresh() {
        try {
          all = await C.list("contents");
          if (view === "list") drawList(); else drawCal();
        } catch (e) { C.err(e); }
      }
      function drawList() {
        const kw = q.value.trim().toLowerCase();
        rows = all.filter((c) => (!pfSel.value || c.platform === pfSel.value) && (!stSel.value || c.status === stSel.value)
          && (!kw || [c.title, c.body, (c.tags || []).join(" ")].join("\n").toLowerCase().includes(kw))
          && (!pushSel.value || (pushSel.value === "rewrite" ? c.needsRewrite : pushState(c) === pushSel.value)));
        for (const id of [...selected]) if (!rows.some((c) => c.id === id)) selected.delete(id);
        count.textContent = `${rows.length} 篇`;
        listEl.replaceChildren(...(rows.length ? rows.map(row) : [h("div", { class: "empty" }, h("p", { class: "muted" }, all.length ? "没有符合条件的稿件" : "还没有稿件。去「创作」写第一篇，或在「对标拆解」里批量创作。"))]));
        drawBatch();
      }
      function drawBatch() {
        batchBtn.disabled = !selected.size;
        batchBtn.textContent = selected.size ? `推送选中（${selected.size}）` : "推送选中";
        allBox.checked = rows.length > 0 && selected.size === rows.length;
        allBox.indeterminate = selected.size > 0 && selected.size < rows.length;
      }
      allBox.addEventListener("change", () => { selected.clear(); if (allBox.checked) rows.forEach((c) => selected.add(c.id)); drawList(); });

      function row(c) {
        const r = c.pushes && c.pushes[c.platform];
        const cb = h("input", { type: "checkbox", checked: selected.has(c.id), onchange: () => { if (cb.checked) selected.add(c.id); else selected.delete(c.id); drawBatch(); } });
        const pushBtn = h("button", { class: "btn small", onclick: () => pushOne(c, pushBtn) }, c.platform === "douyin" ? "打开创作页" : "推送");
        const st = C.selectEl(C.statusOptions(false), c.status, { class: "input input-sm", title: "状态" });
        const date = h("input", { class: "input input-sm", type: "date", value: c.scheduledAt || "", title: "发布日期" });
        st.addEventListener("change", () => C.save("contents", { id: c.id, status: st.value }).catch(C.err));
        date.addEventListener("change", () => C.save("contents", { id: c.id, scheduledAt: date.value }).catch(C.err));
        return h("div", { class: "lib-row" },
          cb,
          C.platformTag(c.platform),
          h("div", { class: "lib-main" },
            h("a", { class: "lib-title", href: "#", onclick: (e) => { e.preventDefault(); C.open("writer", { id: c.id }); } }, c.title || "未命名"),
            h("div", { class: "lib-sub" },
              h("span", {}, `${C.countWords(c.body)} 字`),
              h("span", {}, "更新于 " + C.fmtDate(c.updatedAt)),
              c.auto ? h("span", { class: "chip static" }, "自动创作") : null,
              C.overlapTag(c), C.rewriteTag(c), C.pushTag(c),
              r && r.accountName ? h("span", { class: "muted" }, "· " + r.accountName) : null,
              r && r.error ? h("span", { class: "error-text", title: r.error }, r.error) : null)),
          h("div", { class: "lib-actions show" }, st, date,
            h("button", { class: "btn small ghost", onclick: () => C.open("writer", { id: c.id }) }, "编辑"),
            r && r.url && c.platform !== "douyin" ? h("button", { class: "btn small ghost", onclick: () => C.call(api.publish.openFor(c.id)).catch(C.err) }, "草稿箱") : null,
            pushBtn,
            h("button", { class: "btn small danger-ghost", title: "删除", onclick: async () => {
              if (!(await window.Shell.confirm(`删除「${c.title || "未命名"}」？删除后不能恢复。`, { okText: "删除", danger: true }))) return;
              try { await C.remove("contents", c.id); window.Shell.toast("已删除", "success"); } catch (e) { C.err(e); }
            } }, "删除")));
      }
      async function pushOne(c, btn, { quiet = false } = {}) {
        if (c.needsRewrite) {
          if (quiet) return false;
          if (!(await window.Shell.confirm(`「${c.title}」与参考原文重合度 ${c.overlap}%，已标记需改写。仍然推送吗？`, { okText: "仍然推送", danger: true }))) return false;
        }
        if (btn) btn.disabled = true;
        try {
          const r = await C.push(c.id, { title: `推送「${(c.title || "").slice(0, 16)}」到${C.platformName(c.platform)}`, force: !!c.needsRewrite });
          if (r && r.status === "saved") window.Shell.toast(`「${(c.title || "").slice(0, 12)}」已存入${C.platformName(c.platform)}草稿箱`, "success");
          return true;
        } catch (e) { C.err(e); return false; }
        finally { if (btn) btn.disabled = false; }
      }
      async function batchPush() {
        const items = rows.filter((c) => selected.has(c.id));
        if (!items.length) return;
        const skip = items.filter((c) => c.needsRewrite).length;
        const pfs = [...new Set(items.map((c) => C.platformName(c.platform)))].join("、");
        if (!(await window.Shell.confirm(`把选中的 ${items.length} 篇推送到各自平台的草稿箱（${pfs}）？同一平台会一篇一篇排队推送，不会发布。${skip ? `其中 ${skip} 篇需改写，会跳过。` : ""}`, { okText: "开始推送" }))) return;
        selected.clear(); drawBatch();
        const results = await Promise.all(items.map((c) => pushOne(c, null, { quiet: true })));
        const ok = results.filter(Boolean).length;
        window.Shell.toast(`批量推送结束：${ok} 篇完成，${items.length - ok} 篇未推送`, ok === items.length ? "success" : "error", 5000);
      }
      q.addEventListener("input", window.Shell.debounce(drawList, 200));
      [pfSel, stSel, pushSel].forEach((el) => el.addEventListener("change", drawList));

      // ================= 日历 =================
      let month = new Date(); month.setDate(1);
      const monthLabel = h("b", { class: "cal-month" });
      const grid = h("div", { class: "cal-grid" });
      const calPf = C.selectEl(C.platformOptions(true), "");
      calPf.addEventListener("change", drawCal);
      calView.append(card({ title: "排期", icon: "cal", desc: "把卡片拖到另一天就能改发布日期；双击空白日期新建一篇。", actions: [
        calPf,
        h("button", { class: "btn small", onclick: () => shift(-1) }, "‹ 上月"),
        monthLabel,
        h("button", { class: "btn small", onclick: () => shift(1) }, "下月 ›"),
        h("button", { class: "btn small ghost", onclick: () => { month = new Date(); month.setDate(1); drawCal(); } }, "本月")] }, grid));
      function shift(n) { month = new Date(month.getFullYear(), month.getMonth() + n, 1); drawCal(); }
      function drawCal() {
        monthLabel.textContent = `${month.getFullYear()} 年 ${month.getMonth() + 1} 月`;
        const first = new Date(month);
        const offset = (first.getDay() + 6) % 7; // 周一开头
        const start = new Date(first.getFullYear(), first.getMonth(), 1 - offset);
        const today = C.today();
        const byDay = {};
        for (const c of all) if (c.scheduledAt && (!calPf.value || c.platform === calPf.value)) (byDay[c.scheduledAt] = byDay[c.scheduledAt] || []).push(c);
        const cells = WEEK.map((w) => h("div", { class: "cal-head" }, "周" + w));
        for (let i = 0; i < 42; i++) {
          const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
          const key = C.ymd(d);
          const items = byDay[key] || [];
          const cell = h("div", { class: "cal-cell" + (d.getMonth() !== month.getMonth() ? " other" : "") + (key === today ? " today" : ""), dataset: { date: key } },
            h("div", { class: "cal-date" }, String(d.getDate())),
            ...items.map((c) => h("button", {
              class: `cal-item pf-bg-${c.platform} cal-${c.status}`, draggable: "true", title: `${C.platformName(c.platform)} · ${C.statusName(c.status)}${c.needsRewrite ? " · 需改写" : ""}`,
              onclick: () => C.open("writer", { id: c.id }),
              ondragstart: (e) => { e.dataTransfer.setData("text/plain", c.id); e.dataTransfer.effectAllowed = "move"; },
            }, c.title || "未命名")));
          cell.addEventListener("dragover", (e) => { e.preventDefault(); cell.classList.add("drop"); });
          cell.addEventListener("dragleave", () => cell.classList.remove("drop"));
          cell.addEventListener("drop", async (e) => {
            e.preventDefault(); cell.classList.remove("drop");
            const id = e.dataTransfer.getData("text/plain");
            if (!id) return;
            try { await C.save("contents", { id, scheduledAt: key }); window.Shell.toast(`已排到 ${key}`, "success"); } catch (err) { C.err(err); }
          });
          cell.addEventListener("dblclick", (e) => { if (e.target === cell || e.target.classList.contains("cal-date")) C.open("writer", { fresh: true, scheduledAt: key }); });
          cells.push(cell);
        }
        grid.replaceChildren(...cells);
      }

      this.refresh = refresh;
      this.apply = (p) => {
        if (!p) return;
        if (p.view) viewTabs.set(p.view);
        if (p.status) { stSel.value = p.status; }
        if (p.push) { pushSel.value = p.push; }
        if (p.status || p.push) { if (view !== "list") viewTabs.set("list"); else drawList(); }
      };
      C.onData((what) => { if (what === "contents" || what === "account") refresh(); });
      refresh();
    },
    onShow() {
      const p = C.take("publish");
      if (this.refresh) this.refresh().then(() => { if (p && this.apply) this.apply(p); });
    },
  });
})();
