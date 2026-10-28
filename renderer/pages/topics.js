"use strict";
// 选题：按领域 / 热点批量生成选题 → 收藏 / 直接写成稿 / 放进发布日历当选题
(function () {
  const { h } = window.Shell;
  const C = window.Content;

  window.Shell.registerPage({
    id: "topics",
    title: "选题",
    icon: "bulb",
    order: 20,
    render(root) {
      const { card } = window.Shell;
      root.classList.add("page-wide");
      const s = window.Shell.getSettings();
      const fieldIn = h("input", { class: "input", placeholder: "例如：职场成长、母婴好物、AI 工具" });
      const kwIn = h("textarea", { class: "input", rows: 3, placeholder: "可选：最近的热点、关键词、读者常问的问题，一行一个" });
      const pfSel = C.selectEl(C.platformOptions(true), "");
      const countSel = C.selectEl([["5", "5 个"], ["8", "8 个"], ["12", "12 个"], ["20", "20 个"]], "8");
      const genBtn = h("button", { class: "btn primary", onclick: generate }, "生成选题");
      const stopBtn = h("button", { class: "btn", hidden: true }, "停止");
      const status = h("p", { class: "muted small-text" });
      const resultBox = h("div", { class: "topic-grid" }, h("p", { class: "muted" }, "填好方向点「生成选题」。账号定位写得越具体，选题越贴合。"));
      const savedBox = h("div", { class: "topic-grid", hidden: true });
      // 0.5.6 批量操作：勾选选题后一次收藏 / 后台写 / 加入日历 / 删除
      const genBar = batchBar(resultBox, false);
      const savedBar = batchBar(savedBox, true);
      // 右侧：本次生成 / 已收藏 两个标签页，收藏不用一直占位置
      const tabGen = h("button", { class: "active", onclick: () => showTab("gen") }, "本次生成");
      const savedCount = h("span", { class: "tab-count" }, "0");
      const tabSaved = h("button", { onclick: () => showTab("saved") }, "已收藏 ", savedCount);
      const tabs = h("div", { class: "segmented" }, tabGen, tabSaved);
      function showTab(which) {
        tabGen.classList.toggle("active", which === "gen"); tabSaved.classList.toggle("active", which === "saved");
        resultBox.hidden = which !== "gen"; savedBox.hidden = which !== "saved";
        genBar.el.hidden = which !== "gen" || !resultBox.querySelector(".topic"); savedBar.el.hidden = which !== "saved" || !savedBox.querySelector(".topic");
      }
      void s;

      root.append(
        h("header", { class: "page-head" }, h("div", {}, h("h1", {}, "选题"), h("p", { class: "sub" }, "批量出选题，挑好的收藏或直接写成稿"))),
        h("div", { class: "writer-grid" },
          card({ title: "找选题", icon: "search" },
            h("div", { class: "form" },
              C.field("领域 / 方向", fieldIn),
              C.field("热点 / 关键词", kwIn),
              h("div", { class: "form-row" }, C.field("平台", pfSel), C.field("数量", countSel)),
              h("div", { class: "actions" }, genBtn, stopBtn), status)),
          card({ title: "选题", icon: "bulb", id: "topic-results", actions: [tabs] }, genBar.el, savedBar.el, resultBox, savedBox)));

      let taskId = null;
      stopBtn.onclick = () => { if (taskId) C.cancelTask(taskId); };

      async function generate() {
        genBtn.disabled = true; stopBtn.hidden = false;
        status.textContent = "AI 正在想选题…";
        showTab("gen");
        resultBox.replaceChildren(h("div", { class: "progress" }, h("div", { class: "bar indeterminate" })));
        genBar.refresh();
        try {
          const r = await C.runAi("ai:topics", {
            field: fieldIn.value.trim(), keywords: kwIn.value.trim(), platform: pfSel.value, count: Number(countSel.value),
          }, {
            onTask: (t) => { taskId = t.id; if (t.message) status.textContent = t.message; },
          });
          if (!r) { status.textContent = "已停止"; resultBox.replaceChildren(); return; }
          status.textContent = `生成了 ${r.topics.length} 个选题`;
          resultBox.replaceChildren(...r.topics.map((t) => topicCard(t, false)));
          genBar.refresh();
          showTab("gen");
        } catch (e) {
          status.textContent = "";
          resultBox.replaceChildren(h("p", { class: "error" }, e.message));
        } finally { genBtn.disabled = false; stopBtn.hidden = true; taskId = null; }
      }

      function topicCard(t, saved) {
        const cb = h("input", { type: "checkbox", class: "topic-check", title: "选中，做批量操作", onchange: () => { el.classList.toggle("selected", cb.checked); (saved ? savedBar : genBar).refresh(); } });
        const el = h("div", { class: "topic" },
          h("div", { class: "topic-head" }, cb, C.platformTag(t.platform), h("b", { class: "topic-title" }, t.title)),
          t.angle ? h("p", { class: "topic-line" }, h("span", { class: "muted" }, "角度 "), t.angle) : null,
          t.hook ? h("p", { class: "topic-line" }, h("span", { class: "muted" }, "钩子 "), t.hook) : null,
          t.reason ? h("p", { class: "topic-line muted" }, t.reason) : null);
        const write = h("button", { class: "btn small primary", onclick: () => C.open("writer", { fresh: true, topic: t.title, platform: t.platform, outline: [t.angle && "切入角度：" + t.angle, t.hook && "开头钩子：" + t.hook].filter(Boolean).join("\n") }) }, "写成稿");
        const plan = async (quiet) => {
          await C.save("contents", { title: t.title, topic: [t.angle, t.hook].filter(Boolean).join("；"), platform: t.platform, status: "idea" });
          toPlan.disabled = true; toPlan.textContent = "已加入";
          if (!quiet) window.Shell.toast("已加入内容列表（选题）", "success");
        };
        const toPlan = h("button", { class: "btn small", onclick: async () => { try { await plan(); } catch (e) { C.err(e); } } }, "加入日历");
        // 后台写：不离开选题页，可以连点好几个同时写，写完自动存成草稿
        let doneId = "";
        const bg = h("button", { class: "btn small", title: "在后台写成草稿，可以同时写好几篇", onclick: async () => {
          if (doneId) { C.open("writer", { id: doneId }); return; } // 写好了：点一下打开
          await bgWrite();
        } }, "后台写");
        async function bgWrite() {
          if (doneId || bg.disabled) return;
          bg.disabled = true; bg.textContent = "后台写作中…";
          try {
            const r = await C.runAi("ai:draft", { topic: t.title, platform: t.platform, outline: [t.angle && "切入角度：" + t.angle, t.hook && "开头钩子：" + t.hook].filter(Boolean).join("\n"), save: true },
              { title: `写稿：${t.title.slice(0, 24)}` });
            if (!r) { bg.disabled = false; bg.textContent = "后台写"; return; }
            bg.textContent = "已写好 · 打开"; bg.disabled = false;
            doneId = r.contentId;
            window.Shell.toast(`「${r.title || t.title}」写好了，已存为草稿`, "success", 4000);
          } catch (e) { bg.disabled = false; bg.textContent = "后台写"; C.err(e); }
        }
        const actions = [write, bg, toPlan];
        const ops = { bgWrite, plan };
        if (saved) {
          ops.remove = () => C.remove("topics", t.id);
          actions.push(h("button", { class: "btn small danger-ghost", onclick: async () => { try { await ops.remove(); } catch (e) { C.err(e); } } }, "删除"));
        } else {
          ops.star = async () => { if (star.disabled) return; await C.save("topics", t); star.disabled = true; star.textContent = "已收藏"; };
          const star = h("button", { class: "btn small", onclick: async () => { try { await ops.star(); } catch (e) { C.err(e); } } }, "收藏");
          actions.splice(1, 0, star);
        }
        el.append(h("div", { class: "actions" }, ...actions));
        el._ops = ops;
        return el;
      }

      // 批量操作条：全选 / 已选 N 个 / 收藏（本次生成）/ 后台写 / 加入日历 / 删除（已收藏）
      function batchBar(box, saved) {
        const all = h("input", { type: "checkbox", title: "全选", onchange: () => { for (const c of box.querySelectorAll(".topic-check")) { c.checked = all.checked; c.closest(".topic").classList.toggle("selected", all.checked); } refresh(); } });
        const count = h("span", { class: "muted small-text" }, "");
        const picked = () => [...box.querySelectorAll(".topic")].filter((x) => x.querySelector(".topic-check")?.checked);
        const run = (label, fn, confirmText) => h("button", { class: "btn small" + (label === "删除" ? " danger-ghost" : ""), dataset: { batch: label }, onclick: async (e) => {
          const list = picked();
          if (!list.length) return;
          if (confirmText && !confirm(confirmText.replace("{n}", list.length))) return;
          const btn = e.currentTarget; btn.disabled = true;
          let ok = 0, fail = 0;
          try {
            if (label === "后台写") {
              // 后台写各自开任务，不用等写完
              for (const x of list) { x._ops.bgWrite().catch(() => {}); ok++; }
              window.Shell.toast(`已开始后台写 ${ok} 篇，写好自动存成草稿`, "success", 4000);
            } else {
              for (const x of list) { try { await fn(x._ops); ok++; } catch { fail++; } }
              window.Shell.toast(`${label} ${ok} 个${fail ? `，${fail} 个失败` : ""}`, fail ? "error" : "success");
            }
          } finally { btn.disabled = false; }
          if (label !== "删除") clear();
        } }, label);
        const btns = saved
          ? [run("后台写"), run("加入日历", (o) => o.plan(true)), run("删除", (o) => o.remove(), "删除选中的 {n} 个收藏？")]
          : [run("收藏", (o) => o.star()), run("后台写"), run("加入日历", (o) => o.plan(true))];
        const el = h("div", { class: "topic-batch", hidden: true }, h("label", { class: "topic-all" }, all, "全选"), count, h("span", { class: "spacer" }), ...btns);
        function clear() { all.checked = false; for (const c of box.querySelectorAll(".topic-check")) { c.checked = false; c.closest(".topic").classList.remove("selected"); } refresh(); }
        function refresh() {
          const n = picked().length, total = box.querySelectorAll(".topic").length;
          count.textContent = n ? `已选 ${n} / ${total}` : `共 ${total} 个`;
          all.checked = !!total && n === total; all.indeterminate = n > 0 && n < total;
          for (const b of btns) b.disabled = !n;
          el.hidden = box.hidden || !total;
        }
        return { el, refresh };
      }

      async function loadSaved() {
        try {
          const list = await C.list("topics");
          savedCount.textContent = String(list.length);
          savedBox.replaceChildren(...(list.length ? list.map((t) => topicCard(t, true)) : [h("p", { class: "muted" }, "还没有收藏。在生成结果里点「收藏」就会出现在这里。")]));
          savedBar.refresh();
        } catch (e) { window.Shell.reportError(e); }
      }
      C.onData((what) => { if (what === "topics" || what === "account") loadSaved(); });
      loadSaved();
    },
  });
})();
