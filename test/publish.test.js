"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const P = require("../lib/publish/platforms");
const { mdToHtml, mdToText } = require("../lib/publish/markdown");
const { PLATFORMS } = require("../lib/prompts");

test("平台配置：和写作平台一一对应，字段齐全", () => {
  assert.deepEqual(P.PUBLISH_IDS.sort(), Object.keys(PLATFORMS).sort());
  for (const [id, c] of Object.entries(P.PUBLISH_PLATFORMS)) {
    assert.ok(c.name && c.home && c.login && c.drafts && c.editor, id);
    assert.ok(Array.isArray(c.cookies) && c.cookies.length, id);
    assert.ok(/^https:\/\//.test(c.cookieUrl), id);
    if (c.mode === "auto") {
      assert.ok(c.title.length && c.body.length && c.saveTexts.length && c.saved.length, id);
      assert.ok(!c.saveTexts.some((t) => /发布/.test(t)), `${id} 不能点发布`);
    }
  }
  assert.equal(P.PUBLISH_PLATFORMS.douyin.mode, "assist");
});

test("地址模板、token、登录页判断", () => {
  assert.equal(P.fillUrl("https://x/?token={token}", { token: "123" }), "https://x/?token=123");
  assert.equal(P.fillUrl("https://x/?token={token}", {}), "");
  assert.equal(P.needsToken(P.PUBLISH_PLATFORMS.wechat.drafts), true);
  assert.equal(P.needsToken(P.PUBLISH_PLATFORMS.toutiao.drafts), false);
  assert.equal(P.tokenOf("wechat", "https://mp.weixin.qq.com/cgi-bin/home?t=home/index&lang=zh_CN&token=987654"), "987654");
  assert.equal(P.isLoginUrl("wechat", "https://mp.weixin.qq.com/"), true);
  assert.equal(P.isLoginUrl("wechat", "https://mp.weixin.qq.com/cgi-bin/home?token=1"), false);
  assert.equal(P.isLoginUrl("toutiao", "https://mp.toutiao.com/auth/page/login?redirect_url=x"), true);
  assert.equal(P.isLoginUrl("toutiao", "https://mp.toutiao.com/profile_v4/index"), false);
  assert.equal(P.partitionOf("ab-12/..", "wechat"), "persist:pub-ab-12-wechat");
});

test("UA 去掉 Electron 和应用名", () => {
  const ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) content-ai-assistant/0.2.0 Chrome/130.0.6723.191 Electron/33.4.11 Safari/537.36";
  const out = P.cleanUserAgent(ua);
  assert.ok(!/Electron|content-ai-assistant/.test(out));
  assert.ok(/Chrome\/130/.test(out) && /AppleWebKit\/537\.36/.test(out) && /Safari\/537\.36$/.test(out));
});

test("Markdown → HTML", () => {
  const html = mdToHtml("# 大标题\n\n第一段 **重点** 和 *斜体*\n第二行\n\n## 小标题\n- 一\n- 二\n\n1. 甲\n2. 乙\n\n> 引用\n\n---\n<script>x</script> [链接](https://a.com)");
  assert.match(html, /<h2>大标题<\/h2>/);
  assert.match(html, /<p>第一段 <strong>重点<\/strong> 和 <em>斜体<\/em><br>第二行<\/p>/);
  assert.match(html, /<ul><li>一<\/li><li>二<\/li><\/ul>/);
  assert.match(html, /<ol><li>甲<\/li><li>乙<\/li><\/ol>/);
  assert.match(html, /<blockquote><p>引用<\/p><\/blockquote>/);
  assert.match(html, /<hr>/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /<a href="https:\/\/a.com">链接<\/a>/);
});

test("Markdown → 纯文本", () => {
  assert.equal(mdToText("## 标题\n**粗** `代码`\n- 一项\n\n\n\n[链接](https://a.com)"), "标题\n粗 代码\n• 一项\n\n链接");
});
