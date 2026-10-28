"use strict";
// 密钥存储：API Key 不进 settings.json，单独存 <数据目录>/secrets.json。
// 有系统加密（Electron safeStorage：macOS 钥匙串 / Windows DPAPI / Linux libsecret）就加密保存，否则退回 base64 并标记。
// 页面永远拿不到明文，只能看到「已设置 / 末 4 位」。纯 Node，可单测（传入 crypto 实现）。
const { readJson, writeJsonAtomic } = require("./fs-utils");

function createSecrets({ file, cipher = null } = {}) {
  const canEncrypt = () => !!(cipher && cipher.isAvailable && cipher.isAvailable());
  let data = readJson(file, {});
  if (!data || typeof data !== "object") data = {};

  function set(name, value) {
    const v = String(value || "");
    if (!v) { delete data[name]; writeJsonAtomic(file, data); return true; }
    data[name] = canEncrypt()
      ? { enc: "os", value: cipher.encrypt(v).toString("base64") }
      : { enc: "none", value: Buffer.from(v, "utf8").toString("base64") };
    writeJsonAtomic(file, data);
    return true;
  }
  function get(name) {
    const e = data[name];
    if (!e || !e.value) return "";
    try {
      if (e.enc === "os") return canEncrypt() ? cipher.decrypt(Buffer.from(e.value, "base64")) : "";
      return Buffer.from(e.value, "base64").toString("utf8");
    } catch { return ""; }
  }
  function describe(name) {
    const v = get(name);
    return { set: !!v, tail: v ? v.slice(-4) : "", encrypted: !!(data[name] && data[name].enc === "os") };
  }
  return { set, get, describe, has: (n) => !!get(n), encrypted: canEncrypt };
}

module.exports = { createSecrets };
