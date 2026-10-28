"use strict";
// AI 客户端：OpenAI 兼容接口、SSE 流式解析、错误翻译、JSON 提取
const test = require("node:test");
const assert = require("node:assert/strict");
const { createAiClient, endpoint, splitSse, extractJson, explainStatus } = require("../lib/ai-client");

const cfg = { baseUrl: "https://api.example.com/v1/", model: "m1", apiKey: "sk-test", temperature: 0.5 };

function sseBody(chunks) {
  // 模拟 web ReadableStream 的 async iterator，故意把事件切碎在边界上
  const enc = new TextEncoder();
  return { async *[Symbol.asyncIterator]() { for (const c of chunks) yield enc.encode(c); } };
}
const ev = (content) => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;

test("endpoint：补全 /chat/completions，去掉多余斜杠", () => {
  assert.equal(endpoint("https://api.deepseek.com"), "https://api.deepseek.com/chat/completions");
  assert.equal(endpoint("https://x/v1/"), "https://x/v1/chat/completions");
  assert.equal(endpoint("https://x/v1/chat/completions"), "https://x/v1/chat/completions");
  assert.equal(endpoint(""), "");
});

test("splitSse：只返回完整事件，剩下的留到下次", () => {
  const [ev1, rest] = splitSse("data: a\n\ndata: b\n\ndata: c");
  assert.deepEqual(ev1, ["a", "b"]);
  assert.equal(rest, "data: c");
  const [ev2] = splitSse("event: x\r\ndata: {\"k\":1}\r\n\r\n");
  assert.deepEqual(ev2, ['{"k":1}']);
});

test("流式：拼接增量、回调 onDelta、请求体正确", async () => {
  let sent;
  const all = ev("你好") + ev("，世界") + 'data: {"choices":[],"usage":{"total_tokens":9}}\n\n' + "data: [DONE]\n\n";
  const fetchImpl = async (url, opts) => {
    sent = { url, opts, body: JSON.parse(opts.body) };
    return { ok: true, status: 200, headers: new Map([["content-type", "text/event-stream"]]), body: sseBody([all.slice(0, 13), all.slice(13, 40), all.slice(40)]) };
  };
  const ai = createAiClient({ fetchImpl, getConfig: () => cfg });
  const seen = [];
  const r = await ai.chat([{ role: "user", content: "hi" }], { onDelta: (p, a) => seen.push(a) });
  assert.equal(r.text, "你好，世界");
  assert.deepEqual(r.usage, { total_tokens: 9 });
  assert.deepEqual(seen, ["你好", "你好，世界"]);
  assert.equal(sent.url, "https://api.example.com/v1/chat/completions");
  assert.equal(sent.opts.headers.Authorization, "Bearer sk-test");
  assert.equal(sent.body.model, "m1");
  assert.equal(sent.body.stream, true);
  assert.equal(sent.body.temperature, 0.5);
});

test("非流式 / 服务端返回 JSON 时也能用", async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, headers: new Map([["content-type", "application/json"]]), json: async () => ({ choices: [{ message: { content: "好的" } }], model: "m1" }) });
  const ai = createAiClient({ fetchImpl, getConfig: () => cfg });
  const r = await ai.chat([{ role: "user", content: "x" }]);
  assert.equal(r.text, "好的");
  const p = await ai.ping();
  assert.equal(p.ok, true);
  assert.equal(p.reply, "好的");
});

test("配置缺失：给出中文提示，不发请求", async () => {
  let called = 0;
  const fetchImpl = async () => { called++; };
  await assert.rejects(createAiClient({ fetchImpl, getConfig: () => ({ ...cfg, apiKey: "" }) }).chat([]), /API Key/);
  await assert.rejects(createAiClient({ fetchImpl, getConfig: () => ({ ...cfg, baseUrl: "" }) }).chat([]), /接口地址/);
  await assert.rejects(createAiClient({ fetchImpl, getConfig: () => ({ ...cfg, model: "" }) }).chat([]), /模型名/);
  assert.equal(called, 0);
});

test("HTTP 错误翻译成中文，带上服务端的说明", async () => {
  const fetchImpl = async () => ({ ok: false, status: 401, text: async () => JSON.stringify({ error: { message: "invalid key" } }) });
  await assert.rejects(createAiClient({ fetchImpl, getConfig: () => cfg }).chat([]), (e) => e.code === "HTTP" && e.status === 401 && /API Key 无效/.test(e.message) && /invalid key/.test(e.message));
  assert.match(explainStatus(429), /频繁/);
  assert.match(explainStatus(503), /暂时不可用/);
});

test("网络错误 / 流里的错误", async () => {
  await assert.rejects(createAiClient({ fetchImpl: async () => { throw new Error("ECONNREFUSED"); }, getConfig: () => cfg }).chat([]), /连不上 AI 服务/);
  const fetchImpl = async () => ({ ok: true, status: 200, headers: new Map(), body: sseBody(['data: {"error":{"message":"内容不合规"}}\n\n']) });
  await assert.rejects(createAiClient({ fetchImpl, getConfig: () => cfg }).chat([]), /内容不合规/);
});

test("取消：外部 signal 中止时抛出 AbortError", async () => {
  const fetchImpl = (url, opts) => new Promise((_r, rej) => opts.signal.addEventListener("abort", () => { const e = new Error("aborted"); e.name = "AbortError"; rej(e); }));
  const ctl = new AbortController();
  const p = createAiClient({ fetchImpl, getConfig: () => cfg }).chat([], { signal: ctl.signal });
  setTimeout(() => ctl.abort(), 10);
  await assert.rejects(p, (e) => e.name === "AbortError");
});

test("超时：拿不到响应头时报超时", async () => {
  const fetchImpl = (url, opts) => new Promise((_r, rej) => opts.signal.addEventListener("abort", () => rej(new Error("aborted"))));
  await assert.rejects(createAiClient({ fetchImpl, getConfig: () => cfg, timeoutMs: 30 }).chat([]), /超时/);
});

test("extractJson：裸 JSON、代码块、前后有废话", () => {
  assert.deepEqual(extractJson('[{"a":1}]'), [{ a: 1 }]);
  assert.deepEqual(extractJson('好的：\n```json\n["x","y"]\n```\n希望有用'), ["x", "y"]);
  assert.deepEqual(extractJson('结果如下 {"topics":[1]} 完'), { topics: [1] });
  assert.equal(extractJson("没有 JSON"), undefined);
});

test("extractJson：去掉推理模型的思考过程；JSON 被截断时救回完整的几项", () => {
  assert.deepEqual(extractJson('<think>先想想 [1,2]</think>[{"title":"A"}]'), [{ title: "A" }]);
  assert.deepEqual(extractJson('好的，选题如下：\n[{"title":"A"},{"title":"B"},{"title":"C","ang'), [{ title: "A" }, { title: "B" }]);
  assert.deepEqual(extractJson('{"title":"只有一个"}'), { title: "只有一个" });
});

// 0.6.0：发完 finish_reason 却不发 [DONE] 也不断开（之前会一直卡在「进行中」）
function hangingBody(chunks) {
  const enc = new TextEncoder();
  return { [Symbol.asyncIterator]() { let i = 0; return { next: () => (i < chunks.length ? Promise.resolve({ value: enc.encode(chunks[i++]), done: false }) : new Promise(() => {})), return: () => Promise.resolve({ done: true }) }; } };
}
test("流式：看到 finish_reason 就结束，不等永远不来的 [DONE]", async () => {
  const fin = `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`;
  const fetchImpl = async () => ({ ok: true, status: 200, headers: new Map([["content-type", "text/event-stream"]]), body: hangingBody([ev("你"), ev("好"), fin]) });
  const ai = createAiClient({ fetchImpl, getConfig: () => cfg, timeoutMs: 60000 });
  const t0 = Date.now();
  const r = await ai.chat([{ role: "user", content: "x" }]);
  assert.equal(r.text, "你好");
  assert.ok(Date.now() - t0 < 5000);
});
test("流式：读流卡住时取消能立刻生效；推理内容会回调 onThinking", async () => {
  const think = `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: "想一想" } }] })}\n\n`;
  const fetchImpl = async () => ({ ok: true, status: 200, headers: new Map([["content-type", "text/event-stream"]]), body: hangingBody([think, ev("半")]) });
  const ai = createAiClient({ fetchImpl, getConfig: () => cfg, timeoutMs: 60000 });
  const ctl = new AbortController();
  let thought = 0;
  const p = ai.chat([{ role: "user", content: "x" }], { signal: ctl.signal, onThinking: (n) => { thought = n; } });
  setTimeout(() => ctl.abort(), 50);
  await assert.rejects(p);
  assert.equal(thought, 3);
});
test("流式：只有心跳注释没有数据，按卡顿超时报错", async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, headers: new Map([["content-type", "text/event-stream"]]), body: { async *[Symbol.asyncIterator]() { const enc = new TextEncoder(); while (true) { await new Promise((r) => setTimeout(r, 20)); yield enc.encode(": keep-alive\n\n"); } } } });
  const ai = createAiClient({ fetchImpl, getConfig: () => cfg, timeoutMs: 200 });
  await assert.rejects(ai.chat([{ role: "user", content: "x" }]), /长时间没有返回/);
});
