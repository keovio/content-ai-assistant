"use strict";
// 创作：左边设定（选题、平台、字数、风格、大纲、参考素材、参考爆款）→ 流式生成到右边编辑器；
// 编辑器里可以取标题、润色、保存、排期、导出、复制、推送（同一平台多个号时可选用哪个号）。
// 有参考爆款时显示与原文的重合度，超过上限提醒改写；下方「平台版本」一键生成其他平台版本（原来的一稿多发），
// 每个版本单独编辑和推送。
(function () {
  const { h } = window.Shell;
  const api = window.app;
  const C = window.Content;

  window.Shell.registerPage({
    id: "writer",
    title: "创作",
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
      // 写法库：拆解出来的可复用写法 / 开头 / 标题公式。不勾 = 按选题自动挑；勾了就只用勾的
      const techHint = h("span", { class: "muted small-text" });
      const techList = h("div", { class: "mat-pick tech-pick" });
      const techBox = h("details", { class: "tech-box" }, h("summary", {}, techHint), techList);
      let techAuto = [];
      const techChecked = () => [...techList.querySelectorAll("input:checked")].map((i) => i.value);
      function techSummary() {
        const n = techChecked().length;
        const total = techList.querySelectorAll("input").length;
        techHint.textContent = !total ? "写法库还是空的：先在「对标拆解」拆几篇爆款" : n ? `已选 ${n} 条写法（只用选中的）` : techAuto.length ? `自动：按选题挑 ${techAuto.length} 条（点开可以自己选）` : "不运用写法（设置里关了自动挑选；点开可以手动选）";
      }
      async function loadTechniques() {
        try {
          const keep = new Set(techChecked());
          const r = await C.call(api.techniques.list(topicIn.value.trim()));
          techAuto = r.auto || [];
          const auto = new Set(techAuto);
          techList.replaceChildren(...r.list.map((x) => h("label", { class: "check mat-item" + (auto.has(x.id) ? " auto" : ""), title: `来自《${x.from}》` },
            h("input", { type: "checkbox", value: x.id, checked: keep.has(x.id), onchange: techSummary }),
            h("span", { class: "tag" }, x.kind), x.text.length > 60 ? x.text.slice(0, 60) + "…" : x.text, auto.has(x.id) ? h("span", { class: "muted small-text" }, " · 自动") : "")));
          techSummary();
        } catch (e) { techHint.textContent = e.message; }
      }
      const genBtn = h("button", { class: "btn primary", onclick: generate }, "生成初稿");
      const stopBtn = h("button", { class: "btn", hidden: true }, "停止");
      const genStatus = h("span", { class: "muted small-text" });
      // 参考爆款 + 重合度
      const refBox = h("div", { class: "ref-box", hidden: true });
      const ovBox = h("div", { class: "ov-box", hidden: true });

      // ---- 右：编辑器 ----
      const titleIn = h("input", { class: "input title-input", placeholder: "标题" });
      const bodyIn = h("textarea", { class: "input editor", placeholder: "正文。可以直接写，也可以让左边的 AI 先出一版。" });
      const wc = h("span", { class: "muted small-text" }, "0 字");
      const stSel = C.selectEl(C.statusOptions(false), "draft");
      const dateIn = h("input", { class: "input", type: "date" });
      const savedInfo = h("span", { class: "muted small-text" });
      const pushInfo = h("span", { class: "push-info" });
      const pushBtn = h("button", { class: "btn small", title: "保存后自动打开平台编辑页，填好标题正文并存入草稿箱（不会发布）", onclick: () => pushNow() }, "推送到草稿箱");
      const paSel = C.accountPicker(s.defaultPlatform || "wechat", "", { onChange: (v) => { current.platformAccountId = v; markDirty(); } });
      const draftsBtn = h("button", { class: "btn small ghost", hidden: true, onclick: () => current.id && C.call(api.publish.openFor(current.id)).catch(C.err) }, "打开草稿箱");
      const titleBox = h("div", { class: "title-suggest", hidden: true });
      const imgStrip = h("div", { class: "img-strip", hidden: true });
      const imgBtn = h("button", { class: "btn small", title: "按 设置 → 配图 生成封面和文中配图（可以边写边配）", onclick: () => makeImages() }, "AI 配图");
      let undoBody = null;
      const undoBtn = h("button", { class: "btn small ghost", hidden: true, onclick: () => {
        if (undoBody === null) return;
        bodyIn.value = undoBody; undoBody = null; undoBtn.hidden = true; markDirty(); updateWc();
      } }, "撤销 AI 修改");
      const polishSel = C.selectEl([["polish", "润色"], ["shorten", "精简"], ["expand", "扩写"], ["casual", "口语化"], ["formal", "专业化"], ["original", "降重改写"]], "polish");

      let current = { id: "", refId: "", groupId: "", platformAccountId: "" };
      let ref = null;
      let vCard = null;
      const vTabs = h("div", { class: "segmented v-tabs" });
      const vBody = h("div", { class: "v-body" });
      const vGenBox = h("div", { class: "v-gen", hidden: true });
      let vActive = "";
      let vList = [];
      let dirty = false;
      let taskId = null;
      const markDirty = () => { dirty = true; savedInfo.textContent = "未保存"; };
      const updateWc = () => { wc.textContent = `${C.countWords(bodyIn.value)} 字`; };
      titleIn.addEventListener("input", markDirty);
      bodyIn.addEventListener("input", () => { markDirty(); updateWc(); checkOverlapSoon(); });
      stSel.addEventListener("change", markDirty);
      dateIn.addEventListener("change", markDirty);
      stopBtn.onclick = () => { if (taskId) C.cancelTask(taskId); };

      root.append(
        h("header", { class: "page-head" },
          h("div", {}, h("h1", {}, "创作"), h("p", { class: "sub" }, "设定方向或套用爆款骨架让 AI 出初稿，改到满意后生成各平台版本、推送草稿箱")),
          h("div", { class: "actions" }, h("button", { class: "btn", onclick: () => confirmLeave().then((ok) => ok && load({ fresh: true })) }, "新建"))),
        h("div", { class: "writer-grid" },
          h("div", { class: "writer-side" }, card({ title: "写作设定", icon: "spark" },
            h("div", { class: "form" },
              refBox,
              C.field("选题", topicIn),
              h("div", { class: "form-row" }, C.field("平台", pfSel), C.field("篇幅", wordsSel)),
              C.field("风格要求", styleIn),
              C.field("大纲 / 要点", outlineIn),
              C.field("参考素材", matBox, "勾选的素材交给 AI 参考；不勾就按选题自动挑相关的（设置里可关）"),
              C.field("运用写法", techBox, "从拆解库汇总的写法，写稿时让 AI 自然用上"),
              h("div", { class: "actions" }, genBtn, stopBtn, genStatus))),
            // 平台版本放在写作设定下面
            versionsCard()),
          card({ title: "编辑器", icon: "note", class: "editor-card", actions: [savedInfo] },
            ovBox, titleIn, titleBox, bodyIn, imgStrip,
            h("div", { class: "editor-bar" },
              wc, h("span", { class: "spacer" }),
              h("button", { class: "btn small", title: "按手机尺寸和平台样式预览", onclick: () => C.phonePreview({ title: titleIn.value.trim(), body: bodyIn.value, platform: pfSel.value, cover: current.cover || "" }) }, "手机预览"),
              h("button", { class: "btn small", onclick: suggestTitles }, "AI 取标题"), imgBtn,
              h("button", { class: "btn small", title: "从素材库挑图片插到光标处", onclick: () => C.pickImage().then((m) => { if (!m) return; const a = bodyIn.selectionStart ?? bodyIn.value.length; const line = `\n\n![${(m.title || "配图").slice(0, 40)}](cai-img:${m.image})\n\n`; bodyIn.value = (bodyIn.value.slice(0, a).replace(/\s+$/, "") + line + bodyIn.value.slice(a).replace(/^\s+/, "")).replace(/^\s+/, ""); bodyIn.dispatchEvent(new Event("input")); }) }, "素材图"),
              undoBtn, polishSel, h("button", { class: "btn small", title: "选中一段只处理选中的，不选就处理全文", onclick: polish }, "处理")),
            h("div", { class: "editor-bar push-bar" }, pushInfo, h("span", { class: "spacer" }), paSel, draftsBtn, pushBtn),
            h("div", { class: "editor-bar" },
              C.field("状态", stSel), C.field("发布日期", dateIn), h("span", { class: "spacer" }),
              h("button", { class: "btn small", onclick: () => C.copy((titleIn.value ? titleIn.value + "\n\n" : "") + bodyIn.value, "全文") }, "复制"),
              h("button", { class: "btn small", onclick: exportMd }, "导出"),
              h("button", { class: "btn small danger-ghost", onclick: del }, "删除"),
              h("button", { class: "btn small primary", onclick: () => save() }, "保存")))));

      async function loadMaterials(selected = []) {
        try {
          const list = (await C.list("materials")).filter((m) => m.kind !== "image");
          const keep = new Set(selected.concat([...matBox.querySelectorAll("input:checked")].map((i) => i.value)));
          matBox.replaceChildren(...(list.length ? list.slice(0, 50).map((m) =>
            h("label", { class: "check mat-item", title: (m.content || "").slice(0, 200) },
              h("input", { type: "checkbox", value: m.id, checked: keep.has(m.id) }), m.title || (m.content || "").slice(0, 24) || "未命名"))
            : [h("span", { class: "muted small-text" }, "素材库是空的")]));
        } catch (e) { window.Shell.reportError(e); }
      }

      function fill(c) {
        if (genSession && taskId) { genStatus.textContent = "上一篇还在后台写，写完自动存成草稿"; taskId = null; stopBtn.hidden = true; }
        genSession++; pinnedTitle = "";
        current = { id: c.id || "", sourceId: c.sourceId || "", refId: c.refId || "", groupId: c.groupId || "", platformAccountId: c.platformAccountId || "" };
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
        paSel.redraw(pfSel.value, current.platformAccountId);
        current.cover = c.cover || "";
        drawImages();
        loadRef(current.refId).then(() => drawOverlap(c.id ? { overlap: c.overlap, needsRewrite: c.needsRewrite } : null));
        drawVersions();
      }

      // ---------- 参考爆款 / 重合度 ----------
      async function loadRef(id) {
        ref = null;
        if (id) { try { ref = await C.call(api.store.get("breakdowns", id)); } catch { ref = null; } }
        refBox.hidden = !ref;
        if (!ref) { refBox.replaceChildren(); ovBox.hidden = true; return; }
        const a = ref.analysis || {};
        refBox.replaceChildren(
          h("div", { class: "ref-head" }, h("span", { class: "muted small-text" }, "参考爆款"), h("span", { class: "spacer" }),
            h("button", { class: "btn small ghost", onclick: () => C.open("benchmark", { id: ref.id }) }, "看拆解"),
            h("button", { class: "btn small ghost", title: "不再参考这篇", onclick: () => { current.refId = ""; loadRef(""); markDirty(); } }, "移除")),
          h("b", { class: "ref-title" }, ref.title),
          a.skeleton && a.skeleton.length ? h("div", { class: "muted small-text ref-skel" }, "骨架：" + a.skeleton.map((x) => x.split(/[：:]/)[0]).join(" → ")) : null,
          (a.topics || []).length ? h("div", { class: "ref-topics" }, ...a.topics.map((t) => h("button", { class: "chip", onclick: () => { topicIn.value = t.title; if (t.angle && !outlineIn.value) outlineIn.value = "切入角度：" + t.angle; } }, t.title))) : null);
      }
      let ovTimer = null;
      function checkOverlapSoon() { if (!ref) return; clearTimeout(ovTimer); ovTimer = setTimeout(checkOverlap, 700); }
      async function checkOverlap() {
        if (!ref) return null;
        try { const r = await C.call(api.discover.overlap(bodyIn.value, ref.id)); drawOverlap(r); return r; } catch { return null; }
      }
      function drawOverlap(r) {
        if (!ref) { ovBox.hidden = true; return; }
        const limit = window.Shell.getSettings().overlapLimit;
        if (!r || r.overlap == null || r.overlap < 0) {
          if (bodyIn.value.trim()) { checkOverlap(); return; }
          ovBox.hidden = false;
          ovBox.className = "ov-box";
          ovBox.replaceChildren(h("span", {}, `参考《${ref.title.slice(0, 24)}》写作，生成后会计算与原文的重合度（上限 ${limit}%）`));
          return;
        }
        const bad = r.overlap > limit;
        ovBox.hidden = false;
        ovBox.className = "ov-box" + (bad ? " bad" : " ok");
        const bar = h("span", { class: "ov-bar" }, h("span", { style: `width:${Math.min(100, r.overlap)}%` }));
        ovBox.replaceChildren(
          h("span", { class: "ov-num" }, `与原文重合度 ${r.overlap}%`), bar, h("span", { class: "muted small-text" }, `上限 ${limit}%`),
          bad ? h("span", { class: "ov-warn" }, "重合度过高，请改写后再推送") : h("span", { class: "muted small-text" }, "✓ 可以推送"),
          h("span", { class: "spacer" }),
          bad ? h("button", { class: "btn small", onclick: () => { polishSel.value = "original"; polish(); } }, "AI 降重改写") : null,
          r.snippets && r.snippets.length ? h("details", { class: "ov-snips" }, h("summary", {}, `重合的句子（${r.snippets.length}）`), ...r.snippets.map((x) => h("p", { class: "small-text" }, `${x.ratio}%：${x.text}`))) : null);
      }

      function drawPush(c) {
        const pf = pfSel.value;
        const r = c && c.pushes && c.pushes[pf];
        pushBtn.textContent = pf === "douyin" ? "打开抖音创作页" : `推送到${C.platformName(pf)}草稿箱`;
        draftsBtn.hidden = !(r && r.url) || pf === "douyin";
        draftsBtn.textContent = `打开${C.platformName(pf)}草稿箱`;
        pushInfo.replaceChildren(...(r ? [C.pushTag(c), h("span", { class: "muted small-text" }, " " + C.fmtDate(r.at) + (r.error ? " · " + r.error : ""))] : []));
      }
      pfSel.addEventListener("change", () => { markDirty(); drawPush(null); current.platformAccountId = ""; paSel.redraw(pfSel.value, ""); });

      async function pushNow() {
        const item = await save({ quiet: true });
        if (!item) return;
        let force = false;
        if (item.needsRewrite) {
          if (!(await window.Shell.confirm(`这篇与参考原文重合度 ${item.overlap}%，超过上限。建议先改写。仍然要推送吗？`, { okText: "仍然推送", danger: true }))) return;
          force = true;
        }
        pushBtn.disabled = true;
        try {
          const r = await C.push(item.id, { title: `推送「${(item.title || "").slice(0, 16)}」到${C.platformName(item.platform)}`, platformAccountId: paSel.value, force });
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
          fill({ title: p.title || "", body: p.body || "", platform: p.platform || pfSel.value, status: "draft", sourceId: p.sourceId || "", scheduledAt: p.scheduledAt || "", refId: p.refId || "" });
          if (p.body) markDirty();
        }
        if (p.materialIds) loadMaterials(p.materialIds);
        if (p.topic && !p.body) topicIn.focus();
      }

      async function confirmLeave() {
        if (!dirty || !(titleIn.value || bodyIn.value)) return true;
        return window.Shell.confirm("当前内容还没保存，确定丢掉吗？", { okText: "丢掉", danger: true });
      }

      // 写稿在后台跑，写完主进程直接存成草稿：生成时可以点「新建」去写下一篇、同时取标题、生成平台版本…
      let genSession = 0, genRunning = 0, pinnedTitle = "";
      async function generate() {
        if (!topicIn.value.trim() && !outlineIn.value.trim() && !ref) { window.Shell.toast("先写个选题或大纲", "info"); topicIn.focus(); return; }
        if ((titleIn.value || bodyIn.value) && !(await window.Shell.confirm("生成的初稿会替换编辑器里现在的内容，继续吗？（想同时写另一篇，先点「新建」）"))) return;
        const mine = ++genSession;
        const topic = topicIn.value.trim();
        const reuseId = current.id && !current.groupId ? current.id : "";
        genRunning++; stopBtn.hidden = false; genStatus.textContent = "正在连接 AI…";
        const before = { title: titleIn.value, body: bodyIn.value };
        bodyIn.value = ""; titleIn.value = "";
        const here = () => mine === genSession; // 编辑器还停在这一篇
        let myTask = null;
        try {
          const r = await C.runAi("ai:draft", {
            topic, platform: pfSel.value, words: Number(wordsSel.value), style: styleIn.value.trim(), outline: outlineIn.value.trim(),
            materialIds: [...matBox.querySelectorAll("input:checked")].map((i) => i.value), refId: ref ? ref.id : "",
            save: true, contentId: reuseId, techniqueIds: techChecked(),
          }, {
            title: `写稿：${(topic || (ref && ref.title) || "未命名").slice(0, 24)}`,
            onTask: (t) => { myTask = t.id; if (here()) { taskId = t.id; if (t.message) genStatus.textContent = t.message; } },
            onText: (text) => { if (!here()) return; const st = C.splitTitle(text); titleIn.value = pinnedTitle || st.title; bodyIn.value = st.body; bodyIn.scrollTop = bodyIn.scrollHeight; updateWc(); },
          });
          if (!here()) {
            if (r && r.contentId) window.Shell.toast(`「${r.title || topic}」写好了，已存为草稿（发布页可以找到）`, "success", 5000);
            return;
          }
          if (!r) { genStatus.textContent = "已停止"; if (!bodyIn.value) { titleIn.value = before.title; bodyIn.value = before.body; } updateWc(); return; }
          titleIn.value = pinnedTitle || r.title; bodyIn.value = r.body;
          genStatus.textContent = `完成，${C.countWords(r.body)} 字，已存为草稿`;
          if (r.contentId) {
            const saved = await C.call(api.store.get("contents", r.contentId)).catch(() => null);
            if (saved && here()) { current.id = saved.id; dirty = false; savedInfo.textContent = `已保存 · ${C.fmtDate(saved.updatedAt)}`; drawOverlap(saved.refId ? { overlap: saved.overlap, needsRewrite: saved.needsRewrite } : null); drawVersions(); drawPush(saved); }
            if (pinnedTitle && here() && pinnedTitle !== r.title) await save({ quiet: true }); // 生成途中选好的标题
          } else markDirty();
          updateWc(); checkOverlap();
        } catch (e) {
          if (here()) { genStatus.textContent = ""; if (!bodyIn.value) { titleIn.value = before.title; bodyIn.value = before.body; } }
          C.err(e);
        } finally {
          genRunning--;
          if (here()) { stopBtn.hidden = true; taskId = null; }
          void myTask;
        }
      }

      // ---------- 配图 ----------
      const IMG_RE = /^\s*!\[([^\]]*)\]\(cai-img:([\w.-]+)\)\s*$/;
      const thumbCache = new Map();
      async function thumb(name) {
        if (!thumbCache.has(name)) thumbCache.set(name, C.call(api.images.dataUrl(name)).catch(() => ""));
        return thumbCache.get(name);
      }
      async function drawImages() {
        const list = bodyIn.value.split("\n").map((l) => l.match(IMG_RE)).filter(Boolean).map((m) => ({ alt: m[1], name: m[2] }));
        const all = (current.cover ? [{ alt: "封面", name: current.cover, cover: true }] : []).concat(list);
        imgStrip.hidden = !all.length;
        if (!all.length) { imgStrip.replaceChildren(); return; }
        const tiles = await Promise.all(all.map(async (x) => {
          const src = await thumb(x.name);
          return h("figure", { class: "img-tile" + (x.cover ? " cover" : ""), title: x.alt },
            src ? h("img", { src, alt: x.alt }) : h("div", { class: "img-missing" }, "图片不见了"),
            h("figcaption", {}, x.cover ? "封面" : x.alt || "配图"));
        }));
        imgStrip.replaceChildren(h("span", { class: "muted small-text" }, `配图 ${list.length} 张${current.cover ? " + 封面" : ""}（正文里的 ![…](cai-img:…) 行就是图片位置，可以挪动或删掉）`), h("div", { class: "img-row" }, ...tiles));
      }
      bodyIn.addEventListener("input", window.Shell.debounce(drawImages, 600));
      async function makeImages() {
        if (!bodyIn.value.trim()) { window.Shell.toast("先有正文才能配图", "info"); return; }
        const item = await save({ quiet: true });
        if (!item) return;
        const id = item.id, title = item.title;
        imgBtn.disabled = true; imgBtn.textContent = "配图中…";
        try {
          const r = await C.runAi("ai:images", { contentId: id }, { title: `配图：${title.slice(0, 20)}` });
          if (!r) return;
          if (current.id === id) {
            const c = await C.call(api.store.get("contents", id));
            if (c && !dirty) { bodyIn.value = c.body; current.cover = c.cover || ""; updateWc(); drawImages(); }
            else if (c) { current.cover = c.cover || ""; window.Shell.toast("配图已插进保存的稿子；你刚改过正文，重新打开这篇就能看到图", "info", 6000); }
          }
          window.Shell.toast(r.count || r.cover ? `「${title}」配好了 ${r.count} 张图${r.cover ? " + 封面" : ""}` : "AI 判断这篇不需要配图", "success", 4000);
        } catch (e) { C.err(e); } finally { imgBtn.disabled = false; imgBtn.textContent = "AI 配图"; }
      }

      async function suggestTitles() {
        if (!bodyIn.value.trim() && !topicIn.value.trim()) { window.Shell.toast("先写个选题或正文", "info"); return; }
        titleBox.hidden = false;
        titleBox.replaceChildren(h("span", { class: "muted small-text" }, "AI 正在想标题…"));
        try {
          const r = await C.runAi("ai:titles", { content: bodyIn.value.trim() ? (titleIn.value ? titleIn.value + "\n" : "") + bodyIn.value : `选题：${topicIn.value.trim()}\n${outlineIn.value.trim()}`, platform: pfSel.value });
          if (!r) { titleBox.hidden = true; return; }
          titleBox.replaceChildren(...r.titles.map((t) => h("button", { class: "chip", onclick: () => { titleIn.value = t; if (genRunning && taskId) pinnedTitle = t; markDirty(); titleBox.hidden = true; } }, t)),
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
          markDirty(); updateWc(); checkOverlap();
          window.Shell.toast("已替换，不满意可以点「撤销 AI 修改」", "success", 4000);
        } catch (e) { close(); C.err(e); }
      }

      async function save({ quiet = false } = {}) {
        if (!titleIn.value.trim() && !bodyIn.value.trim()) { window.Shell.toast("内容是空的", "info"); return null; }
        try {
          const item = await C.save("contents", {
            id: current.id || undefined, title: titleIn.value.trim() || "未命名", body: bodyIn.value, platform: pfSel.value,
            status: stSel.value, scheduledAt: dateIn.value, topic: topicIn.value.trim(), sourceId: current.sourceId || "",
            refId: current.refId || "", groupId: current.groupId || "", platformAccountId: paSel.value || "", cover: current.cover || "",
          });
          current.id = item.id; dirty = false;
          savedInfo.textContent = `已保存 · ${C.fmtDate(item.updatedAt)}`;
          if (item.refId) drawOverlap({ overlap: item.overlap, needsRewrite: item.needsRewrite });
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

      // ---------- 平台版本（原一稿多发） ----------
      function versionsCard() {
        vCard = card({ title: "平台版本", icon: "share", id: "writer-versions", desc: "写好后一键改写成其他平台版本，每个版本单独编辑、推送。",
          actions: [h("button", { class: "btn small primary", onclick: () => { vGenBox.hidden = !vGenBox.hidden; drawGen(); } }, "＋ 生成")] },
        vGenBox, vTabs, vBody);
        return vCard;
      }
      const groupOf = () => current.groupId || current.id;
      async function drawVersions() {
        const g = groupOf();
        vList = g ? (await C.list("contents").catch(() => [])).filter((c) => c.id !== current.id && (c.groupId === g || c.id === g)) : [];
        vList.sort((a, b) => a.createdAt - b.createdAt);
        if (!vList.some((c) => c.id === vActive)) vActive = vList[0] ? vList[0].id : "";
        vTabs.replaceChildren(...vList.map((c) => h("button", { class: c.id === vActive ? "active" : "", onclick: () => { vActive = c.id; drawVersions(); } },
          C.platformName(c.platform), c.id === g ? "（主稿）" : "", c.needsRewrite ? " ⚠" : "")));
        vTabs.hidden = !vList.length;
        const v = vList.find((c) => c.id === vActive);
        vBody.replaceChildren(v ? versionPanel(v) : h("p", { class: "muted" }, current.id ? "还没有其他平台版本。点右上角「＋ 生成」。" : "先写好并保存这篇，再生成其他平台版本。"));
        if (!vGenBox.hidden) drawGen();
      }
      function drawGen() {
        const have = new Set([pfSel.value, ...vList.map((c) => c.platform)]);
        const checks = Object.entries(C.PLATFORM_NAMES).filter(([id]) => !have.has(id)).map(([id, name]) => h("label", { class: "check" }, h("input", { type: "checkbox", value: id, checked: true }), name));
        vGenBox.replaceChildren(...(checks.length ? [h("span", { class: "muted small-text" }, "改写成："), ...checks,
          h("button", { class: "btn small primary", onclick: (e) => genVersions([...vGenBox.querySelectorAll("input:checked")].map((i) => i.value), e.currentTarget) }, "开始生成")]
          : [h("span", { class: "muted small-text" }, "所有平台都有版本了")]));
      }
      async function genVersions(pfs, btn) {
        if (!pfs.length) { window.Shell.toast("至少勾一个平台", "info"); return; }
        if (!bodyIn.value.trim()) { window.Shell.toast("先写好正文", "info"); return; }
        const master = await save({ quiet: true });
        if (!master) return;
        const g = master.groupId || master.id;
        if (!master.groupId) { await C.save("contents", { id: master.id, groupId: g }); current.groupId = g; }
        btn.disabled = true; vGenBox.hidden = true;
        const source = `# ${titleIn.value.trim()}\n\n${bodyIn.value.trim()}`;
        await Promise.all(pfs.map(async (pf) => {
          const tmp = { id: "tmp-" + pf, platform: pf, title: "", body: "", createdAt: Date.now(), generating: true };
          vList.push(tmp); vActive = tmp.id;
          vTabs.append(h("button", { class: "active" }, C.platformName(pf), "…"));
          try {
            const r = await C.runAi("ai:rewrite", { source, platform: pf }, { title: `改写为${C.platformName(pf)}` });
            if (!r) return;
            const st = C.splitTitle(r.text);
            const item = await C.save("contents", { title: st.title || master.title, body: st.body, platform: pf, status: "draft", sourceId: master.id, groupId: g, refId: master.refId || "", topic: master.topic || "" });
            vActive = item.id;
          } catch (e) { C.err(e); }
        }));
        btn.disabled = false;
        drawVersions();
        window.Shell.toast("平台版本已生成", "success");
      }
      function versionPanel(v) {
        const t = h("input", { class: "input title-input", value: v.title || "" });
        const b = h("textarea", { class: "input editor small-editor" }); b.value = v.body || "";
        const st = C.selectEl(C.statusOptions(false), v.status || "draft", { class: "input input-sm" });
        const pa = C.accountPicker(v.platform, v.platformAccountId || "");
        const info = h("span", { class: "muted small-text" }, `${C.countWords(v.body)} 字`);
        b.addEventListener("input", () => { info.textContent = `${C.countWords(b.value)} 字 · 未保存`; });
        const saveV = async (quiet) => {
          const item = await C.save("contents", { id: v.id, title: t.value.trim() || "未命名", body: b.value, status: st.value, platformAccountId: pa.value || "" });
          info.textContent = `${C.countWords(item.body)} 字 · 已保存`;
          if (!quiet) window.Shell.toast(`已保存${C.platformName(v.platform)}版本`, "success");
          return item;
        };
        const pushV = async (e) => {
          const btn = e.currentTarget;
          try {
            const item = await saveV(true);
            let force = false;
            if (item.needsRewrite) { if (!(await window.Shell.confirm(`这个版本与参考原文重合度 ${item.overlap}%，超过上限。仍然要推送吗？`, { okText: "仍然推送", danger: true }))) return; force = true; }
            btn.disabled = true;
            const r = await C.push(item.id, { title: `推送「${(item.title || "").slice(0, 16)}」到${C.platformName(item.platform)}`, platformAccountId: pa.value, force });
            if (r && r.status === "saved") window.Shell.toast(`已存入${C.platformName(item.platform)}草稿箱`, "success");
            else if (r && r.status === "opened") window.Shell.toast("已打开抖音创作者中心，脚本已复制", "success", 4000);
          } catch (err) { C.err(err); }
          finally { btn.disabled = false; drawVersions(); }
        };
        return h("div", { class: "v-panel" },
          h("div", { class: "editor-bar" }, C.platformTag(v.platform), C.overlapTag(v), C.rewriteTag(v), C.pushTag(v), h("span", { class: "spacer" }), info),
          t, b,
          h("div", { class: "editor-bar" }, C.field("状态", st), h("span", { class: "spacer" }),
            h("button", { class: "btn small", onclick: () => C.phonePreview({ title: t.value.trim(), body: b.value, platform: v.platform, cover: v.cover || "" }) }, "手机预览"),
            h("button", { class: "btn small", onclick: () => C.copy((t.value ? t.value + "\n\n" : "") + b.value, C.platformName(v.platform) + "版本") }, "复制"),
            h("button", { class: "btn small ghost", onclick: async () => { if (await confirmLeave()) load({ id: v.id }); } }, "在编辑器打开"),
            h("button", { class: "btn small danger-ghost", onclick: async () => {
              if (!(await window.Shell.confirm(`删除${C.platformName(v.platform)}版本「${v.title || "未命名"}」？`, { okText: "删除", danger: true }))) return;
              try { await C.remove("contents", v.id); drawVersions(); } catch (err) { C.err(err); }
            } }, "删除"),
            h("button", { class: "btn small", onclick: () => saveV(false).catch(C.err) }, "保存"),
            pa,
            h("button", { class: "btn small primary", onclick: pushV }, v.platform === "douyin" ? "打开创作页" : "推送草稿箱")));
      }

      // Ctrl/⌘ + S 保存
      root.addEventListener("keydown", (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); save(); } });
      this.load = load;
      this.confirmLeave = confirmLeave;
      this.loadMaterials = loadMaterials;
      C.onData((what) => {
        if (what === "materials") loadMaterials();
        if (what === "breakdowns") loadTechniques();
        if (what === "platformAccounts" || what === "account") { paSel.redraw(pfSel.value); if (!vBody.querySelector("textarea:focus")) drawVersions(); }
        if (what === "contents" && current.id) api.store.get("contents", current.id).then((c) => { if (c && c.id === current.id) drawPush(c); }).catch(() => {});
      });
      loadMaterials();
      loadTechniques();
      topicIn.addEventListener("input", window.Shell.debounce(() => { if (!techChecked().length) loadTechniques(); }, 800));
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
