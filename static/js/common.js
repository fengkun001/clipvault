/* 公共工具：Toast 提示、剪贴板、内容类型自动识别、格式化 */

function showToast(msg) {
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove("show"), 2200);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    // 非安全上下文（http）下的降级方案
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  }
}

/* 内容类型自动识别：基于启发式打分 */
function detectType(text) {
  if (!text) return "text";
  const mdSignals = [
    (text.match(/^#{1,6}\s.+$/gm) || []).length * 3,   // 标题
    (text.match(/\*\*[^*\n]+\*\*/g) || []).length * 2, // 加粗
    (text.match(/^[-*+]\s.+$/gm) || []).length,        // 无序列表
    (text.match(/^\|.*\|/gm) || []).length * 2,        // 表格
    (text.match(/\[[^\]]+\]\([^)]+\)/g) || []).length * 2, // 链接
    (text.match(/^>\s.+$/gm) || []).length,           // 引用
  ].reduce((a, b) => a + b, 0);
  if ((text.match(/```/g) || []).length >= 2) return "markdown";
  if (mdSignals >= 4) return "markdown";

  const codeSignals = [
    (text.match(/[;{}]\s*$/gm) || []).length,
    (text.match(/^\s{4}\S/gm) || []).length * 2,
    (text.match(/\b(def|class|import|function|const|let|var|return|public|private|package|func|fn|use|echo)\b/gm) || []).length * 2,
  ].reduce((a, b) => a + b, 0);
  if (codeSignals >= 6) return "code";
  return "text";
}

function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0, n = bytes;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return n.toFixed(n >= 100 || i === 0 ? 0 : 1) + " " + units[i];
}

function formatRemaining(expiresAt) {
  if (!expiresAt) return "永久有效";
  let diff = Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000);
  if (diff <= 0) return "已过期";
  const d = Math.floor(diff / 86400), h = Math.floor((diff % 86400) / 3600),
        m = Math.floor((diff % 3600) / 60), s = diff % 60;
  if (d > 0) return `${d}天${h}小时后过期`;
  if (h > 0) return `${h}小时${m}分后过期`;
  if (m > 0) return `${m}分${s}秒后过期`;
  return `${s}秒后过期`;
}

/* ============ 端到端加密（E2E）=============
 * 客户端生成 AES-256-GCM 密钥并加密明文，
 * 服务器只存密文；密钥放 URL 锚点（# 后部分不会随请求发送），
 * 因此服务器永远无法解密内容。
 * ================================================= */
function hasCrypto() {
  return typeof crypto !== "undefined" && crypto.subtle;
}

function bytesToBase64(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function e2eEncrypt(plaintext) {
  const key = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv }, key, new TextEncoder().encode(plaintext)
  );
  const rawKey = await crypto.subtle.exportKey("raw", key);
  return {
    payload: bytesToBase64(iv) + "." + bytesToBase64(new Uint8Array(ct)),
    keyB64: bytesToBase64(new Uint8Array(rawKey)),
  };
}

async function e2eDecrypt(payload, keyB64) {
  const [ivB64, ctB64] = payload.split(".");
  if (!ivB64 || !ctB64) throw new Error("bad payload");
  const key = await crypto.subtle.importKey("raw", base64ToBytes(keyB64), { name: "AES-GCM" }, false, ["decrypt"]);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64ToBytes(ivB64) }, key, base64ToBytes(ctB64));
  return new TextDecoder().decode(pt);
}
