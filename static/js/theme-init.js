/* 主题初始化：在 CSS 加载前同步执行，避免日间模式下的首屏闪烁（FOUC）
 * 独立成文件而非内联，是为了保持 CSP 中不放宽 'unsafe-inline' */
(function () {
  try {
    var saved = localStorage.getItem("clipvault_theme");
    var theme = (saved === "light" || saved === "dark")
      ? saved
      : (window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
    document.documentElement.dataset.theme = theme;
  } catch (e) {
    document.documentElement.dataset.theme = "dark";
  }
})();
