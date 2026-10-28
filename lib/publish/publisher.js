"use strict";
// 平台登录 + 打开后台 / 草稿箱 + 自动存草稿（主进程）。
//
// 每个「运营账号 × 平台」一个独立的持久登录空间（partition），用户在弹出的官方登录页里自己扫码 / 短信登录，
// 应用不碰密码。推送时打开平台编辑页，填标题、粘贴正文（富文本走剪贴板粘贴，最接近人工操作）、需要时上传封面，
// 然后只点「存草稿」——永远不点发布。每一步都写日志（模块名 publish），失败时截图并把窗口留给用户处理。
//
//   const pub = createPublisher({ electron, logger, settings, tasks, store, broadcast, dataDir, iconPath })
//   IPC：publish:meta / status / login / logout / open / openFor；后台任务 publish:push { contentId }
const path = require("path");
const fs = require("fs");
const P = require("./platforms");
const { mdToHtml, mdToText, escapeHtml } = require("./markdown");

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
    count(texts) { const s = document.body ? document.body.innerText : ""; let n = 0; for (const t of texts || []) n += s.split(t).length - 1; return n; },
  };
})()`;

function createPublisher({ electron, logger, settings, tasks, store, broadcast, dataDir, iconPath }) {
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
  function sessionFor(accountId, pf) {
    const part = P.partitionOf(accountId, pf);
    const ses = session.fromPartition(part);
    if (!prepared.has(part)) {
      prepared.add(part);
      ses.setUserAgent(P.cleanUserAgent(ses.getUserAgent()));
      ses.setPermissionRequestHandler((_wc, perm, cb) => cb(["clipboard-read", "clipboard-sanitized-write", "fullscreen"].includes(perm)));
    }
    return ses;
  }

  async function status(accountId, pf) {
    const c = cfgOf(pf);
    try {
      const cookies = await sessionFor(accountId, pf).cookies.get({ url: c.cookieUrl });
      const names = new Set(cookies.map((k) => k.name));
      return { loggedIn: c.cookies.some((n) => names.has(n)) };
    } catch (err) { return { loggedIn: false, error: err.message }; }
  }
  async function statusAll(accountId) {
    const out = {};
    for (const pf of P.PUBLISH_IDS) out[pf] = await status(accountId, pf);
    return out;
  }

  function openWindow({ accountId, pf, title, show = true }) {
    const partition = P.partitionOf(accountId, pf);
    sessionFor(accountId, pf);
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
  const accName = (id) => (store.accounts.get(id) || {}).name || "账号";

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
  async function login(accountId, pf) {
    const c = cfgOf(pf);
    const key = `${accountId}:${pf}`;
    if (loginWins.has(key) && alive(loginWins.get(key))) { loginWins.get(key).focus(); return { pending: true }; }
    const win = openWindow({ accountId, pf, title: `登录${c.name} · ${accName(accountId)}` });
    loginWins.set(key, win);
    log.info(`打开${c.name}登录页（${accName(accountId)}），请在弹出的窗口里扫码或用短信登录`);
    await load(win, c.login);
    return new Promise((resolve) => {
      let done = false;
      const finish = (r) => { if (done) return; done = true; clearInterval(timer); loginWins.delete(key); broadcast("publish:status", { accountId, platform: pf, ...r }); resolve(r); };
      const timer = setInterval(async () => {
        if (!alive(win)) { finish(await status(accountId, pf)); return; }
        const st = await status(accountId, pf);
        if (st.loggedIn && !P.isLoginUrl(pf, win.webContents.getURL())) {
          log.info(`${c.name}登录成功（${accName(accountId)}）`);
          setTimeout(() => { if (alive(win)) win.close(); }, 1200);
          finish(st);
        }
      }, 1500);
      win.on("closed", async () => finish(await status(accountId, pf)));
    });
  }
  async function logout(accountId, pf) {
    const ses = sessionFor(accountId, pf);
    await ses.clearStorageData();
    await ses.clearCache();
    log.info(`已退出${cfgOf(pf).name}（${accName(accountId)}）`);
    broadcast("publish:status", { accountId, platform: pf, loggedIn: false });
    return { ok: true };
  }
  async function clearAccount(accountId) {
    for (const pf of P.PUBLISH_IDS) { try { await sessionFor(accountId, pf).clearStorageData(); } catch { /* ignore */ } }
  }

  // ---------- 打开后台 / 草稿箱 ----------
  async function open(accountId, pf, which = "drafts") {
    const c = cfgOf(pf);
    const win = openWindow({ accountId, pf, title: `${c.name}${which === "drafts" ? "草稿箱" : "后台"} · ${accName(accountId)}` });
    const tpl = which === "drafts" ? c.drafts : which === "editor" ? c.editor : c.home;
    try { await load(win, await resolveUrl(win, pf, tpl)); }
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

  async function uploadFile(win, file) {
    const dbg = win.webContents.debugger;
    let attached = false;
    try {
      if (!dbg.isAttached()) { dbg.attach("1.3"); attached = true; }
      const { root } = await dbg.sendCommand("DOM.getDocument", { depth: -1, pierce: true });
      const { nodeId } = await dbg.sendCommand("DOM.querySelector", { nodeId: root.nodeId, selector: "input[type=file]" });
      if (!nodeId) throw new Error("页面上找不到上传图片的入口");
      await dbg.sendCommand("DOM.setFileInputFiles", { nodeId, files: [file] });
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
  async function push(contentId, ctx) {
    const content = store.contents.get(String(contentId || ""));
    if (!content) throw new Error("找不到这篇内容，先保存再推送");
    const pf = content.platform;
    const c = cfgOf(pf);
    const accountId = content.accountId;
    const acc = store.accounts.get(accountId) || {};
    const step = (pct, msg) => { ctx.progress(pct, msg); log.info(`[${c.name}] ${msg}`); };
    const check = () => { if (ctx.signal && ctx.signal.aborted) throw new Error("已取消"); };
    if (!(content.title || "").trim() && !(content.body || "").trim()) throw new Error("内容是空的");

    step(3, `检查${c.name}登录状态（${acc.name || "账号"}）`);
    if (!(await status(accountId, pf)).loggedIn) throw new Error(`「${acc.name || "当前账号"}」还没登录${c.name}，请到 设置 → 平台账号 先登录`);

    const title = c.maxTitle ? content.title.slice(0, c.maxTitle) : content.title;
    if (c.maxTitle && content.title.length > c.maxTitle) log.warn(`[${c.name}] 标题超过 ${c.maxTitle} 字，已截断：${title}`);
    const text = mdToText(content.body);

    // 抖音口播：脚本是拍摄用的，不是能直接存的内容 → 打开创作页 + 复制脚本
    if (c.mode === "assist") {
      clipboard.writeText((content.title ? content.title + "\n\n" : "") + text);
      step(60, "已复制口播脚本，正在打开抖音创作者中心");
      await open(accountId, pf, "editor");
      record(content.id, pf, { status: "opened", url: c.drafts, error: "" });
      step(100, "已打开抖音创作者中心，脚本在剪贴板里，拍好视频上传时粘贴标题和文案即可");
      return { status: "opened", platform: pf };
    }

    return serial(pf, async () => {
      const wait = (lastPush.get(pf) || 0) + settings.get("pushInterval") * 1000 - Date.now();
      if (wait > 0) { step(5, `同一平台连续推送，等 ${Math.ceil(wait / 1000)} 秒`); await sleep(wait + jitter(300, 1500), ctx.signal); }
      check();
      record(content.id, pf, { status: "pushing", url: "", error: "" });
      const show = settings.get("pushShowWindow");
      const win = openWindow({ accountId, pf, title: `推送到${c.name}草稿箱 · ${acc.name || ""}`, show });
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
          step(20, "生成文字封面图");
          const file = await makeCover(title || "未命名", acc.name, acc.color, c.image);
          step(28, "上传封面图");
          await uploadFile(win, file);
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
        if (c.html) clipboard.write({ text, html: mdToHtml(content.body) }); else clipboard.writeText(text);
        win.webContents.paste();
        await sleep(jitter(1500, 2200), ctx.signal);
        const got = await js(`window.__cai.text(${sel})`).catch(() => ({ title: "", body: "" }));
        if (!String(got.title).includes(title.slice(0, 6))) log.warn(`[${c.name}] 标题可能没填进去，请在窗口里检查`);
        if (String(got.body).replace(/\s/g, "").length < Math.min(20, text.replace(/\s/g, "").length / 3)) throw new Error("正文没有粘贴进去，请在打开的窗口里手动粘贴（内容已在剪贴板）");
        step(75, `已填入：标题 ${title.length} 字，正文约 ${String(got.body).replace(/\s/g, "").length} 字`);

        step(82, "保存到草稿箱");
        await sleep(jitter(800, 1600), ctx.signal);
        const before = await js(`window.__cai.count(${JSON.stringify(c.saved)})`).catch(() => 0);
        const urlBefore = win.webContents.getURL();
        const clicked = await js(`window.__cai.clickText(${JSON.stringify(c.saveTexts)})`);
        if (clicked) log.info(`[${c.name}] 已点击「${clicked}」`);
        else log.info(`[${c.name}] 没找到存草稿按钮，等待编辑页自动保存`);
        let saved = false;
        for (let i = 0; i < 30; i++) {
          await sleep(500, ctx.signal);
          const n = await js(`window.__cai.count(${JSON.stringify(c.saved)})`).catch(() => before);
          const urlNow = alive(win) ? win.webContents.getURL() : urlBefore;
          if (n > before || (clicked && urlNow !== urlBefore && !P.isLoginUrl(pf, urlNow))) { saved = true; break; }
        }
        lastPush.set(pf, Date.now());
        const draftsUrl = P.needsToken(c.drafts) ? P.fillUrl(c.drafts, { token: P.tokenOf(pf, editorUrl) }) : c.drafts;
        if (saved) {
          record(content.id, pf, { status: "saved", url: draftsUrl, error: "" });
          step(100, `已存入${c.name}草稿箱`);
          ok = true;
          return { status: "saved", platform: pf };
        }
        record(content.id, pf, { status: "unknown", url: draftsUrl, error: "没等到保存成功的提示" });
        log.warn(`[${c.name}] 内容已填好，但没确认到保存成功，请在打开的窗口里看一下，必要时手动点「${c.saveTexts[0]}」`);
        step(100, "已填好，请在窗口里确认是否保存");
        if (alive(win) && !win.isVisible()) win.show();
        return { status: "unknown", platform: pf };
      } catch (err) {
        const shot = await screenshot(win, content.id);
        record(content.id, pf, { status: "failed", url: "", error: err.message });
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
    async handler(p = {}, ctx) { return push(p.contentId, ctx); },
  });

  // ---------- IPC ----------
  const h = (ch, fn) => ipcMain.handle(ch, async (_e, ...args) => {
    try { return await fn(...args); } catch (err) { log.warn(`${ch} 失败：${err.message}`); return { ok: false, error: err.message }; }
  });
  h("publish:meta", () => P.PUBLISH_IDS.map((id) => ({ id, name: P.PUBLISH_PLATFORMS[id].name, mode: P.PUBLISH_PLATFORMS[id].mode })));
  h("publish:status", (accountId) => statusAll(String(accountId || settings.get("currentAccount"))));
  h("publish:login", (accountId, pf) => login(String(accountId), String(pf)));
  h("publish:logout", (accountId, pf) => logout(String(accountId), String(pf)));
  h("publish:open", (accountId, pf, which) => open(String(accountId || settings.get("currentAccount")), String(pf), ["drafts", "home", "editor"].includes(which) ? which : "drafts"));
  h("publish:openFor", (contentId) => {
    const c = store.contents.get(String(contentId));
    if (!c) throw new Error("找不到这篇内容");
    return open(c.accountId, c.platform, "drafts");
  });
  h("publish:shots", () => { try { electron.shell.openPath(shotDir); } catch { /* ignore */ } return true; });

  return { status, statusAll, login, logout, open, push, clearAccount, makeCover, nativeImage };
}

module.exports = { createPublisher, HELPERS };
