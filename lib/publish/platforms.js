"use strict";
// 各平台后台的地址和编辑器特征（纯数据，可单测）。平台改版时一般只要改这里，发增量包即可。
//
//   home        后台首页（登录后会跳到这里）            login       登录页
//   drafts      草稿箱（{token} 会换成从地址栏取到的 token，公众号用）
//   editor      新建内容的编辑页                         loginUrl    判断「被踢回登录页」的地址特征
//   cookies     登录后才有的 cookie 名（任意一个存在就算已登录）
//   title       标题输入框：CSS 选择器，找不到时按 placeholder 含「标题」兜底
//   body        正文编辑器：CSS 选择器（contenteditable），或 iframe 选择器（iframe 里的 body 可编辑）
//   saveTexts   「存草稿」按钮上的文字（完全匹配，按顺序找）   saved  保存成功后页面上会出现的文字
//   dismiss     进编辑页时可能弹出的引导框按钮文字（只点这些）
//   mode        auto = 自动填并存草稿；assist = 打开创作页 + 复制内容（抖音口播：脚本不是能直接发的内容）
//   html        正文用富文本（Markdown 转 HTML）还是纯文本
//   image       需要至少一张图（小红书）：没有素材图时自动生成一张文字封面
//   prepare     进编辑页后先点的文字（小红书要先切到「上传图文」）
//   stats       账号数据（0.5.4）：url 读哪一页（默认 home，后台首页）；fans / reads / income 是页面上的标签文字，
//               按优先级排、从行首匹配；order = after（数字在标签下面，默认）/ before（数字在标签上面）。解析见 stats.js
const PUBLISH_PLATFORMS = {
  wechat: {
    name: "公众号",
    home: "https://mp.weixin.qq.com/",
    login: "https://mp.weixin.qq.com/",
    loginUrl: [/mp\.weixin\.qq\.com\/?(\?|#|$)/, /\/cgi-bin\/loginpage/],
    tokenFrom: /[?&]token=(\d+)/,
    drafts: "https://mp.weixin.qq.com/cgi-bin/appmsg?begin=0&count=10&type=77&action=list_card&lang=zh_CN&token={token}",
    editor: "https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2&action=edit&isNew=1&type=77&lang=zh_CN&token={token}",
    cookies: ["slave_sid", "data_ticket"],
    cookieUrl: "https://mp.weixin.qq.com/",
    title: ["#title", "textarea[placeholder*='标题']", "input[placeholder*='标题']"],
    body: [".ProseMirror[contenteditable='true']", "#ueditor_0", ".edui-editor iframe", "[contenteditable='true']"],
    saveTexts: ["保存为草稿", "保存草稿", "存草稿"],
    saved: ["已保存", "保存成功"],
    dismiss: ["我知道了", "知道了", "跳过"],
    stats: { fans: ["总用户数", "总关注", "关注用户", "粉丝总数", "粉丝"], reads: ["昨日阅读", "阅读次数", "总阅读", "阅读"], income: ["昨日收入", "累计收入", "收入", "收益"] },
    mode: "auto", html: true,
  },
  xiaohongshu: {
    name: "小红书",
    home: "https://creator.xiaohongshu.com/new/home",
    login: "https://creator.xiaohongshu.com/login",
    loginUrl: [/creator\.xiaohongshu\.com\/login/],
    drafts: "https://creator.xiaohongshu.com/publish/publish?source=official&from=menu&target=image",
    editor: "https://creator.xiaohongshu.com/publish/publish?source=official&from=menu&target=image",
    cookies: ["galaxy_creator_session_id", "access-token-creator.xiaohongshu.com"],
    cookieUrl: "https://creator.xiaohongshu.com/",
    prepare: ["上传图文"],
    image: { width: 1080, height: 1440 },
    title: ["input[placeholder*='标题']", "textarea[placeholder*='标题']"],
    body: [".ql-editor[contenteditable='true']", ".tiptap[contenteditable='true']", "#post-textarea", "[contenteditable='true']"],
    saveTexts: ["暂存离开", "存草稿", "保存草稿"],
    saved: ["已保存", "保存成功", "暂存成功", "草稿"],
    dismiss: ["我知道了", "知道了", "跳过"],
    stats: { fans: ["粉丝数", "总粉丝", "粉丝"], reads: ["观看数", "总观看", "笔记观看", "阅读数", "浏览", "观看"], income: ["累计收益", "收益", "收入"] },
    mode: "auto", html: false, maxTitle: 20,
  },
  douyin: {
    name: "抖音",
    home: "https://creator.douyin.com/creator-micro/home",
    login: "https://creator.douyin.com/",
    loginUrl: [/creator\.douyin\.com\/?(\?|#|$)/, /\/login/],
    drafts: "https://creator.douyin.com/creator-micro/content/upload",
    editor: "https://creator.douyin.com/creator-micro/content/upload",
    cookies: ["sessionid", "sessionid_ss"],
    cookieUrl: "https://creator.douyin.com/",
    stats: { fans: ["总粉丝", "粉丝数", "粉丝"], reads: ["播放量", "总播放", "作品播放", "播放"], income: ["累计收益", "收益", "收入"] },
    mode: "assist", html: false,
  },
  toutiao: {
    name: "头条号",
    home: "https://mp.toutiao.com/profile_v4/index",
    login: "https://mp.toutiao.com/auth/page/login",
    loginUrl: [/mp\.toutiao\.com\/auth\/page\/login/],
    drafts: "https://mp.toutiao.com/profile_v4/manage/draft",
    editor: "https://mp.toutiao.com/profile_v4/graphic/publish",
    cookies: ["sessionid", "sid_tt"],
    cookieUrl: "https://mp.toutiao.com/",
    title: ["textarea[placeholder*='标题']", "input[placeholder*='标题']"],
    body: [".ProseMirror[contenteditable='true']", "[contenteditable='true']"],
    // 头条编辑页会自动存草稿；有「存草稿」按钮就点，没有就等「已保存」
    saveTexts: ["存草稿", "保存草稿"],
    saved: ["已保存", "草稿已保存", "保存成功"],
    dismiss: ["我知道了", "知道了", "跳过"],
    stats: { fans: ["粉丝数", "总粉丝", "粉丝"], reads: ["阅读/播放", "总阅读", "阅读量", "阅读(播放)", "阅读", "展现量"], income: ["累计收益", "总收益", "昨日收益", "收益"] },
    mode: "auto", html: true, maxTitle: 30,
  },
  baijiahao: {
    name: "百家号",
    home: "https://baijiahao.baidu.com/builder/rc/home",
    login: "https://baijiahao.baidu.com/builder/theme/bjh/login",
    loginUrl: [/baijiahao\.baidu\.com\/builder\/theme\/bjh\/login/, /passport\.baidu\.com/],
    drafts: "https://baijiahao.baidu.com/builder/rc/content?type=draft",
    editor: "https://baijiahao.baidu.com/builder/rc/edit?type=news",
    cookies: ["BDUSS"],
    cookieUrl: "https://baijiahao.baidu.com/",
    title: ["input.cheetah-input", "textarea[placeholder*='标题']", "input[placeholder*='标题']"],
    body: ["#ueditor_0", "iframe[id^='ueditor']", ".ProseMirror[contenteditable='true']", "[contenteditable='true']"],
    saveTexts: ["存草稿", "保存草稿"],
    saved: ["保存成功", "已保存", "存草稿成功"],
    dismiss: ["我知道了", "知道了", "跳过"],
    stats: { fans: ["总粉丝数", "粉丝数", "粉丝"], reads: ["总阅读量", "阅读量", "阅读", "推荐量"], income: ["累计收益", "总收益", "昨日收益", "收益"] },
    mode: "auto", html: true, maxTitle: 30,
  },
};

// 测试用：环境变量 CAI_PUBLISH_OVERRIDES='{"toutiao":{"editor":"http://127.0.0.1:5000/…","loginUrl":["/login"]}}' 覆盖配置（端到端测试连本地模拟平台）
if (process.env.CAI_PUBLISH_OVERRIDES) {
  try {
    const o = JSON.parse(process.env.CAI_PUBLISH_OVERRIDES);
    for (const [pf, v] of Object.entries(o)) {
      if (!PUBLISH_PLATFORMS[pf] || !v || typeof v !== "object") continue;
      const patch = { ...v };
      if (Array.isArray(patch.loginUrl)) patch.loginUrl = patch.loginUrl.map((x) => new RegExp(x));
      if (typeof patch.tokenFrom === "string") patch.tokenFrom = new RegExp(patch.tokenFrom);
      Object.assign(PUBLISH_PLATFORMS[pf], patch);
    }
  } catch { /* 忽略写错的覆盖配置 */ }
}

const PUBLISH_IDS = Object.keys(PUBLISH_PLATFORMS);

// 地址里的 {token} 换掉；没有 token 又需要时返回 ""
function fillUrl(tpl, vars = {}) {
  let missing = false;
  const out = String(tpl || "").replace(/\{(\w+)\}/g, (_, k) => { if (vars[k] == null || vars[k] === "") { missing = true; return ""; } return encodeURIComponent(vars[k]); });
  return missing ? "" : out;
}
const needsToken = (tpl) => /\{token\}/.test(String(tpl || ""));
const isLoginUrl = (pf, url) => !!PUBLISH_PLATFORMS[pf] && (PUBLISH_PLATFORMS[pf].loginUrl || []).some((re) => re.test(String(url || "")));
function tokenOf(pf, url) {
  const c = PUBLISH_PLATFORMS[pf];
  const m = c && c.tokenFrom && String(url || "").match(c.tokenFrom);
  return m ? m[1] : "";
}
// 0.4.0 的登录空间命名（每个运营账号 × 平台一个）。0.4.1 起登录按平台号管理，这个只用于把旧登录迁移成平台号
const partitionOf = (accountId, pf) => `persist:pub-${String(accountId).replace(/[^\w-]/g, "")}-${pf}`;

// 浏览器 UA：去掉 Electron / 应用名，避免被平台当成异常客户端
function cleanUserAgent(ua) {
  return String(ua || "").replace(/\s(?:Electron|content-ai-assistant|[^\s/]*AI[^\s/]*)\/\S+/g, "").replace(/\s{2,}/g, " ").trim();
}

module.exports = { PUBLISH_PLATFORMS, PUBLISH_IDS, fillUrl, needsToken, isLoginUrl, tokenOf, partitionOf, cleanUserAgent };
