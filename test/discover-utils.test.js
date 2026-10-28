"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const U = require("../lib/discover/utils");

// 固定「现在」：2026-10-28 14:00（本地时间）
const NOW = new Date(2026, 9, 28, 14, 0, 0).getTime();
const at = (y, mo, d, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();

test("时间解析：相对时间", () => {
  assert.equal(U.parseTime("刚刚", NOW), NOW);
  assert.equal(U.parseTime("5分钟前", NOW), NOW - 5 * 60000);
  assert.equal(U.parseTime("3小时前", NOW), NOW - 3 * 3600000);
  assert.equal(U.parseTime("2 天前", NOW), NOW - 2 * U.DAY);
  assert.equal(U.parseTime("1周前", NOW), NOW - 7 * U.DAY);
  assert.equal(U.parseTime("1个月前", NOW), NOW - 30 * U.DAY);
  assert.equal(U.parseTime("昨天 09:30", NOW), at(2026, 10, 27, 9, 30));
  assert.equal(U.parseTime("前天03:03", NOW), at(2026, 10, 26, 3, 3));
  assert.equal(U.parseTime("今天", NOW), at(2026, 10, 28));
  assert.equal(U.parseTime("10:05", NOW), at(2026, 10, 28, 10, 5));
});

test("时间解析：绝对日期、时间戳、跨年", () => {
  assert.equal(U.parseTime("2026-10-27 14:05", NOW), at(2026, 10, 27, 14, 5));
  assert.equal(U.parseTime("2026/9/1", NOW), at(2026, 9, 1));
  assert.equal(U.parseTime("2025年12月31日", NOW), at(2025, 12, 31));
  assert.equal(U.parseTime("2026-10-28 16:41·观察者网", NOW), at(2026, 10, 28, 16, 41));
  assert.equal(U.parseTime("10-27", NOW), at(2026, 10, 27));
  assert.equal(U.parseTime("10月20日", NOW), at(2026, 10, 20));
  // 12 月 31 日比现在晚两个月：算去年
  assert.equal(U.parseTime("12-31", NOW), at(2025, 12, 31));
  assert.equal(U.parseTime("1793168050", NOW), 1793168050000);
  assert.equal(U.parseTime(1793168050, NOW), 1793168050000);
  assert.equal(U.parseTime("1793168050123", NOW), 1793168050123);
  assert.equal(U.parseTime("", NOW), 0);
  assert.equal(U.parseTime("观察者网", NOW), 0);
  assert.equal(U.parseTime("2026-02-30", NOW), 0);
});

test("热度数字解析", () => {
  assert.equal(U.parseCount("1.2万"), 12000);
  assert.equal(U.parseCount("3.4w"), 34000);
  assert.equal(U.parseCount("1,234 赞"), 1234);
  assert.equal(U.parseCount("10万+"), 100000);
  assert.equal(U.parseCount("1.1亿"), 110000000);
  assert.equal(U.parseCount("2k"), 2000);
  assert.equal(U.parseCount("23评论"), 23);
  assert.equal(U.parseCount(""), 0);
  assert.equal(U.parseCount("赞"), 0);
  assert.equal(U.parseCount(-5), 0);
});

test("热度排序：有点赞的按点赞降序，其次评论，没热度的保持原顺序排在后面", () => {
  const items = [
    { title: "a" }, { title: "b", likes: 10 }, { title: "c", likes: 300 }, { title: "d", comments: 50 },
    { title: "e" }, { title: "f", likes: 10, comments: 9 }, { title: "g", reads: 1000 },
  ];
  assert.deepEqual(U.sortByHeat(items).map((x) => x.title), ["c", "f", "b", "d", "g", "a", "e"]);
  assert.deepEqual(U.sortByHeat(null), []);
});

test("时间范围过滤：0 = 不限，时间未知保留", () => {
  assert.equal(U.withinDays(NOW - 2 * U.DAY, 3, NOW), true);
  assert.equal(U.withinDays(NOW - 4 * U.DAY, 3, NOW), false);
  assert.equal(U.withinDays(NOW - 400 * U.DAY, 0, NOW), true);
  assert.equal(U.withinDays(0, 1, NOW), true);
});

test("链接归一化：同一篇的不同链接认成一个", () => {
  assert.equal(U.normalizeUrl("https://mp.weixin.qq.com/s?__biz=MzA5&mid=2650&idx=1&sn=abc&chksm=xx&scene=21#wechat_redirect"), "wx:MzA5:2650:1");
  assert.equal(U.normalizeUrl("http://mp.weixin.qq.com/s?__biz=MzA5&mid=2650&sn=abc"), "wx:MzA5:2650:1");
  assert.equal(U.normalizeUrl("https://mp.weixin.qq.com/s/AbCdEf123456?from=x"), "wx:AbCdEf123456");
  assert.equal(U.normalizeUrl("https://mp.weixin.qq.com/s?src=11&timestamp=1&ver=1&signature=abc"), "");
  assert.equal(U.normalizeUrl("https://weixin.sogou.com/link?url=dn9a&type=2"), "");
  assert.equal(U.normalizeUrl("https://www.toutiao.com/article/7701635950211826214/?channel=&source=search_tab"), "tt:7701635950211826214");
  assert.equal(U.normalizeUrl("http://www.toutiao.com/a7701635950211826214/"), "tt:7701635950211826214");
  assert.equal(U.normalizeUrl("https://baijiahao.baidu.com/s?id=1879934381039532632&wfr=spider&for=pc"), "bjh:1879934381039532632");
  assert.equal(U.normalizeUrl("https://www.xiaohongshu.com/explore/6528a1b2000000001e03c3f4?xsec_token=x"), "xhs:6528a1b2000000001e03c3f4");
  assert.equal(U.normalizeUrl("https://www.douyin.com/video/7301234567890123456"), "dy:7301234567890123456");
  assert.equal(U.normalizeUrl("https://Example.com/post/1/?utm_source=a&id=2#top"), "example.com/post/1?id=2");
  assert.equal(U.normalizeUrl("javascript:alert(1)"), "");
  assert.equal(U.normalizeUrl("不是链接"), "");
});

test("标题归一化：去掉空白、标点、表情、大小写", () => {
  assert.equal(U.normalizeTitle("别拿 AI工具 干坏事，一问就留证据！"), U.normalizeTitle("别拿AI工具干坏事,一问就留证据!😅"));
  assert.equal(U.normalizeTitle("<em>华为</em>想再从博世手里抢块肉"), "华为想再从博世手里抢块肉");
  assert.equal(U.normalizeTitle("短"), "");
});

test("去重：链接或标题任意一个对上就算拆过；手动和定时用同一套", () => {
  const idx = U.createDedupIndex([
    { title: "普通人如何用 AI 每天省 1 小时", url: "https://www.toutiao.com/article/123456789012/" },
    { title: "另一篇", canonicalUrl: "https://mp.weixin.qq.com/s?__biz=B&mid=9&idx=2&sn=z" },
  ]);
  assert.equal(idx.has({ title: "完全不同的标题", url: "https://www.toutiao.com/a123456789012/?x=1" }), true);
  assert.equal(idx.has({ title: "普通人如何用AI每天省1小时！", url: "https://baijiahao.baidu.com/s?id=99" }), true);
  assert.equal(idx.has({ title: "x", url: "https://mp.weixin.qq.com/s?__biz=B&mid=9&idx=2" }), true);
  assert.equal(idx.has({ title: "全新的一篇文章", url: "https://www.toutiao.com/article/999999999999/" }), false);
  // 搜狗临时链接不参与，靠标题认
  assert.equal(idx.has({ title: "全新的一篇文章", url: "https://weixin.sogou.com/link?url=abc" }), false);
  idx.add({ title: "全新的一篇文章" });
  assert.equal(idx.has({ title: "全新的一篇文章", url: "https://weixin.sogou.com/link?url=zzz" }), true);
});

test("搜索结果内部去重 + 规范化", () => {
  const raw = [
    { title: " 华为  发布会 ", url: "https://www.toutiao.com/article/111111111111/", time: "3小时前", likes: "1.2万", comments: "23评论", author: "观察者网" },
    { title: "华为发布会", url: "https://www.toutiao.com/a111111111111/" },
    { title: "坏链接", url: "ftp://x" },
  ].map((r) => U.normalizeItem(r, "toutiao", NOW));
  assert.equal(raw[0].title, "华为 发布会");
  assert.equal(raw[0].likes, 12000);
  assert.equal(raw[0].comments, 23);
  assert.equal(raw[0].publishedAt, NOW - 3 * 3600000);
  assert.equal(raw[2].url, "");
  assert.equal(U.dedupe(raw.filter((x) => x.url)).length, 1);
});

test("没填关键词：今日热点交替取头条和百度，重复话题只取一次", () => {
  const hot = { toutiao: [{ title: "华为发布会" }, { title: "双十一" }, { title: "降温" }], baidu: [{ title: "华为 发布会！" }, { title: "姆巴佩" }] };
  assert.deepEqual(U.pickHotTopics(hot, 3), ["华为发布会", "双十一", "姆巴佩"]);
  assert.deepEqual(U.pickHotTopics(hot, 1), ["华为发布会"]);
  assert.deepEqual(U.pickHotTopics({}, 3), []);
});

test("avoidReason：跳过时政、灾难、刑案，留下能写的", () => {
  assert.ok(U.avoidReason("国务院原副总理刘延东逝世"));
  assert.ok(U.avoidReason("西班牙高铁列车追尾至少50死"));
  assert.ok(U.avoidReason("男子多次触摸女同事隐私部位被拘捕"));
  assert.equal(U.avoidReason("美日长蛇阵七寸在石垣岛", { category: "military" }), "", "国际 / 军事默认能写");
  assert.equal(U.avoidReason("乌克兰战时状态再延90天意味着什么", { category: "international", hot: true }), "");
  assert.ok(U.avoidReason("美日长蛇阵七寸在石垣岛", { category: "military", intl: true }));
  assert.ok(U.avoidReason("乌克兰战时状态再延90天", { hot: true, intl: true }));
  assert.ok(U.avoidReason("邱毅：台检方无法无天", { category: "taiwan" }));
  assert.equal(U.avoidReason("女子被蜱虫咬伤后确诊森林脑炎"), "");
  assert.equal(U.avoidReason("食用油的保质期是指未开封状态"), "");
  assert.equal(U.avoidReason("身家1270亿周群飞成中国女首富", { category: "finance" }), "");
  assert.equal(U.avoidReason("日本旅游攻略：京都 5 天怎么玩"), "", "搜索结果里提到国家不误伤");
  assert.equal(U.avoidReason("日本首相换人", { hot: true }), "");
  assert.ok(U.avoidReason("日本首相换人", { hot: true, intl: true }));
  assert.ok(U.avoidReason("彩票中奖 5 亿", { words: "彩票 股市" }).includes("彩票"));
  assert.equal(U.avoidReason("国务院发布新规", { on: false }), "", "关掉内置过滤");
  assert.ok(U.avoidReason("彩票中奖", { on: false, words: "彩票" }), "关掉后自定义词仍生效");
});

test("pickHotTopics 跳过时政热点", () => {
  const hot = { toutiao: [{ title: "国务院原副总理逝世" }, { title: "刘某被查", category: "" }, { title: "秋天养生喝什么汤", category: "health" }],
    baidu: [{ title: "台风登陆致3人遇难" }, { title: "年轻人开始流行早睡" }] };
  assert.deepEqual(U.pickHotTopics(hot, 3, { on: true }), ["年轻人开始流行早睡", "秋天养生喝什么汤"]);
  assert.equal(U.pickHotTopics(hot, 5).length, 5);
});
