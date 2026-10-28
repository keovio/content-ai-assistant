"use strict";
// 稿件管理：当前运营账号的所有稿件。搜索、按平台 / 状态 / 推送情况筛选；单篇编辑、一稿多发、推送草稿箱、打开草稿箱、删除；勾选批量推送。
(function () {
  const { h } = window.Shell;
  const api = window.app;
  const C = window.Content;

  window.Shell.registerPage({
    id: "library",
    title: "稿件管理",
    icon: "folder",
    order: 35,
    render(root) {
      const { card } = window.Shell;
      root.classList.add("page-wide");
      const q = h("input", { class: "input grow", type: "search", placeholder: "搜索标题、正文、标签…" });
      const pfSel = C.selectEl(C.platformOptions(true), "");
      const stSel = C.selectEl(C.statusOptions(true), "");
      const pushSel = C.selectEl([["", "全部推送状态"], ["none", "未推送"], ["saved", "已存草稿"], ["unknown", "待确认"], ["failed", "推送失败"]], "");
      const allBox = h("input", { type: "checkbox", title: "全选" });
      const batchBtn = h("button", { class: "btn small primary", disabled: true, onclick: batchPush }, "推送选中");
      const count = h("span", { class: "muted small-text" });
      const listEl = h("div", { class: "lib-list" });
      const selected = new Set();
      let rows = [];

      root.append(
        h("header", { class: "page-head" },
          h("div", {}, h("h1", {}, "稿件管理"), h("p", { class: "sub" }, "当前运营账号写过的所有稿件，点标题继续编辑")),
          h("div", { class: "actions" }, h("button", { class: "btn primary", onclick: () => C.open("writer", { fresh: true }) }, "写新稿"))),
        card({ title: "", class: "lib-card" },
          h("div", { class: "toolbar lib-toolbar" }, q, pfSel, stSel, pushSel),
          h("div", { class: "lib-head" }, h("label", { class: "check" }, allBox, "全选"), count, h("span", { class: "spacer" }), batchBtn),
          listEl));

      const pushState = (c) => { const r = c.pushes && c.pushes[c.platform]; return r ? r.status : "none"; };
      async function refresh() {
        try {
          const list = await C.list("contents", { q: q.value.trim(), platform: pfSel.value, status: stSel.value });
          rows = list.filter((c) => !pushSel.value || pushState(c) === pushSel.value);
          for (const id of [...selected]) if (!rows.some((c) => c.id === id)) selected.delete(id);
          count.textContent = `${rows.length} 篇`;
          listEl.replaceChildren(...(rows.length ? rows.map(row) : [h("div", { class: "empty" }, h("p", { class: "muted" }, list.length || q.value || pfSel.value || stSel.value ? "没有符合条件的稿件" : "还没有稿件。去「AI 写稿」写第一篇吧。"))]));
          drawBatch();
        } catch (e) { C.err(e); }
      }
      function drawBatch() {
        batchBtn.disabled = !selected.size;
        batchBtn.textContent = selected.size ? `推送选中（${selected.size}）` : "推送选中";
        allBox.checked = rows.length > 0 && selected.size === rows.length;
        allBox.indeterminate = selected.size > 0 && selected.size < rows.length;
      }
      allBox.addEventListener("change", () => { selected.clear(); if (allBox.checked) rows.forEach((c) => selected.add(c.id)); refresh(); });

      function row(c) {
        const r = c.pushes && c.pushes[c.platform];
        const cb = h("input", { type: "checkbox", checked: selected.has(c.id), onchange: () => { if (cb.checked) selected.add(c.id); else selected.delete(c.id); drawBatch(); } });
        const pushBtn = h("button", { class: "btn small", onclick: () => pushOne(c, pushBtn) }, c.platform === "douyin" ? "打开创作页" : "推送");
        return h("div", { class: "lib-row" },
          cb,
          C.platformTag(c.platform),
          h("div", { class: "lib-main" },
            h("a", { class: "lib-title", href: "#", onclick: (e) => { e.preventDefault(); C.open("writer", { id: c.id }); } }, c.title || "未命名"),
            h("div", { class: "lib-sub" },
              C.statusTag(c.status),
              c.scheduledAt ? h("span", {}, "排期 " + c.scheduledAt) : null,
              h("span", {}, `${C.countWords(c.body)} 字`),
              h("span", {}, "更新于 " + C.fmtDate(c.updatedAt)),
              C.pushTag(c),
              r && r.error ? h("span", { class: "error-text", title: r.error }, r.error) : null)),
          h("div", { class: "lib-actions" },
            h("button", { class: "btn small ghost", onclick: () => C.open("writer", { id: c.id }) }, "编辑"),
            h("button", { class: "btn small ghost", onclick: () => C.open("rewrite", { title: c.title, body: c.body, sourceId: c.id }) }, "多发"),
            r && r.url && c.platform !== "douyin" ? h("button", { class: "btn small ghost", onclick: () => C.call(api.publish.openFor(c.id)).catch(C.err) }, "草稿箱") : null,
            pushBtn,
            h("button", { class: "btn small danger-ghost", title: "删除", onclick: async () => {
              if (!(await window.Shell.confirm(`删除「${c.title || "未命名"}」？删除后不能恢复。`, { okText: "删除", danger: true }))) return;
              try { await C.remove("contents", c.id); window.Shell.toast("已删除", "success"); } catch (e) { C.err(e); }
            } }, "删除")));
      }
      async function pushOne(c, btn) {
        if (btn) btn.disabled = true;
        try {
          const r = await C.push(c.id, { title: `推送「${(c.title || "").slice(0, 16)}」到${C.platformName(c.platform)}` });
          if (r && r.status === "saved") window.Shell.toast(`「${(c.title || "").slice(0, 12)}」已存入${C.platformName(c.platform)}草稿箱`, "success");
          return true;
        } catch (e) { C.err(e); return false; }
        finally { if (btn) btn.disabled = false; }
      }
      async function batchPush() {
        const items = rows.filter((c) => selected.has(c.id));
        if (!items.length) return;
        const pfs = [...new Set(items.map((c) => C.platformName(c.platform)))].join("、");
        if (!(await window.Shell.confirm(`把选中的 ${items.length} 篇推送到各自平台的草稿箱（${pfs}）？同一平台会一篇一篇排队推送，不会发布。`, { okText: "开始推送" }))) return;
        selected.clear(); drawBatch();
        const results = await Promise.all(items.map((c) => pushOne(c)));
        const ok = results.filter(Boolean).length;
        window.Shell.toast(`批量推送结束：${ok} 篇完成，${items.length - ok} 篇失败`, ok === items.length ? "success" : "error", 5000);
      }

      q.addEventListener("input", window.Shell.debounce(refresh, 200));
      [pfSel, stSel, pushSel].forEach((el) => el.addEventListener("change", refresh));
      C.onData((what) => { if (what === "contents" || what === "account") refresh(); });
      this.refresh = refresh;
      refresh();
    },
    onShow() { if (this.refresh) this.refresh(); },
  });
})();
