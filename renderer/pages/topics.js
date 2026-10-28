"use strict";
// 选题灵感：按领域 / 热点批量生成选题 → 收藏 / 直接写成稿 / 放进日历当选题
(function () {
  const { h } = window.Shell;
  const C = window.Content;

  window.Shell.registerPage({
    id: "topics",
    title: "选题灵感",
    icon: "bulb",
    order: 20,
    render(root) {
      const { card, modules } = window.Shell;
      root.classList.add("page-wide");
      const s = window.Shell.getSettings();
      const fieldIn = h("input", { class: "input", placeholder: "例如：职场成长、母婴好物、AI 工具" });
      const kwIn = h("textarea", { class: "input", rows: 3, placeholder: "可选：最近的热点、关键词、读者常问的问题，一行一个" });
      const pfSel = C.selectEl(C.platformOptions(true), "");
      const countSel = C.selectEl([["5", "5 个"], ["8", "8 个"], ["12", "12 个"], ["20", "20 个"]], "8");
      const genBtn = h("button", { class: "btn primary", onclick: generate }, "生成选题");
      const stopBtn = h("button", { class: "btn", hidden: true }, "停止");
      const status = h("p", { class: "muted small-text" });
      const resultBox = h("div", { class: "topic-list" }, h("p", { class: "muted" }, "填好方向点「生成选题」。没填账号定位的话，先去设置里填一下效果更好。"));
      const savedBox = h("div", { class: "topic-list" });
      if (s.brandPositioning) fieldIn.placeholder = "默认按账号定位：" + s.brandPositioning.slice(0, 30);

      root.append(
        h("header", { class: "page-head" }, h("div", {}, h("h1", {}, "选题灵感"), h("p", { class: "sub" }, "批量出选题，挑好的收藏或直接写成稿"))),
        modules(
          card({ title: "找选题", icon: "search" },
            h("div", { class: "form" },
              C.field("领域 / 方向", fieldIn),
              C.field("热点 / 关键词", kwIn),
              h("div", { class: "form-row" }, C.field("平台", pfSel), C.field("数量", countSel)),
              h("div", { class: "actions" }, genBtn, stopBtn), status)),
          card({ title: "生成结果", icon: "bulb", id: "topic-results" }, resultBox),
          card({ title: "已收藏的选题", icon: "bookmark" }, savedBox)));

      let taskId = null;
      stopBtn.onclick = () => { if (taskId) C.cancelTask(taskId); };

      async function generate() {
        genBtn.disabled = true; stopBtn.hidden = false;
        status.textContent = "AI 正在想选题…";
        resultBox.replaceChildren(h("div", { class: "progress" }, h("div", { class: "bar indeterminate" })));
        try {
          const r = await C.runAi("ai:topics", {
            field: fieldIn.value.trim(), keywords: kwIn.value.trim(), platform: pfSel.value, count: Number(countSel.value),
          }, {
            onTask: (t) => { taskId = t.id; if (t.message) status.textContent = t.message; },
          });
          if (!r) { status.textContent = "已停止"; resultBox.replaceChildren(); return; }
          status.textContent = `生成了 ${r.topics.length} 个选题`;
          resultBox.replaceChildren(...r.topics.map((t) => topicCard(t, false)));
        } catch (e) {
          status.textContent = "";
          resultBox.replaceChildren(h("p", { class: "error" }, e.message));
        } finally { genBtn.disabled = false; stopBtn.hidden = true; taskId = null; }
      }

      function topicCard(t, saved) {
        const el = h("div", { class: "topic" },
          h("div", { class: "topic-head" }, C.platformTag(t.platform), h("b", { class: "topic-title" }, t.title)),
          t.angle ? h("p", { class: "topic-line" }, h("span", { class: "muted" }, "角度 "), t.angle) : null,
          t.hook ? h("p", { class: "topic-line" }, h("span", { class: "muted" }, "钩子 "), t.hook) : null,
          t.reason ? h("p", { class: "topic-line muted" }, t.reason) : null);
        const write = h("button", { class: "btn small primary", onclick: () => C.open("writer", { fresh: true, topic: t.title, platform: t.platform, outline: [t.angle && "切入角度：" + t.angle, t.hook && "开头钩子：" + t.hook].filter(Boolean).join("\n") }) }, "写成稿");
        const toPlan = h("button", { class: "btn small", onclick: async () => {
          try { await C.save("contents", { title: t.title, topic: [t.angle, t.hook].filter(Boolean).join("；"), platform: t.platform, status: "idea" }); window.Shell.toast("已加入内容列表（选题）", "success"); }
          catch (e) { C.err(e); }
        } }, "加入日历");
        const actions = [write, toPlan];
        if (saved) {
          actions.push(h("button", { class: "btn small danger-ghost", onclick: async () => { try { await C.remove("topics", t.id); } catch (e) { C.err(e); } } }, "删除"));
        } else {
          const star = h("button", { class: "btn small", onclick: async () => {
            try { await C.save("topics", t); star.disabled = true; star.textContent = "已收藏"; } catch (e) { C.err(e); }
          } }, "收藏");
          actions.splice(1, 0, star);
        }
        el.append(h("div", { class: "actions" }, ...actions));
        return el;
      }

      async function loadSaved() {
        try {
          const list = await C.list("topics");
          savedBox.replaceChildren(...(list.length ? list.map((t) => topicCard(t, true)) : [h("p", { class: "muted" }, "还没有收藏。")]));
        } catch (e) { window.Shell.reportError(e); }
      }
      C.onData((what) => { if (what === "topics") loadSaved(); });
      loadSaved();
    },
  });
})();
