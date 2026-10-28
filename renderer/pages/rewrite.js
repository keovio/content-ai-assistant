"use strict";
// 一稿多发：选一篇已有内容或粘贴原文，勾选目标平台，同时改写出各平台版本（每个平台一个后台任务，并行跑）
(function () {
  const { h } = window.Shell;
  const C = window.Content;

  window.Shell.registerPage({
    id: "rewrite",
    title: "一稿多发",
    icon: "share",
    order: 40,
    render(root) {
      const { card } = window.Shell;
      root.classList.add("page-wide");
      const pickSel = h("select", { class: "input" });
      const srcTitle = h("input", { class: "input", placeholder: "原文标题（可选）" });
      const srcBody = h("textarea", { class: "input", rows: 12, placeholder: "粘贴原文，或从上面选一篇已保存的内容" });
      const wc = h("span", { class: "muted small-text" }, "0 字");
      const checks = Object.entries(C.PLATFORM_NAMES).map(([id, name]) =>
        h("label", { class: "check" }, h("input", { type: "checkbox", value: id, checked: id !== "wechat" }), name));
      const goBtn = h("button", { class: "btn primary", onclick: start }, "开始改写");
      const stopBtn = h("button", { class: "btn", hidden: true, onclick: () => running.forEach((id) => C.cancelTask(id)) }, "全部停止");
      const results = h("div", { class: "rewrite-results" });
      let sourceId = "";
      const running = new Set();
      srcBody.addEventListener("input", () => { wc.textContent = `${C.countWords(srcBody.value)} 字`; });

      root.append(
        h("header", { class: "page-head" }, h("div", {}, h("h1", {}, "一稿多发"), h("p", { class: "sub" }, "一篇内容，改写成公众号 / 小红书 / 抖音口播各自的样子"))),
        h("div", { class: "writer-grid" },
          card({ title: "原文", icon: "note" },
            h("div", { class: "form" },
              C.field("从已有内容选", pickSel),
              srcTitle, srcBody,
              h("div", { class: "editor-bar" }, wc, h("span", { class: "spacer" }), ...checks),
              h("div", { class: "actions" }, goBtn, stopBtn))),
          results));
      results.append(h("section", { class: "card module" }, h("p", { class: "muted" }, "勾选平台后点「开始改写」，每个平台的版本会出现在这里，可以分别复制或保存。")));

      pickSel.addEventListener("change", async () => {
        if (!pickSel.value) return;
        try {
          const c = await C.call(window.app.store.get("contents", pickSel.value));
          if (c) { srcTitle.value = c.title; srcBody.value = c.body; sourceId = c.id; srcBody.dispatchEvent(new Event("input")); }
        } catch (e) { C.err(e); }
      });

      async function loadPicker() {
        try {
          const list = (await C.list("contents")).filter((c) => (c.body || "").trim());
          const v = pickSel.value;
          pickSel.replaceChildren(h("option", { value: "" }, list.length ? "— 选择一篇 —" : "还没有保存的内容"),
            ...list.slice(0, 200).map((c) => h("option", { value: c.id }, `[${C.platformName(c.platform)}] ${c.title || "未命名"}`)));
          pickSel.value = v;
        } catch (e) { window.Shell.reportError(e); }
      }

      function start() {
        const source = (srcTitle.value.trim() ? "# " + srcTitle.value.trim() + "\n\n" : "") + srcBody.value.trim();
        if (!srcBody.value.trim()) { window.Shell.toast("先放一篇原文", "info"); return; }
        const targets = checks.map((l) => l.querySelector("input")).filter((i) => i.checked).map((i) => i.value);
        if (!targets.length) { window.Shell.toast("至少勾一个平台", "info"); return; }
        results.replaceChildren(...targets.map((pf) => resultCard(pf, source)));
      }

      function resultCard(pf, source) {
        const { card } = window.Shell;
        const out = h("textarea", { class: "input editor small-editor", placeholder: "等待生成…" });
        const status = h("span", { class: "muted small-text" }, "排队中…");
        const actions = h("div", { class: "editor-bar" }, status, h("span", { class: "spacer" }),
          h("button", { class: "btn small", onclick: () => C.copy(out.value, C.platformName(pf) + "版本") }, "复制"),
          h("button", { class: "btn small", onclick: () => C.open("writer", { fresh: true, ...C.splitTitle(out.value), platform: pf, sourceId }) }, "去编辑"),
          h("button", { class: "btn small primary", onclick: async () => {
            const st = C.splitTitle(out.value);
            if (!st.body.trim()) return;
            try { await C.save("contents", { title: st.title || srcTitle.value || "未命名", body: st.body, platform: pf, status: "draft", sourceId }); window.Shell.toast(`已保存${C.platformName(pf)}版本`, "success"); }
            catch (e) { C.err(e); }
          } }, "保存"));
        const el = card({ title: C.platformName(pf) + "版本", icon: "share" }, out, actions);
        goBtn.disabled = true; stopBtn.hidden = false;
        let myId = null;
        C.runAi("ai:rewrite", { source, platform: pf }, {
          title: `改写为${C.platformName(pf)}`,
          onTask: (t) => { if (!myId) { myId = t.id; running.add(t.id); } if (t.message) status.textContent = t.message; else if (t.status === "running") status.textContent = "正在生成…"; },
          onText: (text) => { out.value = text; out.scrollTop = out.scrollHeight; },
        }).then((r) => {
          if (!r) { status.textContent = "已停止"; return; }
          out.value = r.text; status.textContent = `完成，${C.countWords(r.text)} 字`;
        }).catch((e) => { status.textContent = ""; status.className = "error small"; status.textContent = e.message; })
          .finally(() => { running.delete(myId); if (!running.size) { goBtn.disabled = false; stopBtn.hidden = true; } });
        return el;
      }

      this.fillSource = (p) => {
        srcTitle.value = p.title || ""; srcBody.value = p.body || ""; sourceId = p.sourceId || "";
        srcBody.dispatchEvent(new Event("input"));
      };
      C.onData((what) => { if (what === "contents") loadPicker(); });
      loadPicker();
    },
    onShow() {
      const p = C.take("rewrite");
      if (p && this.fillSource && (p.body || p.title)) this.fillSource(p);
    },
  });
})();
