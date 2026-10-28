"use strict";
// 内容运营的主进程部分：AI 后台任务（选题 / 写稿 / 改写 / 标题 / 润色）+ 本地数据 + AI 配置的 IPC。
// main.js 里一行接入：setupContentIpc({ electron, settings, tasks, logger, dataDir, broadcast, fetchImpl })
const path = require("path");
const COMPLIANCE = require("./compliance");
const fs = require("fs");
const { createAiClient, PROVIDERS, extractJson } = require("./ai-client");
const P = require("./prompts");
const { createStore, stats } = require("./store");
const { createSecrets } = require("./secrets");
const { AUTO_SCHEMA } = require("./automation");
const { overlapRatio } = require("./similarity");
const IMG = require("./images");
const TECH = require("./techniques");
const LIB = require("./library");

// 加进 settings schema 的设置项（AI 模型 + 账号定位）
const CONTENT_SCHEMA = {
  aiProvider: { type: "enum", values: Object.keys(PROVIDERS), default: "deepseek" },
  aiBaseUrl: { type: "string", maxLength: 300, default: PROVIDERS.deepseek.baseUrl },
  aiModel: { type: "string", maxLength: 100, default: PROVIDERS.deepseek.model },
  aiTemperature: { type: "number", min: 0, max: 1.5, step: 0.1, default: 0.7 },
  // 旧版（0.1.x）的单账号定位，0.2.0 起迁移成「运营账号」，这几项只用于迁移
  brandName: { type: "string", maxLength: 60, default: "" },
  brandPositioning: { type: "string", maxLength: 300, default: "" },
  brandAudience: { type: "string", maxLength: 300, default: "" },
  brandTone: { type: "string", maxLength: 200, default: "" },
  defaultPlatform: { type: "enum", values: P.PLATFORM_IDS, default: "wechat" },
  currentAccount: { type: "string", maxLength: 64, default: "" },
  // 各平台写作规范：用户补充的要求，拼进写稿 / 改写提示词
  ...Object.fromEntries(P.PLATFORM_IDS.map((id) => [`rule_${id}`, { type: "string", maxLength: 500, default: "" }])),
  // 推送到平台草稿箱
  pushShowWindow: { type: "bool", default: true },
  pushKeepOpen: { type: "bool", default: false },
  pushInterval: { type: "number", min: 3, max: 120, step: 1, default: 8 },
  // 0.4.1：对标拆解 / 定时自动创作 / 重合度上限 / 平台号迁移标记
  ...AUTO_SCHEMA,
  // 配图（独立的一套生图设置）
  ...IMG.IMAGE_SCHEMA,
  // 写稿时自动从写法库挑几条用上（创作页里也可以手动勾选）
  useTechniques: { type: "bool", default: true },
  techniqueCount: { type: "number", min: 1, max: 8, step: 1, default: 4 },
  // 0.5.0 素材复用：写稿自动引用相关素材；配图先从图片素材里找合适的，生成的图自动收进素材库
  useMaterials: { type: "bool", default: true },
  materialCount: { type: "number", min: 1, max: 8, step: 1, default: 3 },
  imageReuse: { type: "bool", default: true },
  imageCollect: { type: "bool", default: true },
};
// 只能由主进程写的集合（页面只读）
const MAIN_ONLY = new Set(["platformAccounts", "autoRuns"]);

const ACCOUNT_SCOPED = new Set(["contents", "topics"]);

const API_KEY = "aiApiKey";

function setupContentIpc({ electron, settings, tasks, logger, dataDir, broadcast, fetchImpl, onAccountRemoved }) {
  const { ipcMain, safeStorage, clipboard, dialog, BrowserWindow } = electron;
  const log = logger.scope("content");
  const store = createStore(path.join(dataDir, "data"));
  const secrets = createSecrets({
    file: path.join(dataDir, "secrets.json"),
    cipher: safeStorage ? {
      isAvailable: () => { try { return safeStorage.isEncryptionAvailable(); } catch { return false; } },
      encrypt: (s) => safeStorage.encryptString(s),
      decrypt: (b) => safeStorage.decryptString(b),
    } : null,
  });
  const images = IMG.createImageClient({
    fetchImpl, dir: path.join(dataDir, "images"),
    getConfig: () => ({ provider: settings.get("imageProvider"), baseUrl: settings.get("imageBaseUrl"), model: settings.get("imageModel"), apiKey: secrets.get(IMG.IMAGE_KEY) }),
  });
  const ai = createAiClient({
    fetchImpl,
    getConfig: () => ({
      baseUrl: settings.get("aiBaseUrl"), model: settings.get("aiModel"),
      temperature: settings.get("aiTemperature"), apiKey: secrets.get(API_KEY),
    }),
  });
  // ---- 运营账号：首次启动把旧的单账号定位迁移成「默认账号」，旧数据归到它名下 ----
  function ensureAccounts() {
    if (!store.accounts.count()) {
      const a = store.accounts.upsert({
        name: settings.get("brandName") || "默认账号", positioning: settings.get("brandPositioning"),
        audience: settings.get("brandAudience"), tone: settings.get("brandTone"), color: "violet",
      });
      log.info(`已创建运营账号「${a.name}」`);
    }
    const list = store.accounts.list();
    let cur = settings.get("currentAccount");
    if (!list.some((a) => a.id === cur)) { cur = list[list.length - 1].id; settings.set({ currentAccount: cur }); }
    const ids = new Set(list.map((a) => a.id));
    for (const name of ACCOUNT_SCOPED) {
      const n = store[name].patchAll((x) => (ids.has(x.accountId) ? null : { accountId: cur }));
      if (n) log.info(`已把 ${n} 条${name === "contents" ? "内容" : "选题"}归到当前账号`);
    }
    return cur;
  }
  ensureAccounts();
  const currentAccount = () => {
    const id = settings.get("currentAccount");
    return store.accounts.get(id) ? id : ensureAccounts();
  };
  const brand = (accountId) => {
    const a = store.accounts.get(accountId || currentAccount()) || {};
    return { name: a.name, positioning: a.positioning, audience: a.audience, tone: a.tone, banned: a.banned };
  };
  const rules = () => Object.fromEntries(P.PLATFORM_IDS.map((id) => [id, settings.get(`rule_${id}`)]));

  // 流式输出：节流后推给页面（ai:delta），页面按 taskId 对上
  function streamer(ctx) {
    let last = 0, pending = null, timer = null;
    const flush = () => { timer = null; if (pending !== null) { broadcast("ai:delta", { taskId: ctx.id, text: pending }); pending = null; last = Date.now(); } };
    return {
      onDelta: (_piece, all) => {
        pending = all;
        ctx.progress(null, `已生成 ${P.countWords(all)} 字`);
        if (Date.now() - last > 80) flush(); else if (!timer) timer = setTimeout(flush, 80);
      },
      end: () => { if (timer) clearTimeout(timer); flush(); },
    };
  }
  async function streamChat(messages, ctx, opts = {}) {
    const s = streamer(ctx);
    ctx.progress(null, "正在连接 AI…");
    try { return await ai.chat(messages, { ...opts, signal: ctx.signal, onDelta: s.onDelta }); }
    finally { s.end(); }
  }

  // ---------------- AI 后台任务 ----------------
  tasks.register("ai:topics", {
    title: "AI 选题",
    async handler(p = {}, ctx) {
      const acc = { accountId: currentAccount() };
      const avoid = store.topics.list(acc).map((t) => t.title).concat(store.contents.list(acc).map((c) => c.title)).filter(Boolean);
      const r = await streamChat(P.topicsPrompt({ brand: brand(), field: p.field, keywords: p.keywords, platform: p.platform, count: p.count, avoid }), ctx, { temperature: 0.9 });
      const topics = P.normalizeTopics(extractJson(r.text));
      if (!topics.length) {
        const raw = String(r.text || "").replace(/\s+/g, " ").trim();
        log.warn(`AI 选题返回的内容解析不出选题（${raw.length} 字），开头是：${raw.slice(0, 160) || "（空）"}`);
        throw new Error(raw ? "AI 返回的不是选题列表（可能被截断或夹了别的内容），开头已记在日志里；把数量调少一点再试，或换个模型" : "AI 没有返回内容：检查模型名和 API Key 是否可用（设置 → AI 模型 → 测试）");
      }
      return { topics };
    },
  });

  // 写法库：手动勾选的优先；没勾就按选题自动挑（有参考爆款时它自己的写法已经在提示里，别的再补两条）
  const techLibrary = () => TECH.buildLibrary(store.breakdowns.list());
  function techniquesFor(p = {}, ref = null) {
    const lib = techLibrary();
    if (Array.isArray(p.techniqueIds) && p.techniqueIds.length) {
      const want = new Set(p.techniqueIds.map(String));
      return lib.filter((x) => want.has(x.id)).slice(0, 8);
    }
    if (p.techniques === false || !settings.get("useTechniques")) return [];
    const pool = ref ? lib.filter((x) => x.fromId !== ref.id) : lib;
    return TECH.pickTechniques(pool, `${p.topic || ""} ${p.outline || ""}`, ref ? 2 : settings.get("techniqueCount"));
  }

  // 素材：手动勾选的优先；没勾就按选题自动挑相关的
  function materialsFor(p = {}) {
    if (Array.isArray(p.materialIds) && p.materialIds.length) return p.materialIds.map((id) => store.materials.get(String(id))).filter((m) => m && !LIB.isImage(m));
    if (p.materials === false || !settings.get("useMaterials")) return [];
    return LIB.pickMaterials(store.materials.list(), `${p.topic || ""} ${p.outline || ""}`, settings.get("materialCount"));
  }
  // 生成的图收进素材库，方便以后复用
  function collectImage(name, { alt = "", prompt = "", title = "", cover = false } = {}) {
    if (!settings.get("imageCollect") || !name) return;
    try {
      store.materials.upsert({ kind: "image", image: name, title: (cover ? `封面：${title}` : alt || title || "配图").slice(0, 200), content: String(prompt || "").slice(0, 2000), tags: ["AI生成"] });
    } catch (e) { log.warn(`配图收进素材库失败：${e.message}`); }
  }

  // 正文没写标题时补一个（推草稿箱要有标题）
  async function ensureTitle(title, body, platform, ctx) {
    if (String(title || "").trim()) return String(title).trim();
    try {
      const r = await ai.chat(P.titlesPrompt({ brand: brand(), content: body, platform, count: 3 }), { signal: ctx && ctx.signal, temperature: 0.8, stream: false });
      let v = extractJson(r.text);
      if (v && !Array.isArray(v) && typeof v === "object") v = Object.values(v).find((x) => Array.isArray(x)) || [];
      const t = (Array.isArray(v) ? v : []).map((x) => String(typeof x === "string" ? x : (x && x.title) || "").trim()).find(Boolean);
      if (t) { log.info(`正文没写标题，已自动取标题「${t}」`); return t; }
    } catch (e) { if (ctx && ctx.signal && ctx.signal.aborted) throw e; log.warn(`自动取标题失败：${e.message}`); }
    return String(body || "").replace(/[#>*\s]+/g, " ").trim().slice(0, 24) || "未命名";
  }

  // 给一篇稿子配图：AI 按内容写画面描述 → 逐张生图 → 封面存进 cover，文中配图插进正文
  async function illustrate(contentId, ctx, opts = {}) {
    const c = store.contents.get(String(contentId || ""));
    if (!c) throw new Error("找不到这篇内容，先保存再配图");
    if (!secrets.get(IMG.IMAGE_KEY)) throw new Error("还没设置生图的 API Key：设置 → 配图");
    const count = opts.count != null && opts.count !== "" ? Number(opts.count) : settings.get("imageCount");
    const cover = opts.cover != null ? !!opts.cover : settings.get("imageCover");
    const body0 = IMG.stripImages(c.body);
    ctx.progress(5, "AI 正在构思配图");
    const r = await ai.chat(P.imagePromptsPrompt({ title: c.title, body: body0, platform: c.platform, count, cover, style: settings.get("imageStyle") }), { signal: ctx.signal, temperature: 0.7, stream: false });
    const plan = extractJson(r.text) || {};
    let list = (Array.isArray(plan) ? plan : Array.isArray(plan.images) ? plan.images : []).filter((x) => x && x.prompt).slice(0, count >= 0 ? count : 6);
    const style = String(plan.style || settings.get("imageStyle") || "").trim();
    const withStyle = (p) => (style && !p.includes(style) ? `${p}。画风：${style}` : p);
    const shape = IMG.shapeFor(settings.get("imageShape"), c.platform);
    const total = list.length + (cover && plan.cover ? 1 : 0);
    if (!total) { log.info(`「${c.title}」内容较短，AI 判断不需要配图`); return { content: c, count: 0 }; }
    let done = 0, coverName = c.cover || "", failed = 0, reused = 0;
    const made = [];
    // 两张同时生成
    const jobs = [];
    if (cover && plan.cover) jobs.push({ cover: true, prompt: String(plan.cover) });
    for (const x of list) jobs.push({ prompt: String(x.prompt), alt: String(x.alt || "配图"), after: String(x.after || "") });
    // 先从图片素材里找画面相符的，能复用就不再生成
    if (opts.reuse !== false && settings.get("imageReuse")) {
      const pics = store.materials.list().filter(LIB.isImage).filter((m) => images.fileOf(m.image) && fs.existsSync(images.fileOf(m.image)));
      const used = new Set(IMG.imagesIn(c.body).map((x) => x.name).concat(c.cover ? [c.cover] : []));
      for (const j of jobs) {
        const m = LIB.matchImage(pics, { alt: j.cover ? c.title : j.alt, prompt: j.prompt }, used);
        if (!m) continue;
        used.add(m.image); j.reused = m.image; reused++;
        log.info(`复用素材图「${m.title || m.image}」作为${j.cover ? "封面" : `配图「${j.alt}」`}`);
      }
    }
    const queue = jobs.filter((j) => {
      if (!j.reused) return true;
      if (j.cover) coverName = j.reused; else made.push({ ...j, name: j.reused, order: jobs.indexOf(j) });
      done++;
      return false;
    });
    const worker = async () => {
      while (queue.length) {
        const j = queue.shift();
        try {
          const g = await images.generate(withStyle(j.prompt), { shape: j.cover ? "landscape" : shape, signal: ctx.signal });
          if (j.cover) coverName = g.name; else made.push({ ...j, name: g.name, order: jobs.indexOf(j) });
          collectImage(g.name, { alt: j.alt, prompt: j.prompt, title: c.title, cover: !!j.cover });
        } catch (e) {
          if (ctx.signal && ctx.signal.aborted) throw e;
          failed++; log.warn(`生成${j.cover ? "封面" : "配图"}失败：${e.message}`);
          if (failed === 1 && /API Key|余额|接口地址|模型/.test(e.message)) { queue.length = 0; throw e; }
        }
        done++;
        ctx.progress(10 + Math.round((done / jobs.length) * 85), `已生成 ${done}/${jobs.length} 张图`);
      }
    };
    await Promise.all([worker(), worker()]);
    made.sort((a, b) => a.order - b.order);
    const latest = store.contents.get(c.id) || c;
    const body = made.length ? IMG.insertImages(latest.body, made) : latest.body;
    const saved = store.contents.upsert({ id: c.id, body, cover: coverName });
    log.info(`已为「${saved.title}」配图：${made.length} 张文中配图${coverName && coverName !== c.cover ? " + 封面" : ""}${reused ? `，其中 ${reused} 张复用素材库` : ""}${failed ? `（${failed} 张失败）` : ""}`);
    broadcast("data:changed", { what: "contents" });
    if (jobs.length > reused) broadcast("data:changed", { what: "materials" });
    return { content: saved, count: made.length, cover: coverName, failed, reused };
  }

  tasks.register("ai:images", {
    title: "AI 配图",
    async handler(p = {}, ctx) { const r = await illustrate(p.contentId, ctx, { count: p.count, cover: p.cover }); return { contentId: r.content.id, count: r.count, cover: r.cover || "", failed: r.failed || 0, reused: r.reused || 0 }; },
  });

  tasks.register("ai:draft", {
    title: "AI 写稿",
    async handler(p = {}, ctx) {
      const materials = materialsFor(p);
      if (materials.length && !(Array.isArray(p.materialIds) && p.materialIds.length)) log.info(`写稿自动引用 ${materials.length} 条素材：${materials.map((m) => (m.title || m.content || "").slice(0, 12)).join("；")}`);
      const ref = p.refId ? store.breakdowns.get(String(p.refId)) : null;
      const techniques = techniquesFor(p, ref);
      if (techniques.length) log.info(`写稿运用 ${techniques.length} 条写法：${techniques.map((x) => x.text.slice(0, 14)).join("；")}`);
      const r = await streamChat(P.draftPrompt({ brand: brand(p.accountId), rules: rules(), topic: p.topic, platform: p.platform, outline: p.outline, words: p.words, style: p.style, materials, ref, techniques }), ctx);
      if (!r.text.trim()) throw new Error("AI 没有返回内容");
      const st = P.splitTitle(r.text);
      if (p.save && !st.title) st.title = await ensureTitle("", st.body, p.platform, ctx);
      // save：写完直接存成草稿（页面已经离开或去写下一篇了，结果也不会丢）
      let contentId = "";
      if (p.save) {
        const saved = withOverlap(store.contents.upsert({
          id: p.contentId ? String(p.contentId) : undefined, accountId: p.accountId || currentAccount(), title: st.title || String(p.topic || "").slice(0, 60) || "未命名", body: st.body,
          platform: p.platform, status: "draft", topic: String(p.topic || ""), refId: ref ? ref.id : "", tags: [],
        }));
        contentId = saved.id;
        log.info(`已写好「${saved.title}」（${P.PLATFORMS[p.platform] ? P.PLATFORMS[p.platform].name : p.platform}，${P.countWords(st.body)} 字），已存为草稿`);
        broadcast("data:changed", { what: "contents" });
      }
      return { text: r.text, ...st, platform: p.platform, usage: r.usage, contentId };
    },
  });

  tasks.register("ai:rewrite", {
    title: "一稿多发改写",
    async handler(p = {}, ctx) {
      if (!String(p.source || "").trim()) throw new Error("原文是空的");
      const r = await streamChat(P.rewritePrompt({ brand: brand(p.accountId), rules: rules(), source: p.source, platform: p.platform }), ctx);
      if (!r.text.trim()) throw new Error("AI 没有返回内容");
      return { text: r.text, ...P.splitTitle(r.text), platform: p.platform };
    },
  });

  tasks.register("ai:titles", {
    title: "AI 取标题",
    async handler(p = {}, ctx) {
      const r = await streamChat(P.titlesPrompt({ brand: brand(), content: p.content, platform: p.platform, count: p.count }), ctx, { temperature: 0.9 });
      let v = extractJson(r.text);
      if (v && !Array.isArray(v) && typeof v === "object") v = Object.values(v).find((x) => Array.isArray(x)) || [v];
      const titles = (Array.isArray(v) ? v : []).map((t) => String(typeof t === "string" ? t : (t && t.title) || "").trim()).filter(Boolean);
      if (!titles.length) throw new Error("AI 返回的标题格式不对，再试一次");
      return { titles };
    },
  });

  tasks.register("ai:polish", {
    title: "AI 润色",
    async handler(p = {}, ctx) {
      if (!String(p.text || "").trim()) throw new Error("没有要处理的文字");
      const r = await streamChat(P.polishPrompt({ brand: brand(), text: p.text, mode: p.mode }), ctx);
      return { text: r.text.trim() };
    },
  });

  // ---------------- IPC ----------------
  const h = (ch, fn) => ipcMain.handle(ch, async (_e, ...args) => {
    try { return await fn(...args); } catch (err) { log.warn(`${ch} 失败：${err.message}`); return { ok: false, error: err.message }; }
  });
  const coll = (name) => {
    if (!Object.prototype.hasOwnProperty.call(store, name)) throw new Error("没有这个数据集合：" + name);
    return store[name];
  };

  h("ai:meta", () => ({
    providers: Object.entries(PROVIDERS).map(([id, v]) => ({ id, ...v })),
    platforms: Object.entries(P.PLATFORMS).map(([id, v]) => ({ id, name: v.name, guide: v.guide })),
    statuses: Object.entries(P.STATUSES).map(([id, name]) => ({ id, name })),
    polishModes: Object.keys(P.POLISH_MODES),
  }));
  h("ai:keyInfo", () => ({ ...secrets.describe(API_KEY), canEncrypt: secrets.encrypted() }));
  h("ai:setKey", (key) => { secrets.set(API_KEY, String(key || "").trim()); log.info(key ? "已保存 API Key" : "已清除 API Key"); return { ok: true, ...secrets.describe(API_KEY) }; });
  h("ai:useProvider", (id) => {
    const p = PROVIDERS[id];
    if (!p) throw new Error("未知服务商");
    const patch = { aiProvider: id };
    if (id !== "custom") { patch.aiBaseUrl = p.baseUrl; patch.aiModel = p.model; }
    return settings.set(patch);
  });
  h("techniques:list", (topic) => {
    const lib = techLibrary();
    const auto = settings.get("useTechniques") ? TECH.pickTechniques(lib, String(topic || ""), settings.get("techniqueCount")).map((x) => x.id) : [];
    return { list: lib.slice(0, 200), auto };
  });
  // 手机预览：正文转成 HTML，配图换成本地图片（data URL）
  h("preview:html", (body) => {
    const { mdToHtml } = require("./publish/markdown");
    const imgUrl = (name) => {
      const f = images.fileOf(String(name || ""));
      if (!f || !fs.existsSync(f)) return "";
      const ext = path.extname(f).slice(1).toLowerCase();
      return `data:image/${ext === "jpg" ? "jpeg" : ext};base64,${fs.readFileSync(f).toString("base64")}`;
    };
    const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    return IMG.splitByImages(String(body || "")).map((x) => {
      if (x.type === "text") return mdToHtml(x.text);
      const src = imgUrl(x.name);
      return src ? `<figure><img src="${src}" alt="${esc(x.alt || "")}">${x.alt ? `<figcaption>${esc(x.alt)}</figcaption>` : ""}</figure>` : "";
    }).join("\n");
  });
  // 上传图片素材：页面把文件读成 data URL 传过来
  h("images:import", (p = {}) => {
    const m = String(p.data || "").match(/^data:image\/(png|jpe?g|webp|gif);base64,([A-Za-z0-9+/=]+)$/);
    if (!m) throw new Error("只支持 PNG / JPG / WebP / GIF 图片");
    const buf = Buffer.from(m[2], "base64");
    if (buf.length > 15 * 1024 * 1024) throw new Error("图片太大（超过 15MB）");
    const ext = m[1] === "jpeg" ? "jpg" : m[1];
    const name = `up-${Date.now().toString(36)}-${require("crypto").randomBytes(3).toString("hex")}.${ext}`;
    fs.mkdirSync(images.dir, { recursive: true });
    fs.writeFileSync(path.join(images.dir, name), buf);
    const title = String(p.title || "").trim() || String(p.fileName || "").replace(/\.[^.]+$/, "").slice(0, 60) || "图片";
    const saved = store.materials.upsert({ kind: "image", image: name, title, content: String(p.content || ""), tags: p.tags || [] });
    log.info(`已上传图片素材「${saved.title}」`);
    broadcast("data:changed", { what: "materials" });
    return saved;
  });
  h("images:meta", () => ({ providers: Object.entries(IMG.IMAGE_PROVIDERS).map(([id, v]) => ({ id, name: v.name, baseUrl: v.baseUrl, model: v.model })) }));
  h("images:keyInfo", () => ({ ...secrets.describe(IMG.IMAGE_KEY), canEncrypt: secrets.encrypted() }));
  h("images:setKey", (key) => { secrets.set(IMG.IMAGE_KEY, String(key || "").trim()); log.info(key ? "已保存生图 API Key" : "已清除生图 API Key"); return { ok: true, ...secrets.describe(IMG.IMAGE_KEY) }; });
  h("images:useProvider", (id) => {
    const p = IMG.IMAGE_PROVIDERS[id];
    if (!p) throw new Error("没有这个生图服务商");
    const patch = { imageProvider: id };
    if (id !== "custom") { patch.imageBaseUrl = p.baseUrl; patch.imageModel = p.model; }
    settings.set(patch);
    return { ok: true };
  });
  h("images:test", async () => {
    const t0 = Date.now();
    const g = await images.generate("一杯冒着热气的咖啡放在木桌上，清晨阳光，简洁插画", { shape: "square" });
    log.info(`生图连接正常：${settings.get("imageModel")}，${Date.now() - t0}ms`);
    return { ok: true, name: g.name, ms: Date.now() - t0, model: settings.get("imageModel") };
  });
  // 页面显示缩略图：只读 images 目录里的文件
  h("images:dataUrl", (name) => {
    const f = images.fileOf(String(name || ""));
    if (!f || !fs.existsSync(f)) return "";
    const ext = path.extname(f).slice(1).toLowerCase();
    return `data:image/${ext === "jpg" ? "jpeg" : ext};base64,${fs.readFileSync(f).toString("base64")}`;
  });
  h("ai:test", async () => { const r = await ai.ping(); log.info(`AI 连接正常：${r.model}，${r.ms}ms`); return r; });

  // contents / topics 默认只看当前账号；filter.accountId = "*" 看全部
  const scoped = (name, filter = {}) => {
    if (!ACCOUNT_SCOPED.has(name)) return filter;
    if (filter.accountId === "*") return { ...filter, accountId: "" };
    return { ...filter, accountId: filter.accountId || currentAccount() };
  };
  h("store:list", (name, filter) => coll(String(name)).list(scoped(String(name), filter && typeof filter === "object" ? filter : {})));
  h("store:get", (name, id) => coll(String(name)).get(String(id)));
  // 有参考爆款的稿子：每次保存都重算与原文的重合度，超过上限标记「需改写」，改好了自动取消标记
  // 同时做违规检测：有高风险词（极限词、医疗功效、引流、时政）也标记「需改写」
  function withOverlap(c) {
    if (!c) return c;
    const bd = c.refId ? store.breakdowns.get(c.refId) : null;
    const overlap = bd && bd.sourceText ? overlapRatio(IMG.stripImages(c.body), bd.sourceText) : c.overlap;
    const risk = settings.get("riskCheck") === false ? { riskLevel: "", riskWords: [] } : COMPLIANCE.summary(`${c.title}\n${c.body}`);
    const needsRewrite = (overlap > settings.get("overlapLimit") && !!(bd && bd.sourceText)) || risk.riskLevel === "high";
    if (overlap === c.overlap && needsRewrite === c.needsRewrite && risk.riskLevel === (c.riskLevel || "") && risk.riskWords.join() === (c.riskWords || []).join()) return c;
    return store.contents.upsert({ id: c.id, overlap, needsRewrite, ...risk });
  }
  h("store:upsert", (name, item) => {
    name = String(name);
    if (MAIN_ONLY.has(name)) throw new Error("这个数据只能由应用自己修改");
    if (ACCOUNT_SCOPED.has(name) && item && typeof item === "object" && !item.id && !item.accountId) item = { ...item, accountId: currentAccount() };
    if (name === "contents" && item && typeof item === "object") {
      item = { ...item };
      if (item.id) delete item.pushes; // 推送记录只由主进程写
      delete item.overlap; delete item.needsRewrite; delete item.riskLevel; delete item.riskWords; // 重合度和违规检测由主进程算
    }
    let saved = coll(name).upsert(item);
    if (name === "contents") saved = withOverlap(saved);
    return { ok: true, item: saved };
  });
  h("store:remove", (name, id) => {
    name = String(name);
    if (MAIN_ONLY.has(name)) throw new Error("这个数据只能由应用自己修改");
    if (name === "accounts") {
      if (store.accounts.count() <= 1) throw new Error("至少要保留一个运营账号");
      const n = store.contents.list({ accountId: String(id) }).length;
      if (n) throw new Error(`这个账号下还有 ${n} 篇内容，先删掉或移到别的账号`);
      const ok = store.accounts.remove(String(id));
      store.topics.list({ accountId: String(id) }).forEach((t) => store.topics.remove(t.id));
      ensureAccounts();
      if (onAccountRemoved) onAccountRemoved(String(id));
      return ok;
    }
    return coll(name).remove(String(id));
  });
  h("store:stats", (today) => stats(store, typeof today === "string" ? today : undefined, currentAccount()));

  h("clipboard:write", (text) => { clipboard.writeText(String(text || "")); return true; });
  h("content:export", async (id) => {
    const c = store.contents.get(String(id));
    if (!c) throw new Error("找不到这篇内容");
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
    const safe = (c.title || "未命名").replace(/[\\/:*?"<>|\r\n]+/g, " ").trim().slice(0, 60) || "未命名";
    const r = await dialog.showSaveDialog(win, { defaultPath: `${safe}.md`, filters: [{ name: "Markdown", extensions: ["md"] }, { name: "文本", extensions: ["txt"] }] });
    if (r.canceled || !r.filePath) return { ok: false, canceled: true };
    fs.writeFileSync(r.filePath, `# ${c.title || "未命名"}\n\n${c.body || ""}\n`, "utf8");
    log.info("已导出：" + r.filePath);
    return { ok: true, file: r.filePath };
  });

  return { store, secrets, ai, images, illustrate, techniquesFor, materialsFor, ensureTitle, currentAccount, brand, rules, withOverlap };
}

module.exports = { setupContentIpc, CONTENT_SCHEMA };
