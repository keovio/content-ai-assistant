"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../lib/compliance");

test("违规检测：高风险词", () => {
  const r = C.check("这是全网第一的面霜，根治痘痘，加我微信领取试用");
  assert.equal(r.level, "high");
  const words = r.issues.map((x) => x.word);
  assert.ok(words.includes("全网第一") && words.includes("根治") && words.includes("加我微信"));
});
test("违规检测：中风险只提醒", () => {
  const r = C.check("觉得有用就转发到朋友圈，求关注");
  assert.equal(r.level, "mid");
});
test("违规检测：正常文章无问题、不扫图片标记", () => {
  assert.equal(C.check("早起的人赢在哪里？三个习惯分享给你。\n![最好的风景](cai-img:a.png)").level, "");
  assert.equal(C.check("最好的方法是早睡").level, "");
  const s = C.summary("国家级认证，最强面霜");
  assert.equal(s.riskLevel, "high"); assert.deepEqual(s.riskWords, ["国家级", "最强"]);
});
