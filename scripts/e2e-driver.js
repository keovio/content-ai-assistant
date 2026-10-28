"use strict";
// 端到端测试的驱动（由 scripts/e2e-mock.js 用 electron 启动，不要单独运行）：
// 先加载真正的 main.js，等主窗口加载完后，在页面里一步步点按钮 / 调接口，并截图。
const path = require("path");
const fs = require("fs");
const { app, BrowserWindow, session } = require("electron");

const PHASE = process.env.E2E_PHASE;
const OUT = process.env.E2E_OUT;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let shotN = 0;

require(path.join(__dirname, "..", "main.js"));

app.on("browser-window-created", (_e, win) => {
  if (global.__e2eMain) return;
  global.__e2eMain = win;
  win.webContents.once("did-finish-load", () => { setTimeout(() => run(win).catch((err) => { console.log("E2E FAIL " + (err && err.stack || err)); app.exit(1); }), 1500); });
});

async function run(win) {
  win.setSize(1440, 960);
  const js = (code) => win.webContents.executeJavaScript(`(async () => { ${code} })()`, true);
  const shot = async (name) => {
    await sleep(600);
    const img = await win.webContents.capturePage();
    const file = path.join(OUT, `${String(++shotN).padStart(2, "0")}-${name}.png`);
    fs.writeFileSync(file, img.toPNG());
    console.log("截图 " + file);
  };
  const waitFor = async (code, ms = 60000, what = "") => {
    const end = Date.now() + ms;
    for (;;) {
      const v = await js(code).catch(() => null);
      if (v) return v;
      if (Date.now() > end) throw new Error("等待超时：" + (what || code.slice(0, 80)));
      await sleep(400);
    }
  };
  const nav = (id) => js(`window.Shell.navigate(${JSON.stringify(id)}); await new Promise(r => setTimeout(r, 500)); return true;`);

  if (PHASE === "seed") {
    // 模拟 0.4.0 老用户：运营账号 × 头条号 的登录空间里已有登录 cookie
    const accId = await js(`return (await window.app.store.list("accounts"))[0].id;`);
    const base = process.env.E2E_BASE;
    const ses = session.fromPartition(`persist:pub-${accId}-toutiao`);
    await ses.cookies.set({ url: base + "/", name: "sessionid", value: "old-0.4.0-login", expirationDate: Math.floor(Date.now() / 1000) + 86400 * 30 });
    await ses.cookies.flushStore();
    await js(`await window.app.settings.set({ platformAccountsMigrated: false }); return true;`);
    console.log("E2E SEED OK " + accId);
    await sleep(500);
    app.exit(0);
    return;
  }

  const R = {};
  // ---- 1. 迁移：0.4.0 的登录变成平台号，绑定原运营账号 ----
  const pas = await waitFor(`const l = await window.app.publish.accounts(); return l.length ? l : null;`, 15000, "迁移平台号");
  R.migrated = pas.map((a) => ({ platform: a.platform, name: a.name, loggedIn: a.loggedIn, bound: !!a.boundAccountId, migratedFrom: !!a.migratedFrom }));

  // ---- 2. AI 指向本地模拟接口 ----
  await js(`
    await window.app.ai.setKey("sk-e2e-test");
    await window.app.images.setKey("img-e2e-test");
    await window.app.settings.set({ imageProvider: "custom", imageBaseUrl: ${JSON.stringify(process.env.E2E_BASE + "/img")}, imageModel: "mock-image" });
    await window.app.settings.set({ aiProvider: "custom", aiBaseUrl: ${JSON.stringify(process.env.E2E_BASE + "/openai")}, aiModel: "mock-model", pushShowWindow: false, pushInterval: 3, defaultPlatform: "wechat" });
    window.Shell.saveSettings({ aiProvider: "custom", pushShowWindow: false, defaultPlatform: "wechat" });
    return true;`);
  await nav("home");
  await waitFor(`return document.querySelector("#home-hot .hot-list li") ? true : null;`, 15000, "今日热点");
  await sleep(800);
  await shot("工作台");
  R.home = await js(`return { flow: document.querySelectorAll("#page-home .flow-step").length, hot: document.querySelectorAll("#home-hot .hot-list li").length, todo: document.querySelector("#home-todo").innerText.slice(0, 200) };`);

  // ---- 3. 找爆款：近 3 天，按点赞排，五天前的被过滤 ----
  await nav("benchmark");
  await js(`
    const root = document.getElementById("page-benchmark");
    const sel = root.querySelector(".bm-search select"); sel.value = "toutiao"; sel.dispatchEvent(new Event("change"));
    const kw = root.querySelector(".bm-search input.grow"); kw.value = "AI 副业";
    root.querySelectorAll(".bm-search select")[1].value = "3";
    [...root.querySelectorAll(".bm-search button")].find((b) => b.textContent === "找爆款").click();
    return true;`);
  await waitFor(`return document.querySelectorAll("#page-benchmark .lib-row").length ? true : null;`, 60000, "搜索结果");
  R.search = await js(`return [...document.querySelectorAll("#page-benchmark .bm-panel:not([hidden]) .lib-row")].map((r) => r.querySelector(".lib-title").textContent + " | " + (r.querySelector(".heat") ? r.querySelector(".heat").textContent : "无热度"));`);
  await shot("找爆款-搜索结果");

  // ---- 4. 勾选前两篇，批量拆解并写成 公众号 + 头条号，直接推草稿箱 ----
  await js(`
    const root = document.getElementById("page-benchmark");
    const rows = [...root.querySelectorAll(".lib-row")].slice(0, 2);
    rows.forEach((r) => { const cb = r.querySelector("input[type=checkbox]"); cb.checked = true; cb.dispatchEvent(new Event("change")); });
    const bar = root.querySelector(".batch-bar");
    for (const cb of bar.querySelectorAll(".check-row input")) cb.checked = ["wechat", "toutiao"].includes(cb.value);
    const push = [...bar.querySelectorAll("label.check")].find((l) => l.textContent.includes("草稿箱")).querySelector("input"); push.checked = true;
    const pic = [...bar.querySelectorAll("label.check")].find((l) => l.textContent.includes("配图")).querySelector("input"); pic.checked = true;
    [...bar.querySelectorAll("button")].find((b) => b.textContent.startsWith("拆解并创作")).click();
    return true;`);
  await waitFor(`const b = document.querySelector(".modal .btn.primary"); if (b) { b.click(); return true; } return null;`, 5000, "确认框");
  await sleep(1500);
  await shot("批量拆解进行中");
  await waitFor(`const t = document.querySelector("#page-benchmark .batch-status"); return t && /完成/.test(t.textContent) ? t.textContent : null;`, 180000, "批量拆解完成");
  R.batch = await js(`return document.querySelector("#page-benchmark .batch-status").textContent;`);
  await shot("批量拆解完成");

  // ---- 5. 发布页：需改写 / 已存草稿 ----
  await nav("publish");
  await sleep(800);
  await shot("发布-列表");
  R.contents = await js(`return (await window.app.store.list("contents")).map((c) => ({ pics: (c.body.match(/cai-img:/g) || []).length, cover: !!c.cover, title: c.title, platform: c.platform, overlap: c.overlap, needsRewrite: c.needsRewrite, push: c.pushes[c.platform] ? c.pushes[c.platform].status : "", pushAccount: c.pushes[c.platform] ? c.pushes[c.platform].accountName : "", group: !!c.groupId, ref: !!c.refId }));`);
  await js(`document.querySelector("#page-publish [data-tab='calendar']").click(); return true;`);
  await shot("发布-日历");

  // ---- 6. 创作页：参考爆款、重合度、平台版本、选号推送 ----
  const masterId = await js(`const l = await window.app.store.list("contents"); const m = l.find((c) => c.needsRewrite && c.platform === "wechat") || l[0]; return m.id;`);
  await js(`window.Content.open("writer", { id: ${JSON.stringify(masterId)} }); return true;`);
  await waitFor(`return document.querySelector("#page-writer .ov-box:not([hidden]) .ov-num") ? true : null;`, 15000, "重合度");
  await sleep(1000);
  await shot("创作-需改写提醒");
  R.writer = await js(`return { overlap: document.querySelector("#page-writer .ov-num").textContent, warn: !!document.querySelector("#page-writer .ov-warn"), ref: document.querySelector("#page-writer .ref-title") ? document.querySelector("#page-writer .ref-title").textContent : "", versions: document.querySelectorAll("#writer-versions .v-tabs button").length, picker: [...document.querySelectorAll("#page-writer .push-bar .pa-picker option")].map((o) => o.textContent) };`);
  R.tech = await js(`return { items: document.querySelectorAll("#page-writer .tech-pick input").length, hint: document.querySelector("#page-writer .tech-box summary").textContent };`);
  const goodId = await js(`const l = await window.app.store.list("contents"); const m = l.find((c) => !c.needsRewrite && c.platform === "wechat"); return m && m.id;`);
  if (goodId) {
    await js(`window.Content.open("writer", { id: ${JSON.stringify(goodId)} }); return true;`);
    await sleep(1500);
    await js(`document.getElementById("writer-versions").scrollIntoView(); return true;`);
    await shot("创作-平台版本");
    // ---- 6b. 0.5.0 手机预览 ----
    await js(`document.querySelector("#page-writer .main-col, #page-writer").scrollIntoView(); [...document.querySelectorAll("#page-writer button")].find((b) => b.textContent === "手机预览").click(); return true;`);
    await waitFor(`return document.querySelector(".pv-overlay .pv-body") ? true : null;`, 10000, "手机预览");
    await sleep(600);
    await shot("手机预览-公众号");
    R.preview = await js(`return { title: document.querySelector(".pv-overlay .pv-title").textContent, imgs: document.querySelectorAll(".pv-overlay .pv-body img").length, tabs: document.querySelectorAll(".pv-overlay .pv-tabs button").length };`);
    await js(`[...document.querySelectorAll(".pv-overlay .pv-tabs button")].find((b) => b.textContent === "小红书").click(); return true;`);
    await sleep(500);
    await shot("手机预览-小红书");
    await js(`[...document.querySelectorAll(".pv-overlay button")].find((b) => b.textContent === "关闭").click(); return true;`);
    // 平台版本也能预览
    const vBtn = await js(`const b = [...document.querySelectorAll("#writer-versions button")].find((x) => x.textContent === "手机预览"); if (b) { b.click(); return true; } return false;`);
    if (vBtn) { await waitFor(`return document.querySelector(".pv-overlay .pv-body") ? true : null;`, 10000, "版本手机预览"); await sleep(500); await shot("手机预览-平台版本"); await js(`document.querySelector(".pv-overlay").click(); return true;`); }
    R.previewVersion = vBtn;
    // ---- 6c. 0.5.0 素材复用：再配一次图，应优先复用素材库里的图 ----
    R.reuse = await js(`const src = (await window.app.store.list("contents")).find((c) => c.id === ${JSON.stringify(goodId)}); const c = await window.app.store.upsert("contents", { title: src.title + "（复用测试）", body: src.body.replace(/^!\\[.*\\]\\(cai-img:.*\\)$/gm, ""), platform: src.platform, status: "draft" }); const r = await window.Content.runAi("ai:images", { contentId: c.item.id }); return { count: r.count, reused: r.reused };`);
    const TINY = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    R.upload = await js(`const r = await window.app.images.import({ data: ${JSON.stringify(TINY)}, fileName: "街角咖啡店.png", tags: "咖啡 门店" }); return { kind: r.kind, title: r.title, image: !!r.image };`);
    // 0.5.6 选题批量操作：生成 → 全选 → 批量收藏 → 已收藏里批量加入日历
    await nav("topics");
    await js(`document.querySelector("#page-topics .writer-grid input.input").value = "职场副业"; [...document.querySelectorAll("#page-topics button")].find((b) => b.textContent === "生成选题").click(); return true;`);
    await waitFor(`return document.querySelectorAll("#page-topics #topic-results .topic").length >= 3 || null;`, 30000, "生成选题");
    R.topicBatch = await js(`const bars = document.querySelectorAll("#page-topics .topic-batch"); const bar = bars[0];
      const out = { barShown: !bar.hidden, disabled: bar.querySelector('[data-batch="收藏"]').disabled };
      bar.querySelector(".topic-all input").click();
      out.count = bar.querySelector(".muted").textContent;
      bar.querySelector('[data-batch="收藏"]').click();
      await new Promise((r) => setTimeout(r, 1200));
      out.saved = (await window.app.store.list("topics")).length;
      out.starred = [...document.querySelectorAll("#page-topics #topic-results .topic button")].filter((b) => b.textContent === "已收藏").length;
      return out;`);
    await shot("选题-批量收藏");
    R.topicBatch2 = await js(`[...document.querySelectorAll("#page-topics .segmented button")].find((b) => b.textContent.startsWith("已收藏")).click();
      await new Promise((r) => setTimeout(r, 300));
      const bar = document.querySelectorAll("#page-topics .topic-batch")[1];
      const before = (await window.app.store.list("contents")).filter((c) => c.status === "idea").length;
      bar.querySelector(".topic-all input").click();
      bar.querySelector('[data-batch="加入日历"]').click();
      await new Promise((r) => setTimeout(r, 1200));
      return { shown: !bar.hidden, added: (await window.app.store.list("contents")).filter((c) => c.status === "idea").length - before };`);
    await nav("materials");
    await js(`window.Shell.toggleLogDock(false); return true;`);
    await sleep(1200);
    await shot("素材库-图片");
    // 0.5.5：素材库左一列「记一条」「上传图片」，「全部素材」占右两格
    R.matLayout = await js(`const g = document.querySelector("#page-materials .mat-grid"); if (!g) return null;
      const r = (sel) => g.querySelector(sel).getBoundingClientRect();
      const f = r(".mg-form"), u = r(".mg-upload"), a = r(".mg-all");
      return { cols: getComputedStyle(g).gridTemplateColumns.split(" ").length,
        leftStack: Math.abs(f.left - u.left) < 2 && u.top > f.bottom,
        allRight: a.left > f.right && a.width > f.width * 1.8 && Math.abs(a.top - f.top) < 2 };`);
    // 0.5.2：图片素材能编辑
    R.imgEdit = await js(`const btn = [...document.querySelectorAll("#page-materials .item-list button")].find((b) => b.textContent === "编辑" && b.closest(".material")?.querySelector("img"));
      if (!btn) return { error: "no image edit button" };
      btn.click(); await new Promise((r) => setTimeout(r, 400));
      const modal = document.querySelector(".img-edit-modal"); if (!modal) return { error: "no modal" };
      const id = modal.dataset.material; const inp = modal.querySelector("input.input"); inp.value = "改过的图片说明"; inp.dispatchEvent(new Event("input"));
      [...modal.querySelectorAll("button")].find((b) => b.textContent === "保存修改").click();
      await new Promise((r) => setTimeout(r, 800));
      const m = (await window.app.store.list("materials")).find((x) => x.id === id);
      return { ok: !!m && m.title === "改过的图片说明" && m.kind === "image" && !!m.image, modalClosed: !document.querySelector(".img-edit-modal") };`);
    R.materials = await js(`const l = await window.app.store.list("materials"); return { images: l.filter((m) => m.kind === "image").length, total: l.length };`);
  }

  // ---- 7. 拆解库 ----
  await js(`window.Content.open("benchmark", { tab: "library" }); return true;`);
  await waitFor(`return document.querySelector("#page-benchmark .bd-detail") ? true : null;`, 10000, "拆解详情");
  await shot("拆解库");
  R.breakdowns = await js(`return (await window.app.store.list("breakdowns")).map((b) => ({ title: b.title, skeleton: b.analysis.skeleton.length, topics: b.analysis.topics.length, avoid: b.analysis.avoid.length }));`);

  // ---- 8. 粘贴链接拆解：同一篇不拆第二次（去重） ----
  const art = process.env.E2E_BASE.replace("127.0.0.1", "localhost") + "/a7001/";
  R.pasteDup = await js(`const r = await window.Content.runAi("discover:breakdown", { url: ${JSON.stringify(art)} }); return { duplicate: r.duplicate, title: r.breakdown.title };`);
  R.pasteNew = await js(`const r = await window.Content.runAi("discover:breakdown", { url: ${JSON.stringify(process.env.E2E_BASE.replace("127.0.0.1", "localhost") + "/a7004/")} }); return { duplicate: r.duplicate, title: r.breakdown.title };`);
  await js(`window.Content.open("benchmark", { tab: "paste" }); return true;`);
  await shot("粘贴拆解");

  // ---- 9. 设置：平台账号（多号、改名、绑定）+ 定时自动创作 ----
  const paId = R.migrated.length ? await js(`return (await window.app.publish.accounts())[0].id;`) : "";
  if (paId) await js(`await window.app.publish.update(${JSON.stringify(paId)}, { name: "主力头条号" }); return true;`);
  // 多个定时任务：旧的单个配置先迁移成「任务 1」，再存两个任务（一个有关键词，一个不填关键词 = 按今日热点）
  R.jobsBefore = await js(`return (await window.app.auto.jobs()).map((j) => j.name);`);
  await js(`await window.app.auto.saveJobs([
      { id: "jobA", name: "AI 副业早晚两次", enabled: true, times: "08:30, 20:00", weekdays: "1,2,3,4,5,6,7", keywords: "AI 副业", source: "toutiao", days: 3, count: 2, targets: "toutiao", push: true },
      { id: "jobB", name: "热点午间", enabled: true, times: "12:00", weekdays: "1,2,3,4,5", keywords: "", source: "toutiao", days: 3, count: 1, targets: "toutiao", push: false },
    ]); return true;`);
  await nav("settings");
  await sleep(800);
  await js(`window.Shell.openSettings("platform-login"); return true;`);
  await shot("设置-平台账号");
  await js(`window.Shell.openSettings("auto"); return true;`);
  await shot("设置-定时自动创作");
  // 0.5.1：开关能点（保存后不弹回）、卡片可折叠
  R.toggle = await js(`const card = document.querySelector("#settings-auto .auto-job[data-job='jobB']"); const before = (await window.app.auto.jobs()).find((x) => x.id === "jobB").enabled;
    card.querySelector(".job-head .switch .slider").click(); await new Promise((r) => setTimeout(r, 900));
    card.querySelector(".job-head .switch .slider").click(); await new Promise((r) => setTimeout(r, 900));
    card.querySelector(".job-head .switch .slider").click(); await new Promise((r) => setTimeout(r, 900));
    const after = (await window.app.auto.jobs()).find((x) => x.id === "jobB").enabled;
    const shown = card.querySelector(".job-head .switch input").checked;
    const g = card.querySelector(".job-grid"); const wasHidden = g.hidden; card.querySelector(".job-fold").click(); const nowHidden = g.hidden;
    return { before, after, shown, foldToggles: wasHidden !== nowHidden, summary: card.querySelector(".job-summary").textContent };`);
  await shot("设置-定时任务折叠");
  await js(`window.Shell.openSettings("images"); return true;`);
  await sleep(300);
  await shot("设置-配图");
  R.settingsOverflow = await js(`return [...document.querySelectorAll("#page-settings .set-row")].filter((r) => r.scrollWidth > r.clientWidth + 2 || [...r.querySelectorAll("select,input")].some((x) => x.getBoundingClientRect().right > r.getBoundingClientRect().right + 2)).map((r) => (r.querySelector(".set-title") || r).textContent.slice(0, 20));`);

  // ---- 10. 立即运行一次自动创作：拆过的跳过，剩下的写成头条号并推草稿箱 ----
  const t = await js(`return (await window.app.auto.runNow("jobA")).task.id;`);
  await waitFor(`const t = (await window.app.tasks.list()).find((x) => x.id === ${JSON.stringify(t)}); return t && ["done", "failed", "cancelled"].includes(t.status) ? t : null;`, 180000, "自动创作完成");
  R.auto = await js(`const s = await window.app.auto.status(); return { next: s.next ? new Date(s.next).toString().slice(0, 21) : "", nextJob: s.nextJob && s.nextJob.name, jobs: s.jobs.length, last: s.lastRun && s.lastRun.summary, lastJob: s.lastRun && s.lastRun.jobName, status: s.lastRun && s.lastRun.status };`);
  const t2 = await js(`return (await window.app.auto.runNow("jobB")).task.id;`);
  await waitFor(`const t = (await window.app.tasks.list()).find((x) => x.id === ${JSON.stringify(t2)}); return t && ["done", "failed", "cancelled"].includes(t.status) ? t : null;`, 180000, "热点任务完成");
  R.autoHot = await js(`const s = await window.app.auto.status(); return { lastJob: s.lastRun && s.lastRun.jobName, keyword: s.lastRun && s.lastRun.keyword, status: s.lastRun && s.lastRun.status, summary: s.lastRun && s.lastRun.summary };`);
  // ---- 11. 0.5.4 账号数据：后台窗口读头条号后台首页 → 工作台账号数据卡片 ----
  const st = await js(`return await window.app.publish.refreshStats();`);
  if (st && st.task) await waitFor(`const t = (await window.app.tasks.list()).find((x) => x.id === ${JSON.stringify(st.task && st.task.id)}); return t && ["done", "failed", "cancelled"].includes(t.status) ? t : null;`, 90000, "读取账号数据");
  R.stats = await js(`const d = await window.app.publish.stats(); return { growth: d.growth && { day: d.growth.day.sum, week: d.growth.week.sum, month: d.growth.month.sum }, totals: d.totals, rows: d.accounts.map((a) => ({ name: a.name, fans: a.stats.fans, reads: a.stats.reads, income: a.stats.income, error: a.stats.error, at: !!a.stats.at })) };`);
  await nav("home");
  await js(`window.Shell.toggleLogDock(false); return true;`); // 关掉运行日志面板，按 1440 宽看三列布局
  await sleep(1500);
  // 0.5.5 增长图：本日（近 7 天）有柱子，切到本周 / 本月也能画
  R.growthUi = await js(`const g = document.querySelector("#home-growth"); if (!g) return null;
    const bars = () => g.querySelectorAll(".growth-chart rect.gbar:not(.none)").length;
    const out = { day: bars(), today: g.querySelectorAll(".growth-chart rect.gbar.today").length, acc: document.querySelectorAll("#home-stats .stats-table tr.stat-on").length, sum: g.querySelector(".growth-sum b").textContent };
    g.querySelector('[data-period="month"]').click(); out.month = g.querySelectorAll(".growth-chart text.lbl").length > 4 && bars();
    g.querySelector('[data-metric="income"]').click(); out.income = bars();
    g.querySelector('[data-period="day"]').click(); g.querySelector('[data-metric="fans"]').click();
    return out;`);
  await shot("工作台-自动创作之后");
  // 三列网格：账号数据占两列、今日热点在右边占两行，同一行等高，卡片不重叠
  R.layout = await js(`const g = document.querySelector("#page-home .home-grid"); const cards = [...g.children].map((c) => { const r = c.getBoundingClientRect(); return { t: c.querySelector(".card-head h2").textContent.trim(), x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), hgt: Math.round(r.height) }; });
    const by = (t) => cards.find((c) => c.t.includes(t));
    const s = by("账号数据"), hot = by("今日热点"), todo = by("待处理"), auto = by("定时自动创作"), bd = by("最近拆解"), rc = by("最近稿件"), wk = by("未来 7 天");
    const overlap = cards.some((a, i) => cards.some((b, j) => i < j && a.x < b.x + b.w - 1 && b.x < a.x + a.w - 1 && a.y < b.y + b.hgt - 1 && b.y < a.y + a.hgt - 1));
    const near = (a, b) => Math.abs(a - b) <= 2;
    return { cols: getComputedStyle(g).gridTemplateColumns.split(" ").length, overlap,
      statsWide: s.w > todo.w * 1.8, hotRight: hot.x > s.x + s.w - 2 && near(hot.y, s.y) && near(hot.y + hot.hgt, todo.y + todo.hgt),
      row2: near(todo.y, auto.y) && near(todo.hgt, auto.hgt) && todo.y > s.y + s.hgt - 2,
      row3: near(bd.y, rc.y) && near(rc.y, wk.y) && near(bd.hgt, rc.hgt) && near(rc.hgt, wk.hgt) && bd.y > todo.y + todo.hgt - 2,
      statsRows: document.querySelectorAll("#home-stats .stats-table tbody tr").length, tiles: [...document.querySelectorAll("#home-stats .stat-tile b")].map((b) => b.textContent),
      oldCards: cards.filter((c) => /平台账号|当前运营账号/.test(c.t)).length, cards: cards.map((c) => c.t) };`);
  // 窄窗口退成一列
  win.setSize(900, 900);
  await sleep(800);
  await shot("工作台-窄窗口");
  R.layoutNarrow = await js(`return getComputedStyle(document.querySelector("#page-home .home-grid")).gridTemplateColumns.split(" ").length;`);
  win.setSize(1440, 960);
  await sleep(500);
  R.final = await js(`return { contents: (await window.app.store.list("contents", { accountId: "*" })).length, breakdowns: (await window.app.store.list("breakdowns")).length, todo: document.querySelector("#home-todo").innerText };`);

  const ok = R.migrated.length === 1 && R.migrated[0].loggedIn && R.migrated[0].bound
    && R.search.length === 3 && !R.search.some((s) => s.includes("五天前")) && /3\.2万/.test(R.search[0])
    && R.contents.some((c) => c.needsRewrite && !c.push) && R.contents.some((c) => c.push === "saved" && c.pushAccount)
    && R.contents.some((c) => c.pics >= 1 && c.cover) && R.jobsBefore.length === 1 && R.autoHot && R.autoHot.status === "done" && R.autoHot.keyword === "今日热点"
    && R.tech.items >= 3 && /自动/.test(R.tech.hint)
    && R.stats.rows.length === 1 && R.stats.rows[0].fans === 12345 && R.stats.rows[0].reads === 67000 && R.stats.rows[0].income === 88.5 && !R.stats.rows[0].error
    && R.stats.totals.fans === 12345 && R.layout.cols === 3 && !R.layout.overlap && R.layout.statsWide && R.layout.hotRight && R.layout.row2 && R.layout.row3
    && R.layout.statsRows === 1 && R.layout.tiles.length === 0 && R.growthUi.acc === 1 && R.layout.oldCards === 0 && R.layout.cards.length === 7 && R.layoutNarrow === 1 && R.stats.growth && R.stats.growth.day.fans === 145 && R.stats.growth.day.income === 3.5 && R.growthUi && R.growthUi.day >= 3 && R.growthUi.today === 1 && R.growthUi.month >= 3 && R.growthUi.income >= 3 && R.topicBatch && R.topicBatch.barShown && R.topicBatch.disabled && R.topicBatch.saved >= 3 && R.topicBatch.starred === 3 && R.topicBatch.count.startsWith("已选 3") && R.topicBatch2.shown && R.topicBatch2.added >= 3 && R.matLayout && R.matLayout.cols === 3 && R.matLayout.leftStack && R.matLayout.allRight
    && R.writer.warn && R.pasteDup.duplicate === true && R.pasteNew.duplicate === false && R.breakdowns.every((b) => b.topics === 3);
  console.log("E2E RESULT " + JSON.stringify(R));
  console.log(ok ? "E2E OK" : "E2E FAIL");
  await sleep(300);
  app.exit(ok ? 0 : 1);
}
