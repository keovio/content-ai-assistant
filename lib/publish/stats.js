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
const PLACEHOLDER = /^(--+|-|—+|暂无(数据)?|N\/A|\.\.\.|…)$/i;
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
      // 0.5.5：紧挨着的那一行是「--」「暂无」这种占位，说明数字还没出来，别去拿另一边别的指标的数字
      if (near[0] != null && PLACEHOLDER.test(near[0])) continue;
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

// ---------- 0.5.5：从后台接口返回的 JSON 里找数字（页面文字读不到时补上，百家号这类数据异步加载的后台靠它） ----------
// 键名按优先级：带 total / 累计的优先
const JSON_KEYS = {
  fans: [/^(total|all|sum)_?(fans|fan|followers?|subscribers?)(_?(num|cnt|count|amount))?$/i, /^(fans|fan|followers?|subscribers?)_?(total|num|cnt|count|amount)$/i, /^(fans|followers)$/i, /^fansNum$/i],
  reads: [/^(total|all|sum)_?(reads?|views?|plays?|pv|view_count|read_count|play_count)(_?(num|cnt|count|pv|amount))?$/i, /^(reads?|views?|plays?)_?(total|num|cnt|count|pv|amount)$/i, /^(read|view|play)Num$/i],
  income: [/^(total|all|sum|history)_?(income|revenue|earnings?|profit|money)(_?(amount|num|total))?$/i, /^(income|revenue|earnings?)_?(total|amount|num)?$/i],
};
function numFromJson(v) {
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v * 100) / 100 : null;
  if (typeof v === "string" && v.length < 20) return parseNumber(v);
  return null;
}
// objs：接口返回的对象数组（按收到的顺序）。返回 { fans, reads, income, found, keys }
function statsFromJson(objs = [], keys = JSON_KEYS) {
  const out = { fans: null, reads: null, income: null, found: 0 };
  const seen = new Set();
  for (const k of METRICS) {
    const pats = keys[k] || [];
    for (let p = 0; p < pats.length && out[k] == null; p++) {
      for (const o of objs) {
        const v = findKey(o, pats[p], 0, seen);
        if (v != null) { out[k] = v; break; }
      }
    }
    if (out[k] != null) out.found++;
  }
  out.keys = [...seen].slice(0, 40);
  return out;
}
function findKey(o, re, depth, seen) {
  if (!o || typeof o !== "object" || depth > 8) return null;
  if (Array.isArray(o)) {
    // 列表里一般是「推荐作者」「文章」之类，别从里面拿账号数据；只看前两项里的对象
    return null;
  }
  for (const [k, v] of Object.entries(o)) {
    if (depth < 4 && seen.size < 200) seen.add(k);
    if (re.test(k)) { const n = numFromJson(v); if (n != null && n >= 0) return n; }
  }
  for (const v of Object.values(o)) {
    if (v && typeof v === "object") { const n = findKey(v, re, depth + 1, seen); if (n != null) return n; }
  }
  return null;
}
// 页面文字读到的优先，没读到的指标用接口里的补
function mergeStats(text, json) {
  const out = { fans: null, reads: null, income: null, found: 0, from: {} };
  for (const k of METRICS) {
    const a = text && text[k] != null ? text[k] : null;
    const b = json && json[k] != null ? json[k] : null;
    out[k] = a != null ? a : b;
    if (out[k] != null) { out.found++; out.from[k] = a != null ? "page" : "api"; }
  }
  return out;
}

// ---------- 0.5.5：每天一份快照，算本日 / 本周 / 本月的增长 ----------
const HISTORY_DAYS = 400;
const pad = (n) => String(n).padStart(2, "0");
function dayKey(ts = Date.now()) { const d = new Date(ts); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
function historyOf(v) {
  if (!Array.isArray(v)) return [];
  const map = new Map();
  for (const x of v) {
    if (!x || !DAY_RE.test(String(x.d))) continue;
    map.set(x.d, { d: x.d, fans: numOrNull(x.fans), reads: numOrNull(x.reads), income: numOrNull(x.income) });
  }
  return [...map.values()].sort((a, b) => (a.d < b.d ? -1 : 1)).slice(-HISTORY_DAYS);
}
// 同一天读多次只留最后一次
function pushHistory(history, stats, ts = Date.now()) {
  const h = historyOf(history).filter((x) => x.d !== dayKey(ts));
  const s = statsOf(stats);
  h.push({ d: dayKey(ts), fans: s.fans, reads: s.reads, income: s.income });
  return historyOf(h);
}
// 一个号每天的增量：和上一份快照比，中间断了几天就算到有快照的这一天
function dailyDeltasOf(history) {
  const h = historyOf(history);
  const out = new Map();
  for (let i = 1; i < h.length; i++) {
    const row = {};
    for (const k of METRICS) {
      const a = h[i - 1][k], b = h[i][k];
      row[k] = a != null && b != null ? Math.round((b - a) * 100) / 100 : null;
    }
    out.set(h[i].d, row);
  }
  return out;
}
// 时段里的每一天：day = 最近 7 天（今天在最后），week = 本周一到周日，month = 本月 1 号到月底
function periodDays(period, now = Date.now()) {
  const d = new Date(now); d.setHours(12, 0, 0, 0);
  const days = [];
  const add = (x) => days.push(dayKey(x));
  if (period === "week") {
    const mon = new Date(d); mon.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    for (let i = 0; i < 7; i++) { const x = new Date(mon); x.setDate(mon.getDate() + i); add(x); }
  } else if (period === "month") {
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0, 12).getDate();
    for (let i = 1; i <= last; i++) add(new Date(d.getFullYear(), d.getMonth(), i, 12));
  } else {
    for (let i = 6; i >= 0; i--) { const x = new Date(d); x.setDate(d.getDate() - i); add(x); }
  }
  return days;
}
// 所有已登录号合计：{ period, today, days: [{ d, fans, reads, income, future }], sum: { fans, reads, income }, since }
// day 时段的 sum 只算今天；week / month 算整个时段
function growthOf(accounts = [], period = "day", now = Date.now()) {
  const days = periodDays(period, now);
  const today = dayKey(now);
  const per = days.map((d) => ({ d, fans: null, reads: null, income: null, future: d > today }));
  let since = "";
  for (const a of accounts) {
    if (!a || !a.loggedIn) continue;
    const h = historyOf(a.history);
    if (h.length && (!since || h[0].d < since)) since = h[0].d;
    const dd = dailyDeltasOf(h);
    for (const row of per) {
      const x = dd.get(row.d);
      if (!x) continue;
      for (const k of METRICS) if (x[k] != null) row[k] = Math.round(((row[k] || 0) + x[k]) * 100) / 100;
    }
  }
  const sum = { fans: null, reads: null, income: null };
  for (const row of per) {
    if (period === "day" && row.d !== today) continue;
    for (const k of METRICS) if (row[k] != null) sum[k] = Math.round(((sum[k] || 0) + row[k]) * 100) / 100;
  }
  return { period, today, days: per, sum, since };
}

module.exports = { METRICS, STALE_MS, RETRY_MS, JSON_KEYS, parseNumber, parseStats, readMetric, hasLabels, statsOf, isStale, totalsOf, statsFromJson, mergeStats, dayKey, historyOf, pushHistory, dailyDeltasOf, periodDays, growthOf };
