"use strict";
// 素材库复用：写稿时按选题自动挑相关的文字素材；配图时先从图片素材里找画面相符的，找不到再生成。
// 纯函数，方便单测。
const { sim } = require("./techniques");

const textOf = (m) => `${m.title || ""} ${(m.tags || []).join(" ")} ${m.content || ""}`;
const isImage = (m) => m && m.kind === "image" && m.image;

// 文字素材：和选题相关度够的挑前 n 条（越新略优先）
function pickMaterials(list = [], topic = "", n = 3, min = 0.25) {
  const t = String(topic || "").trim();
  if (!t || n <= 0) return [];
  const pool = list.filter((m) => m && !isImage(m) && (m.content || m.title));
  const newest = Math.max(1, ...pool.map((m) => m.updatedAt || m.createdAt || 0));
  return pool
    .map((m) => {
      const head = sim(t, `${m.title || ""} ${(m.tags || []).join(" ")}`);
      const body = sim(t, String(m.content || "").slice(0, 600));
      const s = Math.max(head, body * 0.9);
      return { m, s, r: s + 0.05 * ((m.updatedAt || m.createdAt || 0) / newest) };
    })
    .filter((x) => x.s >= min)
    .sort((a, b) => b.r - a.r)
    .slice(0, n)
    .map((x) => x.m);
}

// 图片素材：给一张要配的图（说明 + 画面描述）找最相符的一张；used 里的不重复用
function matchImage(list = [], { alt = "", prompt = "" } = {}, used = new Set(), min = 0.5) {
  const q = `${alt} ${prompt}`.trim();
  if (!q) return null;
  let best = null;
  for (const m of list) {
    if (!isImage(m) || used.has(m.image)) continue;
    const label = `${m.title || ""} ${(m.tags || []).join(" ")}`;
    // 说明 / 标签要和这张图的说明对得上，画面描述做补充，避免只因一两个常见字就复用
    const s = Math.max(sim(alt, label) * (String(label).replace(/\s/g, "").length >= 2 ? 1 : 0), sim(q, `${label} ${m.content || ""}`) * 0.9);
    if (s >= min && (!best || s > best.s)) best = { m, s };
  }
  return best ? { ...best.m, score: Math.round(best.s * 100) / 100 } : null;
}

module.exports = { pickMaterials, matchImage, isImage, textOf };
