"use strict";
// 内容运营的主进程部分：AI 后台任务（选题 / 写稿 / 改写 / 标题 / 润色）+ 本地数据 + AI 配置的 IPC。
// main.js 里一行接入：setupContentIpc({ electron, settings, tasks, logger, dataDir, broadcast, fetchImpl })
const path = require("path");
const fs = require("fs");
const { createAiClient, PROVIDERS, extractJson } = require("./ai-client");
const P = require("./prompts");
const { createStore, stats } = require("./store");
const { createSecrets } = require("./secrets");

// 加进 settings schema 的设置项（AI 模型 + 账号定位）
const CONTENT_SCHEMA = {
  aiProvider: { type: "enum", values: Object.keys(PROVIDERS), default: "deepseek" },
  aiBaseUrl: { type: "string", maxLength: 300, default: PROVIDERS.deepseek.baseUrl },
  aiModel: { type: "string", maxLength: 100, default: PROVIDERS.deepseek.model },
  aiTemperature: { type: "number", min: 0, max: 1.5, step: 0.1, default: 0.7 },
  brandName: { type: "string", maxLength: 60, default: "" },
  brandPositioning: { type: "string", maxLength: 300, default: "" },
  brandAudience: { type: "string", maxLength: 300, default: "" },
  brandTone: { type: "string", maxLength: 200, default: "" },
  defaultPlatform: { type: "enum", values: P.PLATFORM_IDS, default: "wechat" },
};

const API_KEY = "aiApiKey";

function setupContentIpc({ electron, settings, tasks, logger, dataDir, broadcast, fetchImpl }) {
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
  const ai = createAiClient({
    fetchImpl,
    getConfig: () => ({
      baseUrl: settings.get("aiBaseUrl"), model: settings.get("aiModel"),
      temperature: settings.get("aiTemperature"), apiKey: secrets.get(API_KEY),
    }),
  });
  const brand = () => ({
    name: settings.get("brandName"), positioning: settings.get("brandPositioning"),
    audience: settings.get("brandAudience"), tone: settings.get("brandTone"),
  });

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
      const avoid = store.topics.list().map((t) => t.title).concat(store.contents.list().map((c) => c.title)).filter(Boolean);
      const r = await streamChat(P.topicsPrompt({ brand: brand(), field: p.field, keywords: p.keywords, platform: p.platform, count: p.count, avoid }), ctx, { temperature: 0.9 });
      const topics = P.normalizeTopics(extractJson(r.text));
      if (!topics.length) throw new Error("AI 返回的选题格式不对，再试一次");
      return { topics };
    },
  });

  tasks.register("ai:draft", {
    title: "AI 写稿",
    async handler(p = {}, ctx) {
      const materials = (Array.isArray(p.materialIds) ? p.materialIds : []).map((id) => store.materials.get(String(id))).filter(Boolean);
      const r = await streamChat(P.draftPrompt({ brand: brand(), topic: p.topic, platform: p.platform, outline: p.outline, words: p.words, style: p.style, materials }), ctx);
      if (!r.text.trim()) throw new Error("AI 没有返回内容");
      return { text: r.text, ...P.splitTitle(r.text), platform: p.platform, usage: r.usage };
    },
  });

  tasks.register("ai:rewrite", {
    title: "一稿多发改写",
    async handler(p = {}, ctx) {
      if (!String(p.source || "").trim()) throw new Error("原文是空的");
      const r = await streamChat(P.rewritePrompt({ brand: brand(), source: p.source, platform: p.platform }), ctx);
      if (!r.text.trim()) throw new Error("AI 没有返回内容");
      return { text: r.text, ...P.splitTitle(r.text), platform: p.platform };
    },
  });

  tasks.register("ai:titles", {
    title: "AI 取标题",
    async handler(p = {}, ctx) {
      const r = await streamChat(P.titlesPrompt({ brand: brand(), content: p.content, platform: p.platform, count: p.count }), ctx, { temperature: 0.9 });
      const v = extractJson(r.text);
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
    platforms: Object.entries(P.PLATFORMS).map(([id, v]) => ({ id, name: v.name })),
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
  h("ai:test", async () => { const r = await ai.ping(); log.info(`AI 连接正常：${r.model}，${r.ms}ms`); return r; });

  h("store:list", (name, filter) => coll(String(name)).list(filter || {}));
  h("store:get", (name, id) => coll(String(name)).get(String(id)));
  h("store:upsert", (name, item) => ({ ok: true, item: coll(String(name)).upsert(item) }));
  h("store:remove", (name, id) => coll(String(name)).remove(String(id)));
  h("store:stats", (today) => stats(store, typeof today === "string" ? today : undefined));

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

  return { store, secrets, ai };
}

module.exports = { setupContentIpc, CONTENT_SCHEMA };
