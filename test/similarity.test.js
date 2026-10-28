"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { overlapRatio, overlapSnippets, isTooSimilar } = require("../lib/similarity");

const SRC = "很多人以为副业就是多打一份工。其实真正赚钱的副业，是把你本职工作里已经练熟的能力，换一个场景再卖一次。我身边一个做财务的朋友，下班后帮小公司做账，一个月多赚八千。";

test("重合度：照抄 100%，完全不同 0%", () => {
  assert.equal(overlapRatio(SRC, SRC), 100);
  assert.equal(overlapRatio("今天天气不错，我们去公园散步，顺便买杯咖啡回家看书。", SRC), 0);
  assert.equal(overlapRatio("", SRC), 0);
  assert.equal(overlapRatio("短", SRC), 0);
});

test("重合度：标点和空格不影响；部分抄袭按字数比例", () => {
  assert.equal(overlapRatio(SRC.replace(/，/g, " , ").replace(/。/g, "!"), SRC), 100);
  const half = "其实真正赚钱的副业，是把你本职工作里已经练熟的能力换一个场景再卖一次。" + "我更建议你先列出三件别人常来请教你的事情，然后挑一件最容易标准化的开始试。";
  const r = overlapRatio(half, SRC);
  assert.ok(r > 30 && r < 70, String(r));
  // 常见短词（少于 8 个字连续相同）不算重合
  assert.equal(overlapRatio("副业不是多打一份工，而是练熟能力后的再利用，场景决定价格高低。", SRC), 0);
});

test("重合的句子 + 是否超过上限", () => {
  const draft = "开头随便写点别的内容让它不一样。很多人以为副业就是多打一份工。结尾也写点完全不同的东西吧。";
  const sn = overlapSnippets(draft, SRC);
  assert.equal(sn.length, 1);
  assert.equal(sn[0].text, "很多人以为副业就是多打一份工");
  assert.equal(isTooSimilar(31, 30), true);
  assert.equal(isTooSimilar(30, 30), false);
});

test("sameTitle：同一标题 / 只差标点 / 互相包含 / 近似都算重复", () => {
  const { sameTitle, dupTitleOf } = require("../lib/similarity");
  assert.equal(sameTitle("30岁以后，我才明白的5件事", "30岁以后我才明白的5件事！"), true);
  assert.equal(sameTitle("# 打工人如何三个月存下第一笔钱", "打工人如何三个月存下第一笔钱（干货）"), true);
  assert.equal(sameTitle("打工人如何三个月存下第一笔钱", "打工人怎样三个月存下第一笔钱"), true);
  assert.equal(sameTitle("打工人如何三个月存下第一笔钱", "租房避坑：签合同前一定要看这几点"), false);
  assert.equal(sameTitle("", "随便"), false);
  assert.equal(dupTitleOf("租房避坑指南大全", ["别的标题", "租房避坑指南大全！"]), "租房避坑指南大全！");
  assert.equal(dupTitleOf("全新的话题标题", ["别的标题"]), "");
});
