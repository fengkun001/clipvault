/* 日间 / 夜间主题切换（两个页面共用） */
(function () {
  var KEY = "clipvault_theme";
  var btn = document.getElementById("themeToggle");

  function current() {
    return document.documentElement.dataset.theme === "light" ? "light" : "dark";
  }

  function renderButton(theme) {
    if (!btn) return;
    btn.textContent = theme === "light" ? "☀️" : "🌙";
    btn.title = theme === "light" ? "切换到夜间模式" : "切换到日间模式";
  }

  function apply(theme, persist) {
    document.documentElement.dataset.theme = theme;
    renderButton(theme);
    if (persist) {
      try { localStorage.setItem(KEY, theme); } catch (e) { /* 隐私模式下忽略 */ }
    }
  }

  // 首次渲染不写 localStorage：保留「跟随系统」的语义，只有手动切换才固定偏好
  apply(current(), false);

  if (btn) {
    btn.addEventListener("click", function () {
      apply(current() === "light" ? "dark" : "light", true);
    });
  }
})();
