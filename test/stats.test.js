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

// ---------- 0.5.5 ----------
test("账号数据：页面读不到的指标从接口 JSON 补，不从列表里乱拿", () => {
  const json = [{ code: 0, data: { list: [{ fans_num: 5 }], user: { total_fans: "1.5万", total_read_count: 88000 } } }, { data: { total_income: "12.30" } }];
  const j = S.statsFromJson(json);
  assert.equal(j.fans, 15000);
  assert.equal(j.reads, 88000);
  assert.equal(j.income, 12.3);
  const m = S.mergeStats({ fans: 20000, reads: null, income: null }, j);
  assert.equal(m.fans, 20000);
  assert.equal(m.reads, 88000);
  assert.deepEqual(m.from, { fans: "page", reads: "api", income: "api" });
  assert.equal(S.statsFromJson([{ data: [{ fans: 1 }] }]).found, 0);
});

test("账号数据：百家号新版标签（总粉丝量 / 累计阅读量 / 累计收入）", () => {
  const r = S.parseStats("总粉丝量\n3,210\n累计阅读量\n4.5万\n累计收入\n¥66.6", P.PUBLISH_PLATFORMS.baijiahao.stats);
  assert.deepEqual([r.fans, r.reads, r.income], [3210, 45000, 66.6]);
});

test("增长：每天一份快照，本日 / 本周 / 本月", () => {
  const now = new Date(2026, 9, 28, 15).getTime(); // 2026-10-28 周三
  const day = (dd) => new Date(2026, 9, dd, 10).getTime();
  let h = [];
  h = S.pushHistory(h, { fans: 100, reads: 1000, income: 1 }, day(20));
  h = S.pushHistory(h, { fans: 150, reads: 1500, income: 2 }, day(26));
  h = S.pushHistory(h, { fans: 160, reads: 1700, income: 2.5 }, day(27));
  h = S.pushHistory(h, { fans: 170, reads: 1800, income: 3 }, day(28));
  h = S.pushHistory(h, { fans: 175, reads: 1900, income: 3 }, day(28) + 3600e3); // 同一天只留最后一次
  assert.equal(h.length, 4);
  const acc = [{ loggedIn: true, history: h }, { loggedIn: false, history: h }];
  const d = S.growthOf(acc, "day", now);
  assert.equal(d.days.length, 7);
  assert.equal(d.days[6].d, "2026-10-28");
  assert.deepEqual(d.sum, { fans: 15, reads: 200, income: 0.5 });
  const w = S.growthOf(acc, "week", now);
  assert.equal(w.days[0].d, "2026-10-26");
  assert.equal(w.days.length, 7);
  assert.ok(w.days[6].future);
  // 10-26 那份和 10-20 比（中间断了几天算到 26 号）：+50；27：+10；28：+15
  assert.deepEqual(w.sum, { fans: 75, reads: 900, income: 2 });
  const m = S.growthOf(acc, "month", now);
  assert.equal(m.days.length, 31);
  assert.equal(m.sum.fans, 75);
  assert.equal(m.since, "2026-10-20");
  assert.equal(S.growthOf([], "day", now).sum.fans, null);
});

test("账号数据：数字还是「--」占位时不拿上一行别的指标的数字", () => {
  const r = S.parseStats("粉丝数\n12,345\n阅读/播放\n6.7万\n累计收益\n--", P.PUBLISH_PLATFORMS.toutiao.stats);
  assert.equal(r.reads, 67000);
  assert.equal(r.income, null);
});
