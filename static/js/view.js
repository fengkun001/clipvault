/* 查看页逻辑：先取元信息判断类型 → 文本渲染 或 文件卡片 */

const code = window.location.pathname.split("/s/")[1];
document.getElementById("codeTag").textContent = `/s/${code}`;

async function loadShare() {
  // 第一步：元信息（不消耗访问次数）
  let meta;
  try {
    const mres = await fetch(`/api/shares/${encodeURIComponent(code)}/meta`);
    if (mres.status === 404 || mres.status === 410) { showBurned(mres.status); return; }
    if (!mres.ok) throw new Error();
    meta = await mres.json();
  } catch (e) { showBurned(0); return; }

  if (meta.content_type === "file") { renderFile(meta); return; }

  // 第二步：取内容（消耗一次访问）
  try {
    const res = await fetch(`/api/shares/${encodeURIComponent(code)}`);
    if (res.status === 404 || res.status === 410) { showBurned(res.status); return; }
    if (!res.ok) throw new Error();
    await render(await res.json());
  } catch (e) { showBurned(0); }
}

function showBurned(status) {
  document.getElementById("loadingBox").hidden = true;
  const box = document.getElementById("burnedBox");
  box.hidden = false;
  if (status === 410) {
    document.getElementById("burnedTitle").textContent = "🔥 内容已焚毁";
    document.getElementById("burnedDesc").textContent = "该分享已过期，或达到访问次数上限 —— 服务器上已不留任何痕迹。";
  }
}

const TYPE_LABEL = { text: "📄 纯文本", markdown: "📝 Markdown", code: "💻 代码", file: "📦 文件" };

/* ---------- 文本类渲染 ---------- */
async function render(data) {
  document.getElementById("loadingBox").hidden = true;
  document.getElementById("contentBox").hidden = false;

  let content = data.content;
  let typeBadgeText = TYPE_LABEL[data.content_type] || "文本";

  /* 端到端加密内容：从 URL 锚点取密钥，浏览器内解密 */
  if (data.content_type === "encrypted") {
    const km = location.hash.match(/[#&]k=([^&]+)/);
    if (!km) {
      document.getElementById("contentBox").hidden = true;
      showBurned(-1);
      document.getElementById("burnedTitle").textContent = "🔐 这是一个加密分享";
      document.getElementById("burnedDesc").textContent = "缺少解密密钥 —— 请使用包含 # 密钥的完整链接打开。密钥从不发送到服务器。";
      return;
    }
    if (!hasCrypto()) {
      showToast("当前环境不支持解密（需 HTTPS 或 localhost）");
      return;
    }
    try {
      content = await e2eDecrypt(data.content, decodeURIComponent(km[1]));
      const innerType = detectType(content);
      typeBadgeText = "🔐 已解密 · " + (TYPE_LABEL[innerType] || "文本");
      data.content_type = innerType;
    } catch (e) {
      showToast("解密失败：密钥不正确或密文已损坏");
      return;
    }
  }

  document.getElementById("typeBadge").textContent = typeBadgeText;
  updateViewsBadge(document.getElementById("viewsBadge"), data.view_count, data.max_views);
  startExpiryBadge(document.getElementById("expiryBadge"), data.expires_at);

  if (data.content_type === "markdown") {
    // Markdown：marked 渲染 + DOMPurify 清洗，双重防 XSS
    const raw = marked.parse(content, { breaks: true, gfm: true });
    const clean = DOMPurify.sanitize(raw);
    const md = document.getElementById("mdContent");
    md.hidden = false;
    md.innerHTML = clean;
    document.querySelectorAll("#mdContent pre code").forEach((el) => hljs.highlightElement(el));
  } else if (data.content_type === "code") {
    const el = document.getElementById("codeContent");
    el.parentElement.hidden = false;
    el.textContent = content;          // textContent 天然防 XSS
    hljs.highlightElement(el);          // 高亮库自动检测语言
  } else {
    const el = document.getElementById("textContent");
    el.hidden = false;
    el.textContent = content;
  }

  document.getElementById("copyBtn").addEventListener("click", async () => {
    if (await copyText(content)) showToast("内容已复制");
  });
}

/* ---------- 文件类渲染 ---------- */
const PREVIEWABLE_IMAGE = /^image\/(png|jpe?g|gif|webp|bmp|svg\+xml)$/i;
const PREVIEWABLE_MEDIA = /^video\/(mp4|webm)|^audio\/(mpeg|mp3|wav|ogg|m4a)/i;
const PREVIEW_SIZE_LIMIT = 50 * 1024 * 1024; // 超过 50MB 不做在线预览

function renderFile(meta) {
  document.getElementById("loadingBox").hidden = true;
  const box = document.getElementById("fileBox");
  box.hidden = false;

  const ext = (meta.file_name || "").split(".").pop().toLowerCase();
  const icon = document.getElementById("fileIcon");
  icon.textContent = fileIconFor(ext);

  const fileName = meta.file_name || "未命名文件";
  document.getElementById("fileName").textContent = fileName;
  document.getElementById("fileSize").textContent = formatBytes(meta.file_size);
  updateViewsBadge(document.getElementById("fileViewsBadge"), meta.view_count, meta.max_views);
  startExpiryBadge(document.getElementById("fileExpiryBadge"), meta.expires_at);

  const downloadUrl = `/api/files/${encodeURIComponent(code)}/download`;
  const mime = meta.file_mime || "";
  const previewable =
    (PREVIEWABLE_IMAGE.test(mime) || PREVIEWABLE_MEDIA.test(mime)) &&
    (meta.file_size || 0) <= PREVIEW_SIZE_LIMIT;

  if (!previewable) {
    document.getElementById("downloadBtn").addEventListener("click", () => {
      window.location.href = downloadUrl;
      showToast("下载已开始，页面稍后刷新");
      setTimeout(() => location.reload(), 3000);
    });
    return;
  }

  /* 可预览文件：只请求一次（消耗一次访问），blob 同时用于在线预览与下载，
     避免"预览算一次、下载又算一次"的双倍计数 */
  const previewBox = document.getElementById("filePreview");
  const dlBtn = document.getElementById("downloadBtn");
  dlBtn.disabled = true;

  fetch(downloadUrl)
    .then(async (res) => {
      if (res.status === 404 || res.status === 410) { showBurned(res.status); return null; }
      if (!res.ok) throw new Error();
      return res.blob();
    })
    .then((blob) => {
      if (!blob) return;
      const objUrl = URL.createObjectURL(blob);
      const media = document.createElement(PREVIEWABLE_IMAGE.test(mime) ? "img" : "video");
      media.src = objUrl;
      if (media.tagName === "VIDEO") { media.controls = true; }
      previewBox.appendChild(media);
      previewBox.hidden = false;
      // 预览本身消耗了一次访问，徽章同步 +1
      updateViewsBadge(document.getElementById("fileViewsBadge"), meta.view_count + 1, meta.max_views);

      dlBtn.disabled = false;
      dlBtn.addEventListener("click", () => {
        const a = document.createElement("a");
        a.href = objUrl;
        a.download = fileName;
        a.click();
        showToast("已保存（不额外消耗访问次数）");
      });
    })
    .catch(() => {
      dlBtn.disabled = false;
      dlBtn.addEventListener("click", () => { window.location.href = downloadUrl; });
      showToast("预览加载失败，可点击下载查看");
    });
}

function fileIconFor(ext) {
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"].includes(ext)) return "🖼️";
  if (["mp4", "mkv", "mov", "avi", "webm"].includes(ext)) return "🎬";
  if (["mp3", "wav", "flac", "m4a"].includes(ext)) return "🎵";
  if (ext === "pdf") return "📕";
  if (["zip", "rar", "7z", "tar", "gz"].includes(ext)) return "🗜️";
  if (["py", "js", "ts", "html", "css", "java", "c", "cpp", "go", "rs", "json", "xml", "yml", "sh"].includes(ext)) return "💻";
  return "📄";
}

/* ---------- 徽章 ---------- */
function updateViewsBadge(el, count, maxViews) {
  el.textContent = maxViews ? `访问 ${count} / ${maxViews}` : `已被访问 ${count} 次`;
  if (maxViews && maxViews - count <= 1) el.classList.add("badge-green");
}

function startExpiryBadge(el, expiresAt) {
  const update = () => {
    el.textContent = "⏳ " + formatRemaining(expiresAt);
    if (expiresAt && new Date(expiresAt).getTime() - Date.now() < 3600_000) {
      el.style.color = "var(--warning)";
    }
  };
  update();
  if (expiresAt) setInterval(update, 1000);
}

if (code) loadShare();
else showBurned(404);
