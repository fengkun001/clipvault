// 验证 E2E 加密往返：与 common.js 相同的算法逻辑（Node 22 内置 webcrypto）
const { webcrypto: crypto } = require("crypto");

function bytesToBase64(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return Buffer.from(bin, "binary").toString("base64");
}
function base64ToBytes(b64) {
  const bin = Buffer.from(b64, "base64").toString("binary");
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function main() {
  const plaintext = "# 加密测试\n这是 **机密内容** 🤫 with 中文 & emoji";

  // 加密
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plaintext));
  const rawKey = await crypto.subtle.exportKey("raw", key);
  const payload = bytesToBase64(iv) + "." + bytesToBase64(new Uint8Array(ct));
  const keyB64 = bytesToBase64(new Uint8Array(rawKey));

  console.log("payload 长度:", payload.length, "key 长度:", keyB64.length);

  // 解密
  const [ivB64, ctB64] = payload.split(".");
  const key2 = await crypto.subtle.importKey("raw", base64ToBytes(keyB64), { name: "AES-GCM" }, false, ["decrypt"]);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64ToBytes(ivB64) }, key2, base64ToBytes(ctB64));
  const decoded = new TextDecoder().decode(pt);

  console.log("往返一致:", decoded === plaintext ? "✅ PASS" : "❌ FAIL");

  // 错误密钥应失败
  const badKey = await crypto.subtle.importKey("raw", base64ToBytes(bytesToBase64(crypto.getRandomValues(new Uint8Array(32)))), { name: "AES-GCM" }, false, ["decrypt"]);
  try {
    await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64ToBytes(ivB64) }, badKey, base64ToBytes(ctB64));
    console.log("错误密钥: ❌ FAIL（竟然解密成功了）");
  } catch (e) {
    console.log("错误密钥拒绝: ✅ PASS");
  }
}
main();
