"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const P = require("../lib/prompts");

const brand = { name: "小林笔记", positioning: "AI 效率", audience: "职场人", tone: "真诚" };

test("账号定位写进 system 提示", () => {
  const m = P.draftPrompt({ brand, topic: "用 AI 写周报", platform: "xiaohongshu" });
  assert.equal(m[0].role, "system");
  assert.match(m[0].content, /小林笔记/);
  assert.match(m[0].content, /职场人/);
  assert.match(m[1].content, /用 AI 写周报/);
  assert.match(m[1].content, /小红书/);
  assert.equal(P.brandBlock({}), "");
});

test("写稿：素材、大纲、篇幅、未知平台退回公众号", () => {
  const m = P.draftPrompt({ topic: "t", platform: "nope", outline: "要点A", words: 99999, materials: [{ title: "数据", content: "增长 30%", url: "https://a.b" }] });
  assert.match(m[1].content, /公众号/);
  assert.match(m[1].content, /要点A/);
  assert.match(m[1].content, /约 8000 字/);
  assert.match(m[1].content, /增长 30%.*https:\/\/a\.b/);
});

test("选题：数量夹到范围，排除已有选题，要求 JSON", () => {
  const m = P.topicsPrompt({ count: 99, avoid: ["旧选题"], field: "母婴" });
  assert.match(m[1].content, /20 个选题/);
  assert.match(m[1].content, /旧选题/);
  assert.match(m[1].content, /JSON/);
});

test("改写 / 标题 / 润色", () => {
  assert.match(P.rewritePrompt({ source: "原文内容", platform: "douyin" })[1].content, /抖音口播[\s\S]*原文内容/);
  assert.match(P.titlesPrompt({ content: "x", count: 3 })[1].content, /3 个/);
  assert.match(P.polishPrompt({ text: "x", mode: "shorten" })[1].content, /精简/);
  assert.match(P.polishPrompt({ text: "x", mode: "??" })[1].content, /润色/);
});

test("splitTitle：# 标题 / 无标题 / 短首行当标题", () => {
  assert.deepEqual(P.splitTitle("# 标题\n\n正文"), { title: "标题", body: "正文" });
  assert.deepEqual(P.splitTitle("## 二级\n正文"), { title: "二级", body: "正文" });
  assert.equal(P.splitTitle("短标题\n正文").title, "短标题");
  const long = "很".repeat(60) + "\n后面";
  assert.equal(P.splitTitle(long).title, "");
});

test("normalizeTopics：容错各种返回格式", () => {
  const r = P.normalizeTopics({ topics: [{ title: " A ", platform: "douyin" }, "B", { title: "" }, null, { title: "C", platform: "x" }] });
  assert.deepEqual(r.map((t) => [t.title, t.platform]), [["A", "douyin"], ["B", "wechat"], ["C", "wechat"]]);
  assert.deepEqual(P.normalizeTopics(undefined), []);
});

test("countWords：中文按字，英文按词", () => {
  assert.equal(P.countWords("你好 world 123"), 4);
  assert.equal(P.countWords(""), 0);
});
