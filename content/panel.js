// ==============================
// Ozon Stats — content/panel.js
// Создаёт DOM боковой панели и кнопки-переключателя, следит за её
// сворачиванием/разворачиванием, сдвигает "родные" кнопки Ozon (закрыть,
// прокрутка вверх), автоматически сворачивает панель при просмотре галереи
// фото товара, чтобы не перекрывать её.
//
// Остальные файлы content-скрипта (utils.js, orders-panel.js, full-stats.js)
// выполняются следом за этим и обращаются к panel/toggleBtn через общее
// пространство имён window.__ozonStats — все файлы content-скрипта работают
// в одном isolated-world контексте, поэтому такой общий объект между ними
// виден.
// ==============================
(function() {
  'use strict';

  window.__ozonStats = window.__ozonStats || {};

  // Debug-логи выключены по умолчанию, чтобы не шуметь в консоли обычного
  // пользователя. Включить: localStorage.setItem('ozon-stats-debug', '1')
  // и перезагрузить страницу. Используется всеми файлами content-скрипта
  // через window.__ozonStats.log(...); ошибки (console.error) видны всегда.
  window.__ozonStats.debug = localStorage.getItem('ozon-stats-debug') === '1';
  window.__ozonStats.log = function() {
    if (window.__ozonStats.debug) console.log.apply(console, arguments);
  };

  // Проверяем, не создана ли уже панель (повторная инъекция скрипта, например
  // при перезагрузке расширения на уже открытой странице). currentInjectionOk
  // читают остальные файлы content-скрипта (utils.js и далее), чтобы не
  // выполнять свою логику поверх уже готовой панели от предыдущей инъекции.
  if (document.getElementById('ozon-stats-panel')) {
    window.__ozonStats.currentInjectionOk = false;
    return;
  }
  window.__ozonStats.currentInjectionOk = true;

  // Восстанавливаем тёмную тему из localStorage
  try {
    if (localStorage.getItem('ozon_dark_theme') === '1') {
      document.documentElement.classList.add('darkreader');
    }
  } catch(e) {}

  // Создаём панель
  const panel = document.createElement('div');
  panel.id = 'ozon-stats-panel';

  // Проверяем сохранённое состояние
  const savedState = localStorage.getItem('ozon-stats-collapsed');
  if (savedState === 'true') {
    panel.classList.add('collapsed');
  }

  panel.innerHTML = `
    <div id="ozon-stats-content">
      <div id="osp-body">
        <div class="osp-loading">
          <div class="osp-spinner"></div>
          <div>Загрузка данных...</div>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(panel);

  // Создаём кнопку-переключатель ОТДЕЛЬНО от панели (fixed позиция)
  const toggleBtn = document.createElement('button');
  toggleBtn.id = 'ozon-stats-toggle';
  toggleBtn.title = 'Свернуть/Развернуть Ozon Stats';
  toggleBtn.innerHTML = `
    <svg class="toggle-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="9 18 15 12 9 6"></polyline>
    </svg>
    <span class="toggle-text">OZON STATS</span>
  `;
  document.body.appendChild(toggleBtn);

  // Публикуем панель для остальных файлов content-скрипта
  window.__ozonStats.panel = panel;
  window.__ozonStats.toggleBtn = toggleBtn;

  // Обновляем позицию кнопки
  function updateTogglePosition() {
    if (panel.classList.contains('collapsed')) {
      toggleBtn.style.right = '0px';
      toggleBtn.querySelector('.toggle-icon').style.transform = 'rotate(180deg)';
    } else {
      toggleBtn.style.right = '340px';
      toggleBtn.querySelector('.toggle-icon').style.transform = 'rotate(0deg)';
    }
  }
  updateTogglePosition();

  // ===== Сдвиг кнопок Ozon (закрыть, прокрутка вверх) =====
  function getOzonShift() {
    // Если панель свёрнута — небольшой сдвиг (только вкладка ~40px)
    // Если развёрнута — полная ширина панели (340px + запас)
    return panel.classList.contains('collapsed') ? 0 : 350;
  }

  function shiftOzonButtons() {
    const shift = getOzonShift();
    // Селекторы для кнопок Ozon: закрыть фото/модалку, прокрутка вверх
    const selectors = [
      // Кнопка закрытия галереи/фото
      '[data-widget="webGallery"] button',
      // Кнопка "вверх" (scroll to top)
      'button[class*="scrollToTop"]',
      'button[class*="ScrollToTop"]',
      '[class*="scrollToTop"]',
      '[class*="scroll-to-top"]',
      // Общие кнопки закрытия в модальных окнах
      '.ui-s2 [class*="close"]',
      '.ui-s2 [class*="Close"]',
      '[class*="modalClose"]',
      '[class*="modal-close"]',
      // Фиксированные кнопки в правом верхнем/нижнем углу
      '[class*="FloatingButton"]',
      '[class*="floatingButton"]',
    ];

    selectors.forEach(sel => {
      try {
        document.querySelectorAll(sel).forEach(el => {
          const style = window.getComputedStyle(el);
          // Сдвигаем только элементы с position: fixed или absolute, которые у правого края
          if (style.position === 'fixed' || style.position === 'absolute') {
            const currentRight = parseInt(style.right) || 0;
            // Ставим метку чтобы не сдвигать повторно
            const originalRight = el.dataset.ozonStatsOrigRight;
            if (originalRight === undefined) {
              el.dataset.ozonStatsOrigRight = currentRight;
            }
            const base = parseInt(el.dataset.ozonStatsOrigRight) || 0;
            el.style.setProperty('right', (base + shift) + 'px', 'important');
          }
        });
      } catch (e) {}
    });
  }

  // ===== Авто-сворачивание при просмотре картинок =====
  let wasCollapsedBeforeGallery = null; // null = галерея не открыта

  function isGalleryOpen() {
    // Способ 1: Ищем любой fixed div, покрывающий экран, с картинкой внутри
    const allFixed = document.querySelectorAll('div[style], div[class]');
    for (const el of allFixed) {
      // Пропускаем нашу панель
      if (el.id === 'ozon-stats-panel' || el.closest('#ozon-stats-panel')) continue;

      const st = window.getComputedStyle(el);
      if (st.position !== 'fixed') continue;

      const w = parseInt(st.width) || 0;
      const h = parseInt(st.height) || 0;
      const z = parseInt(st.zIndex) || 0;

      // Элемент занимает большую часть экрана и имеет высокий z-index
      if (w > window.innerWidth * 0.7 && h > window.innerHeight * 0.7 && z > 100) {
        // Проверяем есть ли внутри картинка
        const imgs = el.querySelectorAll('img');
        if (imgs.length > 0) {
          return true;
        }
      }
    }

    // Способ 2: body overflow:hidden часто ставится при открытии модалки
    const bodyStyle = window.getComputedStyle(document.body);
    if (bodyStyle.overflow === 'hidden' || bodyStyle.overflowY === 'hidden') {
      // Проверяем что есть полноэкранный элемент поверх
      const els = document.elementsFromPoint(window.innerWidth / 2, window.innerHeight / 2);
      for (const el of els) {
        if (el === document.body || el === document.documentElement) continue;
        if (el.id === 'ozon-stats-panel' || el.id === 'ozon-stats-toggle') continue;
        const st = window.getComputedStyle(el);
        if (st.position === 'fixed' && parseInt(st.zIndex) > 100) {
          if (el.querySelector('img')) {
            return true;
          }
        }
      }
    }

    return false;
  }

  function checkGalleryState() {
    const galleryOpen = isGalleryOpen();

    if (galleryOpen && wasCollapsedBeforeGallery === null) {
      // Галерея только что открылась — запоминаем состояние и сворачиваем
      wasCollapsedBeforeGallery = panel.classList.contains('collapsed');
      if (!panel.classList.contains('collapsed')) {
        panel.classList.add('collapsed');
        updateTogglePosition();
        setTimeout(shiftOzonButtons, 50);
      }
      window.__ozonStats.log('[Ozon Stats] Галерея открыта, панель свёрнута (было свёрнуто:', wasCollapsedBeforeGallery, ')');
    } else if (!galleryOpen && wasCollapsedBeforeGallery !== null) {
      // Галерея закрылась — восстанавливаем прежнее состояние
      if (!wasCollapsedBeforeGallery) {
        panel.classList.remove('collapsed');
        updateTogglePosition();
        setTimeout(shiftOzonButtons, 50);
      }
      window.__ozonStats.log('[Ozon Stats] Галерея закрыта, восстановление:', wasCollapsedBeforeGallery ? 'оставить свёрнутой' : 'развернуть');
      wasCollapsedBeforeGallery = null;
    }
  }

  // Наблюдатель за новыми элементами (модалки, галереи)
  const ozonBtnObserver = new MutationObserver(() => {
    shiftOzonButtons();
    checkGalleryState();
  });
  ozonBtnObserver.observe(document.body, { childList: true, subtree: true });

  // Периодическая проверка (MutationObserver может пропустить изменения стилей)
  setInterval(checkGalleryState, 500);

  // Первичный сдвиг
  shiftOzonButtons();

  // Обработчик сворачивания
  toggleBtn.addEventListener('click', () => {
    panel.classList.toggle('collapsed');
    localStorage.setItem('ozon-stats-collapsed', panel.classList.contains('collapsed'));
    updateTogglePosition();
    // Обновляем позиции кнопок Ozon
    setTimeout(shiftOzonButtons, 50);
    setTimeout(shiftOzonButtons, 400);
  });
})();
