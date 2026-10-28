"use strict";
// 素材库：金句、数据、链接、随手记、图片，带标签和搜索。
// 写稿时按选题自动引用相关的文字素材；配图时先从图片素材里找合适的复用（AI 生成的图自动收进来，也可以自己上传）
(function () {
  const { h } = window.Shell;
  const C = window.Content;
  const KINDS = { note: "随手记", quote: "金句", data: "数据", link: "链接", image: "图片" };
  const TEXT_KINDS = Object.entries(KINDS).filter(([k]) => k !== "image");

  window.Shell.registerPage({
    id: "materials",
    title: "素材库",
    icon: "folder",
    order: 50,
    render(root) {
      const { card } = window.Shell;
      root.classList.add("page-wide");
      const kindSel = C.selectEl(TEXT_KINDS, "note");
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
      const delSelBtn = h("button", { class: "btn small danger-ghost", disabled: true, onclick: deleteSelected }, "删除选中");
      const dlSelBtn = h("button", { class: "btn small ghost", disabled: true, onclick: () => downloadImages(shown.filter((m) => selected.has(m.id) && m.kind === "image")) }, "下载图片");
      const allSel = h("input", { type: "checkbox", title: "全选" });
      let shown = [];
      allSel.addEventListener("change", () => { selected.clear(); if (allSel.checked) shown.forEach((m) => selected.add(m.id)); refresh(); });
      const syncSel = () => {
        allSel.checked = shown.length > 0 && shown.every((m) => selected.has(m.id));
        allSel.indeterminate = selected.size > 0 && !allSel.checked; useBtn.disabled = delSelBtn.disabled = !selected.size; delSelBtn.textContent = selected.size ? `删除选中（${selected.size}）` : "删除选中";
        const nImg = shown.filter((m) => selected.has(m.id) && m.kind === "image").length;
        dlSelBtn.disabled = !nImg; dlSelBtn.textContent = nImg ? `下载图片（${nImg}）` : "下载图片"; };
      const fileIn = h("input", { type: "file", accept: "image/png,image/jpeg,image/webp,image/gif", multiple: true, hidden: true, onchange: upload });
      const upTitle = h("input", { class: "input", placeholder: "图片说明（配图时按它匹配，如：街角咖啡店门口）" });
      const upTags = h("input", { class: "input", placeholder: "标签，用空格或逗号分隔" });
      const upBtn = h("button", { class: "btn", onclick: () => fileIn.click() }, "选择图片上传");
      let editingId = "", editingImage = "";
      const selected = new Set();

      root.append(
        h("header", { class: "page-head" }, h("div", {}, h("h1", {}, "素材库"), h("p", { class: "sub" }, "平时看到好东西就丢进来：写稿按选题自动引用，配图优先复用图片素材"))),
        // 0.5.5：左边一列放「记一条」「上传图片」，「全部素材」占右边两格
        h("div", { class: "mat-wrap" }, h("div", { class: "mat-grid" },
          card({ title: "记一条", icon: "plus", id: "material-form", class: "mg-form" },
            h("div", { class: "form" },
              h("div", { class: "form-row" }, C.field("类型", kindSel), C.field("标签", tagsIn)),
              titleIn, contentIn, urlIn,
              h("div", { class: "actions" }, saveBtn, cancelBtn))),
          card({ title: "上传图片", icon: "image", id: "material-upload", class: "mg-upload" },
            h("div", { class: "form" },
              h("p", { class: "muted small-text" }, "AI 配图时会先从图片素材里找说明相符的直接用，找不到再生成；AI 生成的图也会自动收进来。"),
              upTitle, upTags, h("div", { class: "actions" }, upBtn, fileIn))),
          card({ title: "全部素材", icon: "folder", class: "mg-all", actions: [dlSelBtn, delSelBtn, useBtn] },
            h("div", { class: "toolbar" }, h("label", { class: "check" }, allSel, "全选"), q, kindFilter), listBox))));

      q.addEventListener("input", window.Shell.debounce(refresh, 200));
      kindFilter.addEventListener("change", refresh);

      async function upload() {
        const files = [...fileIn.files];
        fileIn.value = "";
        if (!files.length) return;
        let ok = 0;
        for (const f of files) {
          if (f.size > 15 * 1024 * 1024) { window.Shell.toast(`${f.name} 超过 15MB`, "info"); continue; }
          const data = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(f); });
          try { await C.call(window.app.images.import({ data, fileName: f.name, title: files.length === 1 ? upTitle.value.trim() : "", tags: upTags.value })); ok++; } catch (e) { C.err(e); }
        }
        if (ok) { window.Shell.toast(`已上传 ${ok} 张图片`, "success"); upTitle.value = ""; kindFilter.value = "image"; refresh(); }
      }
      function reset(m) {
        editingId = m ? m.id : "";
        editingImage = m && m.kind === "image" ? m.image : "";
        if (m && m.kind === "image" && ![...kindSel.options].some((o) => o.value === "image")) kindSel.append(h("option", { value: "image" }, "图片"));
        if (!m) for (const o of [...kindSel.options]) if (o.value === "image") o.remove();
        kindSel.value = m ? m.kind : "note";
        titleIn.value = m ? m.title : ""; contentIn.value = m ? m.content : ""; urlIn.value = m ? m.url : ""; tagsIn.value = m ? (m.tags || []).join(" ") : "";
        saveBtn.textContent = m ? "保存修改" : "保存素材";
        cancelBtn.hidden = !m;
        if (m) contentIn.focus();
      }
      async function save() {
        if (!editingImage && !contentIn.value.trim() && !urlIn.value.trim()) { window.Shell.toast("内容和链接至少填一个", "info"); return; }
        if (urlIn.value.trim() && !/^https?:\/\//.test(urlIn.value.trim())) { window.Shell.toast("链接要以 http:// 或 https:// 开头", "info"); return; }
        try {
          await C.save("materials", { id: editingId || undefined, kind: kindSel.value, image: editingImage, title: titleIn.value.trim(), content: contentIn.value.trim(), url: urlIn.value.trim(), tags: tagsIn.value });
          window.Shell.toast(editingId ? "已更新" : "已保存", "success");
          reset();
        } catch (e) { C.err(e); }
      }
      async function downloadImages(list) {
        if (!list.length) return;
        try {
          const r = await C.call(window.app.images.save(list.map((m) => ({ name: m.image, title: m.title || "" }))));
          if (r && r.ok) window.Shell.toast(`已下载 ${r.count} 张图片到 ${r.dir}`, "success");
        } catch (e) { C.err(e); }
      }
      function useSelected() { C.open("writer", { materialIds: [...selected] }); window.Shell.toast(`已在写稿页勾选 ${selected.size} 条素材`, "success"); }

      async function deleteSelected() {
        const ids = [...selected];
        if (!ids.length) return;
        if (!(await window.Shell.confirm(`删除选中的 ${ids.length} 条素材？删除后不能恢复。`, { okText: "删除", danger: true }))) return;
        let ok = 0;
        for (const id of ids) { try { await C.remove("materials", id); ok++; selected.delete(id); } catch (e) { C.err(e); } }
        window.Shell.toast(`已删除 ${ok} 条素材`, ok === ids.length ? "success" : "error");
        refresh();
      }
      async function refresh() {
        try {
          let list = await C.list("materials", { q: q.value.trim() });
          if (kindFilter.value) list = list.filter((m) => m.kind === kindFilter.value);
          for (const id of [...selected]) if (!list.some((m) => m.id === id)) selected.delete(id);
          shown = list;
          syncSel();
          listBox.replaceChildren(...(list.length ? list.map(row) : [h("p", { class: "muted" }, q.value ? "没有搜到。" : "还没有素材。")]));
        } catch (e) { window.Shell.reportError(e); }
      }
      function row(m) {
        const cb = h("input", { type: "checkbox", checked: selected.has(m.id), onchange: () => { if (cb.checked) selected.add(m.id); else selected.delete(m.id); syncSel(); } });
        return h("div", { class: "material" },
          h("div", { class: "material-head" }, cb, h("span", { class: "tag" }, KINDS[m.kind] || m.kind), h("b", {}, m.title || ""), h("span", { class: "spacer" }),
            h("span", { class: "muted small-text" }, C.fmtDate(m.updatedAt))),
          m.kind === "image" ? thumb(m) : null,
          m.content ? h("p", { class: "material-body" + (m.kind === "image" ? " muted small-text" : "") }, m.content) : null,
          m.url ? h("a", { href: m.url, target: "_blank", rel: "noopener", class: "small-text" }, m.url) : null,
          h("div", { class: "editor-bar" },
            ...(m.tags || []).map((t) => h("span", { class: "chip static" }, "#" + t)), h("span", { class: "spacer" }),
            m.kind === "image" ? h("button", { class: "btn small ghost", onclick: () => downloadImages([m]) }, "下载") : h("button", { class: "btn small ghost", onclick: () => C.copy(m.content || m.url, "素材") }, "复制"),
            h("button", { class: "btn small ghost", onclick: () => (m.kind === "image" ? editImage(m) : edit(m)) }, "编辑"),
            h("button", { class: "btn small danger-ghost", onclick: async () => {
              if (!(await window.Shell.confirm("删除这条素材？", { okText: "删除", danger: true }))) return;
              try { await C.remove("materials", m.id); } catch (e) { C.err(e); }
            } }, "删除")));
      }
      // 文字素材：填进上面的表单，并滚过去（之前点了没反应是因为表单在页面顶部看不到）
      function edit(m) {
        reset(m);
        document.getElementById("material-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      // 图片素材：弹窗编辑说明、描述和标签，能看到大图
      function editImage(m) {
        const img = h("img", { class: "img-edit-preview", alt: m.title || "" });
        C.call(window.app.images.dataUrl(m.image)).then((u) => { if (u) img.src = u; }).catch(() => {});
        const tIn = h("input", { class: "input", value: m.title || "", placeholder: "图片说明（配图时按它匹配，如：街角咖啡店门口）" });
        const cIn = h("textarea", { class: "input", rows: 3, placeholder: "补充描述（可选）" });
        cIn.value = m.content || "";
        const gIn = h("input", { class: "input", value: (m.tags || []).join(" "), placeholder: "标签，用空格或逗号分隔" });
        const close = () => { overlay.remove(); document.removeEventListener("keydown", onKey); };
        const onKey = (e) => { if (e.key === "Escape") close(); };
        const saveImg = async () => {
          try {
            await C.save("materials", { id: m.id, kind: "image", image: m.image, title: tIn.value.trim(), content: cIn.value.trim(), url: m.url || "", tags: gIn.value });
            window.Shell.toast("已更新", "success"); close(); refresh();
          } catch (e) { C.err(e); }
        };
        const overlay = h("div", { class: "modal-overlay", onclick: (e) => { if (e.target === overlay) close(); } },
          h("div", { class: "modal img-edit-modal", "data-material": m.id },
            h("h3", { class: "img-edit-title" }, "编辑图片素材"), img,
            h("div", { class: "form" }, C.field("说明", tIn), C.field("描述", cIn), C.field("标签", gIn),
              h("div", { class: "actions" }, h("button", { class: "btn primary", onclick: saveImg }, "保存修改"), h("button", { class: "btn", onclick: close }, "取消")))));
        document.addEventListener("keydown", onKey);
        document.body.append(overlay);
        tIn.focus();
      }
      function thumb(m) {
        const img = h("img", { class: "mat-thumb", alt: m.title || "" });
        C.call(window.app.images.dataUrl(m.image)).then((u) => { if (u) img.src = u; else img.replaceWith(h("span", { class: "muted small-text" }, "图片文件不见了")); }).catch(() => {});
        return img;
      }
      this.focusForm = () => { reset(); contentIn.focus(); };
      C.onData((what) => { if (what === "materials") refresh(); });
      refresh();
    },
    onShow() { const p = C.take("materials"); if (p && p.add && this.focusForm) this.focusForm(); },
  });
})();
