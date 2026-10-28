"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const IMG = require("../lib/images");

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(200, 1)]);

test("配图插进正文：按段落开头对位，对不上就均匀分布；可以拆成文字段和图片段", () => {
  const body = "# 标题\n\n第一段讲为什么要早起。\n\n第二段讲怎么开始。\n\n第三段讲坚持的方法。\n\n第四段总结。";
  const out = IMG.insertImages(body, [{ name: "a.png", alt: "开始", after: "第二段讲怎么开始" }, { name: "b.png", alt: "总结", after: "对不上的" }]);
  const lines = out.split("\n\n");
  assert.equal(lines[lines.indexOf("第二段讲怎么开始。") + 1], "![开始](cai-img:a.png)");
  assert.equal(IMG.imagesIn(out).length, 2);
  assert.equal(IMG.stripImages(out), body);
  const parts = IMG.splitByImages(out);
  assert.deepEqual(parts.filter((p) => p.type === "image").map((p) => p.name), ["a.png", "b.png"]);
  assert.ok(parts[0].type === "text" && parts[0].text.includes("第一段"));
  // 重新配图会替换旧图，不会越插越多
  assert.equal(IMG.imagesIn(IMG.insertImages(out, [{ name: "c.png" }])).length, 1);
});

test("尺寸：没指定时小红书 / 抖音竖图，其他横图", () => {
  assert.equal(IMG.shapeFor("auto", "xiaohongshu"), "portrait");
  assert.equal(IMG.shapeFor("auto", "wechat"), "landscape");
  assert.equal(IMG.shapeFor("square", "xiaohongshu"), "square");
});

test("生图：智谱 / OpenAI 格式返回 url、硅基流动返回 images、b64；错误翻译成中文", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cai-img-"));
  const calls = [];
  let mode = "zhipu";
  const fetchImpl = async (url, opts = {}) => {
    calls.push({ url, body: opts.body ? JSON.parse(opts.body) : null, auth: opts.headers && opts.headers.Authorization });
    if (url === "https://cdn.example/x.png") return { ok: true, status: 200, arrayBuffer: async () => PNG };
    if (mode === "bad") return { ok: false, status: 401, text: async () => JSON.stringify({ error: { message: "invalid key" } }) };
    const j = mode === "silicon" ? { images: [{ url: "https://cdn.example/x.png" }] } : mode === "b64" ? { data: [{ b64_json: PNG.toString("base64") }] } : { data: [{ url: "https://cdn.example/x.png" }] };
    return { ok: true, status: 200, text: async () => JSON.stringify(j) };
  };
  let cfg = { provider: "zhipu", baseUrl: "https://open.bigmodel.cn/api/paas/v4", model: "cogview-3-flash", apiKey: "k1" };
  const img = IMG.createImageClient({ fetchImpl, dir, getConfig: () => cfg });
  const a = await img.generate("一只猫", { shape: "landscape" });
  assert.ok(fs.existsSync(a.file) && a.name.endsWith(".png"));
  assert.equal(calls[0].url, "https://open.bigmodel.cn/api/paas/v4/images/generations");
  assert.equal(calls[0].body.size, "1344x768");
  assert.equal(calls[0].auth, "Bearer k1");
  mode = "silicon"; cfg = { provider: "siliconflow", baseUrl: "https://api.siliconflow.cn/v1", model: "Kwai-Kolors/Kolors", apiKey: "k2" };
  await img.generate("一只狗", { shape: "portrait" });
  const sc = calls.find((c) => c.url.includes("siliconflow"));
  assert.equal(sc.body.image_size, "576x1024");
  assert.equal(sc.body.batch_size, 1);
  mode = "b64"; cfg = { provider: "openai", baseUrl: "https://api.openai.com/v1", model: "gpt-image-1", apiKey: "k3" };
  assert.ok((await img.generate("x")).bytes > 100);
  mode = "bad";
  await assert.rejects(img.generate("x"), /API Key 无效/);
  cfg = { ...cfg, apiKey: "" };
  await assert.rejects(img.generate("x"), /API Key/);
  assert.equal(img.fileOf("../etc/passwd"), "");
  assert.ok(img.fileOf(a.name).endsWith(a.name));
});
