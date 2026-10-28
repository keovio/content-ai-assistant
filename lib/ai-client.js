"use strict";
// AI 客户端：OpenAI 兼容的 /chat/completions 接口（DeepSeek、通义千问、Kimi、智谱、OpenAI 等都支持），纯 Node，可单测。
//
//   const ai = createAiClient({ fetchImpl, getConfig: () => ({ baseUrl, model, apiKey, temperature }) });
//   const { text } = await ai.chat([{ role: "user", content: "你好" }], { onDelta: (piece, all) => {}, signal });
//
// 默认用流式（SSE）返回，边生成边回调 onDelta；stream:false 时一次性返回。

// 内置服务商预设：选了预设就自动填 baseUrl 和默认模型，用户仍可改
const PROVIDERS = {
  deepseek: { name: "DeepSeek", baseUrl: "https://api.deepseek.com", model: "deepseek-chat" },
  qwen: { name: "通义千问", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-plus" },
  kimi: { name: "Kimi（月之暗面）", baseUrl: "https://api.moonshot.cn/v1", model: "moonshot-v1-8k" },
  zhipu: { name: "智谱 GLM", baseUrl: "https://open.bigmodel.cn/api/paas/v4", model: "glm-4-flash" },
  openai: { name: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  custom: { name: "自定义（OpenAI 兼容）", baseUrl: "", model: "" },
};

class AiError extends Error {
  constructor(message, code, status) { super(message); this.name = "AiError"; this.code = code; this.status = status; }
}

function endpoint(baseUrl) {
  const b = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (!b) return "";
  return /\/chat\/completions$/.test(b) ? b : b + "/chat/completions";
}

// 把常见 HTTP 错误翻译成中文
function explainStatus(status, detail) {
  const d = detail ? `（${detail}）` : "";
  if (status === 401 || status === 403) return `API Key 无效或没有权限${d}`;
  if (status === 402) return `账户余额不足${d}`;
  if (status === 404) return `接口地址或模型名不对${d}`;
  if (status === 429) return `请求太频繁或额度用完了，稍后再试${d}`;
  if (status >= 500) return `模型服务暂时不可用（${status}）${detail ? "：" + detail : ""}`;
  return `请求失败（${status}）${detail ? "：" + detail : ""}`;
}

async function readErrorDetail(res) {
  try {
    const t = await res.text();
    try { const j = JSON.parse(t); return String((j.error && (j.error.message || j.error.code)) || j.message || t).slice(0, 300); }
    catch { return t.slice(0, 300); }
  } catch { return ""; }
}

// 解析 SSE 文本块：返回 [完整事件的 data 列表, 剩余未完成的部分]
function splitSse(buffer) {
  const out = [];
  const parts = buffer.split(/\r?\n\r?\n/);
  const rest = parts.pop();
  for (const block of parts) {
    const data = block.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).replace(/^ /, "")).join("\n");
    if (data) out.push(data);
  }
  return [out, rest];
}

function deltaOf(json) {
  const c = json && json.choices && json.choices[0];
  if (!c) return "";
  return (c.delta && c.delta.content) || (c.message && c.message.content) || c.text || "";
}

function createAiClient({ fetchImpl, getConfig, timeoutMs = 60000 } = {}) {
  if (typeof fetchImpl !== "function") throw new Error("createAiClient 需要 fetchImpl");

  async function chat(messages, { onDelta, signal, stream = true, temperature, maxTokens, json = false } = {}) {
    const cfg = (getConfig && getConfig()) || {};
    const url = endpoint(cfg.baseUrl);
    if (!url) throw new AiError("还没有设置 AI 接口地址，去「设置 → AI 模型」里填一下", "NO_CONFIG");
    if (!cfg.apiKey) throw new AiError("还没有填 API Key，去「设置 → AI 模型」里填一下", "NO_KEY");
    if (!cfg.model) throw new AiError("还没有填模型名，去「设置 → AI 模型」里填一下", "NO_MODEL");

    const body = {
      model: cfg.model,
      messages,
      temperature: Number.isFinite(temperature) ? temperature : (Number.isFinite(cfg.temperature) ? cfg.temperature : 0.7),
      stream: !!stream,
    };
    if (maxTokens) body.max_tokens = maxTokens;
    if (json) body.response_format = { type: "json_object" };

    // 拿到响应头之前有超时；之后的流式输出靠「卡顿」检测（timeoutMs 内没有新数据就放弃）
    const ctl = new AbortController();
    let timer = setTimeout(() => ctl.abort(new AiError(`连接 AI 服务超时（${Math.round(timeoutMs / 1000)} 秒）`, "TIMEOUT")), timeoutMs);
    const bump = () => { clearTimeout(timer); timer = setTimeout(() => ctl.abort(new AiError("AI 服务长时间没有返回数据", "STALLED")), timeoutMs); };
    const sig = signal ? AbortSignal.any([signal, ctl.signal]) : ctl.signal;

    try {
      let res;
      try {
        res = await fetchImpl(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.apiKey}`, Accept: stream ? "text/event-stream" : "application/json" },
          body: JSON.stringify(body),
          signal: sig,
        });
      } catch (err) {
        if (signal && signal.aborted) throw err;
        if (ctl.signal.aborted && ctl.signal.reason instanceof AiError) throw ctl.signal.reason;
        throw new AiError(`连不上 AI 服务：${(err && err.message) || err}`, "NETWORK");
      }
      if (!res.ok) throw new AiError(explainStatus(res.status, await readErrorDetail(res)), "HTTP", res.status);

      const ctype = (res.headers && typeof res.headers.get === "function" && res.headers.get("content-type")) || "";
      // 非流式，或者服务端没按流式返回
      if (!stream || !res.body || /application\/json/.test(ctype)) {
        const j = await res.json();
        const text = deltaOf(j);
        if (onDelta && text) onDelta(text, text);
        return { text, usage: j.usage || null, model: j.model || cfg.model };
      }

      let all = "", buf = "", usage = null, done = false;
      const decoder = new TextDecoder("utf-8");
      const handle = (data) => {
        if (data.trim() === "[DONE]") { done = true; return; }
        let j;
        try { j = JSON.parse(data); } catch { return; }
        if (j.error) throw new AiError(String(j.error.message || j.error), "STREAM");
        if (j.usage) usage = j.usage;
        const piece = deltaOf(j);
        if (piece) { all += piece; if (onDelta) onDelta(piece, all); }
      };
      for await (const chunk of res.body) {
        bump();
        buf += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
        const [events, rest] = splitSse(buf);
        buf = rest;
        for (const e of events) handle(e);
        if (done) break;
      }
      if (!done && buf.trim()) { const [events] = splitSse(buf + "\n\n"); for (const e of events) handle(e); }
      return { text: all, usage, model: cfg.model };
    } catch (err) {
      if (ctl.signal.aborted && ctl.signal.reason instanceof AiError && !(signal && signal.aborted)) throw ctl.signal.reason;
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  // 测试连接：发一句很短的话
  async function ping({ signal } = {}) {
    const t0 = Date.now();
    const r = await chat([{ role: "user", content: "只回复两个字：你好" }], { stream: false, maxTokens: 10, signal, temperature: 0 });
    return { ok: true, ms: Date.now() - t0, reply: r.text.trim().slice(0, 40), model: r.model };
  }

  return { chat, ping };
}

// 从模型输出里抠出 JSON（模型常常包一层 ```json ``` 或前后带说明）
function extractJson(text) {
  const s = String(text || "").trim();
  const tryParse = (x) => { try { return JSON.parse(x); } catch { return undefined; } };
  let v = tryParse(s);
  if (v !== undefined) return v;
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) { v = tryParse(fence[1].trim()); if (v !== undefined) return v; }
  // 先试最早出现的那种括号（{"topics":[…]} 不能被当成里面的数组）
  const pairs = [["[", "]"], ["{", "}"]].sort((x, y) => (s.indexOf(x[0]) < 0 ? Infinity : s.indexOf(x[0])) - (s.indexOf(y[0]) < 0 ? Infinity : s.indexOf(y[0])));
  for (const [open, close] of pairs) {
    const a = s.indexOf(open), b = s.lastIndexOf(close);
    if (a >= 0 && b > a) { v = tryParse(s.slice(a, b + 1)); if (v !== undefined) return v; }
  }
  return undefined;
}

module.exports = { createAiClient, PROVIDERS, AiError, endpoint, splitSse, extractJson, explainStatus };
