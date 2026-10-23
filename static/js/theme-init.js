/* 主题初始化：在 CSS 加载前同步执行，避免日间模式下的首屏闪烁（FOUC）
 * 独立成文件而非内联，是为了保持 CSP 中不放宽 'unsafe-inline' */
(function () {
  function setScheme(theme) {
    document.documentElement.dataset.theme = theme;
    // "only light / only dark" 明确禁止浏览器（含国产浏览器的强制深色 / Chrome Auto Dark）
    // 擅自改写页面配色，这是主题能否在手机端生效的关键
    document.documentElement.style.colorScheme = theme === "light" ? "only light" : "only dark";
  }

  try {
    var saved = localStorage.getItem("clipvault_theme");
    var theme = (saved === "light" || saved === "dark")
      ? saved
      : (window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
    setScheme(theme);
  } catch (e) {
    setScheme("dark");
  }
})();
