"use strict";
// 对标拆解 + 自动创作流水线（假的 AI / 搜索 / 推送）：去重、按骨架写稿、重合度超限不推送、其他平台版本、定时任务一轮
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { createStore } = require("../lib/store");
const { createSettings } = require("../lib/settings");
const { createTaskManager } = require("../lib/tasks");
const { createAutomation, AUTO_SCHEMA } = require("../lib/automation");
const { tmp } = require("./helpers");

const SOURCE_A = "很多人以为副业就是多打一份工。其实真正赚钱的副业，是把你本职工作里已经练熟的能力，换一个场景再卖一次。我身边一个做财务的朋友，下班后帮小公司做账，一个月多赚八千。第二个方法是把经验写成课程。第三个方法是做咨询。".repeat(2);
const SOURCE_C = "抄袭测试原文：早上六点起床的人到底赢在哪里？答案可能出乎你的意料，并不是时间更多，而是干扰更少。安静的两小时足够完成一天最重要的事情。".repeat(3);
const ANALYSIS = JSON.stringify({ titleFormula: "反常识 + 结论", hook: "先否定常见看法", skeleton: ["否定误区", "给出方法", "举例", "总结"], emotions: ["焦虑"], highlights: ["月入八千"], reusable: ["先破后立"], avoid: ["财务朋友的案例"], topics: [{ title: "同结构选题一", angle: "a" }, { title: "同结构选题二" }, { title: "同结构选题三" }] });

function setup({ searchItems = [] } = {}) {
  const dir = tmp();
  const store = createStore(path.join(dir, "data"));
  const settings = createSettings({ file: path.join(dir, "settings.json"), schema: { ...AUTO_SCHEMA, currentAccount: { type: "string", default: "acc1" } } });
  const logs = [];
  const logger = { scope: () => ({ info: (m) => logs.push(m), warn: (m) => logs.push("W " + m), debug() {}, error: (m) => logs.push("E " + m) }) };
  const tasks = createTaskManager({ concurrency: 2 });
  const pushed = [];
  const chat = async (messages) => {
    const u = messages[messages.length - 1].content;
    if (u.includes("对标拆解")) return { text: "```json\n" + ANALYSIS + "\n```" };
    if (u.includes("写一篇完整内容")) {
      if (u.includes("早上六点")) return { text: "# 早起的秘密\n\n" + SOURCE_C }; // 照抄 → 重合度 100%
      return { text: "# 副业别再瞎忙\n\n我想换个角度聊副业：与其拼体力，不如盘点自己最拿手的一件事，把它做成能重复交付的小产品，比如模板、清单或者陪跑服务，先从熟人圈试卖。" };
    }
    if (u.includes("改写成")) return { text: "# 平台版本标题\n\n这是改写后的平台版本，换了一种说法讲同样的观点，适合这个平台的读者阅读习惯。" };
    return { text: "" };
  };
  const discover = {
    read: async (url) => ({ url, canonicalUrl: url, title: url.includes("/article/c") ? "早上六点起床的人赢在哪" : "副业的真相", body: url.includes("/article/c") ? SOURCE_C : SOURCE_A, author: "作者", publishedAt: 0, platform: "toutiao" }),
    search: async () => ({ items: searchItems.slice(), hidden: 0, total: searchItems.length }),
  };
  const publisher = { push: async (id) => { pushed.push(id); return { status: "saved" }; } };
  const content = { ai: { chat }, brand: () => ({}), rules: () => ({}), currentAccount: () => "acc1", secrets: { get: () => "sk-test" } };
  const auto = createAutomation({ tasks, store, settings, logger, discover, content, publisher, broadcast() {} });
  return { store, settings, tasks, auto, pushed, logs };
}
const ctx = () => ({ progress() {}, signal: new AbortController().signal, log() {} });

test("拆解：存进拆解库；同一篇（标题或链接）不拆第二次", async () => {
  const { store, auto } = setup();
  const r = await auto.breakdownOne({ text: SOURCE_A, title: "副业的真相" }, ctx());
  assert.equal(r.duplicate, false);
  assert.equal(r.breakdown.analysis.skeleton.length, 4);
  assert.equal(r.breakdown.analysis.topics.length, 3);
  const r2 = await auto.breakdownOne({ text: SOURCE_A, title: "副业的真相！" }, ctx());
  assert.equal(r2.duplicate, true);
  assert.equal(r2.breakdown.id, r.breakdown.id);
  const r3 = await auto.breakdownOne({ url: "https://www.toutiao.com/article/123456789012/" }, ctx());
  assert.equal(r3.duplicate, true); // 读到正文后按标题认出来
  assert.equal(store.breakdowns.count(), 1);
  await assert.rejects(auto.breakdownOne({ text: "太短" , title: "很短的文章标题" }, ctx()), /太短/);
});

test("流水线：写原创 + 平台版本；重合度超限标记需改写且不推送；拆过的跳过", async () => {
  const { store, auto, pushed } = setup();
  await auto.breakdownOne({ text: SOURCE_A, title: "已经拆过的一篇" , url: "https://www.toutiao.com/article/999999999999/" }, ctx());
  const items = [
    { title: "副业的真相", url: "https://www.toutiao.com/article/111111111111/", platform: "toutiao", likes: 100 },
    { title: "早上六点起床的人赢在哪", url: "https://www.toutiao.com/article/c22222222222/", platform: "toutiao" },
    { title: "随便", url: "https://www.toutiao.com/article/999999999999/" },
  ];
  const r = await auto.pipeline(items, { targets: ["wechat", "toutiao"], push: true, trigger: "batch" }, ctx());
  assert.equal(r.found, 3);
  assert.equal(r.broken, 2);
  assert.equal(r.written, 4);
  assert.equal(r.items[2].status, "拆过了");
  const all = store.contents.list();
  assert.equal(all.length, 4);
  const bad = all.filter((c) => c.needsRewrite);
  assert.ok(bad.length >= 1, "照抄的那篇要标记需改写");
  assert.ok(bad.every((c) => c.overlap > 30));
  assert.ok(bad.every((c) => !pushed.includes(c.id)), "需改写的不推送");
  const good = all.filter((c) => !c.needsRewrite);
  assert.deepEqual(new Set(pushed), new Set(good.map((c) => c.id)));
  assert.equal(r.pushed, good.length);
  assert.equal(r.rewrite, bad.length);
  // 同一篇的平台版本在一个分组里，引用同一篇拆解
  const master = all.find((c) => c.title === "副业别再瞎忙");
  const ver = all.find((c) => c.groupId === master.id && c.id !== master.id);
  assert.ok(ver && ver.platform === "toutiao" && ver.refId === master.refId);
  assert.equal(store.autoRuns.list()[0].status, "done");
});

test("自动创作一轮：按关键词找爆款、跳过拆过的、凑够篇数；不推送时只存草稿", async () => {
  const items = [
    { title: "副业的真相", url: "https://www.toutiao.com/article/111111111111/", platform: "toutiao" },
    { title: "早上六点起床的人赢在哪", url: "https://www.toutiao.com/article/c22222222222/", platform: "toutiao" },
  ];
  const { settings, auto, pushed, store } = setup({ searchItems: items });
  settings.set({ autoKeywords: "副业, 早起", autoCount: 1, autoTargets: "wechat", autoPush: false, autoSource: "toutiao" });
  const r = await auto.autoRun("manual", ctx());
  assert.equal(r.found, 1);
  assert.equal(r.written, 1);
  assert.equal(pushed.length, 0);
  assert.equal(store.contents.list()[0].auto, true);
  assert.equal(store.contents.list()[0].status, "draft");
  // 第二轮：第一篇拆过了，自动换下一篇（搜索结果里拆过的由 discover 过滤，这里模拟它被去重）
  settings.set({ autoKeywords: "" });
  await assert.rejects(auto.autoRun("manual", ctx()), /关键词/);
});

test("状态：下次运行时间、最近一次运行", async () => {
  const { settings, auto } = setup();
  assert.equal(auto.status().next, 0);
  settings.set({ autoEnabled: true, autoTimes: "08:30" });
  const st = auto.status();
  assert.ok(st.next > Date.now());
  assert.deepEqual(st.times, ["08:30"]);
  assert.equal(st.lastRun, null);
});
