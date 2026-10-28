"use strict";
// AI 写稿：左边设定（选题、平台、字数、风格、大纲、参考素材）→ 流式生成到右边编辑器；
// 编辑器里可以取标题、润色、保存、排期、导出、复制、一键送去一稿多发。
(function () {
  const { h } = window.Shell;
  const api = window.app;
  const C = window.Content;

  window.Shell.registerPage({
    id: "writer",
    title: "AI 写稿",
    icon: "pen",
    order: 30,
    render(root) {
      const { card } = window.Shell;
      root.classList.add("page-wide");
      const s = window.Shell.getSettings();

      // ---- 左：设定 ----
      const topicIn = h("input", { class: "input", placeholder: "这篇写什么？例如：普通人如何用 AI 每天省 1 小时" });
      const pfSel = C.selectEl(C.platformOptions(false), s.defaultPlatform || "wechat");
      const wordsSel = C.selectEl([["0", "按平台默认"], ["500", "约 500 字"], ["1000", "约 1000 字"], ["1500", "约 1500 字"], ["2500", "约 2500 字"], ["4000", "约 4000 字"]], "0");
      const styleIn = h("input", { class: "input", placeholder: "可选：例如 多讲案例、少用形容词、带点幽默" });
      const outlineIn = h("textarea", { class: "input", rows: 5, placeholder: "可选：大纲 / 必须写到的要点，一行一个" });
      const matBox = h("div", { class: "mat-pick" });
      const genBtn = h("button", { class: "btn primary", onclick: generate }, "生成初稿");
      const stopBtn = h("button", { class: "btn", hidden: true }, "停止");
      const genStatus = h("span", { class: "muted small-text" });

      // ---- 右：编辑器 ----
      const titleIn = h("input", { class: "input title-input", placeholder: "标题" });
      const bodyIn = h("textarea", { class: "input editor", placeholder: "正文。可以直接写，也可以让左边的 AI 先出一版。" });
      const wc = h("span", { class: "muted small-text" }, "0 字");
      const stSel = C.selectEl(C.statusOptions(false), "draft");
      const dateIn = h("input", { class: "input", type: "date" });
      const savedInfo = h("span", { class: "muted small-text" });
      const pushInfo = h("span", { class: "push-info" });
      const pushBtn = h("button", { class: "btn small", title: "保存后自动打开平台编辑页，填好标题正文并存入草稿箱（不会发布）", onclick: () => pushNow() }, "推送到草稿箱");
      const draftsBtn = h("button", { class: "btn small ghost", hidden: true, onclick: () => current.id && C.call(api.publish.openFor(current.id)).catch(C.err) }, "打开草稿箱");
      const titleBox = h("div", { class: "title-suggest", hidden: true });
      let undoBody = null;
      const undoBtn = h("button", { class: "btn small ghost", hidden: true, onclick: () => {
        if (undoBody === null) return;
        bodyIn.value = undoBody; undoBody = null; undoBtn.hidden = true; markDirty(); updateWc();
      } }, "撤销 AI 修改");
      const polishSel = C.selectEl([["polish", "润色"], ["shorten", "精简"], ["expand", "扩写"], ["casual", "口语化"], ["formal", "专业化"]], "polish");

      let current = { id: "" };
      let dirty = false;
      let taskId = null;
      const markDirty = () => { dirty = true; savedInfo.textContent = "未保存"; };
      const updateWc = () => { wc.textContent = `${C.countWords(bodyIn.value)} 字`; };
      titleIn.addEventListener("input", markDirty);
      bodyIn.addEventListener("input", () => { markDirty(); updateWc(); });
      stSel.addEventListener("change", markDirty);
      dateIn.addEventListener("change", markDirty);
      stopBtn.onclick = () => { if (taskId) C.cancelTask(taskId); };

      root.append(
        h("header", { class: "page-head" },
          h("div", {}, h("h1", {}, "AI 写稿"), h("p", { class: "sub" }, "设定好方向让 AI 出初稿，再在右边改到满意")),
          h("div", { class: "actions" }, h("button", { class: "btn", onclick: () => confirmLeave().then((ok) => ok && load({ fresh: true })) }, "新建"))),
        h("div", { class: "writer-grid" },
          card({ title: "写作设定", icon: "spark" },
            h("div", { class: "form" },
              C.field("选题", topicIn),
              h("div", { class: "form-row" }, C.field("平台", pfSel), C.field("篇幅", wordsSel)),
              C.field("风格要求", styleIn),
              C.field("大纲 / 要点", outlineIn),
              C.field("参考素材", matBox, "勾选的素材会交给 AI 参考"),
              h("div", { class: "actions" }, genBtn, stopBtn, genStatus))),
          card({ title: "编辑器", icon: "note", class: "editor-card", actions: [savedInfo] },
            titleIn, titleBox, bodyIn,
            h("div", { class: "editor-bar" },
              wc, h("span", { class: "spacer" }),
              h("button", { class: "btn small", onclick: suggestTitles }, "AI 取标题"),
              undoBtn, polishSel, h("button", { class: "btn small", title: "选中一段只处理选中的，不选就处理全文", onclick: polish }, "处理")),
            h("div", { class: "editor-bar push-bar" }, pushInfo, h("span", { class: "spacer" }), draftsBtn, pushBtn),
            h("div", { class: "editor-bar" },
              C.field("状态", stSel), C.field("发布日期", dateIn), h("span", { class: "spacer" }),
              h("button", { class: "btn small", onclick: () => C.copy((titleIn.value ? titleIn.value + "\n\n" : "") + bodyIn.value, "全文") }, "复制"),
              h("button", { class: "btn small", onclick: exportMd }, "导出"),
              h("button", { class: "btn small", onclick: () => C.open("rewrite", { title: titleIn.value, body: bodyIn.value, sourceId: current.id }) }, "一稿多发"),
              h("button", { class: "btn small danger-ghost", onclick: del }, "删除"),
              h("button", { class: "btn small primary", onclick: () => save() }, "保存")))));

      async function loadMaterials(selected = []) {
        try {
          const list = await C.list("materials");
          const keep = new Set(selected.concat([...matBox.querySelectorAll("input:checked")].map((i) => i.value)));
          matBox.replaceChildren(...(list.length ? list.slice(0, 50).map((m) =>
            h("label", { class: "check mat-item", title: (m.content || "").slice(0, 200) },
              h("input", { type: "checkbox", value: m.id, checked: keep.has(m.id) }), m.title || (m.content || "").slice(0, 24) || "未命名"))
            : [h("span", { class: "muted small-text" }, "素材库是空的")]));
        } catch (e) { window.Shell.reportError(e); }
      }

      function fill(c) {
        current = { id: c.id || "", sourceId: c.sourceId || "" };
        titleIn.value = c.title || "";
        bodyIn.value = c.body || "";
        if (c.platform) pfSel.value = c.platform;
        stSel.value = c.status || "draft";
        dateIn.value = c.scheduledAt || "";
        topicIn.value = c.topic || topicIn.value;
        dirty = false;
        savedInfo.textContent = c.id ? `已保存 · ${C.fmtDate(c.updatedAt)}` : "";
        titleBox.hidden = true;
        undoBody = null; undoBtn.hidden = true;
        updateWc();
        drawPush(c);
      }

      function drawPush(c) {
        const pf = pfSel.value;
        const r = c && c.pushes && c.pushes[pf];
        pushBtn.textContent = pf === "douyin" ? "打开抖音创作页" : `推送到${C.platformName(pf)}草稿箱`;
        draftsBtn.hidden = !(r && r.url) || pf === "douyin";
        draftsBtn.textContent = `打开${C.platformName(pf)}草稿箱`;
        pushInfo.replaceChildren(...(r ? [C.pushTag(c), h("span", { class: "muted small-text" }, " " + C.fmtDate(r.at) + (r.error ? " · " + r.error : ""))] : []));
      }
      pfSel.addEventListener("change", () => { markDirty(); drawPush(null); });

      async function pushNow() {
        const item = await save({ quiet: true });
        if (!item) return;
        pushBtn.disabled = true;
        try {
          const r = await C.push(item.id, { title: `推送「${(item.title || "").slice(0, 16)}」到${C.platformName(item.platform)}` });
          if (r && r.status === "saved") window.Shell.toast(`已存入${C.platformName(item.platform)}草稿箱`, "success");
          else if (r && r.status === "opened") window.Shell.toast("已打开抖音创作者中心，脚本已复制", "success", 4000);
          else if (r) window.Shell.toast("内容已填好，请在弹出的窗口里确认是否保存", "info", 5000);
        } catch (e) { C.err(e); }
        finally {
          pushBtn.disabled = false;
          try { const c = await C.call(api.store.get("contents", item.id)); if (c && c.id === current.id) drawPush(c); } catch { /* ignore */ }
        }
      }

      async function load(p) {
        if (!p) return;
        if (p.id) {
          try { const c = await C.call(api.store.get("contents", p.id)); if (c) fill(c); else window.Shell.toast("这篇内容已经不在了", "error"); }
          catch (e) { C.err(e); }
          return;
        }
        if (p.fresh) {
          topicIn.value = p.topic || ""; outlineIn.value = p.outline || ""; styleIn.value = "";
          fill({ title: p.title || "", body: p.body || "", platform: p.platform || pfSel.value, status: "draft", sourceId: p.sourceId || "", scheduledAt: p.scheduledAt || "" });
          if (p.body) markDirty();
        }
        if (p.materialIds) loadMaterials(p.materialIds);
        if (p.topic && !p.body) topicIn.focus();
      }

      async function confirmLeave() {
        if (!dirty || !(titleIn.value || bodyIn.value)) return true;
        return window.Shell.confirm("当前内容还没保存，确定丢掉吗？", { okText: "丢掉", danger: true });
      }

      async function generate() {
        if (!topicIn.value.trim() && !outlineIn.value.trim()) { window.Shell.toast("先写个选题或大纲", "info"); topicIn.focus(); return; }
        if ((titleIn.value || bodyIn.value) && !(await window.Shell.confirm("生成的初稿会替换编辑器里现在的内容，继续吗？"))) return;
        genBtn.disabled = true; stopBtn.hidden = false; genStatus.textContent = "正在连接 AI…";
        const before = { title: titleIn.value, body: bodyIn.value };
        bodyIn.value = ""; titleIn.value = "";
        try {
          const r = await C.runAi("ai:draft", {
            topic: topicIn.value.trim(), platform: pfSel.value, words: Number(wordsSel.value), style: styleIn.value.trim(), outline: outlineIn.value.trim(),
            materialIds: [...matBox.querySelectorAll("input:checked")].map((i) => i.value),
          }, {
            onTask: (t) => { taskId = t.id; if (t.message) genStatus.textContent = t.message; },
            onText: (text) => { const st = C.splitTitle(text); titleIn.value = st.title; bodyIn.value = st.body; bodyIn.scrollTop = bodyIn.scrollHeight; updateWc(); },
          });
          if (!r) { genStatus.textContent = "已停止"; if (!bodyIn.value) { titleIn.value = before.title; bodyIn.value = before.body; } }
          else { titleIn.value = r.title; bodyIn.value = r.body; genStatus.textContent = `完成，${C.countWords(r.body)} 字`; }
          updateWc(); markDirty();
        } catch (e) {
          genStatus.textContent = "";
          if (!bodyIn.value) { titleIn.value = before.title; bodyIn.value = before.body; }
          C.err(e);
        } finally { genBtn.disabled = false; stopBtn.hidden = true; taskId = null; }
      }

      async function suggestTitles() {
        if (!bodyIn.value.trim()) { window.Shell.toast("先有正文才能取标题", "info"); return; }
        titleBox.hidden = false;
        titleBox.replaceChildren(h("span", { class: "muted small-text" }, "AI 正在想标题…"));
        try {
          const r = await C.runAi("ai:titles", { content: (titleIn.value ? titleIn.value + "\n" : "") + bodyIn.value, platform: pfSel.value });
          if (!r) { titleBox.hidden = true; return; }
          titleBox.replaceChildren(...r.titles.map((t) => h("button", { class: "chip", onclick: () => { titleIn.value = t; markDirty(); titleBox.hidden = true; } }, t)),
            h("button", { class: "btn small ghost", onclick: () => { titleBox.hidden = true; } }, "收起"));
        } catch (e) { titleBox.hidden = true; C.err(e); }
      }

      async function polish() {
        const a = bodyIn.selectionStart, b = bodyIn.selectionEnd;
        const part = a !== b;
        const text = part ? bodyIn.value.slice(a, b) : bodyIn.value;
        if (!text.trim()) { window.Shell.toast("没有要处理的文字", "info"); return; }
        const close = window.Shell.toast(`AI 正在${polishSel.selectedOptions[0].textContent}${part ? "选中的部分" : "全文"}…`, "info", 0);
        try {
          const r = await C.runAi("ai:polish", { text, mode: polishSel.value });
          close();
          if (!r) return;
          const old = bodyIn.value;
          undoBody = old; undoBtn.hidden = false;
          bodyIn.value = part ? old.slice(0, a) + r.text + old.slice(b) : r.text;
          markDirty(); updateWc();
          window.Shell.toast("已替换，不满意可以点「撤销 AI 修改」", "success", 4000);
        } catch (e) { close(); C.err(e); }
      }

      async function save({ quiet = false } = {}) {
        if (!titleIn.value.trim() && !bodyIn.value.trim()) { window.Shell.toast("内容是空的", "info"); return null; }
        try {
          const item = await C.save("contents", {
            id: current.id || undefined, title: titleIn.value.trim() || "未命名", body: bodyIn.value, platform: pfSel.value,
            status: stSel.value, scheduledAt: dateIn.value, topic: topicIn.value.trim(), sourceId: current.sourceId || "",
          });
          current.id = item.id; dirty = false;
          savedInfo.textContent = `已保存 · ${C.fmtDate(item.updatedAt)}`;
          if (!quiet) window.Shell.toast("已保存", "success");
          return item;
        } catch (e) { C.err(e); return null; }
      }
      async function exportMd() {
        const item = await save({ quiet: true });
        if (!item) return;
        try { const r = await C.call(api.content.exportFile(item.id)); if (r.ok) window.Shell.toast("已导出到 " + r.file, "success", 5000); }
        catch (e) { C.err(e); }
      }
      async function del() {
        if (!current.id) { fill({}); return; }
        if (!(await window.Shell.confirm("删除这篇内容？删除后不能恢复。", { okText: "删除", danger: true }))) return;
        try { await C.remove("contents", current.id); fill({}); window.Shell.toast("已删除", "success"); } catch (e) { C.err(e); }
      }

      // Ctrl/⌘ + S 保存
      root.addEventListener("keydown", (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); save(); } });
      this.load = load;
      this.confirmLeave = confirmLeave;
      this.loadMaterials = loadMaterials;
      C.onData((what) => {
        if (what === "materials") loadMaterials();
        if (what === "contents" && current.id) api.store.get("contents", current.id).then((c) => { if (c && c.id === current.id) drawPush(c); }).catch(() => {});
      });
      loadMaterials();
    },
    async onShow() {
      const p = C.take("writer");
      if (p && this.load && (p.id || p.fresh || p.materialIds)) {
        if ((p.id || p.fresh) && !(await this.confirmLeave())) return;
        this.load(p);
      }
    },
  });
})();
