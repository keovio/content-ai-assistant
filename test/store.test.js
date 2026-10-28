"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { createStore, createCollection, stats } = require("../lib/store");
const { tmp } = require("./helpers");

test("增删改查 + 持久化 + 校验字段", () => {
  const dir = tmp();
  const s = createStore(dir);
  const a = s.contents.upsert({ title: "第一篇", body: "正文", platform: "xiaohongshu", status: "bad", tags: "AI, 效率 #AI", scheduledAt: "2026-13-40" });
  assert.ok(a.id);
  assert.equal(a.status, "draft");
  assert.equal(a.scheduledAt, "");
  assert.deepEqual(a.tags, ["AI", "效率"]);
  const b = s.contents.upsert({ id: a.id, status: "ready", scheduledAt: "2026-11-02" });
  assert.equal(b.title, "第一篇"); // 部分更新保留其他字段
  assert.equal(b.status, "ready");
  assert.equal(b.createdAt, a.createdAt);
  const again = createStore(dir);
  assert.equal(again.contents.get(a.id).scheduledAt, "2026-11-02");
  assert.ok(fs.existsSync(path.join(dir, "contents.json")));
  assert.equal(again.contents.remove(a.id), true);
  assert.equal(again.contents.remove(a.id), false);
  assert.equal(again.contents.count(), 0);
});

test("素材：非法链接丢掉，搜索命中标签和内容", () => {
  const s = createStore(tmp());
  const m = s.materials.upsert({ content: "用户留存提升 30%", url: "javascript:alert(1)", tags: ["数据"], kind: "data" });
  assert.equal(m.url, "");
  s.materials.upsert({ content: "别的", tags: ["金句"] });
  assert.equal(s.materials.list({ q: "留存" }).length, 1);
  assert.equal(s.materials.list({ q: "金句" }).length, 1);
  assert.equal(s.materials.list({ tag: "数据" }).length, 1);
});

test("列表按更新时间倒序，按状态 / 平台 / 日期筛选", () => {
  let t = 1000;
  const c = createCollection({ file: path.join(tmp(), "c.json"), normalize: require("../lib/store").SCHEMAS.contents, now: () => ++t });
  c.upsert({ title: "a", status: "draft", platform: "wechat", scheduledAt: "2026-11-01" });
  c.upsert({ title: "b", status: "published", platform: "douyin", scheduledAt: "2026-11-05" });
  assert.deepEqual(c.list().map((x) => x.title), ["b", "a"]);
  assert.deepEqual(c.list({ status: "draft" }).map((x) => x.title), ["a"]);
  assert.deepEqual(c.list({ platform: "douyin" }).map((x) => x.title), ["b"]);
  assert.deepEqual(c.list({ from: "2026-11-02", to: "2026-11-30" }).map((x) => x.title), ["b"]);
});

test("坏文件不崩；stats 统计排期和逾期", () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, "contents.json"), "{坏的");
  const s = createStore(dir);
  assert.equal(s.contents.count(), 0);
  s.contents.upsert({ title: "本周", status: "ready", scheduledAt: "2026-10-30" });
  s.contents.upsert({ title: "逾期", status: "draft", scheduledAt: "2026-10-20" });
  s.contents.upsert({ title: "已发", status: "published", scheduledAt: "2026-10-29" });
  s.materials.upsert({ content: "x" });
  const st = stats(s, "2026-10-28");
  assert.equal(st.total, 3);
  assert.equal(st.byStatus.ready, 1);
  assert.deepEqual(st.upcoming.map((x) => x.title), ["本周"]);
  assert.deepEqual(st.overdue.map((x) => x.title), ["逾期"]);
  assert.equal(st.materials, 1);
});
