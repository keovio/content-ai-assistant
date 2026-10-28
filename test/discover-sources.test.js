"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../lib/discover/sources");

test("来源齐全：公众号、头条、百家号、小红书、抖音", () => {
  assert.deepEqual(S.SOURCE_IDS, ["wechat", "toutiao", "baijiahao", "xiaohongshu", "douyin"]);
  for (const [id, s] of Object.entries(S.SOURCES)) {
    assert.ok(s.name && s.via && typeof s.searchUrl === "function" && s.extract, id);
    assert.ok(/^https:\/\//.test(s.searchUrl("AI 工具", { days: 3, page: 1 })), id);
    // 抠页面的脚本至少要能编译
    assert.doesNotThrow(() => new Function(`${S.PAGE_HELPERS}; return ${s.extract};`), id);
    if (s.needsLogin) assert.ok(s.loginUrl && s.loginCookies.length && s.cookieUrl, id);
  }
  assert.doesNotThrow(() => new Function(`return ${S.READER_JS};`));
  assert.equal(S.SOURCES.xiaohongshu.verified, false);
  assert.equal(S.SOURCES.douyin.verified, false);
});

test("搜索地址：关键词编码、时间范围、翻页", () => {
  const w = S.SOURCES.wechat;
  assert.ok(!w.searchUrl("x", { days: 3 }).includes("tsn")); // 搜狗时间筛选要登录，改为抓回来后按发布时间过滤
  assert.ok(w.searchUrl("x", { page: 2 }).includes("page=2"));
  assert.ok(w.searchUrl("AI 工具").includes("query=AI%20%E5%B7%A5%E5%85%B7"));
  assert.ok(S.SOURCES.toutiao.searchUrl("x", { page: 2 }).includes("page_num=1"));
  assert.ok(S.SOURCES.baijiahao.searchUrl("x", { page: 3 }).includes("pn=20"));
  assert.ok(S.SOURCES.baijiahao.filterUrl.test("https://baijiahao.baidu.com/s?id=1"));
  assert.ok(!S.SOURCES.baijiahao.filterUrl.test("https://www.jiemian.com/a.html"));
  assert.ok(S.SOURCES.douyin.searchUrl("x", { days: 7 }).includes("publish_time=7"));
});

test("今日热点解析：头条热榜", () => {
  const list = S.parseToutiaoHot({ data: [
    { Title: "中方重视姆巴佩作出的道歉", Url: "https://www.toutiao.com/trending/7701614631789284918/?category_name=x", HotValue: "102199531", InterestCategory: ["sports"] },
    { Title: "", Url: "x" }, { Title: "第二条", Url: "javascript:1" },
  ] });
  assert.deepEqual(list, [
    { title: "中方重视姆巴佩作出的道歉", url: "https://www.toutiao.com/trending/7701614631789284918/", hot: 102199531, category: "sports" },
    { title: "第二条", url: "", hot: 0, category: "" },
  ]);
  assert.deepEqual(S.parseToutiaoHot(null), []);
});

test("今日热点解析：百度热搜（嵌套结构、去掉置顶、去重）", () => {
  const json = { success: true, data: { cards: [{ component: "tabTextList", content: [{ content: [
    { isTop: true, word: "置顶", url: "https://m.baidu.com/s?word=a" },
    { index: 1, word: "皇马官方就姆巴佩言论致歉", url: "https://m.baidu.com/s?word=b", hotScore: "7904482" },
    { index: 2, word: "周大福瘦身", hotScore: 100 },
    { index: 3, word: "皇马官方就姆巴佩言论致歉" },
  ] }] }] } };
  const list = S.parseBaiduHot(json);
  assert.deepEqual(list.map((x) => x.title), ["皇马官方就姆巴佩言论致歉", "周大福瘦身"]);
  assert.equal(list[0].hot, 7904482);
  assert.equal(list[0].url, "https://m.baidu.com/s?word=b");
  assert.deepEqual(S.parseBaiduHot({}), []);
});
