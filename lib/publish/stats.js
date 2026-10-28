"use strict";
// 账号数据（纯函数，可单测）：从各平台创作者后台首页的文字里读出粉丝、阅读、收益。
//
// 读法：后台窗口打开平台号的后台首页（lib/publish/platforms.js 里每个平台的 stats.url，默认 home），
// 取整页 innerText，按行切开，找「标签」所在的行，再取同一行标签后面的数字、或下一行（after）/ 上一行（before）的数字。
// 平台改版时一般只要改 platforms.js 里的标签，发增量包即可。
//
//   parseNumber("1.2万") → 12000      parseStats(text, cfg) → { fans, reads, income, found }
//   totalsOf(accounts) → { fans, reads, income, accounts, failed }      isStale(stats, now) → 是否该重读

const METRICS = ["fans", "reads", "income"];
const STALE_MS = 12 * 3600 * 1000;   // 超过 12 小时没更新就自动重读
const RETRY_MS = 3600 * 1000;        // 读失败的号至少隔 1 小时再试，避免每次检查都开窗口

// "12,345" "1.2万" "3.4w" "1.5亿" "¥12.34" "12.34元" "+56" → 数字；"--" "-" "暂无" → null
function parseNumber(input) {
  const s = String(input == null ? "" : input).replace(/[\s,，]/g, "").replace(/^[¥￥$+]/, "");
  const m = s.match(/^(-?\d+(?:\.\d+)?)(万|w|W|亿)?(?:元)?$/);
  if (!m) return null;
  let n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  if (m[2] === "万" || m[2] === "w" || m[2] === "W") n *= 1e4;
  else if (m[2] === "亿") n *= 1e8;
  return Math.round(n * 100) / 100;
}
// 一行里取第一个数字（标签后面跟着的）
const NUM_RE = /[¥￥]?\s*-?\d[\d,]*(?:\.\d+)?\s*(?:万|w|W|亿)?\s*元?/;
function numberIn(text) {
  const m = String(text || "").match(NUM_RE);
  return m ? parseNumber(m[0]) : null;
}
// 字符串标签要从行首开始匹配：「粉丝数」不会误认「新增粉丝数」
const labelRe = (l) => (l instanceof RegExp ? l : new RegExp("^" + String(l).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

// 读一个指标：labels 按优先级排，order = after（数字在标签下面，默认）/ before（数字在标签上面）
function readMetric(lines, labels, order = "after") {
  for (const l of labels || []) {
    const re = labelRe(l);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.length > 24) continue; // 长句子是正文 / 说明，不是数据标签
      const m = line.match(re);
      if (!m) continue;
      const rest = line.slice(m.index + m[0].length).replace(/^[\s:：]+/, "");
      const same = rest ? numberIn(rest) : null;
      if (same != null) return same;
      const near = order === "before" ? [lines[i - 1], lines[i + 1]] : [lines[i + 1], lines[i - 1]];
      for (const x of near) {
        const n = x != null ? parseNumber(x) : null;
        if (n != null) return n;
      }
    }
  }
  return null;
}

// cfg：{ fans: [标签…], reads: [...], income: [...], order }
function parseStats(text, cfg = {}) {
  const lines = String(text || "").split(/\n+/).map((x) => x.trim()).filter(Boolean);
  const out = { fans: null, reads: null, income: null, found: 0 };
  for (const k of METRICS) {
    out[k] = readMetric(lines, cfg[k] || [], cfg.order);
    if (out[k] != null) out.found++;
  }
  return out;
}

// 页面上出现了任意一个标签：说明数据区已经渲染出来了
function hasLabels(text, cfg = {}) {
  const s = String(text || "");
  const lines = s.split(/\n+/).map((x) => x.trim());
  return METRICS.some((k) => (cfg[k] || []).some((l) => lines.some((x) => labelRe(l).test(x))));
}

// 存进平台号的 stats 字段
const numOrNull = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Math.round(Number(v) * 100) / 100);
function statsOf(v) {
  const s = v && typeof v === "object" && !Array.isArray(v) ? v : {};
  return {
    fans: numOrNull(s.fans), reads: numOrNull(s.reads), income: numOrNull(s.income),
    at: Number(s.at) > 0 ? Number(s.at) : 0,          // 上次读成功的时间
    tried: Number(s.tried) > 0 ? Number(s.tried) : 0, // 上次尝试的时间
    error: typeof s.error === "string" ? s.error.slice(0, 300) : "",
  };
}

function isStale(stats, now = Date.now()) {
  const s = statsOf(stats);
  if (now - s.at < STALE_MS) return false;
  return now - s.tried >= RETRY_MS;
}

// 合计：只算已登录的号，没读到的指标不算进去
function totalsOf(accounts = []) {
  const out = { fans: null, reads: null, income: null, accounts: 0, failed: 0 };
  for (const a of accounts) {
    if (!a || !a.loggedIn) continue;
    out.accounts++;
    const s = statsOf(a.stats);
    if (s.error) out.failed++;
    for (const k of METRICS) if (s[k] != null) out[k] = Math.round(((out[k] || 0) + s[k]) * 100) / 100;
  }
  return out;
}

module.exports = { METRICS, STALE_MS, RETRY_MS, parseNumber, parseStats, readMetric, hasLabels, statsOf, isStale, totalsOf };
