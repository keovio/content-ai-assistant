"use strict";
// 0.4.1 新增数据的校验：拆解库、平台号、自动创作记录、稿件的新字段、自动创作设置
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { createStore, stats, analysisOf } = require("../lib/store");
const { createSettings } = require("../lib/settings");
const { AUTO_SCHEMA, targetsOf, splitList } = require("../lib/automation");
const { tmp } = require("./helpers");

test("拆解库：字段校验、列表截断、3 个选题、坏数据兜底", () => {
  const s = createStore(tmp());
  const b = s.breakdowns.upsert({
    platform: "weibo", title: "", url: "javascript:x", canonicalUrl: "https://mp.weixin.qq.com/s/abcdef", likes: "12", comments: -3,
    origin: "hack", sourceText: "x".repeat(40000),
    analysis: { titleFormula: "数字 + 痛点", hook: 123, skeleton: "第一段\n第二段", emotions: ["焦虑", "", null], highlights: [{ text: "反常识" }], reusable: "a", avoid: [],
      topics: ["选题一", { title: "选题二", angle: "角度" }, { title: "" }, { title: "选题三" }, { title: "选题四" }] },
  });
  assert.equal(b.platform, "other");
  assert.equal(b.title, "未命名");
  assert.equal(b.url, "");
  assert.equal(b.canonicalUrl, "https://mp.weixin.qq.com/s/abcdef");
  assert.equal(b.likes, 12);
  assert.equal(b.comments, 0);
  assert.equal(b.origin, "paste");
  assert.equal(b.sourceText.length, 30000);
  assert.deepEqual(b.analysis.skeleton, ["第一段", "第二段"]);
  assert.deepEqual(b.analysis.emotions, ["焦虑"]);
  assert.deepEqual(b.analysis.highlights, ["反常识"]);
  assert.equal(b.analysis.hook, "123");
  assert.deepEqual(b.analysis.topics.map((t) => t.title), ["选题一", "选题二", "选题三"]);
  assert.deepEqual(analysisOf(null).topics, []);
  assert.deepEqual(analysisOf("坏数据").skeleton, []);
});

test("平台号：同一平台可以多个，partition 必须是 persist: 开头", () => {
  const s = createStore(tmp());
  const a = s.platformAccounts.upsert({ platform: "toutiao", name: "  头条号1 ", partition: "persist:pa-abc123", boundAccountId: "acc1", loggedIn: 1 });
  const b = s.platformAccounts.upsert({ platform: "toutiao", name: "", partition: "../../etc" });
  const c = s.platformAccounts.upsert({ platform: "nope", partition: "persist:pub-acc1-wechat" });
  assert.equal(a.name, "头条号1");
  assert.equal(a.loggedIn, true);
  assert.equal(b.name, "未命名");
  assert.equal(b.partition, "");
  assert.equal(c.platform, "wechat");
  assert.equal(s.platformAccounts.list().filter((x) => x.platform === "toutiao").length, 2);
});

test("稿件新字段：重合度范围、需改写、平台号、版本分组；推送记录带平台号", () => {
  const s = createStore(tmp());
  const c = s.contents.upsert({ title: "t", body: "b", overlap: 150, needsRewrite: "yes", refId: "r1", groupId: "g1", platformAccountId: "p1",
    pushes: { toutiao: { status: "saved", at: 1, accountId: "p1", accountName: "头条号1", url: "https://mp.toutiao.com/x" }, weibo: { status: "saved" } } });
  assert.equal(c.overlap, 100);
  assert.equal(c.needsRewrite, true);
  assert.equal(c.pushes.toutiao.accountName, "头条号1");
  assert.equal(c.pushes.weibo, undefined);
  assert.equal(s.contents.upsert({ title: "x" }).overlap, -1);
  assert.equal(s.contents.upsert({ title: "x", overlap: "abc" }).overlap, -1);
  assert.equal(s.contents.upsert({ title: "x", overlap: 0 }).overlap, 0);
});

test("自动创作记录：状态、触发方式、条目截断", () => {
  const s = createStore(tmp());
  const r = s.autoRuns.upsert({ trigger: "x", status: "weird", found: "3", items: Array.from({ length: 60 }, (_, i) => ({ title: "t" + i, url: "ftp://x", contentIds: ["a", "b"] })) });
  assert.equal(r.trigger, "manual");
  assert.equal(r.status, "done");
  assert.equal(r.found, 3);
  assert.equal(r.items.length, 40);
  assert.equal(r.items[0].url, "");
});

test("工作台统计：需改写、推送失败、已推草稿箱、拆解数", () => {
  const s = createStore(tmp());
  s.contents.upsert({ accountId: "a", title: "1", platform: "toutiao", needsRewrite: true });
  s.contents.upsert({ accountId: "a", title: "2", platform: "toutiao", pushes: { toutiao: { status: "failed", at: 1 } } });
  s.contents.upsert({ accountId: "a", title: "3", platform: "wechat", pushes: { wechat: { status: "saved", at: 1 } } });
  s.contents.upsert({ accountId: "b", title: "4", platform: "wechat", needsRewrite: true });
  s.breakdowns.upsert({ title: "爆款" });
  const st = stats(s, "2026-10-28", "a");
  assert.equal(st.needsRewrite.length, 1);
  assert.equal(st.pushFailed.length, 1);
  assert.equal(st.pushed, 1);
  assert.equal(st.breakdowns, 1);
});

test("自动创作设置：默认值和校验", () => {
  const set = createSettings({ file: path.join(tmp(), "s.json"), schema: AUTO_SCHEMA });
  assert.equal(set.get("autoEnabled"), false);
  assert.equal(set.get("autoDays"), 3);
  assert.equal(set.get("overlapLimit"), 30);
  const r = set.set({ autoCount: 99, overlapLimit: 1, autoSource: "weibo", autoDays: 7 });
  assert.equal(set.get("autoCount"), 10);
  assert.equal(set.get("overlapLimit"), 5);
  assert.equal(set.get("autoSource"), "wechat");
  assert.equal(set.get("autoDays"), 7);
  assert.equal(r.ok, false);
  assert.deepEqual(targetsOf("wechat, weibo，toutiao,wechat"), ["wechat", "toutiao"]);
  assert.deepEqual(splitList("AI 工具，职场\n效率;"), ["AI 工具", "职场", "效率"]);
});
