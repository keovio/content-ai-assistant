"use strict";
// 对标拆解 + 自动创作（主进程）：
//   拆解一篇（链接 / 全文 / 搜索结果）→ 存进拆解库（按链接 + 标题去重，同一篇不拆第二次）
//   按骨架写原创 → 算与原文的重合度 → 超过上限标记「需改写」、不推送
//   生成其他平台版本 → 可选推送到平台草稿箱（只存草稿，永远不发布）
//
// 后台任务：discover:search / discover:breakdown / discover:batch / auto:run
// 定时：lib/scheduler.js 到点后跑 auto:run（应用需要开着）
const P = require("./prompts");
const U = require("./discover/utils");
const { overlapRatio, overlapSnippets } = require("./similarity");
const COMPLIANCE = require("./compliance");
const IMG = require("./images");
const { analysisOf } = require("./store");
const { extractJson } = require("./ai-client");
const { parseTimes, parseWeekdays, nextRun, dueSlot } = require("./scheduler");

// 设置项（并进 settings schema）
const AUTO_SCHEMA = {
  autoEnabled: { type: "bool", default: false },
  autoTimes: { type: "string", maxLength: 100, default: "08:30" },
  autoWeekdays: { type: "string", maxLength: 20, default: "1,2,3,4,5,6,7" },
  autoKeywords: { type: "string", maxLength: 300, default: "" },
  autoSource: { type: "enum", values: ["wechat", "toutiao", "baijiahao", "xiaohongshu", "douyin"], default: "wechat" },
  autoDays: { type: "number", min: 0, max: 30, step: 1, default: 3 },
  autoCount: { type: "number", min: 1, max: 10, step: 1, default: 2 },
  autoTargets: { type: "string", maxLength: 100, default: "wechat" },
  autoPush: { type: "bool", default: false },
  overlapLimit: { type: "number", min: 5, max: 90, step: 1, default: 30 },
  autoLastSlot: { type: "string", maxLength: 40, default: "" },
  // 0.4.1 起可以建多个定时任务：JSON 数组（每个任务一套时间 / 关键词 / 来源…）；上面的 auto* 单项只用于从旧配置迁移
  autoJobs: { type: "string", maxLength: 30000, default: "" },
  autoJobsMigrated: { type: "bool", default: false },
  autoJobSlots: { type: "string", maxLength: 4000, default: "" },
  // 找爆款避开时政新闻（政治、外交军事、官员、灾难事故、刑案、讣告）；avoidWords 自定义屏蔽词
  avoidSensitive: { type: "bool", default: true },
  // 违规检测：推送前扫广告法极限词、医疗功效、引流、时政敏感（高风险标记「需改写」不推送）
  riskCheck: { type: "bool", default: true },
  avoidIntl: { type: "bool", default: false },
  avoidWords: { type: "string", maxLength: 500, default: "" },
  discoverDays: { type: "number", min: 0, max: 30, step: 1, default: 3 },
  platformAccountsMigrated: { type: "bool", default: false },
};

const aborted = (err, ctx) => (err && err.message === "已取消") || !!(ctx && ctx.signal && ctx.signal.aborted);
const splitList = (v) => String(v || "").split(/[,，;；\n、]+/).map((s) => s.trim()).filter(Boolean);
const SOURCES = ["wechat", "toutiao", "baijiahao", "xiaohongshu", "douyin"];
const clampN = (v, lo, hi, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const MAX_JOBS = 20;
const PIPELINE_PARALLEL = 2; // 批量 / 自动创作时同时处理几篇
// 一个定时任务的字段校验（页面传来的也走这里）
function normalizeJob(j, i = 0) {
  const x = j && typeof j === "object" ? j : {};
  const id = String(x.id || "").replace(/[^\w-]/g, "").slice(0, 40) || `job${Date.now().toString(36)}${i}`;
  return {
    id,
    name: String(x.name || "").trim().slice(0, 30) || `任务 ${i + 1}`,
    enabled: !!x.enabled,
    times: String(x.times == null ? "08:30" : x.times).slice(0, 100),
    weekdays: String(x.weekdays == null ? "1,2,3,4,5,6,7" : x.weekdays).slice(0, 20),
    keywords: String(x.keywords || "").slice(0, 300),
    source: SOURCES.includes(x.source) ? x.source : "wechat",
    days: clampN(x.days, 0, 30, 3),
    count: clampN(x.count, 1, 10, 2),
    targets: (Array.isArray(x.targets) ? x.targets.join(",") : String(x.targets == null ? "wechat" : x.targets)).slice(0, 100),
    push: !!x.push,
    images: !!x.images,
  };
}
function normalizeJobs(list) {
  const seen = new Set();
  return (Array.isArray(list) ? list : []).slice(0, MAX_JOBS).map(normalizeJob).filter((j) => (seen.has(j.id) ? false : seen.add(j.id)));
}
const targetsOf = (v) => [...new Set((Array.isArray(v) ? v : splitList(v)).filter((p) => P.PLATFORMS[p]))];

function createAutomation({ tasks, store, settings, logger, discover, content, publisher, broadcast }) {
  const log = logger.scope("auto");
  const { ai, brand, rules, currentAccount } = content;
  const limit = () => settings.get("overlapLimit");

  const aiText = async (messages, ctx, opts = {}) => {
    const r = await ai.chat(messages, { ...opts, signal: ctx.signal, onDelta: (_p, all) => ctx.progress(null, `${opts.label || "AI 生成中"}：${P.countWords(all)} 字`) });
    return r.text || "";
  };

  // 去重：同一篇（链接或标题对上）不拆第二次
  function findDuplicate(item) {
    const idx = U.createDedupIndex([item]);
    return store.breakdowns.list().find((b) => idx.has(b)) || null;
  }

  // ---------- 拆解一篇 ----------
  async function breakdownOne(input, ctx, { origin = "paste", keyword = "", interactive = true } = {}) {
    const it = input || {};
    const dup = findDuplicate({ url: it.url, canonicalUrl: it.canonicalUrl, title: it.title });
    if (dup) { log.info(`「${dup.title}」拆过了，跳过`); return { breakdown: dup, duplicate: true }; }
    let text = String(it.text || "").trim();
    let meta = { title: it.title || "", url: it.url || "", canonicalUrl: "", author: it.author || "", publishedAt: Number(it.publishedAt) || 0, platform: it.platform || "" };
    if (!text) {
      if (!it.url) throw new Error("请粘贴全文或文章链接");
      ctx.progress(null, "读取正文…");
      const r = await discover.read(it.url, { referer: it.referer, signal: ctx.signal, interactive, platform: it.platform });
      text = r.body;
      meta = { ...meta, title: meta.title || r.title, canonicalUrl: r.canonicalUrl, author: meta.author || r.author, publishedAt: meta.publishedAt || r.publishedAt, platform: meta.platform || r.platform };
      // 读到正文后用真实链接 / 标题再查一次重
      const dup2 = findDuplicate({ url: r.canonicalUrl, title: meta.title });
      if (dup2) { log.info(`「${dup2.title}」拆过了，跳过`); return { breakdown: dup2, duplicate: true }; }
    }
    if (P.countWords(text) < 50) throw new Error("正文太短（不到 50 字），拆不出结构");
    if (!meta.title) meta.title = text.split(/\n/)[0].slice(0, 60);
    ctx.progress(null, `AI 拆解「${meta.title.slice(0, 20)}」…`);
    const out = await aiText(P.breakdownPrompt({ title: meta.title, text, platform: meta.platform }), ctx, { temperature: 0.4, label: "AI 拆解" });
    const analysis = analysisOf(extractJson(out));
    if (!analysis.skeleton.length && !analysis.hook) throw new Error("AI 返回的拆解格式不对，再试一次");
    const bd = store.breakdowns.upsert({
      ...meta, platform: ["wechat", "xiaohongshu", "douyin", "toutiao", "baijiahao"].includes(meta.platform) ? meta.platform : "other",
      likes: it.likes, comments: it.comments, reads: it.reads, sourceText: text, origin, keyword, analysis,
    });
    log.info(`已拆解「${bd.title}」：骨架 ${analysis.skeleton.length} 段，${analysis.topics.length} 个同结构选题`);
    broadcast("data:changed", { what: "breakdowns" });
    return { breakdown: bd, duplicate: false };
  }

  // ---------- 重合度 ----------
  function checkOverlap(body, bd, title = "") {
    const risk = settings.get("riskCheck") === false ? { riskLevel: "", riskWords: [] } : COMPLIANCE.summary(`${title}\n${body}`);
    if (risk.riskLevel === "high") log.warn(`「${title.slice(0, 30)}」有违规风险词：${risk.riskWords.join("、")}，已标记「需改写」，不会推送`);
    if (!bd || !bd.sourceText) return { overlap: -1, needsRewrite: risk.riskLevel === "high", ...risk };
    const overlap = overlapRatio(body, bd.sourceText);
    return { overlap, needsRewrite: overlap > limit() || risk.riskLevel === "high", ...risk };
  }

  // ---------- 按骨架写原创 ----------
  async function writeFromBreakdown(bd, { platform, topic = "", accountId, auto = false }, ctx) {
    const acc = accountId || currentAccount();
    const t = topic || (bd.analysis.topics[0] && bd.analysis.topics[0].title) || bd.title;
    ctx.progress(null, `按骨架写${P.PLATFORMS[platform].name}稿：${t.slice(0, 20)}`);
    const text = await aiText(P.draftPrompt({ brand: brand(acc), rules: rules(), topic: t, platform, ref: bd, materials: content.materialsFor ? content.materialsFor({ topic: t }) : [], techniques: content.techniquesFor ? content.techniquesFor({ topic: t }, bd) : [] }), ctx, { label: "AI 写稿" });
    const st = P.splitTitle(text);
    if (!st.body.trim()) throw new Error("AI 没有返回内容");
    const ov = checkOverlap(st.body, bd, st.title || t);
    const c = store.contents.upsert({ accountId: acc, title: st.title || t, body: st.body, platform, status: "draft", topic: t, refId: bd.id, ...ov, auto });
    store.contents.upsert({ id: c.id, groupId: c.id });
    store.breakdowns.upsert({ id: bd.id, usedCount: (bd.usedCount || 0) + 1 });
    if (ov.needsRewrite) log.warn(`「${c.title}」与原文重合度 ${ov.overlap}%，超过上限 ${limit()}%，已标记「需改写」，不会推送`);
    else log.info(`已写好「${c.title}」（${P.PLATFORMS[platform].name}，重合度 ${ov.overlap}%）`);
    return store.contents.get(c.id);
  }

  async function writeVersion(master, platform, ctx) {
    const bd = master.refId ? store.breakdowns.get(master.refId) : null;
    ctx.progress(null, `改写成${P.PLATFORMS[platform].name}版本`);
    const text = await aiText(P.rewritePrompt({ brand: brand(master.accountId), rules: rules(), source: `# ${master.title}\n\n${IMG.stripImages(master.body)}`, platform }), ctx, { label: `改写${P.PLATFORMS[platform].name}` });
    const st = P.splitTitle(text);
    if (!st.body.trim()) throw new Error("AI 没有返回内容");
    // 主稿有配图：同样的图均匀插进这个版本
    const pics = IMG.imagesIn(master.body);
    if (pics.length) st.body = IMG.insertImages(st.body, pics.map((x) => ({ ...x, after: "" })));
    const ov = checkOverlap(st.body, bd, st.title || master.title);
    const groupId = master.groupId || master.id;
    if (!master.groupId) store.contents.upsert({ id: master.id, groupId });
    const c = store.contents.upsert({ accountId: master.accountId, title: st.title || master.title, body: st.body, platform, status: "draft", topic: master.topic, refId: master.refId, sourceId: master.id, groupId, ...ov, auto: master.auto, cover: master.cover || "" });
    if (ov.needsRewrite) log.warn(`「${c.title}」（${P.PLATFORMS[platform].name}）重合度 ${ov.overlap}% 超过上限，已标记「需改写」`);
    return c;
  }

  async function pushOne(contentId, ctx) {
    const sub = { progress: (pct, msg) => ctx.progress(null, msg), signal: ctx.signal, log: ctx.log };
    return publisher.push(contentId, sub);
  }

  // ---------- 流水线：拆解 → 写原创 → 其他平台版本 → 推草稿箱 ----------
  async function pipeline(items, { targets, push, trigger, keyword = "", source = "", jobId = "", jobName = "", images = false }, ctx) {
    const tg = targetsOf(targets);
    if (!tg.length) throw new Error("至少选一个要写成的平台");
    const prune = store.autoRuns.list().slice(250);
    for (const r of prune) store.autoRuns.remove(r.id);
    const run = store.autoRuns.upsert({ trigger, status: "running", startedAt: Date.now(), keyword, source, jobId, jobName, found: items.length });
    const sum = { found: items.length, broken: 0, written: 0, pushed: 0, rewrite: 0, failed: 0, items: [] };
    const save = (status) => store.autoRuns.upsert({ id: run.id, status, endedAt: status === "running" ? 0 : Date.now(), ...sum,
      summary: `找到 ${sum.found} 篇，拆解 ${sum.broken} 篇，写成 ${sum.written} 篇，推送 ${sum.pushed} 篇${sum.rewrite ? `，${sum.rewrite} 篇需改写` : ""}${sum.failed ? `，${sum.failed} 处失败` : ""}` });
    broadcast("auto:changed", { runId: run.id });
    try {
      // 两篇同时处理（拆解 / 写稿 / 改写并发），推草稿箱一篇一篇来（同一时间只开一个平台编辑页，避免风控）
      let pushChain = Promise.resolve();
      const pushSerial = (id) => { const p = pushChain.then(() => pushOne(id, ctx)); pushChain = p.catch(() => {}); return p; };
      let doneCount = 0;
      const processItem = async (it, i) => {
        if (ctx.signal && ctx.signal.aborted) throw new Error("已取消");
        const rec = { title: it.title || "", url: it.url || "", status: "", error: "", breakdownId: "", contentIds: [] };
        sum.items[i] = rec;
        ctx.progress((doneCount / items.length) * 100, `第 ${i + 1}/${items.length} 篇：${(it.title || "").slice(0, 20)}`);
        try {
          const r = await breakdownOne(it, ctx, { origin: trigger === "batch" ? "search" : "auto", keyword, interactive: trigger !== "schedule" });
          if (r.duplicate) { rec.status = "拆过了"; rec.breakdownId = r.breakdown.id; return; }
          sum.broken++;
          rec.breakdownId = r.breakdown.id;
          let master = await writeFromBreakdown(r.breakdown, { platform: tg[0], auto: trigger !== "batch" }, ctx);
          // 配图（先给主稿配，平台版本沿用同样的图）
          if (images && !master.needsRewrite && content.illustrate) {
            try { const ir = await content.illustrate(master.id, { progress: (pct, msg) => ctx.progress(null, msg), signal: ctx.signal, log: ctx.log }); master = ir.content || store.contents.get(master.id); }
            catch (err) { if (aborted(err, ctx)) throw err; log.warn(`「${master.title}」配图失败：${err.message}（稿子照常保存）`); }
          }
          const all = [master];
          // 其他平台版本同时改写
          if (tg.length > 1 && !master.groupId) store.contents.upsert({ id: master.id, groupId: master.id });
          const vers = await Promise.all(tg.slice(1).map((pf) => writeVersion(store.contents.get(master.id) || master, pf, ctx).catch((err) => {
            if (aborted(err, ctx)) throw err; sum.failed++; log.warn(`改写${P.PLATFORMS[pf].name}版本失败：${err.message}`); return null;
          })));
          all.push(...vers.filter(Boolean));
          sum.written += all.length;
          rec.contentIds = all.map((c) => c.id);
          rec.status = "已写好";
          for (const c of all) {
            if (c.needsRewrite) { sum.rewrite++; rec.status = "需改写"; continue; }
            if (!push) continue;
            try {
              const pr = await pushSerial(c.id);
              if (pr && (pr.status === "saved" || pr.status === "unknown" || pr.status === "opened")) { sum.pushed++; log.info(`已推送「${c.title}」到${P.PLATFORMS[c.platform].name}草稿箱`); }
            }
            catch (err) {
              if (aborted(err, ctx)) throw err;
              sum.failed++; rec.error = err.message; log.warn(`推送「${c.title}」失败：${err.message}`);
              const now = store.contents.get(c.id);
              if (publisher.recordFail && !(now && now.pushes && now.pushes[c.platform] && now.pushes[c.platform].status === "failed")) publisher.recordFail(c.id, err.message);
            }
          }
          if (push && !rec.error && rec.status === "已写好") rec.status = "已推草稿箱";
        } catch (err) {
          if (aborted(err, ctx)) throw err;
          sum.failed++; rec.status = "失败"; rec.error = err.message;
          log.warn(`「${(it.title || it.url || "").slice(0, 30)}」处理失败：${err.message}`);
        } finally {
          doneCount++;
          save("running");
          broadcast("data:changed", { what: "contents" });
        }
      };
      const queue = items.map((it, i) => [it, i]);
      const worker = async () => { while (queue.length) { const [it, i] = queue.shift(); await processItem(it, i); } };
      await Promise.all(Array.from({ length: Math.min(PIPELINE_PARALLEL, items.length) }, worker));
      sum.items = sum.items.filter(Boolean);
      const done = save("done");
      log.info(`${trigger === "schedule" ? "定时自动创作" : trigger === "batch" ? "批量拆解创作" : "自动创作"}完成：${done.summary}`);
      broadcast("auto:changed", { runId: run.id });
      return { runId: run.id, ...sum, summary: done.summary };
    } catch (err) {
      save(aborted(err, ctx) ? "cancelled" : "failed");
      broadcast("auto:changed", { runId: run.id });
      throw err;
    }
  }

  // ---------- 定时任务列表（可以建多个） ----------
  const parseJson = (v, d) => { try { const x = JSON.parse(v); return x == null ? d : x; } catch { return d; } };
  function jobs() {
    if (!settings.get("autoJobsMigrated")) {
      // 从单个配置迁移：旧的那套设置变成第一个任务（原样保留开关）
      const first = normalizeJob({
        id: "job1", name: "任务 1", enabled: settings.get("autoEnabled"), times: settings.get("autoTimes"), weekdays: settings.get("autoWeekdays"),
        keywords: settings.get("autoKeywords"), source: settings.get("autoSource"), days: settings.get("autoDays"), count: settings.get("autoCount"),
        targets: settings.get("autoTargets"), push: settings.get("autoPush"),
      });
      const existing = normalizeJobs(parseJson(settings.get("autoJobs"), []));
      const slots = settings.get("autoLastSlot") ? { job1: settings.get("autoLastSlot") } : {};
      settings.set({ autoJobs: JSON.stringify(existing.length ? existing : [first]), autoJobsMigrated: true, ...(existing.length ? {} : { autoJobSlots: JSON.stringify(slots) }) });
    }
    return normalizeJobs(parseJson(settings.get("autoJobs"), []));
  }
  function saveJobs(list) {
    const clean = normalizeJobs(list);
    settings.set({ autoJobs: JSON.stringify(clean), autoJobsMigrated: true });
    return clean;
  }
  const slots = () => { const x = parseJson(settings.get("autoJobSlots"), {}); return x && typeof x === "object" ? x : {}; };
  const setSlot = (id, slot) => settings.set({ autoJobSlots: JSON.stringify({ ...slots(), [id]: slot }) });
  const jobConfig = (j) => ({ ...j, keywordList: splitList(j.keywords), targetList: targetsOf(j.targets) });
  // 旧接口：没指定任务时用第一个
  function autoConfig(jobId) {
    const list = jobs();
    const j = (jobId && list.find((x) => x.id === jobId)) || list[0] || normalizeJob({});
    const c = jobConfig(j);
    return { ...c, keywords: c.keywordList, targets: c.targetList };
  }

  // ---------- 自动创作一轮（定时 / 立即运行一次） ----------
  // 正在跑的任务（按 jobId）：不同任务可以同时跑，同一个任务同一时间只跑一轮
  const runningJobs = new Set();
  async function autoRun(trigger, ctx, jobId = "") {
    const cfg = autoConfig(jobId);
    if (runningJobs.has(cfg.id)) throw new Error(`「${cfg.name}」正在运行，等这一轮结束再试`);
    runningJobs.add(cfg.id);
    try { return await autoRunJob(cfg, trigger, ctx); } finally { runningJobs.delete(cfg.id); broadcast("auto:changed", {}); }
  }
  async function autoRunJob(cfg, trigger, ctx) {
    if (!cfg.targets.length) throw new Error(`「${cfg.name}」还没选要写成哪些平台：设置 → 定时自动创作`);
    if (!content.secrets.get("aiApiKey")) throw new Error("还没设置 AI 的 API Key：设置 → AI 模型");
    const kwLabel = cfg.keywords.length ? cfg.keywords.join("、") : "今日热点";
    log.info(`${trigger === "schedule" ? "定时" : "手动"}自动创作「${cfg.name}」开始：${kwLabel}（${cfg.source}，近 ${cfg.days || "不限"} 天，每次 ${cfg.count} 篇）`);
    const picked = [];
    const idx = U.createDedupIndex();
    // 没设关键词：用一个空关键词，搜索时按今日热点挑最火的
    for (const kw of cfg.keywords.length ? cfg.keywords : [""]) {
      if (picked.length >= cfg.count) break;
      ctx.progress(null, `找爆款：${kw || "今日热点"}`);
      try {
        const r = await discover.search({ platform: cfg.source, keyword: kw, days: cfg.days, signal: ctx.signal, interactive: trigger !== "schedule", onStep: (m) => ctx.progress(null, m) });
        for (const it of r.items) { if (picked.length >= cfg.count) break; if (idx.has(it)) continue; idx.add(it); picked.push({ ...it, keyword: kw || it.keyword || "" }); }
      } catch (err) { if (aborted(err, ctx)) throw err; log.warn(`搜索「${kw || "今日热点"}」失败：${err.message}`); }
    }
    if (!picked.length) {
      const run = store.autoRuns.upsert({ trigger, status: "done", startedAt: Date.now(), endedAt: Date.now(), keyword: kwLabel, source: cfg.source, jobId: cfg.id, jobName: cfg.name, summary: "没有找到新的爆款（拆过的已跳过）" });
      broadcast("auto:changed", { runId: run.id });
      log.info("没有找到新的爆款（拆过的已跳过）");
      return { runId: run.id, found: 0, summary: run.summary };
    }
    return pipeline(picked, { targets: cfg.targets, push: cfg.push, images: cfg.images, trigger, keyword: kwLabel, source: cfg.source, jobId: cfg.id, jobName: cfg.name }, ctx);
  }

  // ---------------- 后台任务 ----------------
  tasks.register("discover:search", {
    title: "找爆款",
    async handler(p = {}, ctx) {
      return discover.search({ platform: p.platform, keyword: p.keyword, days: p.days, signal: ctx.signal, onStep: (m) => ctx.progress(null, m) });
    },
  });
  tasks.register("discover:breakdown", {
    title: "对标拆解",
    async handler(p = {}, ctx) {
      const item = p.item || { url: p.url, text: p.text, title: p.title, platform: p.platform };
      return breakdownOne(item, ctx, { origin: p.item ? "search" : "paste", keyword: p.keyword || "" });
    },
  });
  tasks.register("discover:batch", {
    title: "批量拆解并创作",
    async handler(p = {}, ctx) {
      const items = (Array.isArray(p.items) ? p.items : []).slice(0, 20);
      if (!items.length) throw new Error("先勾选要拆解的文章");
      return pipeline(items, { targets: p.targets, push: !!p.push, images: !!p.images, trigger: "batch", keyword: p.keyword || "", source: p.platform || "" }, ctx);
    },
  });
  tasks.register("auto:run", {
    title: "定时自动创作",
    async handler(p = {}, ctx) { return autoRun(p.trigger === "schedule" ? "schedule" : "manual", ctx, String(p.jobId || "")); },
  });

  // ---------------- 定时（多个任务，同一时间到点的同时跑；推草稿箱仍然排队一个个来） ----------------
  let timer = null, ticking = false;
  async function tick(now = Date.now()) {
    if (ticking) return [];
    ticking = true;
    const fired = [], started = [];
    try {
      for (const j of jobs()) {
        if (!j.enabled) continue;
        const slot = dueSlot(j, slots()[j.id] || "", now);
        if (!slot) continue;
        setSlot(j.id, slot);
        fired.push(j.id);
        if (runningJobs.has(j.id)) { log.warn(`「${j.name}」上一轮还没跑完，这次（${slot}）跳过`); continue; }
        log.info(`到点了（${slot}），开始定时自动创作「${j.name}」`);
        started.push(tasks.run("auto:run", { trigger: "schedule", jobId: j.id }, { title: `定时自动创作：${j.name}` }));
      }
      await Promise.all(started.map((r) => tasks.wait(r.id).catch(() => {})));
      if (started.length) broadcast("auto:changed", {});
    } finally { ticking = false; }
    return fired;
  }
  const nextOf = (j, now = Date.now()) => (j.enabled ? nextRun(j, now) || 0 : 0);
  const scheduler = {
    start() { if (!timer) timer = setInterval(() => { tick().catch(() => {}); }, 30000); return this; },
    stop() { if (timer) { clearInterval(timer); timer = null; } },
    tick,
    isRunning: (id) => runningJobs.has(String(id || "")),
    next: () => jobs().map((j) => nextOf(j)).filter(Boolean).sort((a, b) => a - b)[0] || 0,
  };

  function status() {
    const list = jobs();
    const runs = store.autoRuns.list();
    const live = tasks.list().filter((t) => t.type === "auto:run" && !["done", "failed", "cancelled"].includes(t.status));
    const now = Date.now();
    const jobsOut = list.map((j) => {
      const c = jobConfig(j);
      return { ...j, next: nextOf(j, now), timeList: parseTimes(j.times), weekdayList: parseWeekdays(j.weekdays), keywordList: c.keywordList, targetList: c.targetList,
        running: live.length > 0 && runningJobs.has(j.id), lastRun: runs.find((r) => r.jobId === j.id) || null };
    });
    const nextJob = jobsOut.filter((j) => j.next).sort((a, b) => a.next - b.next)[0] || null;
    const first = jobsOut[0] || { timeList: [], weekdayList: [], keywordList: [], targetList: [], source: "wechat", push: false };
    return {
      jobs: jobsOut, enabled: jobsOut.some((j) => j.enabled), enabledCount: jobsOut.filter((j) => j.enabled).length,
      next: nextJob ? nextJob.next : 0, nextJob: nextJob ? { id: nextJob.id, name: nextJob.name } : null,
      // 兼容旧字段（第一个任务）
      times: first.timeList, weekdays: first.weekdayList, keywords: first.keywordList, source: first.source, targets: first.targetList, push: first.push,
      running: live.length > 0, taskId: live[0] ? live[0].id : "", lastRun: runs[0] || null, runs: runs.slice(0, 10),
    };
  }

  return { breakdownOne, writeFromBreakdown, writeVersion, checkOverlap, findDuplicate, pipeline, autoRun, scheduler, status, autoConfig, jobs, saveJobs,
    riskOf: (text) => COMPLIANCE.check(String(text || "")),
    overlapOf: (text, refId) => {
      const bd = refId ? store.breakdowns.get(String(refId)) : null;
      if (!bd) return { overlap: -1, limit: limit(), snippets: [] };
      const overlap = overlapRatio(text, bd.sourceText);
      return { overlap, limit: limit(), needsRewrite: overlap > limit(), snippets: overlap > 0 ? overlapSnippets(text, bd.sourceText) : [] };
    } };
}

module.exports = { createAutomation, AUTO_SCHEMA, targetsOf, splitList, normalizeJob, normalizeJobs };
