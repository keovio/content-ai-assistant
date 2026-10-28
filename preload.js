"use strict";
// 预加载脚本：在 contextIsolation + sandbox 下只暴露需要的几个接口给页面（window.app），页面拿不到 Node。
const { contextBridge, ipcRenderer } = require("electron");

// 订阅事件，返回取消订阅的函数
const on = (channel) => (cb) => {
  const fn = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, fn);
  return () => ipcRenderer.removeListener(channel, fn);
};

contextBridge.exposeInMainWorld("app", {
  info: () => ipcRenderer.invoke("app:info"),
  update: {
    info: () => ipcRenderer.invoke("update:info"),
    check: () => ipcRenderer.invoke("update:check"),
    download: () => ipcRenderer.invoke("update:download"),
    restart: () => ipcRenderer.invoke("update:restart"),
    openUrl: (url) => ipcRenderer.invoke("update:openUrl", url),
    onProgress: on("update:progress"),
    onStatus: on("update:status"),
  },
  // 设置：get() 全部 / set({ key: value }) / reset([keys])；onChange(({ changed, settings }) => …)
  settings: {
    get: () => ipcRenderer.invoke("settings:get"),
    set: (patch) => ipcRenderer.invoke("settings:set", patch),
    reset: (keys) => ipcRenderer.invoke("settings:reset", keys),
    schema: () => ipcRenderer.invoke("settings:schema"),
    onChange: on("settings:changed"),
  },
  // 日志：list({ level, q, limit }) / write(level, message, scope) / onEntries(batch => …)
  logs: {
    list: (filter) => ipcRenderer.invoke("logs:list", filter),
    clear: () => ipcRenderer.invoke("logs:clear"),
    write: (level, message, scope) => ipcRenderer.invoke("logs:write", level, message, scope),
    openDir: () => ipcRenderer.invoke("logs:openDir"),
    file: () => ipcRenderer.invoke("logs:file"),
    onEntries: on("logs:entries"),
  },
  // 后台任务（在 main.js 里 tasks.register 注册）：run(type, params) → { ok, task }；onChange(task => …)
  tasks: {
    list: () => ipcRenderer.invoke("tasks:list"),
    types: () => ipcRenderer.invoke("tasks:types"),
    run: (type, params, opts) => ipcRenderer.invoke("tasks:run", type, params, opts),
    cancel: (id) => ipcRenderer.invoke("tasks:cancel", id),
    clearFinished: () => ipcRenderer.invoke("tasks:clearFinished"),
    onChange: on("tasks:changed"),
  },
  // 外观：自定义背景图（选择 / 读取 data URL / 清除）；onBackground(() => …) 背景图变了
  appearance: {
    pickBackground: () => ipcRenderer.invoke("appearance:pickBackground"),
    background: () => ipcRenderer.invoke("appearance:background"),
    clearBackground: () => ipcRenderer.invoke("appearance:clearBackground"),
    onBackground: on("appearance:background"),
  },
  // AI：meta() 服务商/平台/状态列表；keyInfo() 只返回「是否已设置 + 末 4 位」；test() 测试连接
  // AI 生成走后台任务：tasks.run("ai:draft" | "ai:rewrite" | "ai:topics" | "ai:titles" | "ai:polish", params)，
  // 流式文字用 onDelta(({ taskId, text }) => …) 接收，最终结果在任务的 result 里
  ai: {
    meta: () => ipcRenderer.invoke("ai:meta"),
    keyInfo: () => ipcRenderer.invoke("ai:keyInfo"),
    setKey: (key) => ipcRenderer.invoke("ai:setKey", key),
    useProvider: (id) => ipcRenderer.invoke("ai:useProvider", id),
    test: () => ipcRenderer.invoke("ai:test"),
    onDelta: on("ai:delta"),
  },
  // 写法库（从拆解库汇总）：list(选题) → { list, auto: 按选题自动挑中的 id }
  preview: { html: (body) => ipcRenderer.invoke("preview:html", body) },
  techniques: { list: (topic) => ipcRenderer.invoke("techniques:list", topic) },
  // 配图：独立的生图设置（服务商 / Key / 测试），缩略图只能读应用自己的 images 目录
  images: {
    meta: () => ipcRenderer.invoke("images:meta"),
    keyInfo: () => ipcRenderer.invoke("images:keyInfo"),
    setKey: (key) => ipcRenderer.invoke("images:setKey", key),
    useProvider: (id) => ipcRenderer.invoke("images:useProvider", id),
    test: () => ipcRenderer.invoke("images:test"),
    dataUrl: (name) => ipcRenderer.invoke("images:dataUrl", name),
    save: (items) => ipcRenderer.invoke("images:save", items),
    import: (p) => ipcRenderer.invoke("images:import", p),
  },
  // 本地数据：集合 contents（内容）/ materials（素材）/ topics（收藏的选题）/ breakdowns（拆解库）/ platformAccounts、autoRuns（只读）
  store: {
    list: (name, filter) => ipcRenderer.invoke("store:list", name, filter),
    get: (name, id) => ipcRenderer.invoke("store:get", name, id),
    upsert: (name, item) => ipcRenderer.invoke("store:upsert", name, item),
    remove: (name, id) => ipcRenderer.invoke("store:remove", name, id),
    stats: (today) => ipcRenderer.invoke("store:stats", today),
  },
  // 平台号（同一平台可以登录多个号）：accounts(platform?) 列表带登录状态 / add(platform) 弹出登录页添加 /
  // relogin(id) / update(id, { name, boundAccountId }) / remove(id) 退出并移除 / open(id, "drafts"|"home"|"editor")；
  // 推送走后台任务 tasks.run("publish:push", { contentId, platformAccountId? })
  publish: {
    meta: () => ipcRenderer.invoke("publish:meta"),
    accounts: (platform) => ipcRenderer.invoke("publish:accounts", platform),
    add: (platform) => ipcRenderer.invoke("publish:add", platform),
    relogin: (id) => ipcRenderer.invoke("publish:relogin", id),
    update: (id, patch) => ipcRenderer.invoke("publish:update", id, patch),
    remove: (id) => ipcRenderer.invoke("publish:remove", id),
    open: (id, which) => ipcRenderer.invoke("publish:open", id, which),
    defaultFor: (platform, accountId) => ipcRenderer.invoke("publish:defaultFor", platform, accountId),
    openFor: (contentId) => ipcRenderer.invoke("publish:openFor", contentId),
    mark: (contentId, status) => ipcRenderer.invoke("publish:mark", contentId, status),
    openShots: () => ipcRenderer.invoke("publish:shots"),
    // 0.5.4 账号数据：stats() → { accounts: [{ id, platform, name, loggedIn, stats }], totals, running }；refreshStats() 立即重读全部
    stats: () => ipcRenderer.invoke("publish:stats"),
    refreshStats: () => ipcRenderer.invoke("publish:refreshStats"),
    onStats: on("publish:stats"),
    onAccounts: on("publish:accounts"),
    onChanged: on("publish:changed"),
  },
  // 找爆款 / 对标拆解：搜索、拆解、批量创作走后台任务 discover:search / discover:breakdown / discover:batch
  discover: {
    meta: () => ipcRenderer.invoke("discover:meta"),
    hot: (force) => ipcRenderer.invoke("discover:hot", force),
    webLogin: (platform) => ipcRenderer.invoke("discover:webLogin", platform),
    webStatus: (platform) => ipcRenderer.invoke("discover:webStatus", platform),
    overlap: (text, refId) => ipcRenderer.invoke("discover:overlap", text, refId),
    risk: (text) => ipcRenderer.invoke("discover:risk", text),
    duplicate: (item) => ipcRenderer.invoke("discover:duplicate", item),
  },
  // 定时自动创作：status() 开关 / 下次运行时间 / 最近运行；runNow() 立即运行一次
  auto: {
    status: () => ipcRenderer.invoke("auto:status"),
    runNow: (jobId) => ipcRenderer.invoke("auto:runNow", jobId),
    jobs: () => ipcRenderer.invoke("auto:jobs"),
    saveJobs: (list) => ipcRenderer.invoke("auto:saveJobs", list),
    onChanged: on("auto:changed"),
  },
  // 主进程改了数据（自动创作写稿、拆解入库）：onData(({ what }) => …)
  onData: on("data:changed"),
  content: {
    exportFile: (id) => ipcRenderer.invoke("content:export", id),
    copy: (text) => ipcRenderer.invoke("clipboard:write", text),
  },
  system: {
    info: () => ipcRenderer.invoke("system:info"),
    openDataDir: () => ipcRenderer.invoke("system:openDataDir"),
    openPath: (rel) => ipcRenderer.invoke("system:openPath", rel),
    clearCache: () => ipcRenderer.invoke("system:clearCache"),
    relaunch: () => ipcRenderer.invoke("system:relaunch"),
    onThemeUpdated: on("theme:updated"),
  },
});
