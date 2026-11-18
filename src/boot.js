// 第一次绘制之前先定深浅色：深色外观下打开时不闪一下浅色。
// CSP 不许内联脚本，所以单独一个小文件，在 <head> 里同步加载；规则和 app.js 的 resolvedTheme 一样，app 启动后会再定一次。
(function () {
  try {
    var L = {};
    try { L = JSON.parse(localStorage.getItem('picknest.local') || 'null') || {}; } catch (e) { /* 读不到就按系统外观 */ }
    var dark = L.theme === 'dark' || (L.theme !== 'light' && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    // 状态栏 / 工具栏的颜色也一起定（和 app.js 的 THEME_COLOR 一样）：App 起不来、停在出错提示时，深色页面上面也不会是一条浅色
    var meta = document.querySelector && document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? '#121412' : '#f6f5f0');
  } catch (e) { /* 出错就按系统外观，app.js 会再定 */ }
})();

// 启动看门狗：刚发布新版、网络又慢时，个别程序文件可能用了缓存里的旧版，新旧模块对不上 → app 起不来，页面一直空白。
// 10 秒还没启动（或启动前就出错了）→ 显示「重新载入」（这时晚到的新文件已经进了缓存，再载入一次通常就好）
(function () {
  try {
    var shown = false;
    var show = function () {
      if (shown || window.__picknest || window.__picknestBootError || !document.body) return;
      shown = true;
      var lang = '';
      try { lang = (JSON.parse(localStorage.getItem('picknest.local') || 'null') || {}).lang || ''; } catch (e) { /* 用系统语言 */ }
      if (lang !== 'zh-Hans' && lang !== 'zh-Hant-TW' && lang !== 'en') {
        // 没选过语言：和 i18n.js 的 guessLang 一样，系统语言列表里先碰到繁体中文 → 繁体，其他中文或没有中文 → 简体
        // （English 只在设置里选了才用；不然英文系统上先看到英文的提示，进了 App 又是简体）
        lang = 'zh-Hans';
        var langs = (typeof navigator !== 'undefined' && navigator && (navigator.languages || [navigator.language])) || [];
        for (var i = 0; i < langs.length; i++) {
          var l = String(langs[i] || '').toLowerCase();
          if (/^zh-(tw|hk|mo)|^zh-hant/.test(l)) { lang = 'zh-Hant-TW'; break; }
          if (/^zh/.test(l)) break;
        }
      }
      var txt = { 'zh-Hans': ['PickNest 没能打开（可能刚好在更新）。', '重新载入'], 'zh-Hant-TW': ['PickNest 無法開啟（可能剛好在更新）。', '重新載入'], en: ["PickNest didn't start (it may have just updated).", 'Reload'] }[lang] || ['PickNest 没能打开（可能刚好在更新）。', '重新载入'];
      var box = document.createElement('div');
      box.setAttribute('role', 'alert');
      box.style.cssText = 'position:fixed;inset:0;z-index:99;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:24px;text-align:center;background:Canvas;color:CanvasText;font:17px/1.5 -apple-system,system-ui,sans-serif';
      var p = document.createElement('p');
      p.textContent = txt[0];
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = txt[1];
      b.style.cssText = 'min-height:44px;padding:0 22px;border:0;border-radius:10px;background:#2b7a47;color:#fff;font:inherit';
      b.onclick = function () { location.reload(); };
      box.appendChild(p); box.appendChild(b);
      document.body.appendChild(box);
      var poll = setInterval(function () { if (window.__picknest) { clearInterval(poll); box.remove(); } }, 1000);   // 其实只是慢：起来了就收起
    };
    setTimeout(show, 10000);
    window.addEventListener('error', function () { setTimeout(show, 1500); });
  } catch (e) { /* 看门狗本身出错不影响启动 */ }
})();
