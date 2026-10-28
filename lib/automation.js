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
const { analysisOf } = require("./store");
const { extractJson } = require("./ai-client");
const { parseTimes, parseWeekdays, createScheduler } = require("./scheduler");

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
  discoverDays: { type: "number", min: 0, max: 30, step: 1, default: 3 },
  platformAccountsMigrated: { type: "bool", default: false },
};

const aborted = (err, ctx) => (err && err.message === "已取消") || !!(ctx && ctx.signal && ctx.signal.aborted);
const splitList = (v) => String(v || "").split(/[,，;；\n、]+/).map((s) => s.trim()).filter(Boolean);
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
  function checkOverlap(body, bd) {
    if (!bd || !bd.sourceText) return { overlap: -1, needsRewrite: false };
    const overlap = overlapRatio(body, bd.sourceText);
    return { overlap, needsRewrite: overlap > limit() };
  }

  // ---------- 按骨架写原创 ----------
  async function writeFromBreakdown(bd, { platform, topic = "", accountId, auto = false }, ctx) {
    const acc = accountId || currentAccount();
    const t = topic || (bd.analysis.topics[0] && bd.analysis.topics[0].title) || bd.title;
    ctx.progress(null, `按骨架写${P.PLATFORMS[platform].name}稿：${t.slice(0, 20)}`);
    const text = await aiText(P.draftPrompt({ brand: brand(acc), rules: rules(), topic: t, platform, ref: bd }), ctx, { label: "AI 写稿" });
    const st = P.splitTitle(text);
    if (!st.body.trim()) throw new Error("AI 没有返回内容");
    const ov = checkOverlap(st.body, bd);
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
    const text = await aiText(P.rewritePrompt({ brand: brand(master.accountId), rules: rules(), source: `# ${master.title}\n\n${master.body}`, platform }), ctx, { label: `改写${P.PLATFORMS[platform].name}` });
    const st = P.splitTitle(text);
    if (!st.body.trim()) throw new Error("AI 没有返回内容");
    const ov = checkOverlap(st.body, bd);
    const groupId = master.groupId || master.id;
    if (!master.groupId) store.contents.upsert({ id: master.id, groupId });
    const c = store.contents.upsert({ accountId: master.accountId, title: st.title || master.title, body: st.body, platform, status: "draft", topic: master.topic, refId: master.refId, sourceId: master.id, groupId, ...ov, auto: master.auto });
    if (ov.needsRewrite) log.warn(`「${c.title}」（${P.PLATFORMS[platform].name}）重合度 ${ov.overlap}% 超过上限，已标记「需改写」`);
    return c;
  }

  async function pushOne(contentId, ctx) {
    const sub = { progress: (pct, msg) => ctx.progress(null, msg), signal: ctx.signal, log: ctx.log };
    return publisher.push(contentId, sub);
  }

  // ---------- 流水线：拆解 → 写原创 → 其他平台版本 → 推草稿箱 ----------
  async function pipeline(items, { targets, push, trigger, keyword = "", source = "" }, ctx) {
    const tg = targetsOf(targets);
    if (!tg.length) throw new Error("至少选一个要写成的平台");
    const prune = store.autoRuns.list().slice(250);
    for (const r of prune) store.autoRuns.remove(r.id);
    const run = store.autoRuns.upsert({ trigger, status: "running", startedAt: Date.now(), keyword, source, found: items.length });
    const sum = { found: items.length, broken: 0, written: 0, pushed: 0, rewrite: 0, failed: 0, items: [] };
    const save = (status) => store.autoRuns.upsert({ id: run.id, status, endedAt: status === "running" ? 0 : Date.now(), ...sum,
      summary: `找到 ${sum.found} 篇，拆解 ${sum.broken} 篇，写成 ${sum.written} 篇，推送 ${sum.pushed} 篇${sum.rewrite ? `，${sum.rewrite} 篇需改写` : ""}${sum.failed ? `，${sum.failed} 处失败` : ""}` });
    broadcast("auto:changed", { runId: run.id });
    try {
      for (let i = 0; i < items.length; i++) {
        if (ctx.signal && ctx.signal.aborted) throw new Error("已取消");
        const it = items[i];
        const rec = { title: it.title || "", url: it.url || "", status: "", error: "", breakdownId: "", contentIds: [] };
        sum.items.push(rec);
        ctx.progress((i / items.length) * 100, `第 ${i + 1}/${items.length} 篇：${(it.title || "").slice(0, 20)}`);
        try {
          const r = await breakdownOne(it, ctx, { origin: trigger === "batch" ? "search" : "auto", keyword, interactive: trigger !== "schedule" });
          if (r.duplicate) { rec.status = "拆过了"; rec.breakdownId = r.breakdown.id; continue; }
          sum.broken++;
          rec.breakdownId = r.breakdown.id;
          const master = await writeFromBreakdown(r.breakdown, { platform: tg[0], auto: trigger !== "batch" }, ctx);
          const all = [master];
          for (const pf of tg.slice(1)) {
            try { all.push(await writeVersion(master, pf, ctx)); }
            catch (err) { if (aborted(err, ctx)) throw err; sum.failed++; log.warn(`改写${P.PLATFORMS[pf].name}版本失败：${err.message}`); }
          }
          sum.written += all.length;
          rec.contentIds = all.map((c) => c.id);
          rec.status = "已写好";
          for (const c of all) {
            if (c.needsRewrite) { sum.rewrite++; rec.status = "需改写"; continue; }
            if (!push) continue;
            try { const pr = await pushOne(c.id, ctx); if (pr && (pr.status === "saved" || pr.status === "unknown" || pr.status === "opened")) sum.pushed++; }
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
          save("running");
          broadcast("data:changed", { what: "contents" });
        }
      }
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

  // ---------- 自动创作一轮（定时 / 立即运行一次） ----------
  function autoConfig() {
    return {
      enabled: settings.get("autoEnabled"), times: settings.get("autoTimes"), weekdays: settings.get("autoWeekdays"),
      keywords: splitList(settings.get("autoKeywords")), source: settings.get("autoSource"), days: settings.get("autoDays"),
      count: settings.get("autoCount"), targets: targetsOf(settings.get("autoTargets")), push: settings.get("autoPush"),
    };
  }
  async function autoRun(trigger, ctx) {
    const cfg = autoConfig();
    if (!cfg.keywords.length) throw new Error("还没设置自动创作的关键词：设置 → 定时自动创作");
    if (!cfg.targets.length) throw new Error("还没选要写成哪些平台：设置 → 定时自动创作");
    if (!content.secrets.get("aiApiKey")) throw new Error("还没设置 AI 的 API Key：设置 → AI 模型");
    log.info(`${trigger === "schedule" ? "定时" : "手动"}自动创作开始：${cfg.keywords.join("、")}（${cfg.source}，近 ${cfg.days || "不限"} 天，每次 ${cfg.count} 篇）`);
    const picked = [];
    const idx = U.createDedupIndex();
    for (const kw of cfg.keywords) {
      if (picked.length >= cfg.count) break;
      ctx.progress(null, `找爆款：${kw}`);
      try {
        const r = await discover.search({ platform: cfg.source, keyword: kw, days: cfg.days, signal: ctx.signal, interactive: trigger !== "schedule", onStep: (m) => ctx.progress(null, m) });
        for (const it of r.items) { if (picked.length >= cfg.count) break; if (idx.has(it)) continue; idx.add(it); picked.push({ ...it, keyword: kw }); }
      } catch (err) { if (aborted(err, ctx)) throw err; log.warn(`搜索「${kw}」失败：${err.message}`); }
    }
    if (!picked.length) {
      const run = store.autoRuns.upsert({ trigger, status: "done", startedAt: Date.now(), endedAt: Date.now(), keyword: cfg.keywords.join("、"), source: cfg.source, summary: "没有找到新的爆款（拆过的已跳过）" });
      broadcast("auto:changed", { runId: run.id });
      log.info("没有找到新的爆款（拆过的已跳过）");
      return { runId: run.id, found: 0, summary: run.summary };
    }
    return pipeline(picked, { targets: cfg.targets, push: cfg.push, trigger, keyword: cfg.keywords.join("、"), source: cfg.source }, ctx);
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
      return pipeline(items, { targets: p.targets, push: !!p.push, trigger: "batch", keyword: p.keyword || "", source: p.platform || "" }, ctx);
    },
  });
  tasks.register("auto:run", {
    title: "定时自动创作",
    single: true,
    async handler(p = {}, ctx) { return autoRun(p.trigger === "schedule" ? "schedule" : "manual", ctx); },
  });

  // ---------------- 定时 ----------------
  let running = null;
  const scheduler = createScheduler({
    getConfig: () => { const c = autoConfig(); return { enabled: c.enabled, times: c.times, weekdays: c.weekdays }; },
    getLast: () => settings.get("autoLastSlot"),
    setLast: (slot) => settings.set({ autoLastSlot: slot }),
    onFire: async (slot) => {
      if (running) { log.info(`到了 ${slot}，但上一轮自动创作还没结束，这次跳过`); return; }
      log.info(`到点了（${slot}），开始定时自动创作`);
      const r = tasks.run("auto:run", { trigger: "schedule" }, { title: "定时自动创作" });
      running = r.id;
      try { await tasks.wait(r.id); } catch { /* 结果在任务里 */ } finally { running = null; broadcast("auto:changed", {}); }
    },
  });

  function status() {
    const cfg = autoConfig();
    const runs = store.autoRuns.list();
    const live = tasks.list().find((t) => t.type === "auto:run" && !["done", "failed", "cancelled"].includes(t.status));
    return {
      enabled: cfg.enabled, next: scheduler.next(), times: parseTimes(cfg.times), weekdays: parseWeekdays(cfg.weekdays),
      keywords: cfg.keywords, source: cfg.source, targets: cfg.targets, push: cfg.push,
      running: !!live, taskId: live ? live.id : "", lastRun: runs[0] || null, runs: runs.slice(0, 10),
    };
  }

  return { breakdownOne, writeFromBreakdown, writeVersion, checkOverlap, findDuplicate, pipeline, autoRun, scheduler, status, autoConfig,
    overlapOf: (text, refId) => {
      const bd = refId ? store.breakdowns.get(String(refId)) : null;
      if (!bd) return { overlap: -1, limit: limit(), snippets: [] };
      const overlap = overlapRatio(text, bd.sourceText);
      return { overlap, limit: limit(), needsRewrite: overlap > limit(), snippets: overlap > 0 ? overlapSnippets(text, bd.sourceText) : [] };
    } };
}

module.exports = { createAutomation, AUTO_SCHEMA, targetsOf, splitList };
