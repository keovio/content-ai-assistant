"use strict";
// 内容运营页面的公共工具：window.Content
//   Content.call(promise)                 → 主进程返回 { ok:false, error } 时抛错
//   Content.runAi(type, params, { onText, onTask }) → 跑 AI 后台任务，流式回调文字，结束时返回 result（失败抛错，取消返回 null）
//   Content.open(pageId, payload)         → 跳到某个页面并把数据交给它（页面在 onShow 里 Content.take(pageId) 取）
//   Content.meta()                        → 平台 / 状态 / 服务商列表（缓存）
(function () {
  const api = window.app;
  const { h } = window.Shell;

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
  const PLATFORM_NAMES = { wechat: "公众号", xiaohongshu: "小红书", douyin: "抖音" };
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

  window.Content = {
    call, runAi, cancelTask, open, take, meta, field, selectEl, platformOptions, statusOptions, platformTag, statusTag,
    platformName, statusName, countWords, splitTitle, today, ymd, fmtDate, copy, err, onData, changed, save, remove, list,
    PLATFORM_NAMES, STATUS_NAMES,
  };
})();
