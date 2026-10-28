"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { pickMaterials, matchImage } = require("../lib/library");

const mats = [
  { id: "a", kind: "data", title: "咖啡店租金", content: "一线城市社区咖啡店月租金 2 万左右，回本周期 18 个月", tags: ["咖啡", "开店"], updatedAt: 2 },
  { id: "b", kind: "note", title: "跑步装备", content: "入门跑鞋 500 元足够", tags: ["跑步"], updatedAt: 3 },
  { id: "c", kind: "image", image: "x.png", title: "咖啡店门口", tags: ["咖啡"], content: "街角咖啡店门口，暖色灯光" },
];

test("pickMaterials 按选题挑相关文字素材，不含图片", () => {
  const r = pickMaterials(mats, "开一家咖啡店要多少钱", 3);
  assert.deepStrictEqual(r.map((m) => m.id), ["a"]);
  assert.deepStrictEqual(pickMaterials(mats, "", 3), []);
  assert.deepStrictEqual(pickMaterials(mats, "量子计算的新进展", 3), []);
});

test("matchImage 找画面相符的图片素材，用过的不再用", () => {
  const r = matchImage(mats, { alt: "咖啡店门口", prompt: "傍晚的街角咖啡店门口，暖色灯光，写实" });
  assert.strictEqual(r && r.image, "x.png");
  assert.strictEqual(matchImage(mats, { alt: "咖啡店门口", prompt: "街角咖啡店" }, new Set(["x.png"])), null);
  assert.strictEqual(matchImage(mats, { alt: "跑道", prompt: "清晨操场的红色跑道" }), null);
});
