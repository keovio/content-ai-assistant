"use strict";
// 找爆款 / 读正文（主进程）：在看不见的后台窗口里打开平台的搜索页和文章页，像人一样看页面、抠出标题和正文。
// 不调用平台私有接口，不需要账号（小红书 / 抖音网页版搜索要登录：用「登录网页版」在独立登录空间里扫码）。
//
//   const d = createDiscover({ electron, logger, store, fetchImpl })
//   await d.search({ platform, keyword, days, signal, onStep })  → { items, hidden, total, url }
//   await d.read(url, { referer, signal })                        → { title, body, author, publishedAt, url, canonicalUrl }
//   await d.hot()                                                 → { toutiao: [...], baidu: [...], at }
const S = require("./sources");
const U = require("./utils");
const { cleanUserAgent } = require("../publish/platforms");

const TIMEOUT_MS = 25000;
const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const t = setTimeout(resolve, ms);
  if (signal) signal.addEventListener("abort", () => { clearTimeout(t); reject(new Error("已取消")); }, { once: true });
});

function createDiscover({ electron, logger, store, fetchImpl, iconPath }) {
  const { BrowserWindow, session } = electron;
  const log = logger.scope("discover");
  const prepared = new Set();
  const warmed = new Map(); // partition|url → 时间
  let hotCache = null;

  const srcOf = (pf) => { const s = S.SOURCES[pf]; if (!s) throw new Error("不支持的平台：" + pf); return s; };
  const partitionOf = (pf) => (srcOf(pf).needsLogin ? `persist:discover-${pf}` : "persist:discover");
  function sessionFor(part) {
    const ses = session.fromPartition(part);
    if (!prepared.has(part)) {
      prepared.add(part);
      ses.setUserAgent(cleanUserAgent(ses.getUserAgent()));
      ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
    }
    return ses;
  }
  const alive = (w) => w && !w.isDestroyed();

  function makeWindow(partition, { show = false, title = "" } = {}) {
    sessionFor(partition);
    const win = new BrowserWindow({
      width: 1280, height: 900, show, title: title || "找爆款", icon: iconPath, autoHideMenuBar: true,
      webPreferences: { partition, contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false, backgroundThrottling: false },
    });
    win.webContents.setAudioMuted(true);
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.on("page-title-updated", (e) => { if (title) e.preventDefault(); });
    return win;
  }
  async function load(win, url, referrer) {
    let t;
    const p = win.loadURL(url, referrer ? { httpReferrer: referrer } : {}).catch((err) => { if (!/ERR_ABORTED|\(-3\)/.test(String(err && err.message))) throw err; });
    try {
      await Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`打开页面超时（${TIMEOUT_MS / 1000} 秒）`)), TIMEOUT_MS); })]);
    } finally { clearTimeout(t); }
  }
  const js = (win, code) => win.webContents.executeJavaScript(code, true);
  const isBlockedUrl = (u) => /antispider|captcha|wappass\.baidu\.com|verify\.|\/sec_verify|security-check/i.test(String(u || ""));

  // 遇到安全验证：交互模式下把窗口亮出来让用户手动过验证（最多等 90 秒），自动模式直接报错
  async function handleBlock(win, name, { interactive, signal }) {
    if (!interactive) throw new Error(`${name}触发了安全验证（验证码），这次先跳过，稍后再试`);
    log.warn(`${name}弹出了安全验证，请在打开的窗口里手动完成验证`);
    win.setTitle(`${name}需要验证：完成后会自动继续`);
    win.show();
    for (let i = 0; i < 90; i++) {
      await sleep(1000, signal);
      if (!alive(win)) throw new Error(`${name}的验证窗口被关掉了`);
      if (!isBlockedUrl(win.webContents.getURL())) { await sleep(1500, signal); win.hide(); return; }
    }
    throw new Error(`${name}的安全验证没有完成`);
  }

  async function warmup(win, partition, url, signal) {
    if (!url) return;
    const key = partition + "|" + url;
    if (Date.now() - (warmed.get(key) || 0) < 30 * 60000) return;
    try { await load(win, url); await sleep(1200, signal); warmed.set(key, Date.now()); } catch (err) { log.debug(`预热 ${url} 失败：${err.message}`); }
  }

  // ---------------- 搜索 ----------------
  async function search({ platform, keyword, days = 3, signal, onStep = () => {}, interactive = true, limit = 40, maxPages = 0, topics = 3 } = {}) {
    const src = srcOf(platform);
    const kw = String(keyword || "").trim();
    if (!kw) return searchHot({ platform, days, signal, onStep, interactive, limit, topics });
    const partition = partitionOf(platform);
    if (src.needsLogin && !(await webLoggedIn(platform))) throw new Error(`${src.name}的网页版搜索需要先登录：点「登录${src.name}网页版」扫码登录`);
    const win = makeWindow(partition, { title: `搜索${src.name}：${kw}` });
    const raw = [];
    let firstUrl = "";
    try {
      onStep(`打开${src.via || src.name}`);
      await warmup(win, partition, src.warmup, signal);
      for (let page = 1; page <= (maxPages ? Math.min(maxPages, src.pages || 1) : (src.pages || 1)); page++) {
        const url = src.searchUrl(kw, { days: Number(days) || 0, page });
        if (!firstUrl) firstUrl = url;
        onStep(`搜索「${kw}」第 ${page} 页`);
        await load(win, url, page > 1 ? firstUrl : "");
        if (isBlockedUrl(win.webContents.getURL())) { await handleBlock(win, src.name, { interactive, signal }); await load(win, url); }
        let got = [];
        for (let i = 0; i < 20; i++) {
          if (signal && signal.aborted) throw new Error("已取消");
          got = await js(win, `(() => { ${S.PAGE_HELPERS}; try { return ${src.extract}; } catch (e) { return []; } })()`).catch(() => []);
          if (Array.isArray(got) && got.length) break;
          await sleep(600, signal);
          // 小红书 / 抖音是滚动加载：往下滚一点
          if (i % 4 === 3) await js(win, "window.scrollBy(0, 800)").catch(() => {});
        }
        // 第一页偶尔是空的（反爬 / 加载慢）：隔一会儿重新打开一次
        if (page === 1 && (!got || !got.length)) {
          onStep("没有搜到，稍等重试一次");
          await sleep(2500, signal);
          await load(win, url);
          for (let i = 0; i < 12 && !(got && got.length); i++) {
            await sleep(700, signal);
            got = await js(win, `(() => { ${S.PAGE_HELPERS}; try { return ${src.extract}; } catch (e) { return []; } })()`).catch(() => []);
          }
        }
        log.debug(`[${src.name}] 第 ${page} 页抓到 ${got.length} 条`);
        for (const r of got || []) raw.push({ ...r, referer: url });
        if (!got || !got.length) break;
        if (raw.length >= limit * 2) break;
        await sleep(800 + Math.random() * 1200, signal);
      }
    } finally { if (alive(win)) win.destroy(); }

    const now = Date.now();
    let items = raw.map((r) => ({ ...U.normalizeItem(r, platform, now), referer: r.referer })).filter((x) => x.title && x.url);
    if (src.filterUrl) {
      const own = items.filter((x) => src.filterUrl.test(x.url));
      if (own.length) items = own;
    }
    items = U.dedupe(items).filter((x) => U.withinDays(x.publishedAt, days, now));
    const total = items.length;
    const idx = U.createDedupIndex(store.breakdowns.list());
    const fresh = items.filter((x) => !idx.has(x));
    const sorted = U.sortByHeat(fresh).slice(0, limit);
    log.info(`[${src.name}] 「${kw}」近 ${Number(days) || "不限"}${Number(days) ? " 天" : ""}找到 ${total} 篇，拆过的 ${total - fresh.length} 篇已隐藏`);
    return { items: sorted, hidden: total - fresh.length, total, url: firstUrl };
  }

  // ---------------- 读正文 ----------------
  async function read(url, { referer = "", signal, interactive = true, platform = "" } = {}) {
    const u = String(url || "").trim();
    if (!/^https?:\/\//.test(u)) throw new Error("链接格式不对，要以 http:// 或 https:// 开头");
    const pf = platform && S.SOURCES[platform] ? platform : guessPlatform(u);
    const partition = pf && S.SOURCES[pf] && S.SOURCES[pf].needsLogin ? partitionOf(pf) : "persist:discover";
    const win = makeWindow(partition, { title: "读取正文" });
    try {
      // 搜狗的跳转链接要先有搜索页的 cookie
      if (/weixin\.sogou\.com\/link/.test(u)) await warmup(win, partition, referer || S.SOURCES.wechat.warmup, signal);
      await load(win, u, referer);
      let r = null;
      for (let i = 0; i < 25; i++) {
        if (signal && signal.aborted) throw new Error("已取消");
        if (isBlockedUrl(win.webContents.getURL())) { await handleBlock(win, "文章页", { interactive, signal }); continue; }
        r = await js(win, S.READER_JS).catch(() => null);
        if (r && r.blocked) { await handleBlock(win, "文章页", { interactive, signal }); continue; }
        if (r && r.body && r.body.replace(/\s/g, "").length > 80) break;
        await sleep(600, signal);
      }
      if (!r || !r.body || r.body.replace(/\s/g, "").length < 30) throw new Error("没读到正文：页面可能需要登录、已删除，或者不是文章页");
      const canonical = /^https?:\/\//.test(r.canonical || "") ? r.canonical : win.webContents.getURL();
      return {
        url: u, canonicalUrl: canonical, platform: pf || "other",
        title: String(r.title || "").trim().slice(0, 200), author: String(r.author || "").trim().slice(0, 60),
        publishedAt: U.parseTime(r.time), body: String(r.body || "").slice(0, 30000),
      };
    } finally { if (alive(win)) win.destroy(); }
  }

  function guessPlatform(url) {
    const s = String(url);
    if (/mp\.weixin\.qq\.com|weixin\.sogou\.com/.test(s)) return "wechat";
    if (/toutiao\.com/.test(s)) return "toutiao";
    if (/baijiahao\.baidu\.com|mbd\.baidu\.com/.test(s)) return "baijiahao";
    if (/xiaohongshu\.com|xhslink\.com/.test(s)) return "xiaohongshu";
    if (/douyin\.com/.test(s)) return "douyin";
    return "";
  }

  // ---------------- 小红书 / 抖音网页版登录 ----------------
  async function webLoggedIn(pf) {
    const src = srcOf(pf);
    if (!src.needsLogin) return true;
    try {
      const cookies = await sessionFor(partitionOf(pf)).cookies.get({ url: src.cookieUrl });
      const names = new Set(cookies.map((c) => c.name));
      return (src.loginCookies || []).some((n) => names.has(n));
    } catch { return false; }
  }
  async function webLogin(pf) {
    const src = srcOf(pf);
    if (!src.needsLogin) return { loggedIn: true };
    const win = makeWindow(partitionOf(pf), { show: true, title: `登录${src.name}网页版（用于找爆款）` });
    log.info(`打开${src.name}网页版登录页，请扫码登录（只用于搜索爆款）`);
    await load(win, src.loginUrl).catch(() => {});
    return new Promise((resolve) => {
      let done = false;
      const finish = async () => { if (done) return; done = true; clearInterval(timer); const on = await webLoggedIn(pf); if (on) log.info(`${src.name}网页版已登录`); resolve({ loggedIn: on }); };
      const timer = setInterval(async () => {
        if (!alive(win)) return finish();
        if (await webLoggedIn(pf)) { setTimeout(() => { if (alive(win)) win.close(); }, 1500); finish(); }
      }, 1500);
      win.on("closed", finish);
    });
  }

  // 没填关键词：拿今日热点里最火的几个话题去这个平台搜，合并后按热度挑最火的
  async function searchHot({ platform, days, signal, onStep = () => {}, interactive, limit = 40, topics = 3 } = {}) {
    const src = srcOf(platform);
    onStep("没填关键词：取今日热点");
    const h = await hot();
    const kws = U.pickHotTopics(h, Math.max(1, Math.min(8, Number(topics) || 3)));
    if (!kws.length) throw new Error("没填关键词，今日热点也没取到：填个关键词再试");
    log.info(`[${src.name}] 没填关键词，按今日热点找最火的：${kws.join("、")}`);
    let all = [], hidden = 0, total = 0, firstUrl = "";
    for (const kw of kws) {
      if (signal && signal.aborted) throw new Error("已取消");
      try {
        const r = await search({ platform, keyword: kw, days, signal, onStep, interactive, limit, maxPages: 1 });
        all = all.concat(r.items.map((x) => ({ ...x, keyword: kw })));
        hidden += r.hidden; total += r.total; if (!firstUrl) firstUrl = r.url;
      } catch (err) {
        if (signal && signal.aborted) throw err;
        if (/登录/.test(err.message)) throw err;
        log.warn(`[${src.name}] 热点「${kw}」没搜到：${err.message}`);
      }
      await sleep(600 + Math.random() * 800, signal);
    }
    const items = U.sortByHeat(U.dedupe(all)).slice(0, limit);
    return { items, hidden, total, url: firstUrl, hotTopics: kws };
  }

  // ---------------- 今日热点 ----------------
  async function hot({ force = false } = {}) {
    if (!force && hotCache && Date.now() - hotCache.at < 20 * 60000) return hotCache;
    const get = async (url) => {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 15000);
      try {
        const r = await fetchImpl(url, { signal: ctl.signal, headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36", Accept: "application/json" } });
        if (!r.ok) throw new Error("HTTP " + r.status);
        return await r.json();
      } finally { clearTimeout(t); }
    };
    const out = { at: Date.now(), toutiao: [], baidu: [], errors: [] };
    await Promise.all([
      get(S.HOT_SOURCES.toutiao.url).then((j) => { out.toutiao = S.parseToutiaoHot(j); }).catch((e) => out.errors.push(`头条热榜：${e.message}`)),
      get(S.HOT_SOURCES.baidu.url).then((j) => { out.baidu = S.parseBaiduHot(j); }).catch((e) => out.errors.push(`百度热搜：${e.message}`)),
    ]);
    if (out.errors.length) log.warn("今日热点部分没取到：" + out.errors.join("；"));
    if (out.toutiao.length || out.baidu.length) hotCache = out;
    return out;
  }

  function meta() {
    return S.SOURCE_IDS.map((id) => ({ id, name: S.SOURCES[id].name, via: S.SOURCES[id].via, needsLogin: !!S.SOURCES[id].needsLogin, verified: !!S.SOURCES[id].verified }));
  }

  return { search, read, hot, webLogin, webLoggedIn, meta, guessPlatform };
}

module.exports = { createDiscover };
