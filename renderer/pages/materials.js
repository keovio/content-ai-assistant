"use strict";
// 素材库：金句、数据、链接、随手记，带标签和搜索；勾选后可以一键交给 AI 写稿参考
(function () {
  const { h } = window.Shell;
  const C = window.Content;
  const KINDS = { note: "随手记", quote: "金句", data: "数据", link: "链接" };

  window.Shell.registerPage({
    id: "materials",
    title: "素材库",
    icon: "folder",
    order: 50,
    render(root) {
      const { card, modules } = window.Shell;
      root.classList.add("page-wide");
      const kindSel = C.selectEl(Object.entries(KINDS), "note");
      const titleIn = h("input", { class: "input", placeholder: "标题（可选）" });
      const contentIn = h("textarea", { class: "input", rows: 5, placeholder: "内容：一句金句、一组数据、一段观察…" });
      const urlIn = h("input", { class: "input", placeholder: "来源链接（可选，https://…）" });
      const tagsIn = h("input", { class: "input", placeholder: "标签，用空格或逗号分隔" });
      const saveBtn = h("button", { class: "btn primary", onclick: save }, "保存素材");
      const cancelBtn = h("button", { class: "btn", hidden: true, onclick: () => reset() }, "取消编辑");
      const q = h("input", { class: "input grow", type: "search", placeholder: "搜索素材…" });
      const kindFilter = C.selectEl([["", "全部类型"], ...Object.entries(KINDS)], "");
      const listBox = h("div", { class: "item-list" });
      const useBtn = h("button", { class: "btn small primary", disabled: true, onclick: useSelected }, "用选中的写稿");
      let editingId = "";
      const selected = new Set();

      root.append(
        h("header", { class: "page-head" }, h("div", {}, h("h1", {}, "素材库"), h("p", { class: "sub" }, "平时看到好东西就丢进来，写稿时让 AI 参考"))),
        modules(
          card({ title: "记一条", icon: "plus", id: "material-form" },
            h("div", { class: "form" },
              h("div", { class: "form-row" }, C.field("类型", kindSel), C.field("标签", tagsIn)),
              titleIn, contentIn, urlIn,
              h("div", { class: "actions" }, saveBtn, cancelBtn))),
          card({ title: "全部素材", icon: "folder", class: "span-wide", actions: [useBtn] },
            h("div", { class: "toolbar" }, q, kindFilter), listBox)));

      q.addEventListener("input", window.Shell.debounce(refresh, 200));
      kindFilter.addEventListener("change", refresh);

      function reset(m) {
        editingId = m ? m.id : "";
        kindSel.value = m ? m.kind : "note";
        titleIn.value = m ? m.title : ""; contentIn.value = m ? m.content : ""; urlIn.value = m ? m.url : ""; tagsIn.value = m ? (m.tags || []).join(" ") : "";
        saveBtn.textContent = m ? "保存修改" : "保存素材";
        cancelBtn.hidden = !m;
        if (m) contentIn.focus();
      }
      async function save() {
        if (!contentIn.value.trim() && !urlIn.value.trim()) { window.Shell.toast("内容和链接至少填一个", "info"); return; }
        if (urlIn.value.trim() && !/^https?:\/\//.test(urlIn.value.trim())) { window.Shell.toast("链接要以 http:// 或 https:// 开头", "info"); return; }
        try {
          await C.save("materials", { id: editingId || undefined, kind: kindSel.value, title: titleIn.value.trim(), content: contentIn.value.trim(), url: urlIn.value.trim(), tags: tagsIn.value });
          window.Shell.toast(editingId ? "已更新" : "已保存", "success");
          reset();
        } catch (e) { C.err(e); }
      }
      function useSelected() { C.open("writer", { materialIds: [...selected] }); window.Shell.toast(`已在写稿页勾选 ${selected.size} 条素材`, "success"); }

      async function refresh() {
        try {
          let list = await C.list("materials", { q: q.value.trim() });
          if (kindFilter.value) list = list.filter((m) => m.kind === kindFilter.value);
          for (const id of [...selected]) if (!list.some((m) => m.id === id)) selected.delete(id);
          useBtn.disabled = !selected.size;
          listBox.replaceChildren(...(list.length ? list.map(row) : [h("p", { class: "muted" }, q.value ? "没有搜到。" : "还没有素材。")]));
        } catch (e) { window.Shell.reportError(e); }
      }
      function row(m) {
        const cb = h("input", { type: "checkbox", checked: selected.has(m.id), onchange: () => { if (cb.checked) selected.add(m.id); else selected.delete(m.id); useBtn.disabled = !selected.size; } });
        return h("div", { class: "material" },
          h("div", { class: "material-head" }, cb, h("span", { class: "tag" }, KINDS[m.kind] || m.kind), h("b", {}, m.title || ""), h("span", { class: "spacer" }),
            h("span", { class: "muted small-text" }, C.fmtDate(m.updatedAt))),
          m.content ? h("p", { class: "material-body" }, m.content) : null,
          m.url ? h("a", { href: m.url, target: "_blank", rel: "noopener", class: "small-text" }, m.url) : null,
          h("div", { class: "editor-bar" },
            ...(m.tags || []).map((t) => h("span", { class: "chip static" }, "#" + t)), h("span", { class: "spacer" }),
            h("button", { class: "btn small ghost", onclick: () => C.copy(m.content || m.url, "素材") }, "复制"),
            h("button", { class: "btn small ghost", onclick: () => reset(m) }, "编辑"),
            h("button", { class: "btn small danger-ghost", onclick: async () => {
              if (!(await window.Shell.confirm("删除这条素材？", { okText: "删除", danger: true }))) return;
              try { await C.remove("materials", m.id); } catch (e) { C.err(e); }
            } }, "删除")));
      }
      this.focusForm = () => { reset(); contentIn.focus(); };
      C.onData((what) => { if (what === "materials") refresh(); });
      refresh();
    },
    onShow() { const p = C.take("materials"); if (p && p.add && this.focusForm) this.focusForm(); },
  });
})();
