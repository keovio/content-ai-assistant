"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const T = require("../lib/techniques");
const P = require("../lib/prompts");

const bd = (id, title, at, reusable, extra = {}) => ({ id, title, createdAt: at, analysis: { reusable, hook: extra.hook || "", titleFormula: extra.tf || "", topics: (extra.topics || []).map((t) => ({ title: t })) } });

test("写法库：汇总拆解库里的写法 / 开头 / 标题公式，重复的只留一条", () => {
  const lib = T.buildLibrary([
    bd("a", "普通人用 AI 做副业的 3 个方法", 1, ["用数字清单降低阅读门槛", "每段结尾抛一个小悬念"], { hook: "开头先说反常识结论", tf: "数字 + 人群 + 结果" }),
    bd("b", "早起的人到底赢在哪里", 2, ["用数字清单降低阅读门槛", "先讲自己失败的经历拉近距离"]),
  ]);
  assert.equal(lib.filter((x) => x.text === "用数字清单降低阅读门槛").length, 1);
  assert.equal(lib.length, 5);
  assert.ok(lib.some((x) => x.kind === "开头") && lib.some((x) => x.kind === "标题"));
});

test("按选题挑写法：相关的拆解优先，开头 / 标题各最多一条，数量不超过 n", () => {
  const lib = T.buildLibrary([
    bd("a", "AI 副业赚钱方法", 1, ["拿收入截图做开头", "讲清楚第一步怎么做"], { hook: "开头抛收入数字", topics: ["AI 写作副业"] }),
    bd("b", "早起习惯养成", 2, ["用打卡天数做标题", "结尾给一个今天就能做的小动作"], { hook: "开头讲闹钟", tf: "天数 + 变化" }),
  ]);
  const p = T.pickTechniques(lib, "普通人怎么用 AI 做副业", 3);
  assert.equal(p.length, 3);
  assert.equal(p[0].fromId, "a");
  assert.ok(p.filter((x) => x.kind === "开头").length <= 1);
  assert.deepEqual(T.pickTechniques([], "x", 3), []);
});

test("写稿提示词带上写法，没有就不出现", () => {
  const withT = P.draftPrompt({ topic: "t", techniques: [{ kind: "开头", text: "开头抛收入数字" }, "讲清楚第一步怎么做"] })[1].content;
  assert.match(withT, /从爆款里总结出的写法/);
  assert.match(withT, /【开头】开头抛收入数字/);
  assert.doesNotMatch(P.draftPrompt({ topic: "t" })[1].content, /总结出的写法/);
});
