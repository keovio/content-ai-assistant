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

// 避开不好写的话题：时政、外交军事、官员反腐、灾难事故、刑事案件、讣告。个人号写这些风险大也没法写，找爆款时跳过
// 国内时政：政策会议、官员反腐、涉台涉港；社会负面：灾难事故、刑事案件、讣告
const AVOID_CATS = new Set(["politics", "taiwan", "government"]);
const AVOID_RE = /同志|遗像|乡村振兴|全面振兴|新质生产力|高质量发展|人民日报|新华社|央视|总台|浙江宣传|求是|重要讲话|重要指示|会议精神|座谈会|部署|国务院|中央|总书记|国家主席|部长|省长|市长|县长|官员|干部|书记|纪委|监委|落马|被查|双开|反腐|受贿|贪污|行贿|人大|政协|两会|党|政府|政策解读|领土|主权|台独|台海|涉台|涉港|涉藏|涉疆|台当局|逝世|去世|病逝|遇难|罹难|身亡|殒命|丧生|伤亡|死亡|致死|遇害|命案|凶手|行凶|嫌犯|嫌疑人|枪击|爆炸|坠毁|坠机|追尾|塌方|地震|洪灾|山火|火灾|恐袭|通报|判处|判决|死刑|无期|拘留|拘捕|刑拘|逮捕|警方|公安|检方|法院/;
// 今日热点里额外跳过的国内时政词（搜索结果里「台湾美食」之类不该误伤）
const AVOID_HOT_RE = /台湾|香港|邱毅/;
// 国际 / 军事：默认可以写，设置里打开「也避开国际 / 军事」才跳过
const INTL_CATS = new Set(["international", "military"]);
const INTL_RE = /外交部|总统|总理|首相|外长|防长|大使|领导人|议会|国会|议员|选举|大选|制裁|外交|特朗普|拜登|普京|泽连斯基|内塔尼亚胡|北约|联合国|军方|军队|解放军|部队|导弹|航母|战机|军舰|演习|战争|开战|冲突|空袭|袭击|停火|核武/;
const INTL_HOT_RE = /中方|美国|美方|日方|俄方|乌方|美日|中美|中日|中俄|日本|俄罗斯|乌克兰|以色列|巴勒斯坦|加沙|伊朗|朝鲜|韩国|菲律宾|古巴|欧盟|白宫|五角大楼/;
function splitWords(v) { return (Array.isArray(v) ? v : String(v || "").split(/[,，;；\s、]+/)).map((s) => String(s).trim()).filter(Boolean).slice(0, 100); }
// 返回跳过的原因（空字符串 = 可以写）。opts: { on: 内置时政过滤（默认开）, intl: 也跳过国际 / 军事, category, words: 自定义屏蔽词, hot: 是否今日热点 }
function avoidReason(title, opts = {}) {
  const t = String(title || "");
  if (!t) return "";
  const cats = String(opts.category || "").split(",").map((s) => s.trim()).filter(Boolean);
  for (const w of splitWords(opts.words)) if (t.includes(w)) return `屏蔽词「${w}」`;
  if (opts.on === false) return "";
  if (cats.some((c) => AVOID_CATS.has(c))) return "时政";
  let m = t.match(AVOID_RE) || (opts.hot ? t.match(AVOID_HOT_RE) : null);
  if (m) return `时政新闻「${m[0]}」`;
  if (!opts.intl) return "";
  if (cats.some((c) => INTL_CATS.has(c))) return "国际 / 军事";
  m = t.match(INTL_RE) || (opts.hot ? t.match(INTL_HOT_RE) : null);
  return m ? `国际 / 军事「${m[0]}」` : "";
}

// 没填关键词时用今日热点当关键词：头条热榜和百度热搜交替取，同一个话题只取一次；avoid = { on, words } 时跳过不好写的
function pickHotTopics(hot, n = 3, avoid = null) {
  const a = (hot && hot.toutiao) || [], b = (hot && hot.baidu) || [];
  const out = [], seen = new Set();
  for (let i = 0; out.length < n && i < Math.max(a.length, b.length); i++) {
    for (const x of [a[i], b[i]]) {
      const t = x && String(x.title || x.word || x || "").trim();
      if (!t || out.length >= n) continue;
      if (avoid && avoidReason(t, { on: avoid.on, intl: avoid.intl, category: x.category, words: avoid.words, hot: true })) continue;
      const k = t.toLowerCase().replace(/[^\p{Script=Han}\p{L}\p{N}]+/gu, "");
      if (!k || seen.has(k)) continue;
      seen.add(k); out.push(t);
    }
  }
  return out;
}

module.exports = { avoidReason, pickHotTopics, DAY, parseTime, fmtTime, parseCount, sortByHeat, withinDays, normalizeUrl, normalizeTitle, createDedupIndex, dedupe, normalizeItem };
