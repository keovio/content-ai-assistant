"use strict";
// 找爆款 / 读正文的来源（纯数据 + 注入页面的小脚本）。平台改版时一般只改这里，发增量包即可。
//
// 每个来源：
//   name        显示名
//   warmup      搜索前先打开一次的页面（拿到站点 cookie，降低被当成机器人的概率），可选
//   searchUrl(keyword, { days, page })  搜索结果页地址
//   pages       最多翻几页
//   extract     在搜索结果页里执行的脚本，返回 [{ title, url, author, time, likes, comments, reads, summary }]
//   filterUrl   只保留这个平台的文章链接（可选，比如百家号只要 baijiahao.baidu.com）
//   needsLogin  搜索需要登录网页版（小红书 / 抖音），在「找爆款」里点「登录网页版」完成
//   loginUrl    登录网页版的地址
//   verified    是否已在真实网络上测通（false = 待确认）
//
// READER_JS：在文章页里执行，返回 { title, body, author, time, canonical, blocked }
// 今日热点：头条热榜、百度热搜（JSON 接口，主进程直接请求），parseToutiaoHot / parseBaiduHot 解析

const enc = encodeURIComponent;

// 页面里通用的小工具（每个 extract 前面都会拼上）
const PAGE_HELPERS = String.raw`
  const __txt = (el) => (el ? (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim() : "");
  const __q = (sel, root = document) => { try { return [...root.querySelectorAll(sel)]; } catch { return []; } };
  const __one = (sel, root = document) => { try { return root.querySelector(sel); } catch { return null; } };
  const __abs = (href) => { try { return new URL(href, location.href).href; } catch { return ""; } };
  const __TIME = /(刚刚|\d+\s*(秒|分钟|小时|天|周|个月)前|昨天|前天|今天|\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}|\d{1,2}[-月]\d{1,2}日?|^\d{1,2}:\d{2}$)/;
  // 把「观察者网 · 1评论 · 2小时前 · 3.2万赞」这类元信息拆成字段
  const __meta = (parts) => {
    const o = { author: "", time: "", likes: "", comments: "", reads: "" };
    for (const raw of parts) {
      const p = String(raw || "").trim();
      if (!p) continue;
      if (/赞|喜欢|点赞/.test(p) && /\d/.test(p)) { if (!o.likes) o.likes = p; continue; }
      if (/评论/.test(p) && /\d/.test(p)) { if (!o.comments) o.comments = p; continue; }
      if (/阅读|浏览|播放|观看/.test(p) && /\d/.test(p)) { if (!o.reads) o.reads = p; continue; }
      if (__TIME.test(p)) { if (!o.time) o.time = p; continue; }
      if (!o.author && p.length <= 30) o.author = p;
    }
    return o;
  };
`;

const SOURCES = {
  wechat: {
    name: "公众号",
    via: "搜狗微信搜索",
    warmup: "https://weixin.sogou.com/",
    // 搜狗的时间筛选（tsn）要登录才能用，未登录会被跳回首页：不带筛选，抓 3 页后按发布时间精确过滤
    searchUrl: (kw, { page = 1 } = {}) => `https://weixin.sogou.com/weixin?type=2&ie=utf8&query=${enc(kw)}${page > 1 ? `&page=${page}` : ""}`,
    pages: 3,
    extract: String.raw`(() => {
      return __q(".news-list > li").map((li) => {
        const a = __one(".txt-box h3 a", li) || __one("h3 a", li);
        if (!a) return null;
        const s2 = __one(".s-p .s2", li);
        const ts = s2 && (s2.innerHTML.match(/timeConvert\('(\d{10})'\)/) || [])[1];
        return {
          title: __txt(a), url: __abs(a.getAttribute("href")),
          author: __txt(__one(".s-p .all-time-y2", li) || __one(".s-p a.account", li)),
          time: ts || __txt(s2), summary: __txt(__one("p.txt-info", li)),
        };
      }).filter(Boolean);
    })()`,
    verified: true,
  },
  toutiao: {
    name: "头条",
    via: "头条搜索（资讯）",
    warmup: "https://www.toutiao.com/",
    searchUrl: (kw, { page = 1 } = {}) => `https://so.toutiao.com/search?keyword=${enc(kw)}&pd=information&source=search_subtab_switch&dvpf=pc&aid=4916&page_num=${page - 1}`,
    pages: 2,
    extract: String.raw`(() => {
      // 搜索结果链接是多层 jump 跳转，剥到真正的文章地址
      const unjump = (href) => {
        let u = __abs(href);
        for (let i = 0; i < 4; i++) {
          try { const x = new URL(u); if (/jump/.test(x.pathname) && x.searchParams.get("url")) { u = x.searchParams.get("url"); continue; } } catch { break; }
          break;
        }
        return u.replace(/^http:\/\/(www\.)?toutiao\.com\//, "https://www.toutiao.com/");
      };
      return __q(".cs-card").map((card) => {
        const a = __one(".cs-header a", card);
        if (!a) return null;
        const src = __one(".cs-source", card);
        // 元信息：优先取最里层的每个文字块（作者 / 评论 / 时间各占一块），取不到再按换行拆
        const leaves = src ? __q("span, div, a", src).filter((el) => !el.children.length).map(__txt).filter(Boolean) : [];
        const parts = leaves.length > 1 ? leaves : src ? (src.innerText || "").split(/\n|·/) : [];
        const texts = __q(".cs-text", card).map(__txt).filter((t) => t && t !== __txt(a));
        return { title: __txt(a), url: unjump(a.getAttribute("href")), summary: texts[0] || "", ...__meta(parts) };
      }).filter((x) => x && x.title);
    })()`,
    // 只要头条文章（去掉视频、问答、站外链接）
    filterUrl: /toutiao\.com\/(a\d|article|group|w\/|i\d)/,
    verified: true,
  },
  baijiahao: {
    name: "百家号",
    via: "百度资讯搜索",
    warmup: "https://www.baidu.com/",
    searchUrl: (kw, { page = 1 } = {}) => `https://www.baidu.com/s?tn=news&rtt=1&bsst=1&cl=2&wd=${enc(kw)}${page > 1 ? `&pn=${(page - 1) * 10}` : ""}`,
    pages: 3,
    filterUrl: /^https?:\/\/(baijiahao|mbd)\.baidu\.com\//,
    extract: String.raw`(() => {
      return __q("#content_left .result-op, #content_left .result").map((box) => {
        const a = __one("h3 a", box);
        if (!a) return null;
        const timeEl = __one("[aria-label^='发布于']", box) || __one(".c-color-gray2", box);
        const srcEl = __one("[aria-label^='新闻来源']", box) || __one(".c-color-gray", box);
        const sumEl = __one("[aria-label^='摘要']", box) || __one(".c-summary", box) || __one(".c-font-normal.c-color-text", box);
        return {
          title: __txt(a).replace(/^标题：/, ""), url: box.getAttribute("mu") || __abs(a.getAttribute("href")),
          time: __txt(timeEl), author: __txt(srcEl), summary: __txt(sumEl).replace(/^摘要\s*/, ""),
        };
      }).filter(Boolean);
    })()`,
    verified: true,
  },
  xiaohongshu: {
    name: "小红书",
    via: "小红书网页版搜索",
    warmup: "",
    searchUrl: (kw) => `https://www.xiaohongshu.com/search_result?keyword=${enc(kw)}&source=web_search_result_notes&type=51`,
    pages: 1,
    needsLogin: true,
    loginUrl: "https://www.xiaohongshu.com/explore",
    loginCookies: ["web_session"],
    cookieUrl: "https://www.xiaohongshu.com/",
    extract: String.raw`(() => {
      return __q("section.note-item").map((sec) => {
        const a = __one("a.cover", sec) || __one("a[href*='/explore/']", sec) || __one("a[href*='/search_result/']", sec);
        if (!a) return null;
        return {
          title: __txt(__one(".title span", sec) || __one(".title", sec) || __one(".footer", sec)),
          url: __abs(a.getAttribute("href")),
          author: __txt(__one(".author .name", sec) || __one(".name", sec)),
          likes: __txt(__one(".like-wrapper .count", sec) || __one(".count", sec)),
          time: __txt(__one(".time", sec)),
        };
      }).filter((x) => x && x.title);
    })()`,
    verified: false,
  },
  douyin: {
    name: "抖音",
    via: "抖音网页版搜索",
    warmup: "",
    // publish_time：1 一天内 / 7 一周内 / 180 半年内
    searchUrl: (kw, { days = 0 } = {}) => {
      const pt = days <= 0 ? "" : days <= 1 ? "&publish_time=1" : days <= 7 ? "&publish_time=7" : "&publish_time=180";
      return `https://www.douyin.com/search/${enc(kw)}?type=video${pt}`;
    },
    pages: 1,
    needsLogin: true,
    loginUrl: "https://www.douyin.com/",
    loginCookies: ["sessionid", "sessionid_ss"],
    cookieUrl: "https://www.douyin.com/",
    extract: String.raw`(() => {
      const seen = new Set();
      return __q("a[href*='/video/']").map((a) => {
        const href = __abs(a.getAttribute("href"));
        if (seen.has(href)) return null;
        seen.add(href);
        const box = a.closest("li") || a;
        const lines = (box.innerText || "").split(/\n/).map((s) => s.trim()).filter(Boolean);
        const likes = lines.find((s) => /^\d+(\.\d+)?[万wW亿]?$/.test(s)) || "";
        const author = (lines.find((s) => /^@/.test(s)) || "").replace(/^@/, "");
        const time = lines.find((s) => __TIME.test(s) && s.length < 16) || "";
        const title = lines.filter((s) => s !== likes && !/^@/.test(s) && s !== time && !/^\d{1,2}:\d{2}$/.test(s)).sort((x, y) => y.length - x.length)[0] || "";
        return { title, url: href, likes, author, time };
      }).filter((x) => x && x.title);
    })()`,
    verified: false,
  },
};

const SOURCE_IDS = Object.keys(SOURCES);

// 读正文：通用版。公众号 / 头条 / 百家号有专门的选择器，其他按「文字最多的块」兜底
const READER_JS = String.raw`(() => {
  ${PAGE_HELPERS}
  const href = location.href;
  const title0 = document.title || "";
  if (/antispider|captcha|verify|wappass\.baidu\.com/i.test(href) || /安全验证|验证码|访问过于频繁|环境异常/.test(title0)) return { blocked: true, url: href, title: title0 };
  const meta = (sel) => { const m = __one(sel); return m ? (m.getAttribute("content") || "").trim() : ""; };
  let canonical = meta("meta[property='og:url']") || ((__one("link[rel=canonical]") || {}).href || "");
  if (/mp\.weixin\.qq\.com/.test(href)) {
    const m = (document.documentElement.innerHTML.match(/var\s+msg_link\s*=\s*"([^"]+)"/) || [])[1];
    if (m) canonical = m.replace(/\\x26amp;|&amp;/g, "&").replace(/\\x26/g, "&").replace(/#rd$/, "");
  }
  const pick = (sels) => { for (const s of sels) { const el = __one(s); if (el && __txt(el).length > 0) return el; } return null; };
  const titleEl = pick(["#activity-name", ".rich_media_title", ".article-content h1", "[class*='article'] h1", "h1", "#detail-title", ".note-content .title"]);
  const bodySel = ["#js_content", ".rich_media_content", ".article-content article", ".article-content", "[data-testid='article']", "[class*='articleWrap']", "[class*='article-content']",
    "#detail-desc", ".note-content .desc", ".note-scroller .desc", "[data-e2e='video-desc']", "article"];
  let bodyEl = null;
  for (const s of bodySel) { const el = __one(s); if (el && (el.innerText || "").trim().length > 30) { bodyEl = el; break; } }
  if (!bodyEl) {
    // 兜底：含 <p> 文字最多的容器
    let best = null, bestLen = 0;
    for (const el of __q("article, section, div, main")) {
      const ps = __q(":scope > p, :scope > section > p, :scope > div > p", el);
      const len = ps.reduce((n, p) => n + (p.innerText || "").trim().length, 0);
      if (len > bestLen) { best = el; bestLen = len; }
    }
    bodyEl = bestLen > 80 ? best : document.body;
  }
  const body = (bodyEl ? bodyEl.innerText || "" : "").replace(/\u00a0/g, " ").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, 30000);
  // 原文配图：按出现顺序取正文里的图（懒加载的取 data-src），跳过二维码、表情、小图标
  const images = [];
  const seenImg = new Set();
  if (bodyEl && bodyEl !== document.body) {
    for (const img of __q("img", bodyEl)) {
      if (images.length >= 12) break;
      let src = img.getAttribute("data-src") || img.getAttribute("data-original") || img.getAttribute("data-actualsrc") || img.currentSrc || img.src || "";
      try { src = new URL(src, location.href).href; } catch (e) { continue; }
      if (!/^https?:/.test(src) || /\.svg(\?|$)|wx_fmt=gif|\.gif(\?|$)|emoji|emotion|qrcode|qr_code|avatar|icon/i.test(src)) continue;
      const alt = (img.getAttribute("alt") || img.getAttribute("data-alt") || "").trim();
      if (/二维码|扫码|关注|qrcode/i.test(alt + " " + (img.className || ""))) continue;
      const w = img.naturalWidth || Number(img.getAttribute("data-w")) || Number(img.getAttribute("width")) || 0;
      const h = img.naturalHeight || Number(img.getAttribute("height")) || 0;
      if ((w && w < 200) || (h && h < 120)) continue;
      const key = src.replace(/[?#].*$/, "");
      if (seenImg.has(key)) continue;
      seenImg.add(key);
      let after = "";
      try { const rg = document.createRange(); rg.setStart(bodyEl, 0); rg.setEndBefore(img); after = rg.toString().replace(/\s+/g, " ").trim().slice(-40); } catch (e) { /* ignore */ }
      images.push({ src, alt: alt.slice(0, 80), after });
    }
  }
  let cover = meta("meta[property='og:image']") || meta("meta[name='twitter:image']");
  if (/mp\.weixin\.qq\.com/.test(href)) {
    const m = (document.documentElement.innerHTML.match(/var\s+msg_cdn_url\s*=\s*"([^"]+)"/) || [])[1];
    if (m) cover = m;
  }
  try { if (cover) cover = new URL(cover, location.href).href; } catch (e) { cover = ""; }
  const authorEl = pick(["#js_name", ".rich_media_meta_nickname", ".article-meta .name", ".author-info .name", "[class*='authorName']", "[data-testid='author-name']", ".author-wrapper .name", ".author .name"]);
  const timeEl = pick(["#publish_time", ".article-meta .time", ".publish-time", "[data-testid='updatetime']", "[class*='publishTime']", ".date", ".time"]);
  return {
    url: href, canonical: canonical || href,
    title: __txt(titleEl) || meta("meta[property='og:title']") || title0.replace(/\s*[-_|].{0,20}$/, ""),
    author: __txt(authorEl) || meta("meta[name='author']"),
    time: __txt(timeEl), body, images, cover: /^https?:/.test(cover || "") ? cover : "",
  };
})()`;

// ---------------- 今日热点 ----------------
const HOT_SOURCES = {
  toutiao: { name: "头条热榜", url: "https://www.toutiao.com/hot-event/hot-board/?origin=toutiao_pc" },
  baidu: { name: "百度热搜", url: "https://top.baidu.com/api/board?platform=wise&tab=realtime" },
  weibo: { name: "微博热搜", url: "https://weibo.com/ajax/side/hotSearch", optional: true },
  zhihu: { name: "知乎热榜", url: "https://api.zhihu.com/topstory/hot-lists/total?limit=50", optional: true },
  douyin: { name: "抖音热榜", url: "https://www.iesdouyin.com/web/api/v2/hotsearch/billboard/word/", optional: true },
  bilibili: { name: "B站热搜", url: "https://s.search.bilibili.com/main/hotword", optional: true },
};
const HOT_IDS = Object.keys(HOT_SOURCES);

const hotNum = (v) => { const m = String(v == null ? "" : v).match(/([\d.]+)\s*(万|亿)?/); return m ? Math.round(Number(m[1]) * (m[2] === "亿" ? 1e8 : m[2] === "万" ? 1e4 : 1)) || 0 : 0; };
const clean = (arr) => arr.map((x) => ({ ...x, title: String(x.title || "").trim().slice(0, 80) })).filter((x) => x.title).slice(0, 30);
function parseWeiboHot(json) {
  const arr = (json && json.data && (json.data.realtime || json.data.band_list)) || [];
  return clean(arr.filter((x) => x && !x.is_ad && !x.ad_type).map((x) => ({ title: x.word || x.note, url: "", hot: Number(x.num || x.raw_hot) || 0, category: String(x.category || x.label_name || "") })));
}
function parseZhihuHot(json) {
  const arr = (json && json.data) || [];
  return clean(arr.map((x) => ({ title: x && x.target && (x.target.title || (x.target.title_area && x.target.title_area.text)), url: "", hot: hotNum(x && (x.detail_text || (x.target && x.target.metrics_area && x.target.metrics_area.text))) })));
}
function parseDouyinHot(json) {
  const arr = (json && (json.word_list || (json.data && json.data.word_list))) || [];
  return clean(arr.map((x) => ({ title: x && x.word, url: "", hot: Number(x && x.hot_value) || 0 })));
}
function parseBilibiliHot(json) {
  const arr = (json && (json.list || (json.data && json.data.trending && json.data.trending.list))) || [];
  return clean(arr.map((x) => ({ title: x && (x.show_name || x.keyword), url: "", hot: Number(x && x.heat_score) || 0 })));
}
const HOT_PARSERS = { toutiao: parseToutiaoHot, baidu: parseBaiduHot, weibo: parseWeiboHot, zhihu: parseZhihuHot, douyin: parseDouyinHot, bilibili: parseBilibiliHot };

function parseToutiaoHot(json) {
  const arr = json && Array.isArray(json.data) ? json.data : [];
  return arr.map((x) => ({
    title: String((x && (x.Title || x.title)) || "").trim().slice(0, 80),
    url: /^https:\/\//.test(String(x && x.Url)) ? String(x.Url).split("?")[0] : "",
    hot: Number(x && x.HotValue) || 0,
    // 头条给的分类：politics / international / taiwan / military / health / finance / sports …（不一定有）
    category: Array.isArray(x && x.InterestCategory) ? x.InterestCategory.map(String).join(",").slice(0, 100) : "",
  })).filter((x) => x.title).slice(0, 30);
}

function parseBaiduHot(json) {
  const out = [];
  const seen = new Set();
  (function walk(v, depth) {
    if (!v || depth > 8 || out.length >= 60) return;
    if (Array.isArray(v)) { v.forEach((x) => walk(x, depth + 1)); return; }
    if (typeof v !== "object") return;
    const word = typeof v.word === "string" ? v.word.trim() : typeof v.query === "string" && v.hotScore != null ? v.query.trim() : "";
    if (word && !seen.has(word)) {
      seen.add(word);
      out.push({ title: word.slice(0, 80), url: /^https:\/\//.test(String(v.url || v.rawUrl || "")) ? String(v.url || v.rawUrl) : "", hot: Number(v.hotScore) || 0, top: !!v.isTop });
    }
    for (const k of Object.keys(v)) if (v[k] && typeof v[k] === "object") walk(v[k], depth + 1);
  })(json && json.data, 0);
  return out.filter((x) => !x.top).slice(0, 30);
}

// 测试用：CAI_DISCOVER_OVERRIDES='{"toutiao":{"searchUrl":"http://127.0.0.1:5000/search?q={kw}","warmup":""},"hot":{"toutiao":"http://…"}}'
// 端到端测试连本地模拟平台
if (process.env.CAI_DISCOVER_OVERRIDES) {
  try {
    const o = JSON.parse(process.env.CAI_DISCOVER_OVERRIDES);
    for (const [id, v] of Object.entries(o)) {
      if (id === "hot" && v && typeof v === "object") { for (const [h, url] of Object.entries(v)) if (HOT_SOURCES[h]) HOT_SOURCES[h].url = String(url); continue; }
      if (!SOURCES[id] || !v || typeof v !== "object") continue;
      if (typeof v.searchUrl === "string") { const tpl = v.searchUrl; SOURCES[id].searchUrl = (kw, { days = 0, page = 1 } = {}) => tpl.replace("{kw}", enc(kw)).replace("{days}", days).replace("{page}", page); }
      if (typeof v.warmup === "string") SOURCES[id].warmup = v.warmup;
      if (typeof v.filterUrl === "string") SOURCES[id].filterUrl = new RegExp(v.filterUrl);
      if (v.pages) SOURCES[id].pages = Number(v.pages) || 1;
      if (typeof v.needsLogin === "boolean") SOURCES[id].needsLogin = v.needsLogin;
    }
  } catch { /* 忽略写错的覆盖配置 */ }
}

module.exports = { SOURCES, SOURCE_IDS, PAGE_HELPERS, READER_JS, HOT_SOURCES, HOT_IDS, HOT_PARSERS, parseToutiaoHot, parseBaiduHot, parseWeiboHot, parseZhihuHot, parseDouyinHot, parseBilibiliHot };
