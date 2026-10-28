# 内容AI运营助手

桌面端的内容运营 AI 助手（macOS / Windows / Linux），基于 [electron-app-template](https://github.com/keovio/electron-app-template) 搭建，自带应用内增量更新和坏版本自动回滚。

## 功能

导航：**工作台 · 选题 · 对标拆解 · 创作 · 发布 · 素材库**（0.4.1 起一稿多发并进创作页，内容日历并进发布页）。

| 页面 | 能做什么 |
| --- | --- |
| **工作台** | 顶部四步流程条（对标拆解 → 创作 → 推草稿箱 → 发布）显示各步数量；待处理（未设 API Key、需改写、推送失败、逾期）；定时自动创作状态和下次运行时间；今日热点（头条热榜 + 百度热搜，点一下去搜爆款）；最近拆解、最近稿件、未来 7 天排期、各平台登录号数、当前运营账号 |
| **选题** | 按领域、热点关键词、目标平台批量生成选题（标题 + 切入角度 + 开头钩子 + 推荐理由），自动避开已有选题；可收藏、一键写成稿、加入发布日历 |
| **对标拆解 · 找爆款** | 选平台（公众号 / 头条 / 百家号 / 小红书 / 抖音）、输关键词（可不填：不填就拿今日热点里最火的几个话题去搜，合并后按热度挑最火的）、时间近 1 / 3 / 7 / 30 天或不限（默认近 3 天），在后台窗口里搜索；有热度的按点赞从高到低排，拆过的自动隐藏；勾选多篇批量拆解并写成指定平台（两篇同时处理，平台版本同时改写），可选生成配图、直接推进草稿箱 |
| **对标拆解 · 粘贴拆解** | 贴全文，或贴文章链接自动在后台窗口读正文 |
| **对标拆解 · 拆解库** | 每篇有标题公式、开头钩子、结构骨架、情绪点、爆点、可复用写法、不能照搬的部分和 3 个同结构选题；一键「用这个骨架创作」 |
| **去重** | 按「链接 + 标题」认同一篇（链接归一化到文章 ID，标题去掉空白标点），任意一个对上就不拆第二次；手动和定时用同一套 |
| **创作** | 选题 + 平台 + 篇幅 + 风格 + 大纲 + 素材 +（可选）参考爆款骨架 → 流式生成，写完自动存成草稿；写稿在后台跑，可以同时「新建」写下一篇、边写边 AI 取标题（选好的标题会保留）、AI 配图；「运用写法」：拆解库里所有拆解出的可复用写法 / 开头钩子 / 标题公式汇成写法库，写稿时按选题自动挑几条让 AI 用上，也可以自己勾选（批量和定时创作同样会用）；显示参考的爆款和与原文的重合度，超过上限提醒改写（可一键「AI 降重改写」、看重合的句子）；下方「平台版本」一键生成其他平台版本，每个版本单独编辑和推送；同一平台登录多个号时可选用哪个号推 |
| **发布** | 列表视图：搜索、按平台 / 状态 / 推送情况（含需改写、推送失败）筛选，改状态和日期、推送草稿箱、打开草稿箱、勾选批量推送；日历视图：月视图拖动改发布日期，双击空白日期新建 |
| **素材库** | 随手记、金句、数据、链接，带标签和搜索；勾选后一键交给 AI 写稿参考 |
| **设置 → 平台账号** | 同一平台可以登录多个号（官方页面扫码 / 短信，不存密码，每个号独立登录空间）；列表只显示已登录的号（失效的收在折叠里，可重新登录或移除）；每个号可改名、绑定运营账号；推送默认用绑定当前运营账号的号。0.4.0 登录过的号升级后自动迁移成平台号，不用重新登录 |
| **设置 → 定时自动创作** | 可以建多个定时任务（最多 20 个），每个任务单独设：开关、时间（可多个）、星期、关键词（可不填 = 按今日热点挑最火的）、去哪个平台找爆款、只看近几天、每次几篇、写成哪些平台、是否生成配图、是否自动推草稿箱；重合度上限所有任务共用；每个任务都有「立即运行一次」，不同任务可以同时跑（推草稿箱仍然排队一个个推）。0.4.1 及以前的单个配置自动迁移成「任务 1」。流程：找爆款 → 跳过拆过的 → 拆解 → 写原创 → 推草稿箱。只存草稿不发布，重合度过高的不推送并标记「需改写」。应用需要开着（睡眠错过的时段醒来 15 分钟内补跑） |
| **推送到草稿箱** | 自动打开编辑页、填标题、粘贴正文（富文本）、小红书自动生成文字封面，只点「存草稿」从不发布；抖音口播打开创作者中心并复制脚本；每一步写进运行日志，失败自动截图 |
| **运营账号** | 多账号（矩阵）运营：每个账号一套定位 / 读者 / 语气 / 禁用词，侧栏顶部切换；选题和稿件按账号分开，素材库、拆解库和 AI 模型共用 |
| **设置 → AI 模型** | DeepSeek / 通义千问 / Kimi / 智谱 GLM / OpenAI 预设，或任意 OpenAI 兼容接口；API Key 用系统钥匙串加密保存；一键测试连接 |
| **设置 → 配图** | 和写稿模型分开的一套生图设置：服务商（智谱 CogView、硅基流动 Kolors / FLUX、OpenAI，或任意 OpenAI 兼容的 /images/generations）、接口地址、模型、API Key，一键测试生图；每篇几张、封面、尺寸、画风都可以不填（默认按文章内容自动判断，小红书 / 抖音竖图，其他横图）。AI 先按文章写画面描述再出图：封面存为稿子封面，文中配图以 `![说明](cai-img:文件名)` 插进正文；推草稿箱时文字和图片按顺序分段粘贴（图片由平台编辑器自己上传），小红书直接上传这些配图 |
| **运行日志** | 右侧面板默认「重点」视图：只显示做成了什么（拆解、写稿、配图、平台版本、推送、自动创作的结果，✓ 一行一条）和警告错误；搜索、读正文、任务开始、推送每一步这些过程日志收起来，点「全部」才显示。紧凑单行、中文模块标签 |

### 找爆款的来源（`lib/discover/sources.js`）

| 平台 | 怎么搜 | 状态 |
| --- | --- | --- |
| 公众号 | 搜狗微信搜索（未登录时搜狗不给时间筛选，抓回来后按发布时间过滤） | 已用真实网络测通搜索 + 读正文 |
| 头条 | 头条搜索「资讯」 | 已用真实网络测通搜索 + 读正文（个别关键词头条不给结果） |
| 百家号 | 百度资讯搜索，只留 baijiahao.baidu.com 文章 | 已用真实网络测通搜索 + 读正文（百度偶尔弹验证码：手动拆解时会弹出窗口让你过验证，定时任务会跳过这次） |
| 小红书 | 小红书网页版搜索（要先在「找爆款」里登录网页版） | 待确认（需登录，没有真实账号验证） |
| 抖音 | 抖音网页版搜索（要先登录网页版） | 待确认（需登录，没有真实账号验证） |

都是在看不见的后台窗口里像人一样打开页面读内容，不调用平台私有接口。平台改版时一般只改这个文件，发增量包即可。

所有数据都在本地：`<数据目录>/data/*.json`（运营账号、内容、素材、收藏选题、拆解库、平台号、自动创作记录），API Key 在 `<数据目录>/secrets.json`。

## 上手

```bash
npm i
npm start
```

打开后去「设置 → AI 模型」选服务商、粘贴 API Key、点「测试」，再在「账号定位」里填上你的账号信息，就可以从「对标拆解 → 找爆款」或「选题」开始了。推送草稿箱前在「设置 → 平台账号」登录各平台的号。

## 代码结构（在模板之上新增的部分）

| 文件 | 作用 |
| --- | --- |
| `lib/ai-client.js` | OpenAI 兼容的 `/chat/completions` 客户端：SSE 流式解析、超时与卡顿检测、可取消、中文错误提示、从模型输出里提取 JSON |
| `lib/prompts.js` | 选题 / 写稿 / 改写 / 标题 / 润色 / 对标拆解的提示词，参考爆款骨架注入，各平台写作规范，账号定位注入 |
| `lib/store.js` | 本地 JSON 集合（contents / materials / topics / breakdowns / platformAccounts / autoRuns），字段校验、原子写、搜索筛选、工作台统计 |
| `lib/discover/sources.js` | 找爆款 / 读正文的来源：各平台搜索地址、抠搜索结果和正文的页面脚本、头条热榜 / 百度热搜解析 |
| `lib/discover/utils.js` | 时间解析（「3 小时前」「昨天 09:30」「10-27」…）、热度数字解析、按点赞排序、链接 / 标题归一化和去重 |
| `lib/discover/runner.js` | 后台窗口搜索、读正文、遇到验证码的处理、小红书 / 抖音网页版登录、今日热点 |
| `lib/similarity.js` | 与原文的重合度（连续 8 字相同的片段覆盖了稿子多少）和重合句子 |
| `lib/scheduler.js` | 定时：时间 / 星期解析、下次运行时间、到点判断（宽限期补跑、不重复） |
| `lib/images.js` | 配图：生图客户端（智谱 / 硅基流动 / OpenAI 兼容）、正文里配图行的插入 / 拆分 / 去除 |
| `lib/automation.js` | 对标拆解、按骨架写原创、平台版本、推草稿箱的流水线；后台任务 `discover:search` `discover:breakdown` `discover:batch` `auto:run` |
| `lib/secrets.js` | API Key 存储（Electron safeStorage 加密，不可用时退回编码） |
| `lib/content-ipc.js` | 注册 AI 后台任务（`ai:topics` `ai:draft` `ai:rewrite` `ai:titles` `ai:polish`）和数据 / 配置 IPC，流式文字通过 `ai:delta` 推给页面 |
| `lib/publish/platforms.js` | 各平台后台地址、登录 cookie、编辑器选择器、「存草稿」按钮文字（平台改版时改这里发增量包即可） |
| `lib/publish/publisher.js` | 平台号（多号登录、改名、绑定运营账号、0.4.0 登录迁移）、打开后台 / 草稿箱、自动存草稿引擎（后台任务 `publish:push`） |
| `lib/publish/markdown.js` | Markdown → 富文本 HTML / 纯文本，用于粘贴进平台编辑器 |
| `renderer/pages/common.js` | 页面公共工具 `window.Content`：跑 AI 任务并接收流式文字、页面间传数据、标签组件 |
| `renderer/pages/*.js` | 工作台、选题、对标拆解、创作（含平台版本）、发布（列表 + 日历）、素材库、设置分组 |

加一个平台：在 `lib/prompts.js` 的 `PLATFORMS` 里加一项写作规范，再在 `renderer/pages/common.js` 的 `PLATFORM_NAMES` 和 `style.css` 的 `.pf-*` 颜色里各加一行。

测试：

- `npm test`：AI 客户端、提示词、本地数据和密钥存储，以及 0.4.1 新增的时间解析、去重、热度排序、定时触发、重合度、数据校验、拆解 / 自动创作流水线
- `npm run smoke`：真实启动应用，检查新导航、对标拆解三个标签、工作台流程条、平台号 / 找爆款 / 自动创作接口，并确认旧的按运营账号登录接口（`publish.status` / `login` / `logout`）已移除
- `node scripts/e2e-mock.js [截图目录]`（Linux 无桌面时前面加 `xvfb-run -a`）：本地模拟平台端到端测试，模拟 0.4.0 老用户升级 → 平台号迁移 → 找爆款 → 批量拆解并写成多平台 → 推草稿箱（重合度过高的不推送）→ 粘贴链接去重 → 立即运行一次自动创作，每一步截图

---

以下是模板自带的说明（外壳、增量更新、发布流程）。

## Electron 应用模板

一个可以直接拿来开新项目的跨平台（macOS / Windows / Linux）Electron 模板，自带**应用内增量更新**：
发布小改动时用户只需下载几十 KB ~ 几 MB 的「应用层」，点一下「重启生效」就完成升级；新版本启动失败会自动退回安装包里的版本。

## 它给你什么

- **一个配置文件**：`app.config.json` 管应用名、appId、GitHub 仓库、tag 前缀、更新通道、下载镜像。启动器、更新器、打包、发布流程都从这里读，不用到处改名字。
- **增量更新**：只替换应用层（`app-update.asar`，纯 JS/HTML，不含原生模块），不重新下载 Electron 内核。一个增量包同时服务三个系统。
- **自动回滚**：新应用层抛异常、或在窗口加载完成后 10 秒内崩溃、或连续 2 次没启动成功 → 标记为坏版本，自动重启回安装包内置版本。
- **需要完整安装时自动识别**：Electron 大版本变了或启动器协议升级了，应用会提示并打开对应系统的安装包下载地址。
- **国内网络友好**：先直连 GitHub，慢或连不上自动换镜像（默认 `ghfast.top`），下载带 sha256 校验、卡顿检测、多源回退。
- **稳妥的窗口**：先隐藏创建、画好再显示（3 秒兜底）、单实例、macOS 默认关闭硬件加速（避开 Metal 黑屏问题）、页面加载和网络请求 25 秒超时。
- **安全默认值**：`contextIsolation` + `sandbox`，页面只能用 preload 暴露的 `window.app`；外链只放行 https 并交给系统浏览器。
- **示例界面**：一个页面，显示应用名、版本和来源（安装包内置 / 已更新），以及「应用更新」卡片（检查更新 / 下载更新带进度条 / 重启生效），错误都用中文说明。
- **CI 与发布**：GitHub Actions 三系统测试 + 真实启动冒烟测试；推 tag 自动出 dmg（Apple 芯片 + Intel）/ exe / AppImage 和增量包；也可以只发增量包。

## 通用外壳（新项目只管往里填页面）

打开就是一个完整的桌面应用框架：

- **左侧导航**：拖动右边缘调宽度（180–360px），拖到最左或双击边缘 / 点底部箭头 / `Ctrl/⌘ + B` 折叠成图标栏；宽度和折叠状态会记住。
- **深浅色 + 主题色**：跟随系统 / 浅色 / 深色（同时作用于原生菜单和滚动条），7 种主题色。
- **可换背景**：极光、晚霞、海洋、森林、薄雾、夜空、纯色，或选一张自己的图片（存进数据目录）；可调背景遮罩，卡片和侧边栏默认毛玻璃。
- **性能模式**：一键关掉毛玻璃模糊、阴影和动画，老电脑上更流畅、更省电。
- **可换字体**：系统默认 / 现代无衬线 / 宋体 / 圆体 / 等宽，或填任意已安装字体；字号 12–18px 单独可调。
- **模块化卡片布局**：页面用 `Shell.modules()` + `Shell.card()` 拼，宽窗口自动排成多列（瀑布流），列数随窗口宽度实时变化、卡片少时自动变宽铺满；设置里可切到「经典」单列布局，页面代码不用改。设置页就是这样拼的。
- **右侧运行日志面板**：`Ctrl/⌘ + L` 或侧边栏底部按钮开关，拖左边缘调宽度（双击收起），`A− / A+` 或 `Ctrl/⌘ + 滚轮` 缩放字号；收起时有新错误按钮会亮红点。
- **设置页**：外观（布局、主题、主题色、缩放）、背景、字体、关于与更新（版本、检查更新、自动更新、开机自启、系统信息）、日志与数据（日志级别、日志面板字号、日志文件、数据目录、清除缓存、恢复默认）。设置存在 `<数据目录>/settings.json`，有默认值和校验，修改立即生效。
- **日志页**：主进程和页面的日志实时显示，可按级别 / 关键字筛选、暂停滚动、复制、打开日志文件夹；同时按天写文件、保留 7 天。有新错误时导航上会出现角标。
- **后台任务**：主进程注册任务，页面一行启动；进度条（未知进度显示滚动条）、可取消、排队（默认同时 2 个）；侧边栏底部常驻进度指示，完成/失败弹提示。

### 加一个页面

1. 复制 `renderer/pages/home.js` 为 `renderer/pages/notes.js`，改 `id` / `title` / `icon`；
2. 在 `renderer/index.html` 的「你的页面」那段加一行 `<script src="pages/notes.js"></script>`。

```js
Shell.registerPage({
  id: "notes", title: "笔记", icon: "note", order: 20,   // icon：home note folder search chart user star…，或一个字
  render(root, ctx) {                                    // 第一次打开时调用
    const { h, card, modules } = Shell;
    root.classList.add("page-wide");                     // 宽页面，模块排多列
    root.append(h("header", { class: "page-head" }, h("h1", {}, "笔记")),
      modules(
        card({ title: "最近", icon: "note", tag: "3 条", actions: [h("button", { class: "btn small" }, "新建")] }, h("p", {}, "…")),
        card({ title: "统计", desc: "一句说明" }, h("p", {}, "…"))));
  },
  onShow(root, ctx) {},                                  // 每次切进来（可选）
});
```

页面可用的工具：`Shell.h(tag, attrs, ...children)` 建元素、`Shell.toast(msg, "success")`、`await Shell.confirm("确定？")`、`Shell.navigate(id)`、`Shell.setBadge(id, n)`、`Shell.getSettings()` / `Shell.saveSettings({...})`、`Shell.tasks.run(type, params)`；和主进程通信走 `window.app`（见 `preload.js`）。

### 加一个后台任务

在 `main.js` 里注册（示例任务 `demo` 就在那里）：

```js
tasks.register("export", {
  title: "导出数据",
  single: true,                       // 同类任务只允许一个（可选）
  async handler(params, ctx) {
    for (let i = 0; i < n; i++) {
      ctx.throwIfCancelled();         // 取消时抛出；也可以把 ctx.signal 传给 fetch
      ctx.progress((i + 1) / n * 100, `第 ${i + 1}/${n} 项`);   // 传 null 表示进度未知
    }
    return { file };                  // 结果放在 task.result
  },
});
```

页面里：`await Shell.tasks.run("export", { ... })`。任务开始/结束/失败会自动写日志。

### 加设置项 / 设置分组

1. `main.js` 里扩展 schema：`schema: { ...BASE_SCHEMA, exportDir: { type: "string", default: "" } }`（类型：`bool` / `number`（min/max/step）/ `enum`（values）/ `string`）；
2. 页面里加一个分组：

```js
Shell.registerSettingsSection({ id: "export", title: "导出", order: 25, render(box) {
  const { row, toggle, select, segmented, range, swatches } = Shell.settingsUI;   // 每个分组是一张卡片
  box.append(row("导出目录", Shell.getSettings().exportDir || "未设置", Shell.h("button", { class: "btn" }, "选择…")));
} });
```

主进程写日志：`const log = logger.scope("模块名"); log.info("…")`。

## 5 分钟上手

1. **改配置** `app.config.json`：

   ```json
   {
     "appName": "my-electron-app",          // 英文名：数据目录、安装包文件名都用它
     "productName": "示例应用",              // 显示给用户的名字
     "appId": "com.example.myelectronapp",  // 反向域名，发布后不要再改
     "repo": "keovio/electron-app-template",// 发布用的 GitHub 仓库 owner/name
     "tagPrefix": "v",                      // 发布 tag 前缀：v1.2.3
     "channelTag": "latest-layer",          // 增量通道（一个固定的 Release）
     "mirrors": ["", "https://ghfast.top/"] // "" = 直连；按顺序尝试
   }
   ```
   （实际文件是纯 JSON，不能写注释。）`package.json` 里的 `version` 就是应用版本号。

2. **安装依赖**：`npm i`
   （网络装不了 Electron 时，可先 `ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm i` 跑检查和测试，但 `npm start` 需要 Electron 本体。）

3. **运行**：`npm start`

在 `renderer/pages/` 里写你的页面（见上面「加一个页面」），在 `main.js` 里加主进程逻辑和后台任务，通过 `preload.js` 暴露接口。应用图标：放一张 512×512 的 `build/icon.png` 即可（三个系统通用）。

### 常用命令

| 命令 | 作用 |
| --- | --- |
| `npm start` | 开发运行 |
| `npm run check` | 所有 JS 语法检查 + 配置校验 |
| `npm test` | 单元测试（`node --test`，不需要 Electron） |
| `npm run pack` | 打未打包的应用目录（`release/*-unpacked` 或 `release/mac-*`） |
| `npm run smoke` | 运行打包好的应用做冒烟测试（Linux 无桌面时 `xvfb-run -a npm run smoke`） |
| `npm run dist` | 打当前系统的安装包 |
| `npm run build:layer` | 构建增量包 `release/app-update.asar` + `app-update.json` |

## 发布

### 完整发布（安装包 + 增量包）

```bash
npm version 1.2.0 --no-git-tag-version   # 或手动改 package.json 的 version
echo "这次更新的一句话说明" > update-notes.txt
git commit -am "1.2.0" && git tag v1.2.0 && git push && git push --tags
```

`.github/workflows/release.yml` 会：在 macOS / Windows / Linux 上分别打 `dmg（arm64 + x64）`、`nsis exe`、`AppImage` → 在 Linux 上构建一份通用增量包 → 创建 Release `v1.2.0` 并上传全部文件 → 把 `app-update.json` 覆盖到增量通道 `latest-layer`（通道里已有更新版本时不覆盖，防止降级）→ 下载回来校验。

> 改了 `tagPrefix` 的话，记得同步改 `release.yml` 顶部的 `tags: ["v*"]`（触发规则读不了配置文件）。

### 只发增量包（小改动，不出安装包）

```bash
# 1. 改版本号，写说明
npm version 1.2.1 --no-git-tag-version
echo "修复了某某问题" > update-notes.txt
git commit -am "1.2.1"

# 2. 构建增量包；--installer-version 填最近一次完整发布的版本（需要完整安装时用户会被引导到那里）
npm run build:layer -- --version 1.2.1 --installer-version 1.2.0 --out layer

# 3. 推到分支 layer/v1.2.1（layer/ 在 .gitignore 里，要 -f）
git switch -c layer/v1.2.1
git add -f layer && git commit -m "layer 1.2.1" && git push origin layer/v1.2.1
git switch main && git push
```

4. 在 GitHub → Actions → **Publish Layer** → Run workflow，填 `1.2.1`。
   它会校验 sha256 / 大小 / 版本 / 下载地址，上传到 Release `v1.2.1`（没有就创建）和增量通道，再下载回来校验。
   由流程自动创建的 tag 不会再触发完整发布。

> **构建注意**：`build:layer` 会在系统临时目录里打包，写出后再读回来核对 sha256。在某些同步盘 / 网络文件系统（我们在一个工作区文件系统上遇到过）上，刚写的文件读回来会不一致，脚本会报错；这时把项目复制到 `/tmp` 再构建：
> `cp -r . /tmp/app && cd /tmp/app && npm run build:layer -- …`，再把 `/tmp/app/layer` 拷回来。

### 什么时候必须出完整安装包

- 升级了 Electron **大版本**（清单里的 `electron` 大版本与已安装的不同）
- 改了启动器协议：`boot/bootstrap.js`、`lib/update-core.js`、`lib/fs-utils.js`、`lib/config.js` 的行为变化时，把 `lib/update-core.js` 里的 `BOOT_PROTOCOL` 加 1
- 加了运行时依赖（`dependencies`）或原生模块：增量包不含 `node_modules`，`build:layer` 会拒绝构建

这些情况下旧版本会提示「需要下载完整安装包」，并打开对应系统（mac arm64 / mac x64 / win / linux）的下载地址。

## 更新和回滚是怎么工作的

```
安装包 app.asar ── boot/bootstrap.js（启动器，永不被替换）
                       │ 启动时检查 <数据目录>/updates/
                       ├─ 有更新、校验通过、没被标记坏 → 加载 app-<版本>.asar/main.js
                       └─ 否则 → 加载安装包内置的 main.js
```

- 数据目录：`app.getPath('appData')/<appName>`，即 macOS `~/Library/Application Support/<appName>`、Windows `%APPDATA%\<appName>`、Linux `~/.config/<appName>`；更新文件在其下的 `updates/`。
- 启动 6 秒后自动检查更新；能增量更新就在后台下载，下载完界面出现「重启生效」。
- 启动器选层时会校验：版本比内置新、清单字段完整、Electron 大版本一致、启动器协议兼容、文件大小和 **sha256** 一致。
- 每次加载新层前记一次「启动尝试」：
  - 窗口加载完成后再过 **10 秒**没崩溃（或正常退出）→ 记为成功，以后不再计数；
  - 加载时 / 10 秒内出现未捕获异常 → 立即标记坏版本，带原参数重启回内置版本；
  - 进程直接崩溃（来不及记录）→ 累计尝试次数，**连续 2 次**后第 3 次启动时标记坏版本、加载内置版本。
- 坏版本记录在 `updates/state.json`；用户在界面里重新下载同一版本时会清除记录，允许再试一次。
- 下载完成后只保留「正在用的版本 + 新版本」，旧文件自动清理。

## 网络慢时手动安装增量包

1. 从 Release 页下载 `app-update.asar` 和 `app-update.json`（可以用镜像，如 `https://ghfast.top/<原链接>`）。
2. 退出应用，放进数据目录的 `updates/`（没有就新建），改名为：
   - `app-update.asar` → `app-<版本>.asar`（例如 `app-1.2.1.asar`）
   - `app-update.json` → `app-<版本>.json`（例如 `app-1.2.1.json`）
3. 重新打开应用。sha256 或大小对不上会被自动忽略并退回内置版本。

## 启动参数

| 参数 | 作用 |
| --- | --- |
| `--no-updates` | 不加载已下载的应用层，也不自动检查更新（排查问题时用；环境变量 `APP_NO_UPDATES=1` 同效） |
| `--app-gpu` | macOS 上恢复显卡加速。默认关闭，因为部分 Mac 上 Chromium 的 ANGLE Metal 后端编译着色器失败（`Function main0 was not found`），窗口会一直黑屏 |
| `--smoke-test` | 冒烟测试：隐藏窗口加载页面，检查 preload 接口和页面内容后退出，输出 `SMOKE OK …`，退出码 0 = 通过 |

环境变量 `APP_UPDATES_DIR` 可以指定其他更新目录，`APP_DATA_DIR` 可以指定设置和日志的目录（测试用）。

## 目录结构

```
app.config.json          唯一配置
boot/bootstrap.js        启动器（package.json 的 main）
main.js / preload.js     主进程 / 预加载（在 main.js 里注册后台任务、扩展设置项）
renderer/index.html      外壳布局 + 脚本清单
renderer/pages/          你的页面（home.js 是示例）
renderer/shell/          外壳：shell.js（导航、侧边栏、主题、提示条）、pages/（任务、日志、设置）
renderer/style.css       样式（浅色 / 深色变量）
lib/settings.js          设置存储（默认值 + 校验）
lib/logger.js            日志（内存 + 按天写文件）
lib/tasks.js             后台任务（进度、取消、排队）
lib/shell-ipc.js         外壳的 IPC 和设置副作用
lib/config.js            读配置、算发布地址
lib/update-core.js       更新纯逻辑：选层、校验、回滚记录、错误翻译
lib/updater.js           检查 / 下载更新
lib/download.js          多源下载 + sha256 校验
lib/fs-utils.js          原子写 JSON、锁文件
build/build-layer.js     构建增量包
build/files.js           打包文件清单（安装包和增量包共用）
build/adhoc-sign.js      macOS ad-hoc 签名
electron-builder.config.js
scripts/                 check / smoke / 发布小工具
test/                    node --test 单元测试
.github/workflows/       ci.yml / release.yml / publish-layer.yml
```

## 签名说明

模板默认不做正式代码签名：macOS 只做 ad-hoc 签名（首次打开需在「系统设置 › 隐私与安全性」点「仍要打开」），Windows 安装包未签名（SmartScreen 可能提示）。有证书后按 electron-builder 文档配置即可。

## 许可证

MIT © 2026 keovio
