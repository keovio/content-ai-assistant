#!/usr/bin/env node
"use strict";
// 端到端测试（本地模拟平台，不碰真实账号和网络）：
//   起一个本地服务器，模拟「头条搜索页 + 文章页 + 头条号后台（登录 / 编辑页 / 存草稿）+ 热榜接口 + OpenAI 兼容的 AI 接口」，
//   然后真实启动应用两次：
//     第 1 次（seed）：按 0.4.0 的方式在「运营账号 × 头条号」登录空间里写入登录 cookie，模拟老用户
//     第 2 次（run） ：检查自动迁移成平台号 → 找爆款 → 批量拆解并写成公众号 + 头条号 → 推草稿箱
//                    （重合度过高的不推送、标记需改写）→ 创作页 / 发布页 / 拆解库 / 设置页截图 → 粘贴链接拆解（去重）→ 立即运行一次自动创作
//                    → 读取账号数据（后台首页的粉丝 / 阅读 / 收益）→ 工作台三列布局检查
//   每一步截图保存到输出目录，最后打印 E2E OK / E2E FAIL 和结果 JSON。
//
// 用法：node scripts/e2e-mock.js [输出目录]          Linux 无桌面：xvfb-run -a node scripts/e2e-mock.js /tmp/e2e
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.resolve(process.argv[2] || path.join(os.tmpdir(), "cai-e2e"));
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const DATA = path.join(os.tmpdir(), "cai-e2e-data");
fs.rmSync(DATA, { recursive: true, force: true });

const ARTICLES = {
  "7001": { title: "普通人用 AI 做副业的 3 个方法，第 2 个最省心", likes: "3.2万", comments: "1200评论", time: "5小时前", author: "副业研究所",
    body: "很多人以为副业就是下班再打一份工。其实对普通人来说，最省心的副业是把 AI 当成助手，把自己已经会的东西放大。\n\n第一个方法：用 AI 写小红书笔记，帮本地商家做内容代运营。\n\n第二个方法：用 AI 整理行业资料，做成付费清单。我的一个读者靠这个每月多赚三千。\n\n第三个方法：用 AI 做短视频脚本，接剪辑单。\n\n最后提醒：副业要从小处开始，先跑通一单再说。" },
  "7002": { title: "照抄测试：早起的人到底赢在哪里", likes: "1.1万", comments: "300评论", time: "1天前", author: "晨读",
    body: "早上六点起床的人到底赢在哪里？答案可能出乎你的意料，并不是时间更多，而是干扰更少。\n\n安静的两小时足够完成一天最重要的事情。没有消息，没有会议，没有人打扰。\n\n坚持一个月，你会发现自己的效率完全不一样了。" },
  "7003": { title: "AI 工具清单（五天前的旧文）", likes: "800", comments: "", time: "5天前", author: "工具控", body: "这是一篇五天前的文章，用来测试时间范围过滤。".repeat(5) },
  "7004": { title: "一篇没有热度数据的文章", likes: "", comments: "", time: "1小时前", author: "新人作者", body: "这篇文章没有点赞和评论数据，用来测试热度排序：没有热度的排在后面。".repeat(4) },
};

// ---------------- 模拟服务器 ----------------
const html = (body, title = "") => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body>${body}</body></html>`;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
let base = "";
const aiCalls = [];
const drafts = [];
let imageCalls = 0;
// 16×16 的纯色 PNG（模拟生图返回）
const TINY_PNG = (() => {
  const zlib = require("zlib");
  const crc = (b) => { let c, t = []; for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } let x = 0xffffffff; for (const v of b) x = t[(x ^ v) & 0xff] ^ (x >>> 8); return (x ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const w = 16, hgt = 16, ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(hgt, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * hgt); for (let y = 0; y < hgt; y++) for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = 80; raw[o + 1] = 120; raw[o + 2] = 220; }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]).toString("base64");
})();
function card(id) {
  const a = ARTICLES[id];
  const jump = `${base}/sou/jump?url=${encodeURIComponent(`${base.replace("127.0.0.1", "localhost")}/a${id}/`)}`;
  return `<div class="cs-card"><div class="cs-header"><a href="${esc(jump)}">${esc(a.title)}</a></div>
    <div class="cs-text">${esc(a.body.slice(0, 40))}…</div>
    <div class="cs-source"><span>${esc(a.author)}</span>\n${a.likes ? `<span>${a.likes}赞</span>\n` : ""}${a.comments ? `<span>${a.comments}</span>\n` : ""}<span>${a.time}</span></div></div>`;
}
function aiReply(messages) {
  const u = messages[messages.length - 1].content;
  if (/对标拆解/.test(u)) {
    const t = (u.match(/标题：(.*)/) || [])[1] || "";
    return JSON.stringify({
      titleFormula: "人群 + 数字 + 反差结论", hook: "开头直接否定一个常见误区，制造反差", skeleton: ["否定误区：副业不是再打一份工", "方法一：具体场景", "方法二：最省心的那个，配读者案例", "方法三：延伸", "收尾提醒：从小处开始"],
      emotions: ["对收入的焦虑", "被点醒的轻松感"], highlights: ["「第 2 个最省心」的悬念", "读者每月多赚三千的案例"],
      reusable: ["标题里给数字并点名最好的一个", "每个方法一句话说清再给例子", "结尾给一个低门槛行动"],
      avoid: ["读者每月多赚三千的具体案例", "原文的三个方法清单原样"],
      topics: [{ title: `上班族用 AI 提效的 3 个习惯${t.includes("照抄") ? "（照抄）" : ""}`, angle: "从每天省下的时间切入" }, { title: "宝妈用 AI 做副业的 3 条路", angle: "时间碎片化" }, { title: "学生用 AI 赚第一笔钱", angle: "低成本试错" }],
    });
  }
  // 0.5.6：选题页「生成选题」
  if (/^请给出 \d+ 个选题/.test(u)) return JSON.stringify([{ title: "上班族午休 20 分钟能做的副业", angle: "碎片时间", hook: "午休别刷手机了", platform: "toutiao" }, { title: "AI 写周报的 3 个提示词", angle: "直接给模板", hook: "周报十分钟搞定", platform: "wechat" }, { title: "下班后学剪辑值不值", angle: "算一笔账", hook: "三个月回本吗", platform: "douyin" }]);
  if (/写一篇完整内容/.test(u)) {
    if (/照抄/.test(u)) return "# 早起的人到底赢在哪里\n\n" + ARTICLES["7002"].body; // 故意照抄 → 重合度 100%
    return "# 上班族用 AI 提效的 3 个习惯，最后一个最容易坚持\n\n你以为提效要靠熬夜加班？换个思路，把重复的活交给 AI。\n\n## 习惯一：早上十分钟让 AI 排日程\n把待办丢给它，按轻重缓急排好。\n\n## 习惯二：会议纪要交给 AI\n录音转文字再总结，省下整理的半小时。\n\n## 习惯三：每周五让 AI 帮你复盘\n这是最容易坚持的一个：只要回答三个问题。\n\n从今天开始，先试一个。";
  }
  if (/改写成/.test(u)) {
    const pf = (u.match(/改写成「(.+?)」/) || [])[1] || "平台";
    if (/早上六点起床的人到底赢在哪里/.test(u)) return `# 早起的人赢在哪（${pf}版）\n\n` + ARTICLES["7002"].body;
    return `# 上班族 AI 提效 3 习惯（${pf}版）\n\n这是为${pf}改写的版本：把重复的事交给 AI，早上排日程、会议记纪要、周五做复盘，三个习惯一个比一个容易坚持。`;
  }
  if (/配图的画面描述/.test(u)) return JSON.stringify({ style: "扁平插画", cover: "办公桌上的笔记本电脑和一杯咖啡，清晨阳光", images: [{ after: "", alt: "排日程", prompt: "一个人对着屏幕上的日程表微笑" }, { after: "", alt: "复盘", prompt: "周五傍晚的书桌，写着复盘笔记" }] });
  if (/只回复两个字/.test(u)) return "你好";
  return "好的";
}
const server = http.createServer((req, res) => {
  const u = new URL(req.url, base);
  const send = (code, body, type = "text/html; charset=utf-8", headers = {}) => { res.writeHead(code, { "Content-Type": type, ...headers }); res.end(body); };
  if (u.pathname === "/img/images/generations" && req.method === "POST") {
    let buf = ""; req.on("data", (d) => { buf += d; });
    req.on("end", () => { imageCalls++; send(200, JSON.stringify({ data: [{ b64_json: TINY_PNG }] }), "application/json"); });
    return;
  }
  if (u.pathname === "/openai/chat/completions" && req.method === "POST") {
    let buf = "";
    req.on("data", (d) => { buf += d; });
    req.on("end", () => {
      const j = JSON.parse(buf || "{}");
      aiCalls.push((j.messages || []).slice(-1)[0]?.content?.slice(0, 40));
      const text = aiReply(j.messages || []);
      send(200, JSON.stringify({ model: "mock-model", choices: [{ message: { role: "assistant", content: text } }], usage: { total_tokens: 1 } }), "application/json");
    });
    return;
  }
  if (u.pathname === "/") return send(200, html("首页", "模拟头条"));
  if (u.pathname === "/search") {
    const ids = ["7003", "7004", "7002", "7001"]; // 故意乱序：应用要按点赞排
    return send(200, html(`<div id="results">${ids.map(card).join("")}</div>`, "搜索"));
  }
  if (u.pathname === "/sou/jump") return send(302, "", "text/plain", { Location: u.searchParams.get("url") });
  const am = u.pathname.match(/^\/a(\d+)\/?$/);
  if (am && ARTICLES[am[1]]) {
    const a = ARTICLES[am[1]];
    return send(200, html(`<h1>${esc(a.title)}</h1><div class="article-meta"><span class="name">${esc(a.author)}</span> <span class="time">2026-10-28 08:00</span></div>
      <article class="article-content">${a.body.split("\n\n").map((p) => `<p>${esc(p)}</p>`).join("")}</article>`, a.title));
  }
  if (u.pathname === "/hot/toutiao") return send(200, JSON.stringify({ data: [{ Title: "模拟热点：AI 副业", Url: base + "/", HotValue: "9900000" }, { Title: "模拟热点：早起打卡", HotValue: "5100000" }] }), "application/json");
  if (u.pathname === "/hot/baidu") return send(200, JSON.stringify({ data: { cards: [{ content: [{ word: "百度模拟热搜一", hotScore: "800" }, { word: "百度模拟热搜二", hotScore: "700" }] }] } }), "application/json");
  // ---- 模拟头条号后台 ----
  const logged = /(?:^|;\s*)sessionid=/.test(req.headers.cookie || "");
  if (u.pathname === "/mp/login") return send(200, html(`<p>模拟登录页</p><script>document.cookie="sessionid=new; path=/; max-age=86400";setTimeout(()=>location.href="/mp/home",300)</script>`, "登录"));
  // 后台首页：数据概览（账号数据从这里读；数字晚一点才渲染出来，模拟真实后台的异步加载）
  if (u.pathname === "/mp/home") return logged ? send(200, html(`<p>后台首页</p><div id="ov"><div>粉丝数</div><div class="n">--</div><div>昨日 +12</div><div>阅读/播放</div><div class="n">--</div><div>累计收益</div><div class="n">--</div></div>
    <script>setTimeout(()=>{const n=document.querySelectorAll("#ov .n");n[0].textContent="12,345";n[1].textContent="6.7万";},1200);fetch("/mp/api/overview").then((r)=>r.json())</script>`, "后台")) : send(302, "", "text/plain", { Location: "/mp/login" });
  // 0.5.5：收益只在接口 JSON 里（页面上一直是 --），测从接口补数据
  if (u.pathname === "/mp/api/overview") return send(200, JSON.stringify({ code: 0, data: { author: { name: "x" }, total_income: "88.50", items: [{ fans: 1 }] } }), "application/json");
  if (u.pathname === "/mp/drafts") return send(200, html(`<p>草稿箱</p><ul>${drafts.map((d) => `<li>${esc(d.title)}</li>`).join("")}</ul>`, "草稿箱"));
  if (u.pathname === "/mp/editor") {
    if (!logged) return send(302, "", "text/plain", { Location: "/mp/login" });
    return send(200, html(`<textarea placeholder="请输入文章标题（2～30个字）" style="width:600px"></textarea>
      <div class="ProseMirror" contenteditable="true" style="min-height:300px;width:800px;border:1px solid #ccc"></div>
      <div><label><input type="radio" name="cv">单图</label><div class="article-cover-add" style="width:80px;height:60px;border:1px dashed #999" onclick="document.getElementById('cvm').style.display='block'">+</div><img id="cvimg" style="display:none"></div>
      <div id="cvm" style="display:none;border:1px solid #333;padding:8px">上传图片 <input type="file" accept="image/*" id="cvf" onchange="document.getElementById('cvimg').dataset.ok=this.files.length?'1':''"><button onclick="document.getElementById('cvm').style.display='none'">确定</button></div>
      <button id="save">存草稿</button><span id="tip"></span>
      <script>
        // 模拟平台编辑器：粘贴图片时自己「上传」并插入 <img>
        document.querySelector(".ProseMirror").addEventListener("paste",(e)=>{const f=[...(e.clipboardData&&e.clipboardData.files||[])];if(f.length){e.preventDefault();for(const x of f){const img=document.createElement("img");img.dataset.pasted="1";img.alt=x.type;const s=getSelection();if(s.rangeCount&&document.querySelector(".ProseMirror").contains(s.anchorNode)){const r=s.getRangeAt(0);r.deleteContents();r.insertNode(img);r.setStartAfter(img);r.collapse(true);}else document.querySelector(".ProseMirror").appendChild(img);}}});
        document.getElementById("save").onclick=async()=>{const t=document.querySelector("textarea").value,b=document.querySelector(".ProseMirror").innerText,imgs=document.querySelectorAll(".ProseMirror img").length,cover=document.getElementById("cvimg").dataset.ok==="1";
        await fetch("/mp/save",{method:"POST",body:JSON.stringify({title:t,body:b,imgs,cover})});document.getElementById("tip").textContent="已保存";};</script>`, "发文"));
  }
  if (u.pathname === "/mp/save" && req.method === "POST") {
    let buf = ""; req.on("data", (d) => { buf += d; }); req.on("end", () => { try { drafts.push(JSON.parse(buf)); } catch { /* ignore */ } send(200, "{}", "application/json"); });
    return;
  }
  send(404, "not found", "text/plain");
});

function runApp(phase) {
  return new Promise((resolve) => {
    const exe = require(path.join(ROOT, "node_modules", "electron"));
    const args = [path.join(__dirname, "e2e-driver.js"), "--no-updates"];
    if (process.platform === "linux") args.push("--no-sandbox");
    const env = {
      ...process.env, E2E_PHASE: phase, E2E_OUT: OUT, E2E_BASE: base, APP_DATA_DIR: DATA, APP_UPDATES_DIR: path.join(DATA, "updates"), APP_NO_UPDATES: "1", CAI_STATS_DELAY: "600000",
      CAI_E2E_STATS_HISTORY: JSON.stringify([{ daysAgo: 9, fans: 11000, reads: 52000, income: 60 }, { daysAgo: 3, fans: 11800, reads: 60000, income: 75 }, { daysAgo: 2, fans: 12000, reads: 62500, income: 80 }, { daysAgo: 1, fans: 12200, reads: 65000, income: 85 }]),
      CAI_DISCOVER_OVERRIDES: JSON.stringify({ toutiao: { searchUrl: `${base}/search?q={kw}&days={days}`, warmup: `${base}/`, pages: 1, filterUrl: "/a\\d+/" }, hot: { toutiao: `${base}/hot/toutiao`, baidu: `${base}/hot/baidu` } }),
      CAI_PUBLISH_OVERRIDES: JSON.stringify({ toutiao: { home: `${base}/mp/home`, login: `${base}/mp/login`, drafts: `${base}/mp/drafts`, editor: `${base}/mp/editor`, loginUrl: ["/mp/login"], cookieUrl: `${base}/`, cookies: ["sessionid"] } }),
    };
    const child = spawn(exe, args, { env, cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d) => { out += d; process.stdout.write(d); });
    child.stderr.on("data", (d) => { const s = String(d); out += s; if (!/bus\.cc|viz_main|gpu_|dbus|Fontconfig/.test(s)) process.stderr.write(d); });
    const t = setTimeout(() => { child.kill("SIGKILL"); }, 240000);
    child.on("exit", (code) => { clearTimeout(t); resolve({ code, out }); });
  });
}

server.listen(0, "127.0.0.1", async () => {
  base = `http://127.0.0.1:${server.address().port}`;
  console.log("模拟平台：" + base);
  const seed = await runApp("seed");
  if (!/E2E SEED OK/.test(seed.out)) { console.log("E2E FAIL（seed 阶段）"); server.close(); process.exit(1); }
  const run = await runApp("run");
  const m = run.out.match(/E2E RESULT (.*)/);
  const result = m ? JSON.parse(m[1]) : {};
  result.mockDrafts = drafts.map((d) => d.title + (d.imgs ? `（${d.imgs} 张图）` : "") + (d.cover ? "（有封面）" : ""));
  result.imageCalls = imageCalls;
  result.aiCalls = aiCalls.length;
  fs.writeFileSync(path.join(OUT, "result.json"), JSON.stringify(result, null, 2));
  const ok = run.code === 0 && /E2E OK/.test(run.out) && drafts.length >= 1 && drafts.some((d) => d.title && d.imgs >= 1 && d.cover) && !drafts.some((d) => /CAIIMG/.test(d.body || "")) && imageCalls >= 1;
  console.log((ok ? "E2E OK " : "E2E FAIL ") + JSON.stringify(result));
  console.log("截图：" + OUT);
  server.close();
  process.exit(ok ? 0 : 1);
});
