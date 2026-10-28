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
  // 本地数据：集合 contents（内容）/ materials（素材）/ topics（收藏的选题）
  store: {
    list: (name, filter) => ipcRenderer.invoke("store:list", name, filter),
    get: (name, id) => ipcRenderer.invoke("store:get", name, id),
    upsert: (name, item) => ipcRenderer.invoke("store:upsert", name, item),
    remove: (name, id) => ipcRenderer.invoke("store:remove", name, id),
    stats: (today) => ipcRenderer.invoke("store:stats", today),
  },
  // 平台：登录状态 / 登录 / 退出 / 打开后台或草稿箱；推送走后台任务 tasks.run("publish:push", { contentId })
  publish: {
    meta: () => ipcRenderer.invoke("publish:meta"),
    status: (accountId) => ipcRenderer.invoke("publish:status", accountId),
    login: (accountId, platform) => ipcRenderer.invoke("publish:login", accountId, platform),
    logout: (accountId, platform) => ipcRenderer.invoke("publish:logout", accountId, platform),
    open: (accountId, platform, which) => ipcRenderer.invoke("publish:open", accountId, platform, which),
    openFor: (contentId) => ipcRenderer.invoke("publish:openFor", contentId),
    openShots: () => ipcRenderer.invoke("publish:shots"),
    onStatus: on("publish:status"),
    onChanged: on("publish:changed"),
  },
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
