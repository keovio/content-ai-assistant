"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../lib/scheduler");

// 2026-10-28 是周三
const at = (d, h, mi = 0) => new Date(2026, 9, d, h, mi).getTime();

test("时间、星期解析", () => {
  assert.deepEqual(S.parseTimes("20:30, 9:00；7:5 25:00 abc 09:00"), ["07:05", "09:00", "20:30"]);
  assert.deepEqual(S.parseTimes(""), []);
  assert.deepEqual(S.parseWeekdays("1,3,5,9,x"), [1, 3, 5]);
  assert.deepEqual(S.parseWeekdays(""), [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(S.isoDay(new Date(2026, 9, 28)), 3);
  assert.equal(S.isoDay(new Date(2026, 10, 1)), 7);
});

test("下次运行时间", () => {
  const cfg = { times: "08:30, 20:00", weekdays: "" };
  assert.equal(S.nextRun(cfg, at(28, 7)), at(28, 8, 30));
  assert.equal(S.nextRun(cfg, at(28, 8, 30)), at(28, 20)); // 正好到点的那次不算「下一次」
  assert.equal(S.nextRun(cfg, at(28, 21)), at(29, 8, 30));
  // 只在周一：周三晚上之后的下一次是下周一（11 月 2 日）
  assert.equal(S.nextRun({ times: "08:30", weekdays: "1" }, at(28, 21)), new Date(2026, 10, 2, 8, 30).getTime());
  assert.equal(S.nextRun({ times: "", weekdays: "" }, at(28, 7)), 0);
});

test("到点触发：宽限期内补跑一次，同一时段不重复，过了宽限期跳过", () => {
  const cfg = { times: "08:30", weekdays: "" };
  assert.equal(S.dueSlot(cfg, "", at(28, 8, 29)), "");
  assert.equal(S.dueSlot(cfg, "", at(28, 8, 30)), "2026-10-28 08:30");
  assert.equal(S.dueSlot(cfg, "", at(28, 8, 40)), "2026-10-28 08:30");
  assert.equal(S.dueSlot(cfg, "2026-10-28 08:30", at(28, 8, 40)), "");
  assert.equal(S.dueSlot(cfg, "", at(28, 9, 0)), ""); // 超过 15 分钟
  assert.equal(S.dueSlot({ times: "08:30", weekdays: "1" }, "", at(28, 8, 31)), ""); // 周三不跑
  // 跨零点：23:55 的时段，00:05 还在宽限期
  assert.equal(S.dueSlot({ times: "23:55" }, "", new Date(2026, 9, 29, 0, 5).getTime()), "2026-10-28 23:55");
});

test("轮询器：开关、只触发一次、记录最后时段", async () => {
  let now = at(28, 8, 29);
  let last = "";
  const fired = [];
  const cfg = { enabled: true, times: "08:30" };
  const sch = S.createScheduler({ getConfig: () => cfg, getLast: () => last, setLast: (s) => { last = s; }, onFire: async (s) => { fired.push(s); }, now: () => now, setTimer: () => 1, clearTimer: () => {} });
  assert.equal(await sch.tick(), "");
  now = at(28, 8, 31);
  assert.equal(await sch.tick(), "2026-10-28 08:30");
  assert.equal(await sch.tick(), "");
  assert.deepEqual(fired, ["2026-10-28 08:30"]);
  assert.equal(last, "2026-10-28 08:30");
  assert.equal(sch.next(), at(29, 8, 30));
  cfg.enabled = false;
  now = at(29, 8, 31);
  assert.equal(await sch.tick(), "");
  assert.equal(sch.next(), 0);
});
