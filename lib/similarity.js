"use strict";
// 与原文的重合度（纯函数，可单测）。
//
// 做法：去掉空白和标点后，把稿子里所有「连续 n 个字和原文某处一模一样」的片段标出来，
// 被标到的字数 / 稿子总字数 = 重合度（0–100）。n 默认 8：8 个字连续相同基本就是照抄，
// 「人工智能」「普通人」这种常用词不会被算进去。
const clean = (s) => String(s || "").toLowerCase().replace(/[^\p{Script=Han}\p{L}\p{N}]+/gu, "");

function overlapRatio(draft, source, n = 8) {
  const a = clean(draft);
  const b = clean(source);
  if (a.length < n || b.length < n) return 0;
  const grams = new Set();
  for (let i = 0; i + n <= b.length; i++) grams.add(b.slice(i, i + n));
  const covered = new Uint8Array(a.length);
  for (let i = 0; i + n <= a.length; i++) {
    if (grams.has(a.slice(i, i + n))) covered.fill(1, i, i + n);
  }
  let hit = 0;
  for (const c of covered) hit += c;
  return Math.round((hit / a.length) * 100);
}

// 列出重合的原句（给用户看哪里要改）：返回稿子里最长的几段重合片段
function overlapSnippets(draft, source, { n = 8, max = 5 } = {}) {
  const raw = String(draft || "");
  const b = clean(source);
  if (b.length < n) return [];
  const grams = new Set();
  for (let i = 0; i + n <= b.length; i++) grams.add(b.slice(i, i + n));
  const out = [];
  for (const sentence of raw.split(/[。！？!?\n；;]+/)) {
    const c = clean(sentence);
    if (c.length < n) continue;
    let hit = 0;
    const cov = new Uint8Array(c.length);
    for (let i = 0; i + n <= c.length; i++) if (grams.has(c.slice(i, i + n))) cov.fill(1, i, i + n);
    for (const x of cov) hit += x;
    if (hit / c.length >= 0.5) out.push({ text: sentence.trim().slice(0, 120), ratio: Math.round((hit / c.length) * 100) });
  }
  return out.sort((x, y) => y.ratio - x.ratio || y.text.length - x.text.length).slice(0, max);
}

const isTooSimilar = (ratio, limit) => Number(ratio) > Number(limit);

// 标题查重：去掉标点空格后完全相同、互相包含（≥8 字），或两字片段重合 ≥ 75% 都算重复
function titleKey(t) {
  return String(t || "").replace(/^#+\s*/, "").toLowerCase().replace(/[^\p{Script=Han}\p{L}\p{N}]+/gu, "");
}
function bigrams(s) { const set = new Set(); for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2)); return set; }
function sameTitle(a, b) {
  const x = titleKey(a), y = titleKey(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [s, l] = x.length <= y.length ? [x, y] : [y, x];
  if (s.length >= 8 && l.includes(s)) return true;
  if (s.length < 6) return false;
  const A = bigrams(x), B = bigrams(y);
  let n = 0; for (const g of A) if (B.has(g)) n++;
  return (2 * n) / (A.size + B.size) >= 0.75;
}
// 在 list 里找跟 title 重复的那个，没有返回 ""
function dupTitleOf(title, list = []) {
  for (const t of list) if (sameTitle(title, t)) return String(t);
  return "";
}

module.exports = { overlapRatio, overlapSnippets, isTooSimilar, titleKey, sameTitle, dupTitleOf };
