"use strict";
// 违规检测：推草稿箱前扫一遍容易被平台限流 / 违反广告法的说法。纯规则，不调 AI，不联网。
//   check(text) → { level: "high" | "mid" | "", issues: [{ word, type, level, count, tip }] }
// high：广告法绝对化用语、医疗功效、引流导流、时政敏感 → 定时创作不推送并标记「需改写」
// mid：诱导关注转发、夸大承诺、迷信等 → 只提醒

const RULES = [
  { type: "广告法极限词", level: "high", tip: "广告法禁止绝对化用语，换成「很、非常、更」或具体数据",
    re: /(?:国家级|世界级|全网第一|全国第一|行业第一|销量第一|排名第一|最高级|最低价|最便宜|第一品牌|百分之百有效|100%(?:有效|安全|纯天然)|史无前例|空前绝后)/g },
  // 普通文章里「最好的方法」很常见：只提醒，带货 / 推荐产品时再改
  { type: "绝对化用语", level: "mid", tip: "推荐产品时别用绝对化说法，换成「很、非常、更」或具体数据",
    re: /(?:最佳|最好用|最强|最优秀|顶级|极品|唯一|首选|独家|万能|无敌)/g },
  { type: "医疗功效", level: "high", tip: "非医疗内容不能说治疗 / 功效，改成个人感受或「有助于」并加提醒",
    re: /(?:根治|治愈|药到病除|包治|祛病|抗癌|防癌|治癌|降血压|降血糖|降血脂|消炎|杀菌|疗效|疗程|无副作用|立竿见影|一次见效|永不复发|减肥\d+斤|瘦\d+斤)/g },
  { type: "引流导流", level: "high", tip: "平台禁止站外导流，删掉联系方式和私下交易的说法",
    re: /(?:加(?:我)?(?:微信|vx|VX|威信|薇信|v信|wx)|微信号|vx[:：]|wx[:：]|私信领取|私我领|扫码(?:加|领)|二维码加|进群领|加群|QQ群|qq号|淘宝搜|拼多多搜|点击链接购买|评论区(?:扣|留)\s*1)/g },
  { type: "时政敏感", level: "high", tip: "个人号不要碰时政和领导人，删掉或换个角度",
    re: /(?:总书记|国家主席|中南海|台独|港独|藏独|疆独|法轮|六四|反华|颠覆|翻墙|VPN)/g },
  { type: "诱导互动", level: "mid", tip: "诱导关注 / 转发 / 点赞会被限流，改成自然的结尾",
    re: /(?:转发(?:给|到)?(?:\d+个|朋友圈)|不转不是|必须转|赶紧转|点赞(?:才|就)|关注(?:我)?(?:才|就)能|求关注|求点赞|求转发|不看后悔|删前速看|马上删|看完必转)/g },
  { type: "夸大承诺", level: "mid", tip: "收益和效果不能打包票，加上「因人而异」或换成真实案例",
    re: /(?:稳赚|保赚|躺赚|月入[过上]?[万十百]|日入[过上]?[千万]|一夜暴富|零风险|无风险|保本|包过|包会|轻松月入|躺着赚)/g },
  { type: "封建迷信", level: "mid", tip: "算命转运类内容容易被处理",
    re: /(?:转运|改命|开光|招财符|算命|风水大师|旺夫|克夫)/g },
];

function check(text) {
  const t = String(text || "").replace(/!\[[^\]]*\]\([^)]*\)/g, ""); // 不扫图片标记
  const issues = [];
  for (const r of RULES) {
    const found = new Map();
    for (const m of t.matchAll(r.re)) found.set(m[0], (found.get(m[0]) || 0) + 1);
    for (const [word, count] of found) issues.push({ word, type: r.type, level: r.level, count, tip: r.tip });
  }
  issues.sort((a, b) => (a.level === b.level ? b.count - a.count : a.level === "high" ? -1 : 1));
  const level = issues.some((x) => x.level === "high") ? "high" : issues.length ? "mid" : "";
  return { level, issues };
}

// 存进稿子的简要结果：riskLevel + 最多 12 个词
function summary(text) {
  const r = check(text);
  return { riskLevel: r.level, riskWords: r.issues.slice(0, 12).map((x) => x.word) };
}

module.exports = { check, summary, RULES };
