"use strict";
// 配图：独立于写稿模型的一套生图设置（服务商 / 接口地址 / 模型 / API Key / 尺寸 / 画风），纯 Node，可单测。
//
//   const img = createImageClient({ fetchImpl, getConfig: () => ({ provider, baseUrl, model, apiKey }), dir });
//   const { file, name } = await img.generate("一只橘猫坐在窗台上", { shape: "landscape", signal });
//
// 正文里的配图用一行 Markdown 表示：![配图说明](cai-img:文件名)，文件存在 <数据目录>/images/ 里；
// 推送到平台时按顺序把文字和图片分段粘贴进编辑器（图片走剪贴板，由平台自己上传）。
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const IMAGE_PROVIDERS = {
  zhipu: { name: "智谱 CogView", baseUrl: "https://open.bigmodel.cn/api/paas/v4", model: "cogview-3-flash", api: "openai",
    sizes: { square: "1024x1024", landscape: "1344x768", portrait: "768x1344" } },
  siliconflow: { name: "硅基流动（Kolors / FLUX 等）", baseUrl: "https://api.siliconflow.cn/v1", model: "Kwai-Kolors/Kolors", api: "siliconflow",
    sizes: { square: "1024x1024", landscape: "1024x576", portrait: "576x1024" } },
  openai: { name: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "dall-e-3", api: "openai",
    sizes: { square: "1024x1024", landscape: "1792x1024", portrait: "1024x1792" } },
  custom: { name: "自定义（OpenAI 兼容）", baseUrl: "", model: "", api: "openai",
    sizes: { square: "1024x1024", landscape: "1792x1024", portrait: "1024x1792" } },
};
const SHAPES = ["landscape", "square", "portrait"];
// 没指定尺寸时按平台：小红书 / 抖音竖图，其他横图
const shapeFor = (shape, platform) => (SHAPES.includes(shape) ? shape : ["xiaohongshu", "douyin"].includes(platform) ? "portrait" : "landscape");

// 设置项（并进 settings schema）
const IMAGE_SCHEMA = {
  imageProvider: { type: "enum", values: Object.keys(IMAGE_PROVIDERS), default: "zhipu" },
  imageBaseUrl: { type: "string", maxLength: 300, default: IMAGE_PROVIDERS.zhipu.baseUrl },
  imageModel: { type: "string", maxLength: 100, default: IMAGE_PROVIDERS.zhipu.model },
  // 以下都可以不填：-1 / auto / 空 = 按文章内容自动判断
  imageCount: { type: "number", min: -1, max: 6, step: 1, default: -1 },
  imageCover: { type: "bool", default: true },
  imageShape: { type: "enum", values: ["auto", ...SHAPES], default: "auto" },
  imageStyle: { type: "string", maxLength: 200, default: "" },
};
const IMAGE_KEY = "imageApiKey";

const IMG_LINE = /^\s*!\[([^\]]*)\]\(cai-img:([\w.-]+)\)\s*$/;
const isImageLine = (line) => IMG_LINE.test(line);
const imgLine = (name, alt = "配图") => `![${String(alt || "配图").replace(/[[\]\n]/g, " ").slice(0, 40)}](cai-img:${name})`;
const safeName = (n) => /^[\w.-]{1,80}$/.test(String(n || "")) && !String(n).includes("..");

// 正文里的配图（按出现顺序）
function imagesIn(body) {
  return String(body || "").split(/\r?\n/).map((l) => l.match(IMG_LINE)).filter(Boolean).map((m) => ({ alt: m[1], name: m[2] }));
}
// 去掉正文里所有配图行
function stripImages(body) {
  return String(body || "").split(/\r?\n/).filter((l) => !isImageLine(l)).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
// 把配图插进正文：每张图 { name, alt, after }，after 是它应该跟在哪段后面（段落开头的几个字）；对不上就均匀分布
function insertImages(body, images) {
  const paras = stripImages(body).split(/\n\s*\n/);
  const n = paras.length;
  const slots = new Map(); // 段落下标 → 图片列表
  const used = new Set();
  const norm = (s) => String(s || "").replace(/[\s#>*_`\-•]/g, "").slice(0, 12);
  images.forEach((img, k) => {
    let at = -1;
    const key = norm(img.after);
    if (key.length >= 4) at = paras.findIndex((p, i) => !used.has(i) && norm(p).startsWith(key.slice(0, 8)));
    if (at < 0) at = Math.min(n - 1, Math.max(0, Math.round(((k + 1) * n) / (images.length + 1)) - 1));
    // 第一段是标题行时往后挪一段
    if (at === 0 && /^#/.test(paras[0]) && n > 1) at = 1;
    used.add(at);
    if (!slots.has(at)) slots.set(at, []);
    slots.get(at).push(img);
  });
  const out = [];
  paras.forEach((p, i) => { out.push(p); for (const img of slots.get(i) || []) out.push(imgLine(img.name, img.alt)); });
  return out.join("\n\n");
}
// 正文按顺序拆成文字段和图片段（推送时分段粘贴）
function splitByImages(body) {
  const parts = [];
  let buf = [];
  for (const line of String(body || "").split(/\r?\n/)) {
    const m = line.match(IMG_LINE);
    if (m) { if (buf.join("").trim()) parts.push({ type: "text", text: buf.join("\n").trim() }); buf = []; parts.push({ type: "image", name: m[2], alt: m[1] }); }
    else buf.push(line);
  }
  if (buf.join("").trim()) parts.push({ type: "text", text: buf.join("\n").trim() });
  return parts;
}

function endpointOf(baseUrl) {
  const b = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (!b) return "";
  return /\/images\/generations$/.test(b) ? b : b + "/images/generations";
}

function explain(status, detail) {
  const d = detail ? `（${detail}）` : "";
  if (status === 401 || status === 403) return `生图 API Key 无效或没有权限${d}`;
  if (status === 402) return `生图账户余额不足${d}`;
  if (status === 404) return `生图接口地址或模型名不对${d}`;
  if (status === 429) return `生图请求太频繁或额度用完了${d}`;
  if (status >= 500) return `生图服务暂时不可用（${status}）${d}`;
  return `生图请求失败（${status}）${d}`;
}

function createImageClient({ fetchImpl, getConfig, dir, timeoutMs = 120000 }) {
  if (!fetchImpl) throw new Error("createImageClient 需要 fetchImpl");
  const ensureDir = () => { fs.mkdirSync(dir, { recursive: true }); return dir; };

  async function request(url, opts, signal, what) {
    const ctl = new AbortController();
    const onAbort = () => ctl.abort();
    if (signal) { if (signal.aborted) throw new Error("已取消"); signal.addEventListener("abort", onAbort, { once: true }); }
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    try { return await fetchImpl(url, { ...opts, signal: ctl.signal }); }
    catch (e) {
      if (signal && signal.aborted) throw new Error("已取消");
      if (ctl.signal.aborted) throw new Error(`${what}超时（${Math.round(timeoutMs / 1000)} 秒）`);
      throw new Error(`${what}失败：${e.message || e}`);
    } finally { clearTimeout(t); if (signal) signal.removeEventListener("abort", onAbort); }
  }

  async function generate(prompt, { shape = "landscape", signal } = {}) {
    const cfg = getConfig();
    const p = IMAGE_PROVIDERS[cfg.provider] || IMAGE_PROVIDERS.custom;
    const url = endpointOf(cfg.baseUrl);
    if (!url) throw new Error("还没设置生图接口地址：设置 → 配图");
    if (!cfg.model) throw new Error("还没设置生图模型：设置 → 配图");
    if (!cfg.apiKey) throw new Error("还没设置生图的 API Key：设置 → 配图");
    const size = p.sizes[SHAPES.includes(shape) ? shape : "landscape"];
    const body = p.api === "siliconflow"
      ? { model: cfg.model, prompt: String(prompt).slice(0, 1000), image_size: size, batch_size: 1 }
      : { model: cfg.model, prompt: String(prompt).slice(0, 1000), size, n: 1 };
    const res = await request(url, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.apiKey}` }, body: JSON.stringify(body) }, signal, "生图");
    const text = await res.text().catch(() => "");
    let j = null; try { j = JSON.parse(text); } catch { /* 非 JSON */ }
    if (!res.ok) {
      const detail = j ? String((j.error && (j.error.message || j.error.code)) || j.message || "").slice(0, 200) : text.slice(0, 200);
      throw new Error(explain(res.status, detail));
    }
    const item = j && ((j.data && j.data[0]) || (j.images && j.images[0]));
    if (!item) throw new Error("生图接口没有返回图片");
    let buf;
    if (item.b64_json) buf = Buffer.from(item.b64_json, "base64");
    else if (item.url) {
      const r = await request(item.url, {}, signal, "下载图片");
      if (!r.ok) throw new Error(`下载图片失败（${r.status}）`);
      buf = Buffer.from(await r.arrayBuffer());
    } else throw new Error("生图接口返回的格式看不懂");
    if (buf.length < 32) throw new Error("下载到的图片是空的");
    const ext = buf[0] === 0x89 ? "png" : buf[0] === 0xff ? "jpg" : buf.slice(0, 4).toString() === "RIFF" ? "webp" : "png";
    const name = `img-${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}.${ext}`;
    const file = path.join(ensureDir(), name);
    fs.writeFileSync(file, buf);
    return { name, file, size, bytes: buf.length };
  }

  const fileOf = (name) => (safeName(name) ? path.join(dir, name) : "");
  return { generate, fileOf, dir };
}

module.exports = { shapeFor, IMAGE_PROVIDERS, IMAGE_SCHEMA, IMAGE_KEY, SHAPES, createImageClient, imagesIn, stripImages, insertImages, splitByImages, isImageLine, imgLine, endpointOf, safeName };
