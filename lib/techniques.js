"use strict";
// 写法库：把拆解库里每篇的「可复用写法 / 开头钩子 / 标题公式」汇总起来，写稿时按选题挑合适的几条
// 纯函数，方便单测。

const norm = (s) => String(s || "").replace(/\s+/g, "").toLowerCase();
function grams(s) {
  const t = norm(s).replace(/[^\p{L}\p{N}]/gu, "");
  const out = new Set();
  for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
  return out;
}
function sim(a, b) {
  const A = grams(a), B = grams(b);
  if (!A.size || !B.size) return 0;
  let n = 0;
  for (const g of A) if (B.has(g)) n++;
  return n / Math.min(A.size, B.size);
}

// 拆解库 → 写法列表 [{ id, kind, text, from, fromId, at }]，内容几乎一样的只留一条
function buildLibrary(breakdowns = []) {
  const out = [];
  const seen = [];
  const add = (kind, text, b) => {
    const t = String(text || "").trim();
    if (t.length < 4) return;
    const k = norm(t);
    if (seen.some((s) => s === k || (s.length > 12 && k.length > 12 && sim(s, k) > 0.85))) return;
    seen.push(k);
    out.push({ id: `${b.id}:${kind}:${out.length}`, kind, text: t.slice(0, 300), from: String(b.title || "").slice(0, 80), fromId: b.id, at: b.createdAt || 0, topics: (b.analysis.topics || []).map((x) => x.title || "").join(" ") });
  };
  const list = [...breakdowns].filter((b) => b && b.analysis).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  for (const b of list) {
    for (const r of b.analysis.reusable || []) add("写法", r, b);
    if (b.analysis.hook) add("开头", b.analysis.hook, b);
    if (b.analysis.titleFormula) add("标题", b.analysis.titleFormula, b);
  }
  return out;
}

// 按选题挑写法：和选题越相关、越新越靠前；每种最多几条，避免全是同一类
function pickTechniques(library = [], topic = "", n = 5) {
  if (!library.length || n <= 0) return [];
  const newest = Math.max(...library.map((x) => x.at || 0)) || 1;
  const scored = library.map((x, i) => ({
    x,
    s: (topic ? sim(topic, `${x.from} ${x.topics}`) * 2 + sim(topic, x.text) : 0) + (x.at ? 0.3 * (x.at / newest) : 0) - i * 0.001 + (x.kind === "写法" ? 0.15 : 0),
  })).sort((a, b) => b.s - a.s);
  const cap = { 写法: Math.max(1, n - 2), 开头: 1, 标题: 1 };
  const used = { 写法: 0, 开头: 0, 标题: 0 };
  const out = [];
  for (const { x } of scored) {
    if (out.length >= n) break;
    if (used[x.kind] >= cap[x.kind]) continue;
    used[x.kind]++;
    out.push(x);
  }
  return out;
}

module.exports = { buildLibrary, pickTechniques, sim };
