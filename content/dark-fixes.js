// ==============================
// Ozon Stats — content/dark-fixes.js
// Правки для нашей самодельной тёмной темы (см. html.darkreader в styles.css):
// инверсия видео/картинок внутри Shadow DOM (обычный CSS-фильтр их не берёт)
// и подмена розовых/пурпурных элементов (после инверсии они выглядят чужеродно).
// Полностью независим от остальных файлов — работает даже если панель ниже
// по какой-то причине не создалась.
// ==============================
(function() {
  function fixShadowVideos() {
    var isDark = document.documentElement.classList.contains('darkreader');
    document.querySelectorAll('*').forEach(function(el) {
      if (!el.shadowRoot) return;
      var videos = el.shadowRoot.querySelectorAll('video');
      videos.forEach(function(video) {
        if (isDark) {
          video.style.setProperty('filter', 'invert(100%) hue-rotate(180deg)', 'important');
        } else {
          video.style.removeProperty('filter');
        }
      });
      el.shadowRoot.querySelectorAll('img, canvas').forEach(function(media) {
        if (isDark) {
          media.style.setProperty('filter', 'invert(100%) hue-rotate(180deg)', 'important');
        } else {
          media.style.removeProperty('filter');
        }
      });
    });
  }

  // === Фикс розовых/пурпурных элементов — меняем на красный ===
  function isInOurPanel(el) {
    var p = el;
    while (p) {
      if (p.id === 'ozon-stats-panel' || p.id === 'ozon-stats-toggle') return true;
      p = p.parentElement;
    }
    return false;
  }

  function isPinkColor(r, g, b) {
    // Розовый/пурпурный/магента: R высокий, G низкий, B средний-высокий
    return (r > 150 && g < 100 && b > 40);
  }

  function fixPinkElements() {
    try {
      if (!document.documentElement.classList.contains('darkreader')) return;
      var all = document.getElementsByTagName('*');
      for (var i = 0; i < all.length; i++) {
        try {
          var el = all[i];
          if (isInOurPanel(el)) continue;
          var cs = getComputedStyle(el);

          // Фикс розового фона (бейджи "Распродажа" и т.п.)
          var bg = cs.backgroundColor;
          if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
            var m = bg.match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
            if (m && isPinkColor(parseInt(m[1]), parseInt(m[2]), parseInt(m[3]))) {
              el.style.setProperty('background-color', '#ef4444', 'important');
              el.style.setProperty('filter', 'invert(100%) hue-rotate(180deg)', 'important');
              el.setAttribute('data-dark-fixed', 'bg');
            }
          }

          // Фикс розового градиента (бейджи с gradient #F1117E)
          var bgImg = cs.backgroundImage;
          if (bgImg && bgImg.indexOf('241') !== -1 && bgImg.indexOf('17') !== -1 && bgImg.indexOf('126') !== -1) {
            el.style.setProperty('background-image', 'linear-gradient(225deg, #ff000094 0%, #ff000087 100%)', 'important');
            el.setAttribute('data-dark-fixed', 'gradient');
          }

          // Фикс розового текста (ценники, скидки и т.д.)
          var color = cs.color;
          if (color) {
            var cm = color.match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
            if (cm) {
              var r = parseInt(cm[1]), g = parseInt(cm[2]), b = parseInt(cm[3]);
              if (r > 180 && g < 100 && (r - g) > 80) {
                var totalText = (el.textContent || '').trim();
                if (totalText.length > 0 && totalText.length < 60) {
                  el.style.setProperty('color', '#ff6464', 'important');
                  el.setAttribute('data-dark-fixed', 'text');
                }
              }
            }
          }
        } catch(e) {}
      }
    } catch(e) {}
  }

  function resetDarkFixes() {
    // Сбрасываем все inline-стили, установленные для тёмной темы
    var fixed = document.querySelectorAll('[data-dark-fixed]');
    fixed.forEach(function(el) {
      var type = el.getAttribute('data-dark-fixed');
      if (type === 'bg') {
        el.style.removeProperty('background-color');
        el.style.removeProperty('filter');
      } else if (type === 'gradient') {
        el.style.removeProperty('background-image');
      } else if (type === 'text') {
        el.style.removeProperty('color');
      }
      el.removeAttribute('data-dark-fixed');
    });
    // Сбрасываем Shadow DOM видео
    fixShadowVideos();
  }

  // Делаем resetDarkFixes доступной глобально для toggle (см. content/orders-panel.js)
  window.__ozonResetDarkFixes = resetDarkFixes;

  function startObserver() {
    fixShadowVideos();
    fixPinkElements();
    var observer = new MutationObserver(function() {
      fixShadowVideos();
      fixPinkElements();
    });
    observer.observe(document.body || document.documentElement, {
      childList: true, subtree: true
    });
    setInterval(fixShadowVideos, 1000);
    setInterval(fixPinkElements, 2000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startObserver);
  } else {
    startObserver();
  }
})();
