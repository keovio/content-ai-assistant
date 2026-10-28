"use strict";
// 对标拆解：找爆款（后台窗口里搜，按点赞排，拆过的自动隐藏，可勾选批量拆解并写成指定平台、直接推草稿箱）/
// 粘贴拆解（贴全文或文章链接）/ 拆解库（标题公式、开头钩子、结构骨架、情绪点、爆点、可复用写法、不能照搬的部分、3 个同结构选题）
(function () {
  const { h } = window.Shell;
  const api = window.app;
  const C = window.Content;
  const DAYS = [["1", "近 1 天"], ["3", "近 3 天"], ["7", "近 7 天"], ["30", "近 30 天"], ["0", "不限时间"]];

  window.Shell.registerPage({
    id: "benchmark",
    title: "对标拆解",
    icon: "search",
    order: 25,
    render(root) {
      const { card } = window.Shell;
      root.classList.add("page-wide");
      const s = window.Shell.getSettings();
      const panels = { find: h("div", { class: "bm-panel" }), paste: h("div", { class: "bm-panel", hidden: true }), library: h("div", { class: "bm-panel", hidden: true }) };
      const libCount = h("span", { class: "tab-count" }, "0");
      const tabBar = C.tabs([["find", "找爆款"], ["paste", "粘贴拆解"], ["library", "拆解库"]], (id) => {
        for (const [k, el] of Object.entries(panels)) el.hidden = k !== id;
        if (id === "library") loadLibrary();
      });
      tabBar.el.querySelector("[data-tab='library']").append(" ", libCount);
      tabBar.el.querySelector("[data-tab='find']").classList.add("active");

      root.append(
        h("header", { class: "page-head" },
          h("div", {}, h("h1", {}, "对标拆解"), h("p", { class: "sub" }, "找到同领域的爆款，拆出能复用的结构和写法，再写成你自己的原创")),
          h("div", { class: "actions" }, tabBar.el)),
        panels.find, panels.paste, panels.library);

      // ================= 找爆款 =================
      let sources = [];
      const pfSel = h("select", { class: "input" });
      const kwIn = h("input", { class: "input grow", placeholder: "关键词（可不填：不填就按今日热点挑最火的）" });
      const daysSel = C.selectEl(DAYS, String(s.discoverDays ?? 3));
      const searchBtn = h("button", { class: "btn primary", onclick: search }, "找爆款");
      const stopBtn = h("button", { class: "btn", hidden: true }, "停止");
      const loginBtn = h("button", { class: "btn small", hidden: true, onclick: webLogin }, "登录网页版");
      const srcHint = h("span", { class: "muted small-text" });
      const findStatus = h("span", { class: "muted small-text" });
      const resultHead = h("div", { class: "lib-head" });
      const resultList = h("div", { class: "lib-list" }, h("div", { class: "empty" }, h("p", { class: "muted" }, "选平台、输关键词，点「找爆款」。会在后台窗口里搜索，有热度的按点赞从高到低排，拆过的自动隐藏。")));
      const allBox = h("input", { type: "checkbox", title: "全选" });
      const targetBox = h("div", { class: "check-row" }, ...Object.entries(C.PLATFORM_NAMES).map(([id, name]) =>
        h("label", { class: "check" }, h("input", { type: "checkbox", value: id, checked: id === (s.defaultPlatform || "wechat") }), name)));
      const pushChk = h("input", { type: "checkbox" });
      const imgChk = h("input", { type: "checkbox" });
      const batchBtn = h("button", { class: "btn small primary", disabled: true, onclick: () => batch(true) }, "拆解并创作");
      const onlyBtn = h("button", { class: "btn small", disabled: true, onclick: () => batch(false) }, "只拆解");
      const batchStatus = h("div", { class: "batch-status muted small-text" });
      let results = [];
      const picked = new Set();
      let searchTask = null;
      stopBtn.onclick = () => { if (searchTask) C.cancelTask(searchTask); };
      kwIn.addEventListener("keydown", (e) => { if (e.key === "Enter") search(); });
      daysSel.addEventListener("change", () => window.Shell.saveSettings({ discoverDays: Number(daysSel.value) }));

      panels.find.append(
        card({ title: "找爆款", icon: "search", class: "bm-search" },
          h("div", { class: "toolbar" }, pfSel, kwIn, daysSel, searchBtn, stopBtn),
          h("div", { class: "editor-bar" }, srcHint, loginBtn, h("span", { class: "spacer" }), findStatus)),
        card({ title: "", class: "lib-card" },
          resultHead,
          h("div", { class: "lib-head batch-bar" }, h("label", { class: "check" }, allBox, "全选"),
            h("span", { class: "muted small-text" }, "写成："), targetBox,
            h("span", { class: "bar-group" }, h("span", { class: "bar-sep" }), h("span", { class: "muted small-text" }, "写好后："),
            h("label", { class: "check", title: "写好后直接推送到对应平台的草稿箱（只存草稿，不发布；重合度过高的不推送）" }, pushChk, "推送到草稿箱"),
            h("label", { class: "check", title: "按 设置 → 配图 生成封面和文中配图，推草稿箱时一起填进去" }, imgChk, "生成配图")),
            h("span", { class: "spacer" }), onlyBtn, batchBtn),
          batchStatus, resultList));

      C.call(api.discover.meta()).then((m) => {
        sources = m;
        pfSel.replaceChildren(...m.map((x) => h("option", { value: x.id }, x.name + (x.needsLogin ? "（需登录）" : ""))));
        pfSel.value = m.some((x) => x.id === s.autoSource) ? s.autoSource : "wechat";
        drawSource();
      }).catch(window.Shell.reportError);
      pfSel.addEventListener("change", drawSource);
      async function drawSource() {
        const src = sources.find((x) => x.id === pfSel.value);
        if (!src) return;
        srcHint.textContent = `通过「${src.via}」搜索${src.verified ? "" : " · 待确认：网页版需要登录，结构可能变化"}`;
        loginBtn.hidden = !src.needsLogin;
        if (src.needsLogin) {
          const st = await C.call(api.discover.webStatus(src.id)).catch(() => ({ loggedIn: false }));
          loginBtn.textContent = st.loggedIn ? `已登录${src.name}网页版 · 重新登录` : `登录${src.name}网页版`;
        }
      }
      async function webLogin() {
        loginBtn.disabled = true;
        try { const r = await C.call(api.discover.webLogin(pfSel.value)); window.Shell.toast(r.loggedIn ? "网页版已登录" : "没有完成登录", r.loggedIn ? "success" : "info"); }
        catch (e) { C.err(e); } finally { loginBtn.disabled = false; drawSource(); }
      }

      async function search() {
        const keyword = kwIn.value.trim();
        searchBtn.disabled = true; stopBtn.hidden = false; findStatus.textContent = keyword ? "正在打开搜索页…" : "没填关键词：按今日热点找最火的…";
        resultList.replaceChildren(h("div", { class: "progress" }, h("div", { class: "bar indeterminate" })));
        picked.clear(); drawBatch();
        try {
          const r = await C.runAi("discover:search", { platform: pfSel.value, keyword, days: Number(daysSel.value) }, {
            title: `找爆款：${C.SOURCE_NAMES[pfSel.value]}「${keyword || "今日热点"}」`,
            onTask: (t) => { searchTask = t.id; if (t.message) findStatus.textContent = t.message; },
          });
          if (!r) { findStatus.textContent = "已停止"; resultList.replaceChildren(); return; }
          results = r.items.map((x) => ({ ...x, keyword: keyword || x.keyword || "" }));
          findStatus.textContent = "";
          drawResults(r);
        } catch (e) {
          findStatus.textContent = "";
          resultList.replaceChildren(h("div", { class: "empty" }, h("p", { class: "error" }, e.message)));
        } finally { searchBtn.disabled = false; stopBtn.hidden = true; searchTask = null; }
      }
      function drawResults(r) {
        const dayText = DAYS.find((d) => d[0] === daysSel.value)[1];
        resultHead.replaceChildren(h("b", {}, `${dayText}找到 ${r.total} 篇`), h("span", { class: "muted small-text" }, (r.hidden ? `，已隐藏 ${r.hidden} 篇拆过的` : "") + (r.skipped ? `，跳过 ${r.skipped} 篇时政新闻` : "")),
          r.hotTopics && r.hotTopics.length ? h("span", { class: "muted small-text" }, `（按今日热点：${r.hotTopics.join("、")}）`) : null,
          h("span", { class: "spacer" }), h("span", { class: "muted small-text" }, results.some((x) => x.likes) ? "按点赞从高到低" : "有热度的排在前面"));
        resultList.replaceChildren(...(results.length ? results.map(resultRow) : [h("div", { class: "empty" }, h("p", { class: "muted" }, r.total ? "都拆过了，换个关键词或放宽时间试试" : r.hotTopics ? "今日热点在这个平台没搜到近期文章，填个关键词或放宽时间试试" : "没有找到，换个关键词或放宽时间试试"))]));
        drawBatch();
      }
      function resultRow(x) {
        const cb = h("input", { type: "checkbox", checked: picked.has(x.url), onchange: () => { if (cb.checked) picked.add(x.url); else picked.delete(x.url); drawBatch(); } });
        const one = h("button", { class: "btn small", onclick: () => breakdownItem(x, one) }, "拆解");
        const heat = [x.likes ? `${C.fmtCount(x.likes)} 赞` : "", x.comments ? `${C.fmtCount(x.comments)} 评论` : "", x.reads ? `${C.fmtCount(x.reads)} 阅读` : ""].filter(Boolean).join(" · ");
        return h("div", { class: "lib-row", dataset: { url: x.url } }, cb,
          h("div", { class: "lib-main" },
            h("a", { class: "lib-title", href: "#", title: x.url, onclick: (e) => { e.preventDefault(); api.update.openUrl(x.url.replace(/^http:/, "https:")); } }, x.title),
            x.summary ? h("div", { class: "lib-sum muted small-text" }, x.summary) : null,
            h("div", { class: "lib-sub" }, x.author ? h("span", {}, x.author) : null, x.publishedAt ? h("span", {}, C.fmtAgo(x.publishedAt)) : x.timeText ? h("span", {}, x.timeText) : null,
              heat ? h("span", { class: "heat" }, heat) : null)),
          h("div", { class: "lib-actions show" }, one));
      }
      function drawBatch() {
        batchBtn.disabled = onlyBtn.disabled = !picked.size;
        batchBtn.textContent = picked.size ? `拆解并创作（${picked.size}）` : "拆解并创作";
        allBox.checked = results.length > 0 && picked.size === results.length;
        allBox.indeterminate = picked.size > 0 && picked.size < results.length;
      }
      allBox.addEventListener("change", () => { picked.clear(); if (allBox.checked) results.forEach((x) => picked.add(x.url)); for (const cb of resultList.querySelectorAll(".lib-row input[type=checkbox]")) cb.checked = allBox.checked; drawBatch(); });
      const removeRow = (url) => { results = results.filter((x) => x.url !== url); picked.delete(url); const el = [...resultList.children].find((r) => r.dataset.url === url); if (el) el.remove(); drawBatch(); };

      async function breakdownItem(x, btn) {
        btn.disabled = true; btn.textContent = "拆解中…";
        try {
          const r = await C.runAi("discover:breakdown", { item: x, keyword: x.keyword }, { title: `拆解「${x.title.slice(0, 16)}」` });
          if (!r) return;
          removeRow(x.url);
          C.changed("breakdowns");
          window.Shell.toast(r.duplicate ? "这篇拆过了，已在拆解库" : "已拆解，存进拆解库", "success");
          showDetailIn("library", r.breakdown.id);
        } catch (e) { C.err(e); btn.disabled = false; btn.textContent = "拆解"; }
      }
      async function batch(write) {
        const items = results.filter((x) => picked.has(x.url));
        if (!items.length) return;
        const targets = [...targetBox.querySelectorAll("input:checked")].map((i) => i.value);
        if (write && !targets.length) { window.Shell.toast("至少勾一个要写成的平台", "info"); return; }
        const push = write && pushChk.checked;
        if (push && !(await window.Shell.confirm(`拆解 ${items.length} 篇，写成 ${targets.map(C.platformName).join("、")}，并推送到草稿箱（只存草稿、不发布；重合度超过上限的不推送）？`, { okText: "开始" }))) return;
        batchBtn.disabled = onlyBtn.disabled = true;
        batchStatus.textContent = "开始处理…";
        try {
          let r;
          if (write) {
            r = await C.runAi("discover:batch", { items, targets, push, images: imgChk.checked, platform: pfSel.value, keyword: kwIn.value.trim() }, {
              title: `批量拆解并创作（${items.length} 篇）`, onTask: (t) => { if (t.message) batchStatus.textContent = t.message; } });
          } else {
            let ok = 0, dup = 0;
            for (const x of items) {
              batchStatus.textContent = `拆解「${x.title.slice(0, 20)}」…`;
              try { const one = await C.runAi("discover:breakdown", { item: x, keyword: x.keyword }, { title: `拆解「${x.title.slice(0, 16)}」` }); if (one) { if (one.duplicate) dup++; else ok++; } }
              catch (e) { C.err(e); }
            }
            r = { summary: `拆解 ${ok} 篇${dup ? `，${dup} 篇拆过了` : ""}` };
          }
          if (!r) { batchStatus.textContent = "已停止"; return; }
          batchStatus.replaceChildren(h("span", {}, "完成：" + r.summary + "  "),
            write ? h("button", { class: "btn small ghost", onclick: () => C.open("publish", { view: "list" }) }, "去发布页看稿子") : null,
            h("button", { class: "btn small ghost", onclick: () => tabBar.set("library") }, "看拆解库"));
          items.forEach((x) => removeRow(x.url));
          C.changed("breakdowns"); C.changed("contents");
        } catch (e) { batchStatus.textContent = ""; C.err(e); }
        finally { drawBatch(); }
      }

      // ================= 粘贴拆解 =================
      const urlIn = h("input", { class: "input grow", placeholder: "文章链接：公众号 / 头条 / 百家号 / 小红书 / 抖音…（会在后台窗口里读正文）" });
      const pTitle = h("input", { class: "input", placeholder: "标题（贴全文时填，可选）" });
      const pText = h("textarea", { class: "input", rows: 12, placeholder: "或者直接粘贴全文" });
      const pPf = C.selectEl([["", "来源平台（可选）"], ...Object.entries(C.PLATFORM_NAMES)], "");
      const pBtn = h("button", { class: "btn primary", onclick: pasteBreakdown }, "开始拆解");
      const pStatus = h("span", { class: "muted small-text" });
      const pOut = h("div", {});
      panels.paste.append(h("div", { class: "writer-grid" },
        card({ title: "粘贴拆解", icon: "note", desc: "贴链接会自动读正文；也可以直接贴全文。拆过的同一篇（链接或标题相同）不会再拆一次。" },
          h("div", { class: "form" },
            C.field("文章链接", urlIn),
            h("div", { class: "or-sep muted small-text" }, "或者"),
            pTitle, pText,
            h("div", { class: "form-row" }, C.field("来源平台", pPf)),
            h("div", { class: "actions" }, pBtn, pStatus))),
        pOut));
      pOut.append(card({ title: "拆解结果", icon: "spark" }, h("p", { class: "muted" }, "拆解完会显示在这里，同时存进拆解库。")));

      async function pasteBreakdown() {
        const url = urlIn.value.trim();
        const text = pText.value.trim();
        if (!url && !text) { window.Shell.toast("贴一个链接，或者粘贴全文", "info"); return; }
        if (url && !/^https?:\/\//.test(url)) { window.Shell.toast("链接要以 http:// 或 https:// 开头", "info"); return; }
        pBtn.disabled = true; pStatus.textContent = url ? "正在读取正文…" : "AI 正在拆解…";
        try {
          const r = await C.runAi("discover:breakdown", { url: text ? "" : url, text, title: pTitle.value.trim(), platform: pPf.value }, {
            title: "对标拆解", onTask: (t) => { if (t.message) pStatus.textContent = t.message; } });
          if (!r) { pStatus.textContent = "已停止"; return; }
          pStatus.textContent = r.duplicate ? "这篇拆过了，下面是之前的拆解" : "已拆解，存进拆解库";
          pOut.replaceChildren(detailCard(r.breakdown));
          C.changed("breakdowns");
          if (!r.duplicate) { urlIn.value = ""; pText.value = ""; pTitle.value = ""; }
        } catch (e) { pStatus.textContent = ""; C.err(e); }
        finally { pBtn.disabled = false; }
      }

      // ================= 拆解库 =================
      const libQ = h("input", { class: "input grow", type: "search", placeholder: "搜索标题、作者、关键词…" });
      const libPf = C.selectEl([["", "全部来源"], ...Object.entries(C.SOURCE_NAMES)], "");
      const libList = h("div", { class: "item-list bd-list" });
      const libDetail = h("div", {});
      let selectedId = "";
      panels.library.append(h("div", { class: "writer-grid bd-grid" },
        card({ title: "拆解库", icon: "bookmark" }, h("div", { class: "toolbar" }, libQ, libPf), libList),
        libDetail));
      libDetail.append(card({ title: "拆解详情", icon: "spark" }, h("p", { class: "muted" }, "从左边选一篇看拆解。")));
      libQ.addEventListener("input", window.Shell.debounce(loadLibrary, 200));
      libPf.addEventListener("change", loadLibrary);

      async function loadLibrary() {
        try {
          const all = await C.list("breakdowns");
          libCount.textContent = String(all.length);
          const kw = libQ.value.trim().toLowerCase();
          const list = all.filter((b) => (!libPf.value || b.platform === libPf.value) && (!kw || [b.title, b.author, b.keyword].join(" ").toLowerCase().includes(kw)));
          libList.replaceChildren(...(list.length ? list.map((b) => h("button", { class: "item bd-item" + (b.id === selectedId ? " active" : ""), dataset: { id: b.id }, onclick: () => select(b.id) },
            h("span", { class: `pf pf-${b.platform}` }, C.SOURCE_NAMES[b.platform] || "其他"),
            h("span", { class: "item-title" }, b.title),
            b.likes ? h("span", { class: "muted small-text" }, `${C.fmtCount(b.likes)} 赞`) : null,
            h("span", { class: "muted item-right" }, C.fmtDate(b.createdAt))))
            : [h("p", { class: "muted" }, all.length ? "没有符合条件的拆解" : "拆解库还是空的。去「找爆款」或「粘贴拆解」拆第一篇吧。")]));
          if ((!selectedId || !list.some((b) => b.id === selectedId)) && list[0]) select(list[0].id);
          else if (selectedId) select(selectedId);
        } catch (e) { window.Shell.reportError(e); }
      }
      async function select(id) {
        selectedId = id;
        for (const b of libList.querySelectorAll(".bd-item")) b.classList.toggle("active", b.dataset.id === id);
        try {
          const b = await C.call(api.store.get("breakdowns", id));
          if (!b) { selectedId = ""; loadLibrary(); return; }
          libDetail.replaceChildren(detailCard(b));
        } catch (e) { C.err(e); }
      }
      function showDetailIn(_tab, id) { selectedId = id; } // 下次进拆解库时选中它

      // 拆解详情卡片（粘贴拆解结果 / 拆解库共用）
      function detailCard(b) {
        const a = b.analysis || {};
        const list = (arr, ordered) => (arr && arr.length ? h(ordered ? "ol" : "ul", { class: "bd-ul" }, ...arr.map((x) => h("li", {}, x))) : h("p", { class: "muted small-text" }, "（无）"));
        const sec = (title, body, cls) => h("div", { class: "bd-sec" + (cls ? " " + cls : "") }, h("div", { class: "bd-sec-title" }, title), body);
        const topicBtns = (a.topics || []).map((t) => h("div", { class: "bd-topic" },
          h("div", { class: "grow" }, h("b", {}, t.title), t.angle ? h("div", { class: "muted small-text" }, t.angle) : null),
          h("button", { class: "btn small", onclick: () => create(b, t) }, "写这个")));
        const src = h("details", { class: "bd-src" }, h("summary", {}, `查看原文（${C.countWords(b.sourceText)} 字）`), h("div", { class: "bd-src-text" }, b.sourceText || ""));
        const actions = [
          h("button", { class: "btn small primary", onclick: () => create(b, (a.topics || [])[0]) }, "用这个骨架创作"),
          b.url || b.canonicalUrl ? h("button", { class: "btn small ghost", onclick: () => api.update.openUrl(String(b.canonicalUrl || b.url).replace(/^http:/, "https:")) }, "打开原文") : null,
          h("button", { class: "btn small danger-ghost", onclick: async () => {
            if (!(await window.Shell.confirm(`从拆解库删除「${b.title}」？删除后这篇会重新出现在找爆款结果里。`, { okText: "删除", danger: true }))) return;
            try { await C.remove("breakdowns", b.id); selectedId = ""; libDetail.replaceChildren(card({ title: "拆解详情", icon: "spark" }, h("p", { class: "muted" }, "已删除。"))); loadLibrary(); } catch (e) { C.err(e); }
          } }, "删除"),
        ];
        return card({ title: b.title, icon: "spark", class: "bd-detail", actions: [h("span", { class: `pf pf-${b.platform}` }, C.SOURCE_NAMES[b.platform] || "其他")] },
          h("div", { class: "lib-sub" }, b.author ? h("span", {}, b.author) : null, b.publishedAt ? h("span", {}, C.fmtAgo(b.publishedAt)) : null,
            b.likes ? h("span", {}, `${C.fmtCount(b.likes)} 赞`) : null, b.comments ? h("span", {}, `${C.fmtCount(b.comments)} 评论`) : null,
            h("span", {}, "拆于 " + C.fmtDate(b.createdAt)), b.usedCount ? h("span", {}, `已用 ${b.usedCount} 次`) : null),
          h("div", { class: "actions bd-actions" }, ...actions),
          sec("标题公式", h("p", {}, a.titleFormula || "（无）")),
          sec("开头钩子", h("p", {}, a.hook || "（无）")),
          sec("结构骨架", list(a.skeleton, true)),
          h("div", { class: "bd-two" }, sec("情绪点", list(a.emotions)), sec("爆点", list(a.highlights))),
          sec("可复用写法", list(a.reusable), "good"),
          sec("不能照搬的部分", list(a.avoid), "bad"),
          sec("3 个同结构选题", topicBtns.length ? h("div", { class: "bd-topics" }, ...topicBtns) : h("p", { class: "muted small-text" }, "（无）")),
          src);
      }
      function create(b, t) {
        C.open("writer", { fresh: true, refId: b.id, topic: t ? t.title : "", outline: t && t.angle ? "切入角度：" + t.angle : "", platform: window.Shell.getSettings().defaultPlatform || "wechat" });
      }

      this.take = (p) => {
        if (!p) return;
        if (p.tab) tabBar.set(p.tab);
        if (p.keyword) { kwIn.value = p.keyword; if (p.platform && sources.some((x) => x.id === p.platform)) { pfSel.value = p.platform; drawSource(); } if (p.search) search(); }
        if (p.id) { tabBar.set("library"); select(p.id); }
      };
      C.onData((what) => { if (what === "breakdowns" && !panels.library.hidden) loadLibrary(); else if (what === "breakdowns") C.list("breakdowns").then((l) => { libCount.textContent = String(l.length); }).catch(() => {}); });
      C.list("breakdowns").then((l) => { libCount.textContent = String(l.length); }).catch(() => {});
    },
    onShow() { const p = C.take("benchmark"); if (p && this.take) this.take(p); },
  });
})();
