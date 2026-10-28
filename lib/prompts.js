"use strict";
// 提示词：选题、写稿、一稿多发改写、标题、润色（纯函数，可单测）。
// 每个函数返回 OpenAI 格式的 messages 数组。账号定位（brand）会拼进 system 提示里，让所有输出保持同一个人设。

const PLATFORMS = {
  wechat: {
    name: "公众号",
    guide: [
      "微信公众号长文：1500–3000 字，有清晰的小标题（用 ## 标记），开头 3 行内抓住读者，结尾给出总结或引导关注/留言。",
      "段落短（每段 2–4 句），适合手机阅读；可以用加粗强调关键句；不要用表情符号刷屏。",
    ],
  },
  xiaohongshu: {
    name: "小红书",
    guide: [
      "小红书笔记：标题 20 字以内，有情绪或数字钩子，可带 1–2 个 emoji。",
      "正文 300–800 字，口语化、第一人称、分点（用 emoji 或序号开头），像朋友分享真实经验，避免广告腔。",
      "结尾附 5–8 个话题标签，格式 #标签 。",
    ],
  },
  douyin: {
    name: "抖音口播",
    guide: [
      "抖音口播脚本：60–90 秒，约 250–350 字，前 3 秒必须有强钩子（反常识、提问或结果先行）。",
      "按时间分段写：【0-3s 钩子】【正文】【结尾引导】，每段注明画面/字幕建议；句子短，适合念出来。",
      "最后给出 1 条视频标题和 3–5 个话题标签。",
    ],
  },
  toutiao: {
    name: "头条号",
    guide: [
      "今日头条文章：1000–2000 字，标题 2–30 字，信息量足、有具体细节，可以有悬念但不能标题党、不夸大。",
      "开头 2 句内给出核心看点；段落短（每段 1–3 句），多用小标题（## 标记）和分点，适合信息流快速阅读。",
      "不要引导关注其他平台、不要放外链和联系方式；结尾可以抛一个问题引导评论。",
    ],
  },
  baijiahao: {
    name: "百家号",
    guide: [
      "百家号图文：800–2000 字，原创表达，标题 8–30 字，包含读者会搜索的关键词（利于百度搜索收录）。",
      "结构清晰：开头点题，正文用小标题（## 标记）分 3–5 部分，结尾总结；语言客观、可信，不用夸张词和绝对化用语。",
      "不要出现外链、二维码、微信号等导流信息，不要营销广告语。",
    ],
  },
};

const PLATFORM_IDS = Object.keys(PLATFORMS);
const STATUSES = { idea: "选题", draft: "草稿", ready: "待发布", published: "已发布" };

function brandBlock(brand = {}) {
  const lines = [];
  if (brand.name) lines.push(`账号名：${brand.name}`);
  if (brand.positioning) lines.push(`账号定位：${brand.positioning}`);
  if (brand.audience) lines.push(`目标读者：${brand.audience}`);
  if (brand.tone) lines.push(`语气风格：${brand.tone}`);
  if (brand.banned) lines.push(`禁止使用的词：${brand.banned}`);
  return lines.length ? "\n\n以下是你服务的账号信息，所有内容都要符合它：\n" + lines.join("\n") : "";
}

function system(brand, extra = "") {
  return {
    role: "system",
    content: "你是一名资深的中文新媒体内容运营和写手，熟悉公众号、小红书、抖音、头条号、百家号的内容规律，"
      + "写作真实、具体、有信息量，不编造数据和引用，不写空话套话。" + brandBlock(brand) + (extra ? "\n\n" + extra : ""),
  };
}

// 平台规范 + 用户在设置里给这个平台加的要求（rules: { wechat: "结尾固定加…" }）
function guideOf(p, rules) {
  const extra = rules && typeof rules[p] === "string" && rules[p].trim() ? ["本账号对这个平台的额外要求（优先遵守）：" + rules[p].trim()] : [];
  return "平台要求：\n" + PLATFORMS[p].guide.concat(extra).join("\n");
}

const clampInt = (v, lo, hi, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const platformName = (p) => (PLATFORMS[p] ? PLATFORMS[p].name : "公众号");

// 选题：返回 JSON 数组 [{ title, angle, hook, platform, reason }]
function topicsPrompt({ brand, field = "", keywords = "", platform = "", count = 8, avoid = [] } = {}) {
  const n = clampInt(count, 1, 20, 8);
  const req = [
    `请给出 ${n} 个选题。`,
    field ? `领域/方向：${field}` : "",
    keywords ? `关键词或最近热点：${keywords}` : "",
    platform && PLATFORMS[platform] ? `主要发布平台：${platformName(platform)}` : "发布平台：公众号、小红书、抖音、头条号、百家号都可以，为每个选题挑最合适的",
    avoid.length ? `不要和这些已有选题重复：${avoid.slice(0, 30).join("；")}` : "",
    "每个选题要有明确的切入角度，避免泛泛而谈。",
    `只输出 JSON 数组，不要任何解释，格式：[{"title":"选题标题","angle":"切入角度（一句话）","hook":"开头钩子（一句话）","platform":"wechat|xiaohongshu|douyin|toutiao|baijiahao","reason":"为什么现在值得写（一句话）"}]`,
  ].filter(Boolean).join("\n");
  return [system(brand), { role: "user", content: req }];
}

// 写稿：直接输出成稿（Markdown），第一行是标题
function draftPrompt({ brand, rules, topic = "", platform = "wechat", outline = "", materials = [], words = 0, style = "" } = {}) {
  const p = PLATFORMS[platform] ? platform : "wechat";
  const req = [
    `请为「${platformName(p)}」写一篇完整内容。`,
    `选题：${topic || "（未指定，请根据账号定位自拟）"}`,
    outline ? `作者给的大纲/要点（必须覆盖）：\n${outline}` : "",
    words ? `篇幅：约 ${clampInt(words, 100, 8000, 1500)} 字` : "",
    style ? `额外风格要求：${style}` : "",
    materials.length ? "可参考的素材（只用相关的，引用要准确）：\n" + materials.slice(0, 10).map((m, i) => `${i + 1}. ${m.title ? m.title + "：" : ""}${String(m.content || "").slice(0, 800)}${m.url ? `（来源：${m.url}）` : ""}`).join("\n") : "",
    guideOf(p, rules),
    "输出格式：第一行是标题（以 # 开头），然后是正文，使用 Markdown。不要输出任何说明性的话。",
  ].filter(Boolean).join("\n\n");
  return [system(brand), { role: "user", content: req }];
}

// 一稿多发：把原文改写成目标平台的版本
function rewritePrompt({ brand, rules, source = "", platform = "xiaohongshu", keepPoints = true } = {}) {
  const p = PLATFORMS[platform] ? platform : "xiaohongshu";
  const req = [
    `把下面这篇内容改写成「${platformName(p)}」版本。`,
    keepPoints ? "保留原文的核心观点和关键信息，不要新增原文没有的事实或数据。" : "",
    guideOf(p, rules),
    "输出格式：第一行是标题（以 # 开头），然后是正文。不要输出任何说明性的话。",
    "原文：\n\"\"\"\n" + String(source).slice(0, 12000) + "\n\"\"\"",
  ].filter(Boolean).join("\n\n");
  return [system(brand), { role: "user", content: req }];
}

// 标题：返回 JSON 数组 ["标题1", …]
function titlesPrompt({ brand, content = "", platform = "wechat", count = 6 } = {}) {
  const n = clampInt(count, 1, 12, 6);
  const req = [
    `为下面的内容想 ${n} 个「${platformName(platform)}」标题，风格各不相同（悬念、数字、痛点、反常识、结果导向等），不要标题党到失真。`,
    `只输出 JSON 数组，例如 ["标题1","标题2"]。`,
    "内容：\n\"\"\"\n" + String(content).slice(0, 6000) + "\n\"\"\"",
  ].join("\n\n");
  return [system(brand), { role: "user", content: req }];
}

// 润色 / 改写一段话
const POLISH_MODES = {
  polish: "润色：让表达更流畅、准确、有节奏，意思不变",
  shorten: "精简：删掉废话，篇幅压缩到原来的一半左右",
  expand: "扩写：补充细节、例子和解释，篇幅扩到原来的 1.5–2 倍，不编造数据",
  casual: "口语化：改成像跟朋友聊天一样自然的说法",
  formal: "专业化：改成更专业、克制、可信的表达",
};
function polishPrompt({ brand, text = "", mode = "polish" } = {}) {
  const m = POLISH_MODES[mode] || POLISH_MODES.polish;
  return [system(brand), { role: "user", content: `${m}。只输出改好的文字，不要解释。\n\n"""\n${String(text).slice(0, 8000)}\n"""` }];
}

// 第一行 # 标题 → { title, body }
function splitTitle(text) {
  const s = String(text || "").replace(/^\s+/, "");
  const m = s.match(/^#{1,3}\s*(.+?)\s*(?:\r?\n|$)/);
  if (m) return { title: m[1].trim(), body: s.slice(m[0].length).replace(/^\s+/, "") };
  const first = s.split(/\r?\n/)[0] || "";
  return { title: first.length <= 40 ? first.trim() : "", body: first.length <= 40 ? s.slice(first.length).replace(/^\s+/, "") : s };
}

// 规范化模型返回的选题列表
function normalizeTopics(v) {
  const arr = Array.isArray(v) ? v : (v && Array.isArray(v.topics) ? v.topics : []);
  return arr.map((t) => (typeof t === "string" ? { title: t } : t || {}))
    .filter((t) => t.title && String(t.title).trim())
    .map((t) => ({
      title: String(t.title).trim().slice(0, 120),
      angle: String(t.angle || "").trim().slice(0, 300),
      hook: String(t.hook || "").trim().slice(0, 300),
      platform: PLATFORMS[t.platform] ? t.platform : "wechat",
      reason: String(t.reason || "").trim().slice(0, 300),
    }));
}

// 粗略字数：中文按字、英文按词
function countWords(text) {
  const s = String(text || "");
  const cjk = (s.match(/[\u3400-\u9fff\uf900-\ufaff]/g) || []).length;
  const latin = (s.replace(/[\u3400-\u9fff\uf900-\ufaff]/g, " ").match(/[A-Za-z0-9]+/g) || []).length;
  return cjk + latin;
}

module.exports = {
  PLATFORMS, PLATFORM_IDS, STATUSES, POLISH_MODES,
  topicsPrompt, draftPrompt, rewritePrompt, titlesPrompt, polishPrompt,
  splitTitle, normalizeTopics, countWords, brandBlock,
};
