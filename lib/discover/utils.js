"use strict";
// 找爆款用到的纯函数（可单测）：时间解析、热度数字解析、按点赞排序、链接/标题归一化、去重索引。
//
//   parseTime("3小时前", now)        → 毫秒时间戳（解析不了返回 0）
//   parseCount("1.2万")              → 12000
//   sortByHeat(items)                → 有热度的按点赞（再按评论、阅读）从高到低排在前面，没热度的保持原顺序排在后面
//   withinDays(ts, days, now)        → days=0 表示不限；时间未知（0）的保留
//   normalizeUrl(url) / normalizeTitle(title) / createDedupIndex(list)：同一篇按「链接 + 标题」认，任意一个对上就算拆过

const DAY = 86400000;
const pad = (n) => String(n).padStart(2, "0");

// 本地时间 → 时间戳；非法返回 0
function local(y, mo, d, h = 0, mi = 0, s = 0) {
  const t = new Date(y, mo - 1, d, h, mi, s);
  if (t.getFullYear() !== y || t.getMonth() !== mo - 1 || t.getDate() !== d) return 0;
  return t.getTime();
}

function parseTime(input, now = Date.now()) {
  if (input == null) return 0;
  if (typeof input === "number") return input > 1e12 ? input : input > 1e9 ? input * 1000 : 0;
  const s = String(input).trim().replace(/\s+/g, " ");
  if (!s) return 0;
  if (/^\d{13}$/.test(s)) return Number(s);
  if (/^\d{10}$/.test(s)) return Number(s) * 1000;
  if (/刚刚|just now/i.test(s)) return now;
  let m = s.match(/(\d+(?:\.\d+)?)\s*(秒|分钟|分|小时|个小时|天|周|星期|个月|月|年)前/);
  if (m) {
    const n = Number(m[1]);
    const unit = { 秒: 1000, 分钟: 60000, 分: 60000, 小时: 3600000, 个小时: 3600000, 天: DAY, 周: 7 * DAY, 星期: 7 * DAY, 个月: 30 * DAY, 月: 30 * DAY, 年: 365 * DAY }[m[2]];
    return now - Math.round(n * unit);
  }
  const today = new Date(now);
  const hm = (str) => { const x = String(str || "").match(/(\d{1,2})[:：](\d{2})/); return x ? [Number(x[1]), Number(x[2])] : [0, 0]; };
  m = s.match(/^(今天|昨天|前天)\s*(.*)$/);
  if (m) {
    const back = { 今天: 0, 昨天: 1, 前天: 2 }[m[1]];
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - back);
    const [h, mi] = hm(m[2]);
    return local(d.getFullYear(), d.getMonth() + 1, d.getDate(), h, mi);
  }
  // 2026-10-27 14:05 / 2026/10/27 / 2026.10.27 / 2026年10月27日 14:05
  m = s.match(/(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*日?(?:\s*(\d{1,2})[:：](\d{2})(?:[:：](\d{2}))?)?/);
  if (m) return local(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0));
  // 10-27 14:05 / 10月27日：今年，若比现在晚一天以上就算去年
  m = s.match(/(?:^|\D)(\d{1,2})\s*[-/月]\s*(\d{1,2})\s*日?(?:\s*(\d{1,2})[:：](\d{2}))?(?!\d)/);
  if (m) {
    const mo = Number(m[1]), d = Number(m[2]);
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      let t = local(today.getFullYear(), mo, d, Number(m[3] || 0), Number(m[4] || 0));
      if (t && t > now + DAY) t = local(today.getFullYear() - 1, mo, d, Number(m[3] || 0), Number(m[4] || 0));
      return t;
    }
  }
  // 只有 14:05：当天
  m = s.match(/^(\d{1,2})[:：](\d{2})$/);
  if (m) return local(today.getFullYear(), today.getMonth() + 1, today.getDate(), Number(m[1]), Number(m[2]));
  return 0;
}

function fmtTime(ts, now = Date.now()) {
  if (!ts) return "";
  const diff = now - ts;
  if (diff < 60000) return "刚刚";
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < DAY) return `${Math.floor(diff / 3600000)} 小时前`;
  if (diff < 7 * DAY) return `${Math.floor(diff / DAY)} 天前`;
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// "1.2万" / "3.4w" / "1,234" / "10万+" / "1.1亿" / "2k" / "123赞" → 数字；解析不了返回 0
function parseCount(input) {
  if (typeof input === "number") return Number.isFinite(input) && input > 0 ? Math.round(input) : 0;
  const s = String(input == null ? "" : input).replace(/[,，\s]/g, "");
  const m = s.match(/(\d+(?:\.\d+)?)(万|w|W|亿|k|K|千)?/);
  if (!m) return 0;
  const mult = { 万: 1e4, w: 1e4, W: 1e4, 亿: 1e8, k: 1e3, K: 1e3, 千: 1e3 }[m[2]] || 1;
  return Math.round(Number(m[1]) * mult);
}

const heatOf = (x) => (Number(x && x.likes) || 0) > 0 || (Number(x && x.comments) || 0) > 0 || (Number(x && x.reads) || 0) > 0;
function sortByHeat(items) {
  const list = (Array.isArray(items) ? items : []).map((x, i) => ({ x, i }));
  const hot = list.filter((e) => heatOf(e.x)).sort((a, b) =>
    (Number(b.x.likes) || 0) - (Number(a.x.likes) || 0)
    || (Number(b.x.comments) || 0) - (Number(a.x.comments) || 0)
    || (Number(b.x.reads) || 0) - (Number(a.x.reads) || 0)
    || a.i - b.i);
  const cold = list.filter((e) => !heatOf(e.x));
  return hot.concat(cold).map((e) => e.x);
}

function withinDays(ts, days, now = Date.now()) {
  const d = Number(days) || 0;
  if (d <= 0 || !ts) return true;
  return ts >= now - d * DAY;
}

// 链接归一化：只保留能认出「同一篇」的部分；临时跳转链接（搜狗 /link）返回 ""
const TRACKING = /^(utm_\w+|wfr|for|spm|from|source|channel|share_\w+|scene|srcid|clicktime|enterid|ascene|devicetype|version|lang|nettype|pass_ticket|wx_header|exportkey|sessionid|chksm|xsec_\w+|log_pb|category_name|enter_from|search_id|req_id|timestamp|signature|ver|new|src|rd|is_\w+|tt_from|utm|app|isappinstalled)$/i;
function normalizeUrl(input) {
  let u;
  try { u = new URL(String(input || "").trim()); } catch { return ""; }
  if (!/^https?:$/.test(u.protocol)) return "";
  const host = u.hostname.toLowerCase().replace(/^www\./, "").replace(/^m\./, "");
  const p = u.searchParams;
  if (/(^|\.)sogou\.com$/.test(host) && /^\/link/.test(u.pathname)) return "";
  if (host === "mp.weixin.qq.com") {
    const sm = u.pathname.match(/^\/s\/([\w-]{6,})/);
    if (sm) return `wx:${sm[1]}`;
    if (p.get("__biz") && p.get("mid")) return `wx:${p.get("__biz")}:${p.get("mid")}:${p.get("idx") || "1"}`;
    if (p.get("src") && p.get("signature")) return ""; // 搜狗给的临时链接
  }
  let m;
  if (/toutiao\.com$/.test(host) && (m = u.pathname.match(/\/(?:article|group|item|w|a|i)\/?(\d{8,})/) || u.pathname.match(/\/a(\d{8,})/))) return `tt:${m[1]}`;
  if (/toutiao\.com$/.test(host) && p.get("group_id")) return `tt:${p.get("group_id")}`;
  if (host === "baijiahao.baidu.com" && p.get("id")) return `bjh:${p.get("id")}`;
  if (host === "mbd.baidu.com" && (m = u.pathname.match(/\/newspage\/data\/landingsuper/)) && p.get("nid")) return `bjh:${String(p.get("nid")).replace(/^news_/, "")}`;
  if (/xiaohongshu\.com$/.test(host) && (m = u.pathname.match(/\/(?:explore|discovery\/item|search_result|item)\/([0-9a-f]{16,})/i))) return `xhs:${m[1]}`;
  if (/douyin\.com$/.test(host) && (m = u.pathname.match(/\/(?:video|note)\/(\d{8,})/))) return `dy:${m[1]}`;
  if (/douyin\.com$/.test(host) && p.get("modal_id")) return `dy:${p.get("modal_id")}`;
  const keep = [...p.entries()].filter(([k]) => !TRACKING.test(k)).sort(([a], [b]) => a.localeCompare(b));
  const qs = keep.length ? "?" + keep.map(([k, v]) => `${k}=${v}`).join("&") : "";
  return `${host}${u.pathname.replace(/\/+$/, "") || "/"}${qs}`;
}

// 标题归一化：去掉空白、标点、表情、【】里的栏目名，转小写；太短（< 4 字）不参与去重
function normalizeTitle(input) {
  const s = String(input || "")
    .replace(/<[^>]+>/g, "")
    .toLowerCase()
    .replace(/[^\p{Script=Han}\p{L}\p{N}]+/gu, "");
  return s.length >= 4 ? s.slice(0, 120) : "";
}

// 去重索引：list 里每条有 url / canonicalUrl / title；has(item) 任意一个对上就算重复
function createDedupIndex(list = []) {
  const urls = new Set();
  const titles = new Set();
  const add = (x) => {
    if (!x) return;
    for (const k of [x.canonicalUrl, x.url, x.sourceUrl]) { const n = normalizeUrl(k); if (n) urls.add(n); }
    const t = normalizeTitle(x.title);
    if (t) titles.add(t);
  };
  const has = (x) => {
    if (!x) return false;
    for (const k of [x.canonicalUrl, x.url, x.sourceUrl]) { const n = normalizeUrl(k); if (n && urls.has(n)) return true; }
    const t = normalizeTitle(x.title);
    return !!t && titles.has(t);
  };
  (Array.isArray(list) ? list : []).forEach(add);
  return { add, has, size: () => urls.size + titles.size };
}

// 一次搜索结果内部去重（同一篇出现多次只留第一次）
function dedupe(items) {
  const idx = createDedupIndex();
  const out = [];
  for (const x of Array.isArray(items) ? items : []) { if (idx.has(x)) continue; idx.add(x); out.push(x); }
  return out;
}

// 搜索结果规范化：页面里抠出来的原始字段 → 统一结构
function normalizeItem(raw, platform, now = Date.now()) {
  const r = raw || {};
  const title = String(r.title || "").replace(/\s+/g, " ").trim().slice(0, 200);
  const url = /^https?:\/\//.test(String(r.url || "")) ? String(r.url).slice(0, 2000) : "";
  return {
    platform,
    title,
    url,
    author: String(r.author || "").replace(/\s+/g, " ").trim().slice(0, 60),
    summary: String(r.summary || "").replace(/\s+/g, " ").trim().slice(0, 300),
    publishedAt: parseTime(r.time, now),
    timeText: String(r.time || "").trim().slice(0, 40),
    likes: parseCount(r.likes),
    comments: parseCount(r.comments),
    reads: parseCount(r.reads),
  };
}

module.exports = { DAY, parseTime, fmtTime, parseCount, sortByHeat, withinDays, normalizeUrl, normalizeTitle, createDedupIndex, dedupe, normalizeItem };
