"use strict";
// 内容运营页面的公共工具：window.Content
//   Content.call(promise)                 → 主进程返回 { ok:false, error } 时抛错
//   Content.runAi(type, params, { onText, onTask }) → 跑 AI 后台任务，流式回调文字，结束时返回 result（失败抛错，取消返回 null）
//   Content.open(pageId, payload)         → 跳到某个页面并把数据交给它（页面在 onShow 里 Content.take(pageId) 取）
//   Content.meta()                        → 平台 / 状态 / 服务商列表（缓存）
(function () {
  const api = window.app;
  const { h } = window.Shell;

  // replaceChildren(a, cond ? b : null) 会把 null 当成文字「null」显示出来：统一跳过 null / undefined / false
  if (!Element.prototype.__caiSafeReplace) {
    const raw = Element.prototype.replaceChildren;
    Element.prototype.replaceChildren = function (...nodes) { return raw.apply(this, nodes.filter((n) => n !== null && n !== undefined && n !== false)); };
    Element.prototype.__caiSafeReplace = true;
  }

  async function call(p) {
    const r = await p;
    if (r && typeof r === "object" && !Array.isArray(r) && r.ok === false && r.error) throw new Error(r.error);
    return r;
  }

  // ---- AI 任务 ----
  const waiters = new Map(); // taskId → { onText, resolve, reject, onTask }
  const FINAL = new Set(["done", "failed", "cancelled"]);
  let wired = false;
  function wire() {
    if (wired) return;
    wired = true;
    api.ai.onDelta(({ taskId, text }) => { const w = waiters.get(taskId); if (w && w.onText) w.onText(text); });
    api.tasks.onChange((t) => {
      const w = waiters.get(t.id);
      if (!w) return;
      if (w.onTask) w.onTask(t);
      if (!FINAL.has(t.status)) return;
      waiters.delete(t.id);
      if (t.status === "done") w.resolve(t.result);
      else if (t.status === "cancelled") w.resolve(null);
      else w.reject(new Error(t.error || "AI 任务失败"));
    });
  }
  async function runAi(type, params, { onText, onTask, title } = {}) {
    wire();
    const r = await api.tasks.run(type, params, title ? { title } : undefined);
    if (!r || !r.ok) throw new Error((r && r.error) || "任务启动失败");
    const t = r.task;
    return new Promise((resolve, reject) => {
      waiters.set(t.id, { onText, onTask, resolve, reject });
      if (onTask) onTask(t);
      // 万一任务在注册监听前就结束了
      api.tasks.list().then((list) => {
        const now = list.find((x) => x.id === t.id);
        if (now && FINAL.has(now.status) && waiters.has(t.id)) {
          waiters.delete(t.id);
          if (now.status === "done") resolve(now.result); else if (now.status === "cancelled") resolve(null); else reject(new Error(now.error || "AI 任务失败"));
        }
      }).catch(() => {});
    });
  }
  const cancelTask = (id) => api.tasks.cancel(id);

  // ---- 页面间传数据 ----
  const inbox = new Map();
  function open(pageId, payload) { inbox.set(pageId, payload); window.Shell.navigate(pageId); }
  function take(pageId) { const v = inbox.get(pageId); inbox.delete(pageId); return v; }

  // ---- 元数据 ----
  let metaCache = null;
  async function meta() { if (!metaCache) metaCache = await call(api.ai.meta()); return metaCache; }
  const PLATFORM_NAMES = { wechat: "公众号", xiaohongshu: "小红书", douyin: "抖音", toutiao: "头条号", baijiahao: "百家号" };
  const STATUS_NAMES = { idea: "选题", draft: "草稿", ready: "待发布", published: "已发布" };
  const platformName = (p) => PLATFORM_NAMES[p] || p || "";
  const statusName = (s) => STATUS_NAMES[s] || s || "";

  // ---- 小组件 ----
  function field(label, control, hint) {
    return h("label", { class: "field" }, h("span", { class: "field-label" }, label), control, hint ? h("span", { class: "field-hint" }, hint) : null);
  }
  function selectEl(options, value, attrs = {}) {
    const sel = h("select", { class: "input", ...attrs }, ...options.map(([v, l]) => h("option", { value: v }, l)));
    sel.value = value;
    return sel;
  }
  const platformOptions = (withAny) => (withAny ? [["", "不限平台"]] : []).concat(Object.entries(PLATFORM_NAMES));
  const statusOptions = (withAny) => (withAny ? [["", "全部状态"]] : []).concat(Object.entries(STATUS_NAMES));
  const platformTag = (p) => h("span", { class: `pf pf-${p}` }, platformName(p));
  const statusTag = (s) => h("span", { class: `st st-${s}` }, statusName(s));

  function countWords(text) {
    const s = String(text || "");
    const cjk = (s.match(/[\u3400-\u9fff\uf900-\ufaff]/g) || []).length;
    const latin = (s.replace(/[\u3400-\u9fff\uf900-\ufaff]/g, " ").match(/[A-Za-z0-9]+/g) || []).length;
    return cjk + latin;
  }
  // 「# 标题\n正文」拆开
  function splitTitle(text) {
    const s = String(text || "").replace(/^\s+/, "");
    const m = s.match(/^#{1,3}\s*(.+?)\s*(?:\r?\n|$)/);
    return m ? { title: m[1].trim(), body: s.slice(m[0].length).replace(/^\s+/, "") } : { title: "", body: s };
  }
  const today = () => { const d = new Date(); const p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
  const ymd = (d) => { const p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
  const fmtDate = (t) => { const d = new Date(t); return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };

  async function copy(text, what = "内容") {
    try { await api.content.copy(text); window.Shell.toast(`已复制${what}`, "success"); }
    catch (e) { window.Shell.toast("复制失败：" + e.message, "error"); }
  }
  const err = (e) => window.Shell.toast((e && e.message) || String(e), "error", 5000);

  // 数据变了：通知各页面刷新（同一窗口内）
  const listeners = new Set();
  const onData = (cb) => { listeners.add(cb); return () => listeners.delete(cb); };
  const changed = (what) => { for (const cb of listeners) { try { cb(what); } catch (e) { window.Shell.reportError(e); } } };

  // 存 / 删并广播
  async function save(name, item) { const r = await call(api.store.upsert(name, item)); changed(name); return r.item; }
  async function remove(name, id) { const r = await call(api.store.remove(name, id)); changed(name); return r; }
  const list = (name, filter) => call(api.store.list(name, filter));

  // ---- 运营账号 ----
  let accounts = [];
  const currentAccountId = () => window.Shell.getSettings().currentAccount || "";
  const currentAccount = () => accounts.find((a) => a.id === currentAccountId()) || accounts[0] || null;
  async function loadAccounts() { accounts = (await call(api.store.list("accounts"))).sort((a, b) => a.createdAt - b.createdAt); drawSwitcher(); return accounts; }
  const switcherSel = h("select", { class: "input acct-select", title: "切换运营账号", "aria-label": "运营账号" });
  const switcherDot = h("span", { class: "acct-dot" });
  const switcher = h("div", { class: "acct-switch" }, switcherDot, switcherSel);
  function drawSwitcher() {
    switcherSel.replaceChildren(...accounts.map((a) => h("option", { value: a.id }, a.name)), h("option", { value: "__manage" }, "管理账号…"));
    const cur = currentAccount();
    switcherSel.value = cur ? cur.id : "";
    switcherDot.className = "acct-dot accent-" + ((cur && cur.color) || "blue");
  }
  switcherSel.addEventListener("change", () => {
    if (switcherSel.value === "__manage") { drawSwitcher(); window.Shell.navigate("settings"); setTimeout(() => document.getElementById("settings-accounts")?.scrollIntoView({ behavior: "smooth" }), 150); return; }
    switchAccount(switcherSel.value);
  });
  async function switchAccount(id) {
    if (!accounts.some((a) => a.id === id)) return;
    // 直接写主进程（不走防抖），保证接下来的数据请求已经按新账号筛选
    window.Shell.saveSettings({ currentAccount: id });
    await api.settings.set({ currentAccount: id });
    drawSwitcher();
    changed("account"); changed("contents"); changed("topics");
    const a = currentAccount();
    if (a) window.Shell.toast(`已切换到「${a.name}」`, "success", 1800);
  }
  window.Shell.onStart(() => {
    const brand = document.querySelector("#sidebar .brand");
    if (brand) brand.after(switcher);
    loadAccounts().catch(window.Shell.reportError);
    window.Shell.onSettings((c) => { if ("currentAccount" in c) drawSwitcher(); });
  });

  // ---- 推送到平台草稿箱 ----
  const PUSH_NAMES = { pushing: "推送中", saved: "已存草稿", unknown: "待确认", failed: "推送失败", opened: "已打开创作页" };
  function pushTag(content) {
    const r = content && content.pushes && content.pushes[content.platform];
    if (!r) return null;
    return h("span", { class: `push-tag push-${r.status}`, title: r.error || fmtDate(r.at) }, PUSH_NAMES[r.status] || r.status);
  }
  // 推送一篇已保存的内容（后台任务，同平台自动排队）；platformAccountId 指定用哪个平台号；返回 result 或抛错
  async function push(contentId, { title, platformAccountId = "", force = false } = {}) {
    return runAi("publish:push", { contentId, platformAccountId, force }, { title });
  }
  api.publish.onChanged(() => changed("contents"));

  // ---- 平台号（同一平台可以登录多个号） ----
  let platformAccounts = [];
  async function loadPlatformAccounts() { platformAccounts = await call(api.publish.accounts()); return platformAccounts; }
  const loggedInOf = (pf) => platformAccounts.filter((a) => a.platform === pf && a.loggedIn);
  // 推送用哪个号的下拉框：只有一个号时也显示（方便看用的是谁）；没有号时显示提示。value = "" 表示「默认（绑定当前运营账号的号）」
  function accountPicker(pf, value = "", { onChange } = {}) {
    const sel = h("select", { class: "input input-sm pa-picker", title: "用哪个平台号推送" });
    const draw = (pfNow, v) => {
      const list = loggedInOf(pfNow);
      const cur = currentAccountId();
      const bound = list.find((a) => a.boundAccountId === cur);
      const def = bound ? `默认：${bound.name}` : list.length === 1 ? `默认：${list[0].name}` : list.length ? "请选择平台号" : `还没登录${platformName(pfNow)}`;
      sel.replaceChildren(h("option", { value: "" }, def), ...list.map((a) => h("option", { value: a.id }, a.name + (a.boundAccountId && a.boundAccountId !== cur ? "（绑定其他运营账号）" : ""))));
      sel.value = list.some((a) => a.id === v) ? v : "";
      sel.disabled = !list.length;
      sel.hidden = pfNow === "douyin" && list.length <= 1;
    };
    draw(pf, value);
    sel.addEventListener("change", () => onChange && onChange(sel.value));
    sel.redraw = (pfNow, v = sel.value) => draw(pfNow, v);
    return sel;
  }
  api.publish.onAccounts(() => loadPlatformAccounts().then(() => changed("platformAccounts")).catch(() => {}));
  // 主进程改了数据（自动创作 / 拆解入库）
  api.onData((p) => { if (p && p.what) changed(p.what); });
  api.auto.onChanged(() => changed("auto"));
  window.Shell.onStart(() => { loadPlatformAccounts().then(() => changed("platformAccounts")).catch(window.Shell.reportError); });

  // 重合度标签
  function overlapTag(c, limit) {
    if (!c || c.overlap == null || c.overlap < 0) return null;
    const bad = c.needsRewrite || (limit != null && c.overlap > limit);
    return h("span", { class: "ov-tag" + (bad ? " bad" : ""), title: "与参考原文的重合度" }, `重合 ${c.overlap}%`);
  }
  const rewriteTag = (c) => (c && c.needsRewrite ? h("span", { class: "push-tag push-failed", title: "与参考原文重合度过高，改写后再推送" }, "需改写") : null);
  const SOURCE_NAMES = { wechat: "公众号", toutiao: "头条", baijiahao: "百家号", xiaohongshu: "小红书", douyin: "抖音", other: "其他" };
  const fmtCount = (n) => (!n ? "" : n >= 1e8 ? (n / 1e8).toFixed(1).replace(/\.0$/, "") + "亿" : n >= 1e4 ? (n / 1e4).toFixed(1).replace(/\.0$/, "") + "万" : String(n));
  const fmtAgo = (ts) => {
    if (!ts) return "";
    const d = Date.now() - ts;
    if (d < 3600000) return `${Math.max(1, Math.floor(d / 60000))} 分钟前`;
    if (d < 86400000) return `${Math.floor(d / 3600000)} 小时前`;
    if (d < 7 * 86400000) return `${Math.floor(d / 86400000)} 天前`;
    return ymd(new Date(ts));
  };
  // 分段标签：tabs([["find","找爆款"],…], onPick) → { el, set(id) }
  function tabs(items, onPick, initial) {
    const el = h("div", { class: "segmented tabs-bar", role: "tablist" });
    const set = (id) => { for (const b of el.children) b.classList.toggle("active", b.dataset.tab === id); onPick(id); };
    for (const [id, label] of items) el.append(h("button", { dataset: { tab: id }, role: "tab", onclick: () => set(id) }, label));
    if (initial) setTimeout(() => set(initial), 0);
    return { el, set };
  }

  window.Content = {
    loadAccounts, currentAccount, currentAccountId, switchAccount, getAccounts: () => accounts.slice(), push, pushTag, PUSH_NAMES,
    loadPlatformAccounts, getPlatformAccounts: () => platformAccounts.slice(), loggedInOf, accountPicker, overlapTag, rewriteTag, SOURCE_NAMES, fmtCount, fmtAgo, tabs,
    call, runAi, cancelTask, open, take, meta, field, selectEl, platformOptions, statusOptions, platformTag, statusTag,
    platformName, statusName, countWords, splitTitle, today, ymd, fmtDate, copy, err, onData, changed, save, remove, list,
    PLATFORM_NAMES, STATUS_NAMES,
  };
})();
