"use strict";
// 内容日历：月视图看排期（拖到另一天就改日期），下面是全部内容列表（按状态 / 平台筛选、改状态、排期）
(function () {
  const { h } = window.Shell;
  const C = window.Content;
  const WEEK = ["一", "二", "三", "四", "五", "六", "日"];

  window.Shell.registerPage({
    id: "calendar",
    title: "内容日历",
    icon: "cal",
    order: 60,
    render(root) {
      const { card } = window.Shell;
      root.classList.add("page-wide");
      let month = new Date(); month.setDate(1);
      const monthLabel = h("b", { class: "cal-month" });
      const grid = h("div", { class: "cal-grid" });
      const stFilter = C.selectEl(C.statusOptions(true), "");
      const pfFilter = C.selectEl(C.platformOptions(true), "");
      const q = h("input", { class: "input grow", type: "search", placeholder: "搜索标题 / 正文…" });
      const listBox = h("div", { class: "item-list" });
      let all = [];

      root.append(
        h("header", { class: "page-head" },
          h("div", {}, h("h1", {}, "内容日历"), h("p", { class: "sub" }, "排期一目了然；把卡片拖到另一天就能改发布日期")),
          h("div", { class: "actions" }, h("button", { class: "btn primary", onclick: () => C.open("writer", { fresh: true }) }, "写一篇"))),
        card({ title: "排期", icon: "cal", actions: [
          h("button", { class: "btn small", onclick: () => shift(-1) }, "‹ 上月"),
          monthLabel,
          h("button", { class: "btn small", onclick: () => shift(1) }, "下月 ›"),
          h("button", { class: "btn small ghost", onclick: () => { month = new Date(); month.setDate(1); draw(); } }, "本月")] }, grid),
        card({ title: "全部内容", icon: "note" }, h("div", { class: "toolbar" }, q, stFilter, pfFilter), listBox));

      q.addEventListener("input", window.Shell.debounce(drawList, 200));
      stFilter.addEventListener("change", drawList);
      pfFilter.addEventListener("change", drawList);
      function shift(n) { month = new Date(month.getFullYear(), month.getMonth() + n, 1); draw(); }

      async function refresh() {
        try { all = await C.list("contents"); draw(); drawList(); } catch (e) { window.Shell.reportError(e); }
      }

      function draw() {
        monthLabel.textContent = `${month.getFullYear()} 年 ${month.getMonth() + 1} 月`;
        const first = new Date(month);
        const offset = (first.getDay() + 6) % 7; // 周一开头
        const start = new Date(first.getFullYear(), first.getMonth(), 1 - offset);
        const today = C.today();
        const byDay = {};
        for (const c of all) if (c.scheduledAt) (byDay[c.scheduledAt] = byDay[c.scheduledAt] || []).push(c);
        const cells = WEEK.map((w) => h("div", { class: "cal-head" }, "周" + w));
        for (let i = 0; i < 42; i++) {
          const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
          const key = C.ymd(d);
          const items = byDay[key] || [];
          const cell = h("div", { class: "cal-cell" + (d.getMonth() !== month.getMonth() ? " other" : "") + (key === today ? " today" : ""), dataset: { date: key } },
            h("div", { class: "cal-date" }, String(d.getDate())),
            ...items.map((c) => h("button", {
              class: `cal-item pf-bg-${c.platform} cal-${c.status}`, draggable: "true", title: `${C.platformName(c.platform)} · ${C.statusName(c.status)}`,
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

      function drawList() {
        const kw = q.value.trim().toLowerCase();
        const list = all.filter((c) => (!stFilter.value || c.status === stFilter.value) && (!pfFilter.value || c.platform === pfFilter.value)
          && (!kw || (c.title + "\n" + c.body).toLowerCase().includes(kw)));
        listBox.replaceChildren(...(list.length ? list.map(row) : [h("p", { class: "muted" }, all.length ? "没有符合条件的内容。" : "还没有内容。")]));
      }
      function row(c) {
        const st = C.selectEl(C.statusOptions(false), c.status, { class: "input input-sm" });
        const date = h("input", { class: "input input-sm", type: "date", value: c.scheduledAt || "" });
        st.addEventListener("change", () => C.save("contents", { id: c.id, status: st.value }).catch(C.err));
        date.addEventListener("change", () => C.save("contents", { id: c.id, scheduledAt: date.value }).catch(C.err));
        return h("div", { class: "item static" },
          C.platformTag(c.platform),
          h("button", { class: "item-title link-btn", onclick: () => C.open("writer", { id: c.id }) }, c.title || "未命名"),
          h("span", { class: "muted small-text" }, `${C.countWords(c.body)} 字`),
          st, date,
          h("button", { class: "btn small danger-ghost", onclick: async () => {
            if (!(await window.Shell.confirm(`删除「${c.title || "未命名"}」？`, { okText: "删除", danger: true }))) return;
            C.remove("contents", c.id).catch(C.err);
          } }, "删除"));
      }

      this.refresh = refresh;
      this.setStatus = (s) => { stFilter.value = s; drawList(); };
      C.onData((what) => { if (what === "contents") refresh(); });
      refresh();
    },
    onShow() {
      const p = C.take("calendar");
      if (this.refresh) this.refresh().then(() => { if (p && p.status && this.setStatus) this.setStatus(p.status); });
    },
  });
})();
