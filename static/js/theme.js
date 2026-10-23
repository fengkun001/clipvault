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
    // 内联声明优先级最高，明确告诉浏览器当前页面支持哪种配色，避免被"强制深色"反色
    document.documentElement.style.colorScheme = theme;
    renderButton(theme);
    if (persist) {
      try { localStorage.setItem(KEY, theme); } catch (e) { /* 隐私模式下忽略 */ }
    }
  }

  // 首次渲染不写 localStorage：保留「跟随系统」的语义，只有手动切换才固定偏好
  apply(current(), false);

  if (btn) {
    var locked = false;

    function toggle() {
      if (locked) return;
      locked = true;
      setTimeout(function () { locked = false; }, 500);
      apply(current() === "light" ? "dark" : "light", true);
    }

    if (window.PointerEvent) {
      // 手机端一次触摸只会产生一个 pointerup，彻底避开浏览器合成的重复 click
      btn.addEventListener("pointerup", function (e) {
        if (e.pointerType === "mouse" && e.button !== 0) return;
        e.preventDefault();
        toggle();
      });
      // 鼠标/触摸的 click 不再重复处理；仅保留键盘（Enter/Space，detail 为 0）可访问性
      btn.addEventListener("click", function (e) {
        if (e.detail === 0) {
          e.preventDefault();
          toggle();
        }
      });
    } else {
      btn.addEventListener("click", function (e) {
        e.preventDefault();
        toggle();
      });
    }
  }
})();
