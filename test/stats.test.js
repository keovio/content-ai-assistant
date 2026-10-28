"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("os");
const fs = require("fs");
const path = require("path");
const S = require("../lib/publish/stats");
const P = require("../lib/publish/platforms");
const { createStore } = require("../lib/store");

test("账号数据：数字解析", () => {
  assert.equal(S.parseNumber("12,345"), 12345);
  assert.equal(S.parseNumber("1.2万"), 12000);
  assert.equal(S.parseNumber("3.4w"), 34000);
  assert.equal(S.parseNumber("1.5亿"), 150000000);
  assert.equal(S.parseNumber("¥12.34"), 12.34);
  assert.equal(S.parseNumber("56.7元"), 56.7);
  assert.equal(S.parseNumber("+56"), 56);
  assert.equal(S.parseNumber("--"), null);
  assert.equal(S.parseNumber("暂无"), null);
  assert.equal(S.parseNumber(""), null);
});

test("账号数据：标签在上、数字在下（头条号后台首页）", () => {
  const text = "头条号\n首页\n数据概览\n粉丝数\n1,234\n昨日 +12\n阅读/播放\n5.6万\n累计收益\n¥88.50\n发布文章";
  const r = S.parseStats(text, P.PUBLISH_PLATFORMS.toutiao.stats);
  assert.deepEqual(r, { fans: 1234, reads: 56000, income: 88.5, found: 3 });
});

test("账号数据：同一行「标签 数字」，不把「新增粉丝」当粉丝", () => {
  const text = "新增粉丝 30\n粉丝数 2,000\n阅读量：8000\n这是一段很长的说明文字，里面提到粉丝 999 和收益 1 不能算进去的情况";
  const r = S.parseStats(text, P.PUBLISH_PLATFORMS.baijiahao.stats);
  assert.equal(r.fans, 2000);
  assert.equal(r.reads, 8000);
  assert.equal(r.income, null);
  assert.equal(r.found, 2);
});

test("账号数据：数字在标签上面（order = before）", () => {
  const r = S.parseStats("1,024\n粉丝\n3.3万\n阅读", { fans: ["粉丝"], reads: ["阅读"], order: "before" });
  assert.equal(r.fans, 1024);
  assert.equal(r.reads, 33000);
});

test("账号数据：页面上有没有标签", () => {
  assert.equal(S.hasLabels("加载中…", P.PUBLISH_PLATFORMS.wechat.stats), false);
  assert.equal(S.hasLabels("首页\n总用户数\n", P.PUBLISH_PLATFORMS.wechat.stats), true);
  for (const id of P.PUBLISH_IDS) assert.ok(P.PUBLISH_PLATFORMS[id].stats, `${id} 缺少 stats 配置`);
});

test("账号数据：过期判断（12 小时没更新重读，失败的至少隔 1 小时）", () => {
  const now = 1_800_000_000_000;
  assert.equal(S.isStale(null, now), true);
  assert.equal(S.isStale({ at: now - 3600e3, tried: now - 3600e3 }, now), false);
  assert.equal(S.isStale({ at: now - 13 * 3600e3, tried: now - 13 * 3600e3 }, now), true);
  assert.equal(S.isStale({ at: 0, tried: now - 10 * 60e3, error: "x" }, now), false);
  assert.equal(S.isStale({ at: 0, tried: now - 2 * 3600e3, error: "x" }, now), true);
});

test("账号数据：合计只算已登录的号，没读到的不算", () => {
  const t = S.totalsOf([
    { loggedIn: true, stats: { fans: 100, reads: 1000, income: 1.5, at: 1 } },
    { loggedIn: true, stats: { fans: 50, reads: null, income: 2.25, at: 1, error: "页面改版" } },
    { loggedIn: false, stats: { fans: 9999, reads: 9999, income: 9999, at: 1 } },
  ]);
  assert.deepEqual(t, { fans: 150, reads: 1000, income: 3.75, accounts: 2, failed: 1 });
  assert.deepEqual(S.totalsOf([]), { fans: null, reads: null, income: null, accounts: 0, failed: 0 });
});

test("账号数据：存进平台号，字段校验", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cai-stats-"));
  const s = createStore(dir);
  const a = s.platformAccounts.upsert({ platform: "toutiao", name: "号1", partition: "persist:pa-x1", loggedIn: true });
  assert.deepEqual(a.stats, { fans: null, reads: null, income: null, at: 0, tried: 0, error: "" });
  const b = s.platformAccounts.upsert({ id: a.id, stats: { fans: "12", reads: "abc", income: 3.456, at: 5, tried: 5, error: 42 } });
  assert.deepEqual(b.stats, { fans: 12, reads: null, income: 3.46, at: 5, tried: 5, error: "" });
  assert.equal(b.name, "号1");
  fs.rmSync(dir, { recursive: true, force: true });
});
