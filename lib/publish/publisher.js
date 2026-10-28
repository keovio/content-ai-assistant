"use strict";
// 平台登录 + 打开后台 / 草稿箱 + 自动存草稿（主进程）。
//
// 0.4.1 起登录按「平台号」管理：同一平台可以登录多个号，每个号一个独立的持久登录空间（partition），
// 可以改名、绑定到某个运营账号；推送默认用绑定当前运营账号的号，也可以指定。0.4.0 按「运营账号 × 平台」
// 登录的号会在启动时自动迁移成平台号（沿用原来的登录空间，不用重新登录）。
// 用户在弹出的官方登录页里自己扫码 / 短信登录，应用不碰密码。推送时打开平台编辑页，填标题、粘贴正文（富文本走剪贴板粘贴，最接近人工操作）、需要时上传封面，
// 然后只点「存草稿」——永远不点发布。每一步都写日志（模块名 publish），失败时截图并把窗口留给用户处理。
//
//   const pub = createPublisher({ electron, logger, settings, tasks, store, broadcast, dataDir, iconPath })
//   IPC：publish:meta / accounts / add / relogin / update / remove / open / openFor / shots / stats / refreshStats；
//   后台任务 publish:push { contentId, platformAccountId? }、publish:stats { force?, ids? }（0.5.4 账号数据）
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const P = require("./platforms");
const { mdToHtml, mdToText, escapeHtml } = require("./markdown");
const ST = require("./stats");

const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const t = setTimeout(resolve, ms);
  if (signal) signal.addEventListener("abort", () => { clearTimeout(t); reject(new Error("已取消")); }, { once: true });
});
const jitter = (a, b) => a + Math.random() * (b - a);

// 注入到平台页面里的小工具（只读页面、聚焦、按文字点按钮）。不用平台的私有接口，只做人能做的操作。
const HELPERS = String.raw`(() => {
  if (window.__cai) return;
  const vis = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden" && getComputedStyle(el).display !== "none";
  const q = (sel, root = document) => { try { return [...root.querySelectorAll(sel)]; } catch { return []; } };
  function titleEl(cfg) {
    for (const s of cfg.title || []) { const el = q(s).find(vis); if (el) return el; }
    return q("input, textarea").find((el) => vis(el) && /标题/.test(el.placeholder || ""));
  }
  function bodyEl(cfg, t) {
    for (const s of cfg.body || []) {
      for (const el of q(s)) {
        if (el === t || !vis(el)) continue;
        if (el.tagName === "IFRAME") {
          try { const d = el.contentDocument; if (d && d.body) return { el, frame: true, doc: d }; } catch { /* 跨域 iframe */ }
          continue;
        }
        if (el.isContentEditable) {
          // 同一选择器有多个时取面积最大的（正文区通常最大）
          const all = q(s).filter((x) => x !== t && vis(x) && x.isContentEditable);
          const big = all.sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0] || el;
          return { el: big, frame: false };
        }
      }
    }
    return null;
  }
  function textOf(cfg) {
    const t = titleEl(cfg); const b = bodyEl(cfg, t);
    return { title: t ? (t.value || t.innerText || "") : "", body: b ? (b.frame ? b.doc.body.innerText : b.el.innerText) || "" : "" };
  }
  window.__cai = {
    find(cfg) { const t = titleEl(cfg); const b = bodyEl(cfg, t); return { title: !!t, body: !!b, url: location.href }; },
    focusTitle(cfg) {
      const t = titleEl(cfg); if (!t) return false;
      t.scrollIntoView({ block: "center" }); t.focus();
      if (typeof t.select === "function") t.select(); else document.execCommand("selectAll");
      return true;
    },
    focusBody(cfg) {
      const t = titleEl(cfg); const b = bodyEl(cfg, t); if (!b) return false;
      if (b.frame) { b.el.scrollIntoView({ block: "center" }); b.el.contentWindow.focus(); b.doc.body.focus(); b.doc.execCommand("selectAll"); }
      else { b.el.scrollIntoView({ block: "center" }); b.el.focus(); document.execCommand("selectAll"); }
      return true;
    },
    text: textOf,
    // 兜底：用原生 setter 写标题并触发 input 事件（React/Vue 受控输入框也能收到）
    setTitle(cfg, v) {
      const t = titleEl(cfg); if (!t) return false;
      if ("value" in t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) {
        const proto = t.tagName === "INPUT" ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
        Object.getOwnPropertyDescriptor(proto, "value").set.call(t, v);
      } else t.innerText = v;
      t.dispatchEvent(new Event("input", { bubbles: true })); t.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    },
    // 在正文里找到占位符文字并选中它（之后粘贴图片会替换掉占位符）
    selectMarker(cfg, token) {
      const t = titleEl(cfg); const b = bodyEl(cfg, t); if (!b) return false;
      const doc = b.frame ? b.doc : document; const root = b.frame ? b.doc.body : b.el;
      const w = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = w.nextNode())) {
        const i = n.nodeValue.indexOf(token);
        if (i < 0) continue;
        if (b.frame) { b.el.contentWindow.focus(); b.doc.body.focus(); } else b.el.focus();
        const r = doc.createRange(); r.setStart(n, i); r.setEnd(n, i + token.length);
        const s = (b.frame ? b.el.contentWindow : window).getSelection(); s.removeAllRanges(); s.addRange(r);
        (n.parentElement || root).scrollIntoView({ block: "center" });
        return true;
      }
      return false;
    },
    // 按完全匹配的文字找可点的元素（按钮优先），返回点到的文字
    clickText(texts) {
      for (const text of texts || []) {
        const cands = q("button, a, [role=button], span, div, label").filter((el) => vis(el) && (el.innerText || "").trim() === text);
        cands.sort((a, b) => (b.tagName === "BUTTON") - (a.tagName === "BUTTON") || a.childElementCount - b.childElementCount);
        const el = cands[0];
        if (el) { const target = el.closest("button, [role=button], a") || el; target.scrollIntoView({ block: "center" }); target.click(); return text; }
      }
      return null;
    },
    // 页面上「已保存 23:36」这类提示的快照：头条会一直显示自动保存时间，数量不变但时间会变
    savedSnap(texts) { const s = document.body ? document.body.innerText : ""; const out = []; for (const t of texts || []) { let i = s.indexOf(t); while (i >= 0) { out.push(s.slice(Math.max(0, i - 12), i + t.length + 12).replace(/\s+/g, " ")); i = s.indexOf(t, i + 1); } } return out.join("|"); },
    // 按 CSS 选择器点第一个看得见的元素
    clickSel(sels) { for (const s of sels || []) { const el = q(s).find(vis); if (el) { el.scrollIntoView({ block: "center" }); el.click(); return s; } } return null; },
    count(texts) { const s = document.body ? document.body.innerText : ""; let n = 0; for (const t of texts || []) n += s.split(t).length - 1; return n; },
  };
})()`;

const IMG = require("../images");

function createPublisher({ electron, logger, settings, tasks, store, broadcast, dataDir, iconPath, imageFile = () => "" }) {
  const { BrowserWindow, session, clipboard, ipcMain, nativeImage } = electron;
  const log = logger.scope("publish");
  const shotDir = path.join(dataDir, "publish-shots");
  const prepared = new Set();
  const loginWins = new Map();
  const queues = new Map();   // 平台 → 串行队列
  const lastPush = new Map(); // 平台 → 上次推送时间

  const cfgOf = (pf) => {
    const c = P.PUBLISH_PLATFORMS[pf];
    if (!c) throw new Error("不支持的平台：" + pf);
    return c;
  };
  function sessionFor(part) {
    const ses = session.fromPartition(part);
    if (!prepared.has(part)) {
      prepared.add(part);
      ses.setUserAgent(P.cleanUserAgent(ses.getUserAgent()));
      ses.setPermissionRequestHandler((_wc, perm, cb) => cb(["clipboard-read", "clipboard-sanitized-write", "fullscreen"].includes(perm)));
    }
    return ses;
  }

  // 某个登录空间里这个平台是否已登录（看登录后才有的 cookie）
  async function partitionLoggedIn(part, pf) {
    const c = cfgOf(pf);
    try {
      const cookies = await sessionFor(part).cookies.get({ url: c.cookieUrl });
      const names = new Set(cookies.map((k) => k.name));
      return c.cookies.some((n) => names.has(n));
    } catch { return false; }
  }
  const getPa = (id) => {
    const a = store.platformAccounts.get(String(id || ""));
    if (!a || !a.partition) throw new Error("找不到这个平台号，可能已经删除");
    return a;
  };
  async function checkPa(a) {
    const loggedIn = await partitionLoggedIn(a.partition, a.platform);
    if (loggedIn !== a.loggedIn || Date.now() - (a.checkedAt || 0) > 60000) {
      try { store.platformAccounts.upsert({ id: a.id, loggedIn, checkedAt: Date.now() }); } catch { /* ignore */ }
    }
    return { ...a, loggedIn };
  }
  // 平台号列表（带实时登录状态）；platform 可选
  async function listAccounts(platform) {
    const all = store.platformAccounts.list().filter((a) => !platform || a.platform === platform).sort((x, y) => x.createdAt - y.createdAt);
    const out = [];
    for (const a of all) out.push(await checkPa(a));
    return out;
  }

  // ---------- 0.4.0 → 0.4.1：把「运营账号 × 平台」的登录迁移成平台号 ----------
  async function migrate() {
    if (settings.get("platformAccountsMigrated")) return 0;
    let n = 0;
    const exist = new Set(store.platformAccounts.list().map((a) => a.migratedFrom).filter(Boolean));
    for (const acc of store.accounts.list().sort((x, y) => x.createdAt - y.createdAt)) {
      for (const pf of P.PUBLISH_IDS) {
        const key = `${acc.id}:${pf}`;
        if (exist.has(key)) continue;
        const part = P.partitionOf(acc.id, pf);
        if (!(await partitionLoggedIn(part, pf))) continue;
        store.platformAccounts.upsert({ platform: pf, name: `${acc.name}·${cfgOf(pf).name}`, partition: part, boundAccountId: acc.id, loggedIn: true, checkedAt: Date.now(), migratedFrom: key });
        n++;
      }
    }
    settings.set({ platformAccountsMigrated: true });
    if (n) log.info(`已把 0.4.0 登录过的 ${n} 个平台号迁移过来（沿用原登录，不用重新登录）`);
    return n;
  }

  // 推送用哪个号：指定的 > 绑定这篇内容所属运营账号的 > 这个平台唯一登录的那个号
  async function resolveAccount(pf, opAccountId, preferId) {
    const c = cfgOf(pf);
    const list = (await listAccounts(pf)).filter((a) => a.loggedIn);
    if (preferId) {
      const a = list.find((x) => x.id === preferId);
      if (a) return a;
      const any = store.platformAccounts.get(preferId);
      if (any && any.platform === pf) throw new Error(`选中的${c.name}号「${any.name}」登录已失效，请到 设置 → 平台账号 重新登录`);
    }
    const bound = list.find((a) => a.boundAccountId && a.boundAccountId === opAccountId);
    if (bound) return bound;
    if (list.length === 1) return list[0];
    if (!list.length) throw new Error(`还没有登录${c.name}的号，请到 设置 → 平台账号 添加`);
    throw new Error(`${c.name}登录了 ${list.length} 个号，请选择用哪个号推送，或在 设置 → 平台账号 把其中一个绑定到当前运营账号`);
  }

  function openWindow({ partition, title, show = true }) {
    sessionFor(partition);
    const win = new BrowserWindow({
      width: 1240, height: 860, minWidth: 900, minHeight: 600, show, title, icon: iconPath, autoHideMenuBar: true,
      webPreferences: { partition, contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false, backgroundThrottling: false },
    });
    win.webContents.setWindowOpenHandler(() => ({ action: "allow", overrideBrowserWindowOptions: { autoHideMenuBar: true, icon: iconPath, webPreferences: { partition, contextIsolation: true, sandbox: true } } }));
    win.on("page-title-updated", (e) => { e.preventDefault(); });
    return win;
  }
  async function load(win, url) {
    try { await win.loadURL(url); } catch (err) { if (!/ERR_ABORTED|-3/.test(String(err && err.message))) throw err; }
  }
  const alive = (win) => win && !win.isDestroyed();

  // 公众号这类地址带 token：先开首页，等跳转后的地址里出现 token
  async function resolveUrl(win, pf, tpl, signal) {
    const c = cfgOf(pf);
    if (!P.needsToken(tpl)) return tpl;
    await load(win, c.home);
    for (let i = 0; i < 40; i++) {
      const url = alive(win) ? win.webContents.getURL() : "";
      const token = P.tokenOf(pf, url);
      if (token) return P.fillUrl(tpl, { token });
      if (i > 6 && P.isLoginUrl(pf, url)) throw new Error(`${c.name}登录已失效，请到 设置 → 平台账号 重新登录`);
      await sleep(500, signal);
    }
    throw new Error(`没能打开${c.name}后台（没有拿到 token），请确认已登录`);
  }

  // ---------- 登录 ----------
  // 在某个登录空间里打开平台登录页，等到登录成功或窗口被关掉；返回是否登录成功
  async function loginIn(partition, pf, label) {
    const c = cfgOf(pf);
    if (loginWins.has(partition) && alive(loginWins.get(partition))) { loginWins.get(partition).focus(); return { pending: true, loggedIn: false }; }
    const win = openWindow({ partition, title: `登录${c.name}${label ? " · " + label : ""}` });
    loginWins.set(partition, win);
    log.info(`打开${c.name}登录页${label ? "（" + label + "）" : ""}，请在弹出的窗口里扫码或用短信登录`);
    await load(win, c.login);
    return new Promise((resolve) => {
      let done = false;
      const finish = (loggedIn) => { if (done) return; done = true; clearInterval(timer); loginWins.delete(partition); resolve({ loggedIn }); };
      const timer = setInterval(async () => {
        if (!alive(win)) { finish(await partitionLoggedIn(partition, pf)); return; }
        const on = await partitionLoggedIn(partition, pf);
        if (on && !P.isLoginUrl(pf, win.webContents.getURL())) {
          setTimeout(() => { if (alive(win)) win.close(); }, 1200);
          finish(true);
        }
      }, 1500);
      win.on("closed", async () => finish(await partitionLoggedIn(partition, pf)));
    });
  }
  // 添加一个平台号：新开一个登录空间，登录成功才保存；默认绑定当前运营账号
  async function addAccount(pf, { name = "", boundAccountId } = {}) {
    const c = cfgOf(pf);
    const partition = `persist:pa-${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
    const r = await loginIn(partition, pf, "新号");
    if (r.pending) return r;
    if (!r.loggedIn) {
      try { const ses = sessionFor(partition); await ses.clearStorageData(); } catch { /* ignore */ }
      log.info(`没有完成${c.name}登录，未添加`);
      return { ok: false, loggedIn: false };
    }
    const n = store.platformAccounts.list().filter((a) => a.platform === pf).length + 1;
    const cur = boundAccountId !== undefined ? boundAccountId : settings.get("currentAccount");
    const a = store.platformAccounts.upsert({ platform: pf, name: name || `${c.name}号${n}`, partition, boundAccountId: cur || "", loggedIn: true, checkedAt: Date.now() });
    log.info(`${c.name}登录成功，已添加平台号「${a.name}」`);
    broadcast("publish:accounts", { id: a.id, platform: pf, loggedIn: true });
    return { ok: true, loggedIn: true, account: a };
  }
  async function relogin(id) {
    const a = getPa(id);
    const r = await loginIn(a.partition, a.platform, a.name);
    if (!r.pending) {
      store.platformAccounts.upsert({ id: a.id, loggedIn: r.loggedIn, checkedAt: Date.now() });
      if (r.loggedIn) log.info(`${cfgOf(a.platform).name}「${a.name}」已重新登录`);
      broadcast("publish:accounts", { id: a.id, platform: a.platform, loggedIn: r.loggedIn });
    }
    return { ok: !!r.loggedIn, ...r };
  }
  function updateAccount(id, patch = {}) {
    const a = getPa(id);
    const next = {};
    if (typeof patch.name === "string") next.name = patch.name.trim() || a.name;
    if (typeof patch.boundAccountId === "string") {
      if (patch.boundAccountId && !store.accounts.get(patch.boundAccountId)) throw new Error("没有这个运营账号");
      next.boundAccountId = patch.boundAccountId;
    }
    const saved = store.platformAccounts.upsert({ id: a.id, ...next });
    broadcast("publish:accounts", { id: a.id, platform: a.platform });
    return { ok: true, account: saved };
  }
  async function removeAccount(id) {
    const a = getPa(id);
    try { const ses = sessionFor(a.partition); await ses.clearStorageData(); await ses.clearCache(); } catch { /* ignore */ }
    store.platformAccounts.remove(a.id);
    log.info(`已退出并移除${cfgOf(a.platform).name}「${a.name}」`);
    broadcast("publish:accounts", { id: a.id, platform: a.platform, removed: true });
    return { ok: true };
  }
  // 运营账号被删：解除绑定（平台号本身保留）
  async function clearAccount(opAccountId) {
    store.platformAccounts.patchAll((a) => (a.boundAccountId === opAccountId ? { boundAccountId: "" } : null));
  }

  // ---------- 打开后台 / 草稿箱 ----------
  async function open(id, which = "drafts") {
    const a = getPa(id);
    const c = cfgOf(a.platform);
    const win = openWindow({ partition: a.partition, title: `${c.name}${which === "drafts" ? "草稿箱" : "后台"} · ${a.name}` });
    const tpl = which === "drafts" ? c.drafts : which === "editor" ? c.editor : c.home;
    try { await load(win, await resolveUrl(win, a.platform, tpl)); }
    catch (err) { log.warn(err.message); }
    return { ok: true };
  }

  // ---------- 小红书文字封面（没有图片时自动生成） ----------
  async function makeCover(title, accountName, color, size) {
    const COLORS = { blue: ["#1e3a8a", "#3b82f6"], violet: ["#3b1d8f", "#8b5cf6"], pink: ["#9d174d", "#ec4899"], orange: ["#9a3412", "#f97316"], green: ["#14532d", "#22c55e"], teal: ["#134e4a", "#14b8a6"], graphite: ["#1f2937", "#6b7280"] };
    const [c1, c2] = COLORS[color] || COLORS.violet;
    const html = `<!doctype html><meta charset="utf-8"><style>
      html,body{margin:0;width:${size.width}px;height:${size.height}px;font-family:"PingFang SC","Microsoft YaHei","Noto Sans CJK SC",sans-serif}
      body{background:linear-gradient(160deg,${c1},${c2});display:flex;flex-direction:column;justify-content:center;padding:0 110px;box-sizing:border-box;color:#fff}
      h1{font-size:${title.length > 24 ? 92 : 112}px;line-height:1.28;margin:0;font-weight:800;letter-spacing:2px;word-break:break-all}
      .bar{width:120px;height:14px;border-radius:7px;background:#fde68a;margin:0 0 60px}
      .acc{position:absolute;left:110px;bottom:110px;font-size:40px;opacity:.85}</style>
      <div class="bar"></div><h1>${escapeHtml(title)}</h1><div class="acc">${escapeHtml(accountName || "")}</div>`;
    const win = new BrowserWindow({ show: false, width: size.width, height: size.height, useContentSize: true, webPreferences: { offscreen: true, sandbox: true, contextIsolation: true } });
    try {
      await win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
      await sleep(400);
      const img = await win.webContents.capturePage();
      fs.mkdirSync(shotDir, { recursive: true });
      const file = path.join(shotDir, `cover-${Date.now()}.png`);
      fs.writeFileSync(file, img.toPNG());
      return file;
    } finally { if (alive(win)) win.destroy(); }
  }

  // last=true：用页面上最后一个匹配的上传框（弹窗里的通常在最后）
  async function uploadFile(win, file, { selector = "input[type=file]", last = false } = {}) {
    const dbg = win.webContents.debugger;
    let attached = false;
    try {
      if (!dbg.isAttached()) { dbg.attach("1.3"); attached = true; }
      const { root } = await dbg.sendCommand("DOM.getDocument", { depth: -1, pierce: true });
      let nodeId = 0;
      if (last) { const r = await dbg.sendCommand("DOM.querySelectorAll", { nodeId: root.nodeId, selector }); nodeId = (r.nodeIds || []).slice(-1)[0] || 0; }
      else ({ nodeId } = await dbg.sendCommand("DOM.querySelector", { nodeId: root.nodeId, selector }));
      if (!nodeId) throw new Error("页面上找不到上传图片的入口");
      await dbg.sendCommand("DOM.setFileInputFiles", { nodeId, files: Array.isArray(file) ? file : [file] });
    } finally { if (attached) { try { dbg.detach(); } catch { /* ignore */ } } }
  }

  async function screenshot(win, id) {
    try {
      if (!alive(win)) return "";
      const img = await win.webContents.capturePage();
      fs.mkdirSync(shotDir, { recursive: true });
      const file = path.join(shotDir, `fail-${id.slice(0, 8)}-${Date.now()}.png`);
      fs.writeFileSync(file, img.toPNG());
      return file;
    } catch { return ""; }
  }

  function record(contentId, pf, rec) {
    const c = store.contents.get(contentId);
    if (!c) return;
    store.contents.upsert({ id: contentId, pushes: { ...(c.pushes || {}), [pf]: { ...rec, at: Date.now() } } });
    broadcast("publish:changed", { contentId, platform: pf, ...rec });
  }

  // 串行：同一平台一次只推一篇，两篇之间隔一会儿
  function serial(pf, fn) {
    const prev = queues.get(pf) || Promise.resolve();
    const next = prev.catch(() => {}).then(fn);
    queues.set(pf, next.catch(() => {}));
    return next;
  }

  // ---------- 推送到草稿箱 ----------
  async function push(contentId, ctx, { platformAccountId = "", force = false } = {}) {
    const content = store.contents.get(String(contentId || ""));
    if (!content) throw new Error("找不到这篇内容，先保存再推送");
    const pf = content.platform;
    const c = cfgOf(pf);
    const opAcc = store.accounts.get(content.accountId) || {};
    const step = (pct, msg) => { ctx.progress(pct, msg); log.info(`[${c.name}] ${msg}`); };
    const check = () => { if (ctx.signal && ctx.signal.aborted) throw new Error("已取消"); };
    if (!(content.title || "").trim() && !(content.body || "").trim()) throw new Error("内容是空的");
    if (content.needsRewrite && !force) throw new Error("这篇和参考原文重合度过高，已标记「需改写」，改写后再推送");

    step(3, `选择${c.name}平台号并检查登录状态`);
    const pa = await resolveAccount(pf, content.accountId, platformAccountId || content.platformAccountId);
    const acc = { name: pa.name, color: opAcc.color };
    const who = { accountId: pa.id, accountName: pa.name };
    step(4, `使用平台号「${pa.name}」`);

    const title = c.maxTitle ? content.title.slice(0, c.maxTitle) : content.title;
    if (c.maxTitle && content.title.length > c.maxTitle) log.warn(`[${c.name}] 标题超过 ${c.maxTitle} 字，已截断：${title}`);
    const text = mdToText(IMG.stripImages(content.body));
    // 配图：封面 + 正文里的图（只取文件还在的）
    const fileOk = (n) => { const f = n ? imageFile(n) : ""; return f && fs.existsSync(f) ? f : ""; };
    const parts = IMG.splitByImages(content.body).filter((x) => x.type === "text" || fileOk(x.name));
    const pics = parts.filter((x) => x.type === "image").map((x) => fileOk(x.name));
    const coverFile = fileOk(content.cover);

    // 抖音口播：脚本是拍摄用的，不是能直接存的内容 → 打开创作页 + 复制脚本
    if (c.mode === "assist") {
      clipboard.writeText((content.title ? content.title + "\n\n" : "") + text);
      step(60, "已复制口播脚本，正在打开抖音创作者中心");
      await open(pa.id, "editor");
      record(content.id, pf, { status: "opened", url: c.drafts, error: "", ...who });
      step(100, "已打开抖音创作者中心，脚本在剪贴板里，拍好视频上传时粘贴标题和文案即可");
      return { status: "opened", platform: pf };
    }

    return serial(pf, async () => {
      const wait = (lastPush.get(pf) || 0) + settings.get("pushInterval") * 1000 - Date.now();
      if (wait > 0) { step(5, `同一平台连续推送，等 ${Math.ceil(wait / 1000)} 秒`); await sleep(wait + jitter(300, 1500), ctx.signal); }
      check();
      record(content.id, pf, { status: "pushing", url: "", error: "", ...who });
      const show = settings.get("pushShowWindow");
      const win = openWindow({ partition: pa.partition, title: `推送到${c.name}草稿箱 · ${acc.name || ""}`, show });
      const js = (code) => win.webContents.executeJavaScript(`${HELPERS};${code}`, true);
      const savedClip = { text: clipboard.readText(), html: clipboard.readHTML() };
      let ok = false;
      try {
        step(10, "打开编辑页");
        const editorUrl = await resolveUrl(win, pf, c.editor, ctx.signal);
        await load(win, editorUrl);
        await sleep(jitter(1500, 2500), ctx.signal);
        if (P.isLoginUrl(pf, win.webContents.getURL())) throw new Error(`${c.name}登录已失效，请到 设置 → 平台账号 重新登录`);

        if (c.prepare) {
          for (let i = 0; i < 20; i++) { check(); if (await js(`window.__cai.clickText(${JSON.stringify(c.prepare)})`)) break; await sleep(500, ctx.signal); }
          await sleep(jitter(800, 1500), ctx.signal);
        }
        if (c.image) {
          // 图文笔记：有配图就上传配图（封面在前），没有才生成文字封面
          const files = [coverFile, ...pics].filter(Boolean).slice(0, 9);
          if (files.length) step(20, `上传 ${files.length} 张配图`);
          else step(20, "生成文字封面图");
          const upload = files.length ? files : [await makeCover(title || "未命名", acc.name, acc.color, c.image)];
          if (!files.length) step(28, "上传封面图");
          await uploadFile(win, upload);
          await sleep(jitter(3000, 4500), ctx.signal);
        }
        await js(`window.__cai.clickText(${JSON.stringify(c.dismiss || [])})`).catch(() => null);

        step(35, "等待编辑器加载");
        let found = null;
        for (let i = 0; i < 40; i++) {
          check();
          found = await js(`window.__cai.find(${JSON.stringify({ title: c.title, body: c.body })})`).catch(() => null);
          if (found && found.title && found.body) break;
          if (i % 6 === 5) await js(`window.__cai.clickText(${JSON.stringify(c.dismiss || [])})`).catch(() => null);
          await sleep(500, ctx.signal);
        }
        if (!found || !found.title || !found.body) throw new Error(`${c.name}编辑页没有找到${found && found.title ? "正文编辑区" : "标题输入框"}，可能平台改版了`);
        const sel = JSON.stringify({ title: c.title, body: c.body });

        step(45, "填写标题");
        if (!win.isFocused() && show) win.focus();
        await js(`window.__cai.focusTitle(${sel})`);
        await sleep(jitter(200, 500), ctx.signal);
        win.webContents.insertText(title);
        await sleep(jitter(500, 900), ctx.signal);

        step(60, "粘贴正文");
        await js(`window.__cai.focusBody(${sel})`);
        await sleep(jitter(300, 600), ctx.signal);
        const imgCount = c.html ? parts.filter((x) => x.type === "image").length : 0;
        if (imgCount) {
          // 先把全文一次粘进去，图片位置放占位符；再逐个选中占位符粘贴图片（由平台编辑器自己上传）。
          // 不再文字、图片交替粘：头条等编辑器粘完图片光标会跑到图片说明框里，后面的文字就丢了
          const token = (k) => `CAIIMG${k}X`;
          let k = 0;
          const md = parts.map((x) => (x.type === "text" ? x.text : `\n\n${token(++k)}\n\n`)).join("");
          clipboard.write({ text: mdToText(md), html: mdToHtml(md) });
          win.webContents.paste();
          await sleep(jitter(1500, 2200), ctx.signal);
          let n = 0;
          for (const part of parts) {
            if (part.type !== "image") continue;
            check();
            n++;
            const tk = token(n);
            const img = nativeImage.createFromPath(fileOk(part.name));
            if (img.isEmpty()) { log.warn(`[${c.name}] 配图读不出来，跳过：${part.name}`); continue; }
            step(60 + Math.round((n / imgCount) * 12), `粘贴第 ${n}/${imgCount} 张配图`);
            if (!(await js(`window.__cai.selectMarker(${sel}, ${JSON.stringify(tk)})`).catch(() => false))) { log.warn(`[${c.name}] 没找到第 ${n} 张配图的位置，跳过`); continue; }
            await sleep(jitter(300, 600), ctx.signal);
            clipboard.writeImage(img);
            win.webContents.paste();
            await sleep(jitter(2500, 3500), ctx.signal); // 等平台上传完
          }
          // 没替换掉的占位符删掉
          for (let i = 1; i <= imgCount; i++) {
            for (let tries = 0; tries < 3; tries++) {
              if (!(await js(`window.__cai.selectMarker(${sel}, ${JSON.stringify(token(i))})`).catch(() => false))) break;
              win.webContents.delete();
              await sleep(300, ctx.signal);
            }
          }
        } else {
          if (c.html) clipboard.write({ text, html: mdToHtml(IMG.stripImages(content.body)) }); else clipboard.writeText(text);
          win.webContents.paste();
        }
        await sleep(jitter(1500, 2200), ctx.signal);
        const got = await js(`window.__cai.text(${sel})`).catch(() => ({ title: "", body: "" }));
        const titleOk = (g) => String(g.title || "").replace(/\s/g, "").includes(title.replace(/\s/g, "").slice(0, 6));
        if (!titleOk(got)) {
          // 标题被编辑器清掉或没填进去：重新填一次，不行再用 JS 直接写
          log.warn(`[${c.name}] 标题没填进去，重新填一次`);
          await js(`window.__cai.focusTitle(${sel})`).catch(() => false);
          await sleep(jitter(200, 400), ctx.signal);
          win.webContents.insertText(title);
          await sleep(jitter(500, 800), ctx.signal);
          let g2 = await js(`window.__cai.text(${sel})`).catch(() => ({ title: "" }));
          if (!titleOk(g2)) { await js(`window.__cai.setTitle(${sel}, ${JSON.stringify(title)})`).catch(() => false); await sleep(500, ctx.signal); g2 = await js(`window.__cai.text(${sel})`).catch(() => ({ title: "" })); }
          if (!titleOk(g2)) log.warn(`[${c.name}] 标题还是没填进去，请在窗口里手动填：${title}`);
          got.title = g2.title;
        }
        if (String(got.body).replace(/\s/g, "").length < Math.min(20, text.replace(/\s/g, "").length / 3)) throw new Error("正文没有粘贴进去，请在打开的窗口里手动粘贴（内容已在剪贴板）");
        step(75, `已填入：标题 ${title.length} 字，正文约 ${String(got.body).replace(/\s/g, "").length} 字${imgCount ? `，${imgCount} 张配图` : ""}`);

        // 封面：平台有封面设置时，选「单图」→ 打开上传框 → 传图 → 确定。失败不影响存草稿
        const coverPick = coverFile || pics[0] || "";
        if (c.cover && coverPick) {
          step(78, "上传封面");
          try {
            const cv = c.cover;
            if (cv.mode) { await js(`window.__cai.clickText(${JSON.stringify(cv.mode)})`).catch(() => null); await sleep(jitter(500, 900), ctx.signal); }
            let opened = null;
            for (let i = 0; i < 6 && !opened; i++) { opened = await js(`window.__cai.clickSel(${JSON.stringify(cv.open || [])})`).catch(() => null) || await js(`window.__cai.clickText(${JSON.stringify(cv.openTexts || [])})`).catch(() => null); if (!opened) await sleep(500, ctx.signal); }
            if (!opened) throw new Error("没找到添加封面的入口");
            await sleep(jitter(1200, 1800), ctx.signal);
            if (cv.tab) { await js(`window.__cai.clickText(${JSON.stringify(cv.tab)})`).catch(() => null); await sleep(jitter(500, 900), ctx.signal); }
            await uploadFile(win, coverPick, { selector: cv.input || "input[type=file]", last: true });
            let done = null;
            for (let i = 0; i < 30 && !done; i++) { await sleep(800, ctx.signal); done = await js(`window.__cai.clickText(${JSON.stringify(cv.confirm || ["确定"])})`).catch(() => null); }
            if (!done) throw new Error("封面传了，但没找到「确定」按钮");
            await sleep(jitter(1500, 2500), ctx.signal);
            log.info(`[${c.name}] 已设置封面${coverFile ? "" : "（没有单独的封面，用了第一张配图）"}`);
          } catch (err) {
            if (err.message === "已取消") throw err;
            log.warn(`[${c.name}] 封面没设置上：${err.message}，请在窗口里手动上传封面`);
          }
        }

        step(82, "保存到草稿箱");
        await sleep(jitter(800, 1600), ctx.signal);
        const before = await js(`window.__cai.count(${JSON.stringify(c.saved)})`).catch(() => 0);
        const snapBefore = await js(`window.__cai.savedSnap(${JSON.stringify(c.saved)})`).catch(() => "");
        const urlBefore = win.webContents.getURL();
        // 同时看网络：点了保存后，平台的保存/草稿接口返回成功也算保存成功
        let netSaved = false;
        const wcId = win.webContents.id;
        const ses = win.webContents.session;
        const saveRe = c.saveApi || /\/(save|draft|publish|update|article|create)/i;
        const onDone = (d) => { if (d.webContentsId === wcId && d.method === "POST" && d.statusCode < 400 && saveRe.test(d.url)) netSaved = true; };
        try { ses.webRequest.onCompleted(onDone); } catch { /* ignore */ }
        const clicked = await js(`window.__cai.clickText(${JSON.stringify(c.saveTexts)})`);
        if (clicked) log.info(`[${c.name}] 已点击「${clicked}」`);
        else log.info(`[${c.name}] 没找到存草稿按钮，等待编辑页自动保存`);
        let saved = false;
        for (let i = 0; i < 30; i++) {
          await sleep(500, ctx.signal);
          const n = await js(`window.__cai.count(${JSON.stringify(c.saved)})`).catch(() => before);
          const urlNow = alive(win) ? win.webContents.getURL() : urlBefore;
          const snap = n > 0 ? await js(`window.__cai.savedSnap(${JSON.stringify(c.saved)})`).catch(() => snapBefore) : snapBefore;
          if (n > before || (n > 0 && snap !== snapBefore) || (clicked && netSaved && i >= 1) || (clicked && urlNow !== urlBefore && !P.isLoginUrl(pf, urlNow))) { saved = true; break; }
        }
        try { ses.webRequest.onCompleted(null); } catch { /* ignore */ }
        lastPush.set(pf, Date.now());
        const draftsUrl = P.needsToken(c.drafts) ? P.fillUrl(c.drafts, { token: P.tokenOf(pf, editorUrl) }) : c.drafts;
        if (saved) {
          record(content.id, pf, { status: "saved", url: draftsUrl, error: "", ...who });
          step(100, `已存入${c.name}草稿箱`);
          ok = true;
          return { status: "saved", platform: pf };
        }
        record(content.id, pf, { status: "unknown", url: draftsUrl, error: "没等到保存成功的提示", ...who });
        log.warn(`[${c.name}] 内容已填好，但没确认到保存成功，请在打开的窗口里看一下，必要时手动点「${c.saveTexts[0]}」`);
        step(100, "已填好，请在窗口里确认是否保存");
        if (alive(win) && !win.isVisible()) win.show();
        return { status: "unknown", platform: pf };
      } catch (err) {
        const shot = await screenshot(win, content.id);
        record(content.id, pf, { status: "failed", url: "", error: err.message, ...who });
        log.error(`[${c.name}] 推送失败：${err.message}${shot ? `（截图：${shot}）` : ""}`);
        if (alive(win) && err.message !== "已取消") win.show(); else if (alive(win)) win.close();
        throw err;
      } finally {
        // 还原用户的剪贴板
        try { if (savedClip.html) clipboard.write({ text: savedClip.text, html: savedClip.html }); else clipboard.writeText(savedClip.text); } catch { /* ignore */ }
        if (ok && alive(win) && !settings.get("pushKeepOpen")) setTimeout(() => { if (alive(win)) win.close(); }, 1500);
      }
    });
  }

  tasks.register("publish:push", {
    title: "推送到草稿箱",
    async handler(p = {}, ctx) {
      try { return await push(p.contentId, ctx, { platformAccountId: p.platformAccountId, force: !!p.force }); }
      catch (err) {
        // 还没进入推送流程就失败（没登录、没选号、需改写）：也记一条失败，工作台「待处理」能看到
        const c = store.contents.get(String(p.contentId || ""));
        if (c && !(c.pushes && c.pushes[c.platform] && c.pushes[c.platform].at > Date.now() - 5000) && err.message !== "已取消") {
          record(c.id, c.platform, { status: "failed", url: "", error: err.message });
        }
        throw err;
      }
    },
  });

  // ---------- 账号数据（0.5.4）：后台窗口打开创作者后台首页，读粉丝 / 阅读 / 收益 ----------
  // 一次只开一个窗口，一个号一个号读；读失败保留上次的数字，只记下错误
  // 0.5.5：同时听后台接口返回的 JSON（百家号等数据是异步接口加载的，页面文字里常常找不到），页面文字读到的优先
  function sniffJson(win, host) {
    const bodies = [];
    const dbg = win.webContents.debugger;
    const reqs = new Map();
    let attached = false;
    try { if (!dbg.isAttached()) { dbg.attach("1.3"); attached = true; } } catch { return { bodies, stop() {} }; }
    const onMsg = (_e, method, params) => {
      if (method === "Network.responseReceived") {
        const r = params.response || {};
        if (!/json|javascript|text\/plain/i.test(r.mimeType || "")) return;
        if (!["XHR", "Fetch"].includes(params.type)) return;
        try { if (host && !new URL(r.url).hostname.endsWith(host)) return; } catch { return; }
        reqs.set(params.requestId, r.url);
      } else if (method === "Network.loadingFinished" && reqs.has(params.requestId) && bodies.length < 80) {
        const url = reqs.get(params.requestId);
        reqs.delete(params.requestId);
        dbg.sendCommand("Network.getResponseBody", { requestId: params.requestId }).then((b) => {
          if (!b || b.base64Encoded || !b.body || b.body.length > 400000) return;
          const t = b.body.trim().replace(/^[\w$.]+\(([\s\S]*)\);?$/, "$1"); // jsonp
          try { bodies.push({ url, json: JSON.parse(t) }); } catch { /* 不是 JSON */ }
        }).catch(() => {});
      }
    };
    dbg.on("message", onMsg);
    dbg.sendCommand("Network.enable").catch(() => {});
    return { bodies, stop() { try { dbg.removeListener("message", onMsg); if (attached) dbg.detach(); } catch { /* ignore */ } } };
  }
  async function pageText(win) {
    // 主页面 + 所有 iframe 的文字（有的后台数据区在 iframe 里）
    const frames = (() => { try { return win.webContents.mainFrame.framesInSubtree; } catch { return []; } })();
    const parts = [];
    for (const f of frames.length ? frames : [win.webContents]) {
      const t = await f.executeJavaScript("document.body ? document.body.innerText : ''", true).catch(() => "");
      if (t) parts.push(t);
    }
    return parts.join("\n");
  }
  async function readStats(a, signal) {
    const c = cfgOf(a.platform);
    const sc = c.stats || {};
    const win = openWindow({ partition: a.partition, title: `读取账号数据 · ${a.name}`, show: false });
    let host = "";
    try { host = new URL(c.home).hostname.split(".").slice(-2).join("."); } catch { /* ignore */ }
    const sniff = sniffJson(win, host);
    let text = "", r = null;
    try {
      win.webContents.setAudioMuted(true);
      const url = await resolveUrl(win, a.platform, sc.url || c.home, signal);
      await load(win, url);
      for (let i = 0; i < 40; i++) {
        await sleep(i ? 600 : 1500, signal);
        if (!alive(win)) throw new Error("窗口被关掉了");
        if (P.isLoginUrl(a.platform, win.webContents.getURL())) throw new Error("登录已失效，请到 设置 → 平台账号 重新登录");
        text = await pageText(win);
        r = ST.mergeStats(ST.parseStats(text, sc), ST.statsFromJson(sniff.bodies.map((b) => b.json)));
        // 数据区常常是先出标签、数字后到：再等一下让数字渲染出来
        if (r.found >= 3 || (r.found >= 2 && i >= 4) || (r.found && i >= 12)) break;
      }
      if (!r || !r.found) {
        const j = ST.statsFromJson(sniff.bodies.map((b) => b.json));
        const snippet = String(text || "").replace(/\s*\n\s*/g, " | ").slice(0, 400);
        log.warn(`${c.name}「${a.name}」账号数据没读到，页面 ${alive(win) ? win.webContents.getURL() : ""}；页面文字：${snippet || "（空）"}；接口 ${sniff.bodies.length} 个，字段：${j.keys.join(", ").slice(0, 400) || "（无）"}`);
        throw new Error("页面上没找到粉丝 / 阅读 / 收益，可能平台改版了");
      }
      if (Object.values(r.from).includes("api")) log.info(`${c.name}「${a.name}」部分数据来自后台接口：${Object.entries(r.from).filter(([, v]) => v === "api").map(([k]) => k).join("、")}`);
      return r;
    } finally { sniff.stop(); if (alive(win)) win.destroy(); }
  }
  let statsRunning = false;
  async function refreshStats({ force = false, ids = null } = {}, ctx = null) {
    if (statsRunning) return { ok: false, busy: true };
    statsRunning = true;
    broadcast("publish:stats", { running: true });
    const done = { ok: 0, failed: 0, skipped: 0 };
    try {
      const list = (await listAccounts()).filter((a) => a.loggedIn && (!ids || ids.includes(a.id)));
      const todo = list.filter((a) => force || ST.isStale(a.stats));
      done.skipped = list.length - todo.length;
      for (let i = 0; i < todo.length; i++) {
        const a = todo[i];
        if (ctx && ctx.signal && ctx.signal.aborted) throw new Error("已取消");
        const name = `${cfgOf(a.platform).name}「${a.name}」`;
        if (ctx) ctx.progress(Math.round((i / todo.length) * 100), `读取${name}的账号数据`);
        const prev = ST.statsOf(a.stats);
        try {
          const r = await readStats(a, ctx && ctx.signal);
          // 这次没读到的指标沿用上次的
          const next = { fans: r.fans != null ? r.fans : prev.fans, reads: r.reads != null ? r.reads : prev.reads, income: r.income != null ? r.income : prev.income, at: Date.now(), tried: Date.now(), error: "" };
          // 0.5.5：每天留一份快照，算本日 / 本周 / 本月增长
          let hist = a.history;
          // 测试用：E2E 里给还没有快照的号预先填几天历史，好看增长图
          if (process.env.CAI_E2E_STATS_HISTORY && !(hist && hist.length)) {
            try { hist = JSON.parse(process.env.CAI_E2E_STATS_HISTORY).map((x) => ({ d: ST.dayKey(Date.now() - x.daysAgo * 864e5), fans: x.fans, reads: x.reads, income: x.income })); } catch { hist = []; }
          }
          store.platformAccounts.upsert({ id: a.id, stats: next, history: ST.pushHistory(hist, next) });
          done.ok++;
          log.info(`${name}：粉丝 ${r.fans ?? "—"}，阅读 ${r.reads ?? "—"}，收益 ${r.income ?? "—"}`);
        } catch (err) {
          if (err.message === "已取消") throw err;
          store.platformAccounts.upsert({ id: a.id, stats: { ...prev, tried: Date.now(), error: err.message } });
          if (/登录已失效/.test(err.message)) store.platformAccounts.upsert({ id: a.id, loggedIn: false, checkedAt: Date.now() });
          done.failed++;
          log.warn(`${name}账号数据读取失败：${err.message}`);
        }
        broadcast("publish:stats", { id: a.id });
      }
      if (ctx) ctx.progress(100, todo.length ? `读完 ${todo.length} 个号${done.failed ? `，${done.failed} 个失败` : ""}` : "都是最新的，不用重读");
      return { ok: true, ...done };
    } finally {
      statsRunning = false;
      broadcast("publish:stats", { running: false });
    }
  }
  async function statsSummary() {
    const list = (await listAccounts()).filter((a) => a.loggedIn || ST.statsOf(a.stats).at);
    const rows = list.map((a) => ({ id: a.id, platform: a.platform, name: a.name, loggedIn: a.loggedIn, stats: ST.statsOf(a.stats), history: ST.historyOf(a.history) }));
    const now = Date.now();
    // 0.5.5 增长：本日（近 7 天柱状，今天在最后）/ 本周 / 本月
    const g3 = (list) => ({ day: ST.growthOf(list, "day", now), week: ST.growthOf(list, "week", now), month: ST.growthOf(list, "month", now) });
    // 0.5.6：工作台按单个号看增长（growth 合计保留给接口 / 测试用）
    const accounts = rows.map(({ history, ...x }) => ({ ...x, growth: g3([{ loggedIn: true, history }]) }));
    return { accounts, totals: ST.totalsOf(rows), growth: g3(rows), running: statsRunning };
  }
  // 自动读：启动 delay 后读一次，之后每 checkEvery 检查一次，超过 12 小时没更新的号重读
  let statsTimers = [];
  function startStats({ delay = 120000, checkEvery = 30 * 60000 } = {}) {
    // 不是强制读时，先看有没有过期的号，没有就不建任务（免得每半小时弹一次「完成」）
    const run = async (force) => {
      if (statsRunning) return;
      try {
        if (!force && !(await listAccounts()).some((a) => a.loggedIn && ST.isStale(a.stats))) return;
        if (force && !(await listAccounts()).some((a) => a.loggedIn)) return;
        tasks.run("publish:stats", { force }, { title: "读取账号数据" });
      } catch (err) { log.warn("自动读取账号数据失败：" + err.message); }
    };
    statsTimers.push(setTimeout(() => run(true), delay));
    statsTimers.push(setInterval(() => run(false), checkEvery));
  }
  function stopStats() { for (const t of statsTimers) { clearTimeout(t); clearInterval(t); } statsTimers = []; }
  tasks.register("publish:stats", {
    title: "读取账号数据",
    single: true,
    handler: (p = {}, ctx) => refreshStats({ force: !!p.force, ids: Array.isArray(p.ids) ? p.ids.map(String) : null }, ctx),
  });

  // ---------- IPC ----------
  const h = (ch, fn) => ipcMain.handle(ch, async (_e, ...args) => {
    try { return await fn(...args); } catch (err) { log.warn(`${ch} 失败：${err.message}`); return { ok: false, error: err.message }; }
  });
  h("publish:meta", () => P.PUBLISH_IDS.map((id) => ({ id, name: P.PUBLISH_PLATFORMS[id].name, mode: P.PUBLISH_PLATFORMS[id].mode })));
  h("publish:accounts", (platform) => listAccounts(platform ? String(platform) : ""));
  h("publish:add", (pf) => addAccount(String(pf)));
  h("publish:relogin", (id) => relogin(String(id)));
  h("publish:update", (id, patch) => updateAccount(String(id), patch && typeof patch === "object" ? patch : {}));
  h("publish:remove", (id) => removeAccount(String(id)));
  h("publish:open", (id, which) => open(String(id), ["drafts", "home", "editor"].includes(which) ? which : "drafts"));
  // 默认用哪个号推（给创作页显示）：返回 { id, name } 或 { error }
  h("publish:defaultFor", async (pf, opAccountId) => {
    try { const a = await resolveAccount(String(pf), String(opAccountId || settings.get("currentAccount"))); return { id: a.id, name: a.name }; }
    catch (err) { return { id: "", error: err.message }; }
  });
  // 用户手动确认/清除推送状态：status = "saved" 标记已存草稿；"clear" 清掉这条记录
  h("publish:mark", (contentId, status) => {
    const c = store.contents.get(String(contentId || ""));
    if (!c || !c.pushes || !c.pushes[c.platform]) return { ok: false };
    if (status === "clear") {
      const pushes = { ...c.pushes }; delete pushes[c.platform];
      store.contents.upsert({ id: c.id, pushes });
      broadcast("publish:changed", { contentId: c.id, platform: c.platform, status: "" });
    } else record(c.id, c.platform, { ...c.pushes[c.platform], status: "saved", error: "" });
    return { ok: true };
  });
  h("publish:openFor", async (contentId) => {
    const c = store.contents.get(String(contentId));
    if (!c) throw new Error("找不到这篇内容");
    const rec = c.pushes && c.pushes[c.platform];
    const pa = rec && rec.accountId && store.platformAccounts.get(rec.accountId) ? store.platformAccounts.get(rec.accountId) : await resolveAccount(c.platform, c.accountId, c.platformAccountId);
    return open(pa.id, "drafts");
  });
  h("publish:stats", () => statsSummary());
  h("publish:refreshStats", () => {
    if (statsRunning) return { ok: false, busy: true, error: "正在读取，等这一轮结束" };
    return { ok: true, task: tasks.run("publish:stats", { force: true }, { title: "读取账号数据" }) };
  });
  h("publish:shots", () => { try { electron.shell.openPath(shotDir); } catch { /* ignore */ } return true; });

  // 推送没开始就失败（没登录、没选号）也记一条，工作台「待处理」能看到
  function recordFail(contentId, error) {
    const c = store.contents.get(String(contentId || ""));
    if (c) record(c.id, c.platform, { status: "failed", url: "", error: String(error || "推送失败") });
  }
  return { recordFail, refreshStats, statsSummary, startStats, stopStats, readStats, listAccounts, resolveAccount, migrate, addAccount, relogin, updateAccount, removeAccount, open, push, clearAccount, makeCover, nativeImage, partitionLoggedIn };
}

module.exports = { createPublisher, HELPERS };
