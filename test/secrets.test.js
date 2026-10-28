"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { createSecrets } = require("../lib/secrets");
const { tmp } = require("./helpers");

// 假的系统加密：反转字节
const cipher = { isAvailable: () => true, encrypt: (s) => Buffer.from(s, "utf8").reverse(), decrypt: (b) => Buffer.from(b).reverse().toString("utf8") };

test("有系统加密时加密保存，文件里没有明文", () => {
  const f = path.join(tmp(), "secrets.json");
  const s = createSecrets({ file: f, cipher });
  s.set("k", "sk-abcdef1234");
  assert.equal(s.get("k"), "sk-abcdef1234");
  assert.deepEqual(s.describe("k"), { set: true, tail: "1234", encrypted: true });
  assert.ok(!fs.readFileSync(f, "utf8").includes("sk-abcdef1234"));
  assert.equal(createSecrets({ file: f, cipher }).get("k"), "sk-abcdef1234");
});

test("没有系统加密时退回编码；清空即删除", () => {
  const f = path.join(tmp(), "secrets.json");
  const s = createSecrets({ file: f });
  s.set("k", "abc");
  assert.equal(s.get("k"), "abc");
  assert.equal(s.describe("k").encrypted, false);
  s.set("k", "");
  assert.equal(s.has("k"), false);
  assert.deepEqual(s.describe("k"), { set: false, tail: "", encrypted: false });
});
