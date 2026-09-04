/* 首页逻辑：文本/文件双模式分享、二维码、历史记录、用户系统 */

const HISTORY_KEY = "clipvault_shares";
const TOKEN_KEY = "clipvault_token";

/* ---------- 用户认证 ---------- */
function getToken() { return localStorage.getItem(TOKEN_KEY); }

function authFetch(url, options = {}) {
  const token = getToken();
  const headers = Object.assign({}, options.headers || {});
  if (token) headers["Authorization"] = "Bearer " + token;
  return fetch(url, Object.assign({}, options, { headers }));
}

function refreshAuthUI() {
  const token = getToken();
  const authModal = document.getElementById("authModal");
  authModal.hidden = true;
  if (token) {
    authFetch("/api/auth/me").then((r) => {
      if (!r.ok) throw new Error();
      return r.json();
    }).then((u) => {
      document.getElementById("userBadge").hidden = false;
      document.getElementById("userName").textContent = u.username;
      document.getElementById("loginBtn").hidden = true;
      document.getElementById("logoutBtn").hidden = false;
      renderMyShares();
    }).catch(() => {
      localStorage.removeItem(TOKEN_KEY);
      renderHistory();
    });
  } else {
    document.getElementById("userBadge").hidden = true;
    document.getElementById("loginBtn").hidden = false;
    document.getElementById("logoutBtn").hidden = true;
    renderHistory();
  }
}

document.getElementById("loginBtn").addEventListener("click", () => {
  document.getElementById("authModal").hidden = false;
  document.getElementById("authUsername").focus();
});
document.getElementById("authClose").addEventListener("click", () => {
  document.getElementById("authModal").hidden = true;
});
document.getElementById("authModal").addEventListener("click", (e) => {
  if (e.target === e.currentTarget) e.currentTarget.hidden = true;
});
document.getElementById("logoutBtn").addEventListener("click", () => {
  localStorage.removeItem(TOKEN_KEY);
  showToast("已退出登录");
  refreshAuthUI();
});

async function doAuth(action) {
  const username = document.getElementById("authUsername").value.trim();
  const password = document.getElementById("authPassword").value;
  if (!username || !password) { showToast("请输入用户名和密码"); return; }
  try {
    const res = await fetch(`/api/auth/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "操作失败");
    const data = await res.json();
    localStorage.setItem(TOKEN_KEY, data.token);
    showToast(action === "register" ? "注册成功" : "登录成功");
    document.getElementById("authPassword").value = "";
    refreshAuthUI();
  } catch (e) { showToast(e.message); }
}
document.getElementById("doLoginBtn").addEventListener("click", () => doAuth("login"));
document.getElementById("doRegisterBtn").addEventListener("click", () => doAuth("register"));
document.getElementById("authPassword").addEventListener("keydown", (e) => {
  if (e.key === "Enter") doAuth("login");
});

/* ---------- 标签页切换 ---------- */
let currentTab = "text";
document.querySelectorAll(".tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    currentTab = btn.dataset.tab;
    document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b === btn));
    document.getElementById("textTab").hidden = currentTab !== "text";
    document.getElementById("fileTab").hidden = currentTab !== "file";
    document.getElementById("typeGroup").style.display = currentTab === "text" ? "" : "none";
  });
});

/* ---------- 文件选择与拖拽 ---------- */
let selectedFile = null;
const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");

dropzone.addEventListener("click", () => fileInput.click());
dropzone.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") fileInput.click(); });
["dragover", "dragenter"].forEach((ev) =>
  dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.add("dragover"); })
);
["dragleave", "drop"].forEach((ev) =>
  dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.remove("dragover"); })
);
dropzone.addEventListener("drop", (e) => {
  if (e.dataTransfer.files.length) setFile(e.dataTransfer.files[0]);
});
fileInput.addEventListener("change", () => { if (fileInput.files.length) setFile(fileInput.files[0]); });

const FILE_ICONS = {
  image: "🖼️", video: "🎬", audio: "🎵", pdf: "📕",
  zip: "🗜️", code: "💻", text: "📄",
};
function fileIcon(name, type) {
  const ext = (name.split(".").pop() || "").toLowerCase();
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"].includes(ext)) return FILE_ICONS.image;
  if (["mp4", "mkv", "mov", "avi", "webm"].includes(ext)) return FILE_ICONS.video;
  if (["mp3", "wav", "flac", "m4a"].includes(ext)) return FILE_ICONS.audio;
  if (ext === "pdf") return FILE_ICONS.pdf;
  if (["zip", "rar", "7z", "tar", "gz"].includes(ext)) return FILE_ICONS.zip;
  if (["py", "js", "ts", "html", "css", "java", "c", "cpp", "go", "rs", "json", "xml", "yml", "sh"].includes(ext)) return FILE_ICONS.code;
  return FILE_ICONS.text;
}

function setFile(file) {
  if (file.size > 100 * 1024 * 1024) { showToast("文件超过 100MB 限制"); return; }
  selectedFile = file;
  document.getElementById("fileSelected").hidden = false;
  dropzone.hidden = true;
  document.getElementById("fsIcon").textContent = fileIcon(file.name, file.type);
  document.getElementById("fsName").textContent = file.name;
  document.getElementById("fsSize").textContent = formatBytes(file.size);
}
document.getElementById("fsRemove").addEventListener("click", () => {
  selectedFile = null;
  fileInput.value = "";
  document.getElementById("fileSelected").hidden = true;
  dropzone.hidden = false;
});

/* ---------- 历史记录 ---------- */
function getHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]"); }
  catch (e) { return []; }
}
function saveHistory(list) { localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, 20))); }
function addHistory(item) { const l = getHistory(); l.unshift(item); saveHistory(l); }

/* ---------- 加密开关提示 ---------- */
document.getElementById("e2eToggle").addEventListener("change", (e) => {
  document.getElementById("e2eNote").hidden = e.target.value !== "on";
});

/* ---------- 创建分享 ---------- */
function readOptions() {
  const expiryVal = document.getElementById("expiry").value;
  const expires_in = expiryVal === "forever" ? null : parseInt(expiryVal, 10);
  const viewsVal = document.getElementById("maxViews").value;
  const max_views = viewsVal === "unlimited" ? null : parseInt(viewsVal, 10);
  return { expires_in, max_views };
}

async function createShare() {
  const { expires_in, max_views } = readOptions();
  const btn = document.getElementById("shareBtn");
  btn.disabled = true;
  btn.textContent = "创建中…";

  try {
    let data;
    let keyB64 = null;
    if (currentTab === "file") {
      if (!selectedFile) { showToast("请先选择要分享的文件"); return; }
      const fd = new FormData();
      fd.append("file", selectedFile);
      if (expires_in !== null) fd.append("expires_in", expires_in);
      if (max_views !== null) fd.append("max_views", max_views);
      const res = await authFetch("/api/files", { method: "POST", body: fd });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "上传失败");
      data = await res.json();
      addHistory({
        code: data.code, url: data.url, delete_token: data.delete_token,
        preview: `📎 ${selectedFile.name}`, created_at: new Date().toISOString(),
        expires_at: data.expires_at, max_views: data.max_views,
      });
      document.getElementById("fsRemove").click();
    } else {
      const content = document.getElementById("content").value.trim();
      if (!content) { showToast("请先输入要分享的内容"); return; }

      let body, preview;
      const wantE2E = document.getElementById("e2eToggle").value === "on";
      if (wantE2E) {
        if (!hasCrypto()) { showToast("当前环境不支持加密（需 HTTPS 或 localhost）"); return; }
        // 端到端加密：浏览器内完成，服务器只收到密文
        const enc = await e2eEncrypt(content);
        keyB64 = enc.keyB64;
        body = { content: enc.payload, content_type: "encrypted", expires_in, max_views };
        preview = "🔐 [端到端加密内容]";
      } else {
        const typeSel = document.getElementById("contentType").value;
        const content_type = typeSel === "auto" ? detectType(content) : typeSel;
        body = { content, content_type, expires_in, max_views };
        preview = content.slice(0, 40);
      }
      const res = await authFetch("/api/shares", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "创建失败");
      data = await res.json();
      if (keyB64) data.url = data.url + "#k=" + encodeURIComponent(keyB64);
      addHistory({
        code: data.code, url: data.url, delete_token: data.delete_token,
        preview, created_at: new Date().toISOString(),
        expires_at: data.expires_at, max_views: data.max_views,
      });
      document.getElementById("content").value = "";
    }
    showResult(data);
    renderAuthedList();
    showToast(keyB64 ? "加密分享已生成（密钥在链接中）" : "分享链接已生成");
    document.getElementById("resultCard").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (e) {
    showToast(e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "⚡ 生成分享链接";
  }
}

function showResult(data) {
  const card = document.getElementById("resultCard");
  card.hidden = false;
  document.getElementById("shareLink").textContent = data.url;

  const qr = document.getElementById("qrcode");
  qr.innerHTML = "";
  new QRCode(qr, { text: data.url, width: 150, height: 150, correctLevel: QRCode.CorrectLevel.M });

  document.getElementById("metaExpiry").textContent = data.expires_at
    ? new Date(data.expires_at).toLocaleString("zh-CN")
    : "永久";
  document.getElementById("metaViews").textContent = data.max_views ?? "无限制";
}

/* ---------- 销毁与历史渲染 ---------- */
async function destroyShare(code) {
  const list = getHistory();
  const item = list.find((x) => x.code === code);
  if (!item) return;
  if (!confirm("确定立即焚毁该分享？此操作不可恢复。")) return;
  try {
    await fetch(`/api/shares/${code}?token=${encodeURIComponent(item.delete_token)}`, { method: "DELETE" });
    saveHistory(list.filter((x) => x.code !== code));
    renderHistory();
    showToast("已焚毁");
  } catch (e) {
    showToast("销毁失败");
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* 登录状态显示云端列表，未登录显示本地历史 */
function renderAuthedList() {
  if (getToken()) renderMyShares();
  else renderHistory();
}

const TYPE_ICON = { text: "📄", markdown: "📝", code: "💻", file: "📎", encrypted: "🔐" };

async function renderMyShares() {
  const box = document.getElementById("historyList");
  document.getElementById("myShareTitle").innerHTML =
    '🗂️ 我的分享 <span style="font-weight:400;font-size:12px;color:var(--text-faint)">（云端同步 · 含访问统计）</span>';
  box.innerHTML = '<div class="empty-tip">加载中…</div>';
  try {
    const res = await authFetch("/api/auth/my-shares");
    if (!res.ok) throw new Error();
    const list = await res.json();
    if (!list.length) {
      box.innerHTML = '<div class="empty-tip">还没有分享记录，创建第一个吧</div>';
      return;
    }
    box.innerHTML = list.map((s) => {
      const expired = s.expires_at && new Date(s.expires_at) < new Date();
      const views = s.max_views ? `👁 ${s.view_count}/${s.max_views}` : `👁 ${s.view_count}`;
      const exp = s.expires_at
        ? (expired ? "已过期" : new Date(s.expires_at).toLocaleString("zh-CN"))
        : "永久";
      return `
        <div class="share-item">
          <div class="info">
            <a class="code-link" href="/s/${s.code}" target="_blank">${TYPE_ICON[s.content_type] || "📄"} /s/${s.code}</a>
            <span class="desc">${escapeHtml(s.preview || "")} · ${views} · ${exp}</span>
          </div>
          <div class="actions">
            <button class="btn btn-ghost" onclick="copyMyUrl('${s.code}')">复制链接</button>
            <button class="btn btn-danger" onclick="destroyMyShare('${s.code}')">🔥 焚毁</button>
          </div>
        </div>`;
    }).join("");
  } catch (e) {
    box.innerHTML = '<div class="empty-tip">加载失败，请刷新重试</div>';
  }
}

async function copyMyUrl(code) {
  if (await copyText(location.origin + "/s/" + code)) showToast("链接已复制");
}

async function destroyMyShare(code) {
  if (!confirm("确定立即焚毁该分享？此操作不可恢复。")) return;
  try {
    const res = await authFetch(`/api/shares/${code}`, { method: "DELETE" });
    if (!res.ok) throw new Error();
    showToast("已焚毁");
    renderMyShares();
  } catch (e) { showToast("销毁失败"); }
}

function renderHistory() {
  const box = document.getElementById("historyList");
  const list = getHistory();
  if (!list.length) {
    box.innerHTML = '<div class="empty-tip">暂无分享记录，创建第一个吧</div>';
    return;
  }
  box.innerHTML = list.map((item) => {
    const expired = item.expires_at && new Date(item.expires_at) < new Date();
    const status = expired ? "（已过期）" : "";
    return `
      <div class="share-item">
        <div class="info">
          <a class="code-link" href="/s/${item.code}" target="_blank">/s/${item.code}</a>
          <span class="desc">${escapeHtml(item.preview || "")}${status}</span>
        </div>
        <div class="actions">
          <button class="btn btn-ghost" onclick="copyHistoryUrl('${item.code}')">复制链接</button>
          <button class="btn btn-danger" onclick="destroyShare('${item.code}')">🔥 焚毁</button>
        </div>
      </div>`;
  }).join("");
}

async function copyHistoryUrl(code) {
  const item = getHistory().find((x) => x.code === code);
  if (!item) return;
  if (await copyText(item.url)) showToast("链接已复制");
}

/* ---------- 事件绑定 ---------- */
document.getElementById("shareBtn").addEventListener("click", createShare);
document.getElementById("copyBtn").addEventListener("click", async () => {
  const url = document.getElementById("shareLink").textContent;
  if (await copyText(url)) showToast("链接已复制");
});

refreshAuthUI();
