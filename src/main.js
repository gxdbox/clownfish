/**
 * main.js — 入口：全局错误浮层 + 启动引导
 */
(function () {
  'use strict';

  // 运行时错误浮层（红色，调试可见性）
  window.addEventListener('error', function (e) {
    var el = document.getElementById('error-overlay');
    if (!el) return;
    el.style.display = 'block';
    el.textContent = '错误: ' + (e.message || 'unknown') +
      (e.filename ? '\n' + e.filename + ':' + (e.lineno || '') : '');
  });

  // 未捕获的 Promise 异常
  window.addEventListener('unhandledrejection', function (e) {
    var el = document.getElementById('error-overlay');
    if (!el) return;
    el.style.display = 'block';
    el.textContent = '异步错误: ' + (e.reason && e.reason.message ? e.reason.message : e.reason);
  });

  function boot() {
    var loader = document.getElementById('loader');
    if (loader) loader.style.display = 'none';
    window.CF.game.boot();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
