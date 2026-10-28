"use strict";
// 定时自动创作的时间计算（纯函数 + 一个很小的轮询器，可单测）。
//
//   parseTimes("9:00, 20:30")      → ["09:00", "20:30"]
//   parseWeekdays("1,3,5")         → [1, 3, 5]（1 = 周一 … 7 = 周日；空 = 每天）
//   nextRun({ times, weekdays }, now)       → 下一次运行的时间戳（没有可用时间返回 0）
//   dueSlot({ times, weekdays }, last, now) → 到点且没跑过的时段 "YYYY-MM-DD HH:MM"，否则 ""
//   createScheduler({ getConfig, getLast, setLast, onFire })  → start() / stop() / tick()
//
// 应用需要开着才会触发；电脑睡眠错过的时段，醒来后 graceMs（默认 15 分钟）内会补跑一次，再晚就跳过。

const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function parseTimes(input) {
  const list = Array.isArray(input) ? input : String(input || "").split(/[,，;；\s、]+/);
  const out = new Set();
  for (const raw of list) {
    const m = String(raw).trim().match(/^(\d{1,2})[:：](\d{1,2})$/);
    if (!m) continue;
    const h = Number(m[1]), mi = Number(m[2]);
    if (h > 23 || mi > 59) continue;
    out.add(`${pad(h)}:${pad(mi)}`);
  }
  return [...out].sort().slice(0, 12);
}

function parseWeekdays(input) {
  const list = Array.isArray(input) ? input : String(input || "").split(/[,，;；\s、]+/);
  const out = new Set();
  for (const raw of list) { const n = Number(String(raw).trim()); if (Number.isInteger(n) && n >= 1 && n <= 7) out.add(n); }
  return out.size ? [...out].sort((a, b) => a - b) : [1, 2, 3, 4, 5, 6, 7];
}

const isoDay = (d) => ((d.getDay() + 6) % 7) + 1; // 周一 = 1 … 周日 = 7

function slotsOf(cfg) {
  return { times: parseTimes(cfg && cfg.times), days: new Set(parseWeekdays(cfg && cfg.weekdays)) };
}

function nextRun(cfg, now = Date.now()) {
  const { times, days } = slotsOf(cfg);
  if (!times.length) return 0;
  const base = new Date(now);
  for (let i = 0; i <= 8; i++) {
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i);
    if (!days.has(isoDay(d))) continue;
    for (const t of times) {
      const [h, mi] = t.split(":").map(Number);
      const at = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, mi).getTime();
      if (at > now) return at;
    }
  }
  return 0;
}

function dueSlot(cfg, last, now = Date.now(), graceMs = 15 * 60000) {
  const { times, days } = slotsOf(cfg);
  if (!times.length) return "";
  const base = new Date(now);
  // 今天和昨天（跨零点的宽限）里，最近一个已经到点的时段
  let best = null;
  for (let i = 1; i >= 0; i--) {
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() - i);
    if (!days.has(isoDay(d))) continue;
    for (const t of times) {
      const [h, mi] = t.split(":").map(Number);
      const at = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, mi).getTime();
      if (at <= now && now - at <= graceMs) best = { at, key: `${ymd(d)} ${t}` };
    }
  }
  if (!best || best.key === last) return "";
  return best.key;
}

function createScheduler({ getConfig, getLast, setLast, onFire, interval = 30000, now = Date.now, setTimer = setInterval, clearTimer = clearInterval }) {
  let timer = null;
  let busy = false;
  async function tick() {
    if (busy) return "";
    const cfg = getConfig();
    if (!cfg || !cfg.enabled) return "";
    const slot = dueSlot(cfg, getLast(), now());
    if (!slot) return "";
    busy = true;
    try { setLast(slot); await onFire(slot); } finally { busy = false; }
    return slot;
  }
  return {
    start() { if (!timer) timer = setTimer(() => { tick().catch(() => {}); }, interval); return this; },
    stop() { if (timer) { clearTimer(timer); timer = null; } },
    tick,
    next: () => { const cfg = getConfig(); return cfg && cfg.enabled ? nextRun(cfg, now()) : 0; },
  };
}

module.exports = { parseTimes, parseWeekdays, nextRun, dueSlot, createScheduler, isoDay };
