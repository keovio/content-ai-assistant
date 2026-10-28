"use strict";
// 本地数据：每个集合一个 JSON 文件（<数据目录>/data/<名字>.json），原子写，纯 Node，可单测。
//
//   const contents = createCollection({ file, normalize })
//   contents.list({ q, status, platform })  contents.get(id)  contents.upsert(item)  contents.remove(id)
//
// 集合：accounts（运营账号/人设）、contents（内容：选题/草稿/待发布/已发布，带排期日期和各平台推送记录）、
//       materials（素材，所有账号共用）、topics（收藏的选题灵感）。contents / topics 用 accountId 归属到账号。
const path = require("path");
const crypto = require("crypto");
const { readJson, writeJsonAtomic } = require("./fs-utils");
const { PLATFORMS, STATUSES } = require("./prompts");

const str = (v, max = 200) => (typeof v === "string" ? v : v == null ? "" : String(v)).slice(0, max);
const isDate = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
const tagsOf = (v) => (Array.isArray(v) ? v : typeof v === "string" ? v.split(/[,，\s#]+/) : [])
  .map((t) => str(t, 30).trim()).filter(Boolean).filter((t, i, a) => a.indexOf(t) === i).slice(0, 20);

const PUSH_STATUSES = ["pushing", "saved", "unknown", "failed", "opened"];
// 推送记录：{ [平台]: { status, at, url, error } }
function pushesOf(v) {
  const out = {};
  if (!v || typeof v !== "object" || Array.isArray(v)) return out;
  for (const [pf, r] of Object.entries(v)) {
    if (!PLATFORMS[pf] || !r || typeof r !== "object") continue;
    out[pf] = {
      status: PUSH_STATUSES.includes(r.status) ? r.status : "failed",
      at: Number(r.at) || 0,
      url: /^https?:\/\//.test(str(r.url, 2000)) ? str(r.url, 2000) : "",
      error: str(r.error, 500),
    };
  }
  return out;
}
const COLORS = ["blue", "violet", "pink", "orange", "green", "teal", "graphite"];

const SCHEMAS = {
  accounts: (x) => ({
    name: str(x.name, 40).trim() || "未命名账号",
    positioning: str(x.positioning, 300),
    audience: str(x.audience, 300),
    tone: str(x.tone, 200),
    banned: str(x.banned, 300),
    color: COLORS.includes(x.color) ? x.color : "blue",
  }),
  contents: (x) => ({
    accountId: str(x.accountId, 64),
    pushes: pushesOf(x.pushes),
    title: str(x.title, 200),
    body: str(x.body, 200000),
    platform: PLATFORMS[x.platform] ? x.platform : "wechat",
    status: STATUSES[x.status] ? x.status : "draft",
    topic: str(x.topic, 500),
    tags: tagsOf(x.tags),
    scheduledAt: isDate(x.scheduledAt) ? x.scheduledAt : "",
    sourceId: str(x.sourceId, 64),
  }),
  materials: (x) => ({
    title: str(x.title, 200),
    content: str(x.content, 20000),
    url: /^https?:\/\//.test(str(x.url, 2000)) ? str(x.url, 2000) : "",
    kind: ["note", "link", "quote", "data"].includes(x.kind) ? x.kind : "note",
    tags: tagsOf(x.tags),
  }),
  topics: (x) => ({
    accountId: str(x.accountId, 64),
    title: str(x.title, 200),
    angle: str(x.angle, 500),
    hook: str(x.hook, 500),
    reason: str(x.reason, 500),
    platform: PLATFORMS[x.platform] ? x.platform : "wechat",
    used: !!x.used,
  }),
};

function createCollection({ file, normalize = (x) => x, now = Date.now, max = 5000 } = {}) {
  let items = null;
  const load = () => {
    if (items) return items;
    const raw = readJson(file, { items: [] });
    items = (Array.isArray(raw) ? raw : Array.isArray(raw.items) ? raw.items : [])
      .filter((x) => x && typeof x.id === "string")
      .map((x) => ({ ...normalize(x), id: x.id, createdAt: Number(x.createdAt) || 0, updatedAt: Number(x.updatedAt) || 0 }));
    return items;
  };
  const save = () => writeJsonAtomic(file, { version: 1, items });

  function list({ q = "", status = "", platform = "", tag = "", from = "", to = "", accountId = "" } = {}) {
    const kw = str(q, 100).trim().toLowerCase();
    return load()
      .filter((x) => !accountId || x.accountId === accountId)
      .filter((x) => !status || x.status === status)
      .filter((x) => !platform || x.platform === platform)
      .filter((x) => !tag || (x.tags || []).includes(tag))
      .filter((x) => !from || (x.scheduledAt && x.scheduledAt >= from))
      .filter((x) => !to || (x.scheduledAt && x.scheduledAt <= to))
      .filter((x) => !kw || [x.title, x.body, x.content, x.topic, x.angle, (x.tags || []).join(" ")]
        .some((f) => typeof f === "string" && f.toLowerCase().includes(kw)))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((x) => ({ ...x }));
  }
  function get(id) { const x = load().find((i) => i.id === id); return x ? { ...x } : null; }
  function upsert(input) {
    if (!input || typeof input !== "object") throw new Error("数据格式不对");
    const all = load();
    const t = now();
    const idx = input.id ? all.findIndex((i) => i.id === input.id) : -1;
    let item;
    if (idx >= 0) {
      item = { ...all[idx], ...normalize({ ...all[idx], ...input }), id: all[idx].id, createdAt: all[idx].createdAt, updatedAt: t };
      all[idx] = item;
    } else {
      if (all.length >= max) throw new Error(`最多保存 ${max} 条，请先删除一些`);
      item = { ...normalize(input), id: crypto.randomUUID(), createdAt: t, updatedAt: t };
      all.push(item);
    }
    save();
    return { ...item };
  }
  function remove(id) {
    const all = load();
    const idx = all.findIndex((i) => i.id === id);
    if (idx < 0) return false;
    all.splice(idx, 1);
    save();
    return true;
  }
  // 批量改：fn(item) 返回要合并的字段（或 null 不改），只写一次文件；返回改了几条
  function patchAll(fn) {
    const all = load();
    let n = 0;
    for (let i = 0; i < all.length; i++) {
      const patch = fn({ ...all[i] });
      if (!patch) continue;
      all[i] = { ...all[i], ...normalize({ ...all[i], ...patch }), id: all[i].id, createdAt: all[i].createdAt, updatedAt: all[i].updatedAt };
      n++;
    }
    if (n) save();
    return n;
  }
  return { list, get, upsert, remove, patchAll, count: () => load().length };
}

function createStore(dir) {
  const out = {};
  for (const [name, normalize] of Object.entries(SCHEMAS)) out[name] = createCollection({ file: path.join(dir, `${name}.json`), normalize });
  return out;
}

// 工作台统计
function stats(store, today = new Date().toISOString().slice(0, 10), accountId = "") {
  const contents = store.contents.list({ accountId });
  const by = {};
  for (const k of Object.keys(STATUSES)) by[k] = 0;
  for (const c of contents) by[c.status] = (by[c.status] || 0) + 1;
  const end = new Date(Date.parse(today) + 6 * 86400000).toISOString().slice(0, 10);
  const upcoming = contents.filter((c) => c.scheduledAt && c.scheduledAt >= today && c.scheduledAt <= end && c.status !== "published")
    .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
  const overdue = contents.filter((c) => c.scheduledAt && c.scheduledAt < today && c.status !== "published");
  return { total: contents.length, byStatus: by, upcoming, overdue, materials: store.materials.count(), topics: store.topics.list({ accountId }).length };
}

module.exports = { createCollection, createStore, stats, SCHEMAS, isDate, PUSH_STATUSES };
