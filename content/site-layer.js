// ==============================
// Ozon Stats — content/site-layer.js
// Слой поверх страниц ozon.ru: скрытие баннеров, тихие цены и цена
// за единицу (кг/л/шт). Настройки хранятся в localStorage в JSON
// ozon_clean_settings и общие для всех вкладок. Скрипт ничего не делает,
// пока пользователь не включил соответствующую опцию в панели.
// ==============================
(function() {
  'use strict';
  if (!window.__ozonStats || !window.__ozonStats.currentInjectionOk) return;

  const STORAGE_KEY = 'ozon_clean_settings';
  const UNIT_CACHE_KEY = 'ozon_clean_units';
  const CART_KEY = 'ozon_cart_prices';
  const CACHE_TTL = 7 * 24 * 60 * 60 * 1000;
  const CART_TTL = 60 * 24 * 60 * 60 * 1000;
  const CART_LIMIT = 500;
  const DEFAULTS = {
    hideAds: false,
    hideOldPrice: false,
    hideDiscount: false,
    unitExact: false,
    clampTitles: false,
    wideContent: false,
    cartPrices: false,
    accentOn: false,
    accentColor: '#ffa31a',
    siteTheme: 'auto'
  };

  function readSettings() {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch (e) {}

    // Миграция от прежних схем: единый переключатель quietPrices
    // (off/soft/hard) и режимы unitMode (off/title/exact) стали наборными
    // флагами и выключателем точного режима.
    if (saved.hideOldPrice === undefined) {
      saved.hideOldPrice = saved.quietPrices === 'soft' || saved.quietPrices === 'hard';
    }
    if (saved.hideDiscount === undefined) {
      saved.hideDiscount = saved.quietPrices === 'hard';
    }
    if (saved.unitExact === undefined) {
      saved.unitExact = saved.unitMode === 'exact' || saved.unitPrice === true;
    }
    delete saved.quietPrices;
    delete saved.unitMode;
    delete saved.unitPrice;

    return Object.assign({}, DEFAULTS, saved);
  }

  let settings = readSettings();
  const root = document.documentElement;

  // ===== Баннеры =====
  // Виджеты стабильные (data-widget), хешированных классов здесь нет.
  function applyAds() {
    root.classList.toggle('ozon-clean-hide-ads', !!settings.hideAds);
  }

  // ===== Тихие цены =====
  // Два независимых флага: зачёркнутая цена и плашка скидки «−NN%».
  // Зачёркнутую цену нельзя выбрать CSS-селектором, поэтому помечаем
  // элементы классом при обходе карточек, а скрывает уже CSS.
  function isStruck(el) {
    return el.children.length === 0 &&
      window.getComputedStyle(el).textDecorationLine.indexOf('line-through') >= 0;
  }

  function markPrices(card) {
    // Кэш по карточке здесь нельзя: Ozon перерисовывает блок цены через React,
    // подменяя узлы внутри того же .tile-root. Карточка та же, а помеченные
    // элементы — уже новые, и после перезагрузки страницы скидки снова видны.
    // Поэтому каждый проход обходит карточку заново; getComputedStyle зовём
    // только для листьев с ценой, иначе обход 60 карточек был бы дорогим.
    card.querySelectorAll('*').forEach(function(el) {
      const text = (el.textContent || '').trim();
      // Скидка бывает не листом: внутри бейджа «−23%» лежит декоративный div.
      // Помечаем самый внешний совпадающий элемент, чтобы не дублировать класс.
      if (/^[−-]?\d+\s*%$/.test(text)) {
        const parentIsDiscount = el.parentElement &&
          /^[−-]?\d+\s*%$/.test((el.parentElement.textContent || '').trim());
        if (!parentIsDiscount) el.classList.add('ozon-clean-discount');
        return;
      }
      if (el.children.length || text.indexOf('₽') < 0) return;
      if (!isStruck(el)) return;
      el.classList.add('ozon-clean-struck');
      // У Ozon старая цена продублирована: видимый span без зачёркивания
      // и скрытый от скринридеров сосед с ним. Прячем родителя, если все
      // его дети — одно и то же число (иначе есть риск спрятать цену).
      const parent = el.parentElement;
      if (parent && parent !== card) {
        const kids = Array.prototype.slice.call(parent.children);
        if (kids.length && kids.length <= 3 && kids.every(function(k) {
          return (k.textContent || '').trim() === text;
        })) parent.classList.add('ozon-clean-struck');
      }
    });
  }

  function applyPrices() {
    root.classList.toggle('ozon-clean-hide-old', !!settings.hideOldPrice);
    root.classList.toggle('ozon-clean-hide-discount', !!settings.hideDiscount);
    if (!settings.hideOldPrice && !settings.hideDiscount) return;
    document.querySelectorAll('.tile-root').forEach(markPrices);
  }

  // ===== Вписать название =====
  // Названия на Ozon занимают 2–6 строк, из-за чего карточки разной высоты.
  // Ограничиваем текст двумя строками через line-clamp; полный текст —
  // в атрибуте title (нативный тултип по наведению).
  function findTitleEl(card) {
    let best = null;
    card.querySelectorAll('span, a, div').forEach(function(el) {
      if (el.children.length) return;
      const t = (el.textContent || '').trim();
      if (t.length < 18 || t.indexOf('₽') >= 0) return;
      if (!/[а-яё]/i.test(t)) return;
      if (/^\d+([.,]\d+)?(\s|$)/.test(t)) return;
      if (!best || t.length > (best.textContent || '').trim().length) best = el;
    });
    return best;
  }

  // Ozon уже режет название родным контейнером (-webkit-line-clamp: 2),
  // поэтому собственный clamp на листе ничего не менял. Поднимаем родной
  // контейнер до четырёх строк: ищем ближайшего предка с непустым clamp и
  // помечаем его ozon-clean-title-box. Свой clamp на листе — только запасной
  // путь, когда такого предка нет.
  const TITLE_BOX_DEPTH = 5;

  function findClampBox(el) {
    let cur = el;
    for (let i = 0; i < TITLE_BOX_DEPTH && cur; i++) {
      const cs = getComputedStyle(cur);
      if (cs.webkitLineClamp && cs.webkitLineClamp !== 'none') return cur;
      cur = cur.parentElement;
    }
    return null;
  }

  function markTitle(card) {
    const el = findTitleEl(card);
    if (!el) return;
    const fresh = !el.classList.contains('ozon-clean-title');
    if (fresh) {
      el.classList.add('ozon-clean-title');
      if (!el.getAttribute('title')) el.setAttribute('title', (el.textContent || '').trim());
    }
    let box = card.querySelector('.ozon-clean-title-box');
    if (!box && el.classList.contains('ozon-clean-title-self')) box = el;
    if (!box) {
      box = findClampBox(el);
      if (box) box.classList.add('ozon-clean-title-box');
      else {
        el.classList.add('ozon-clean-title-self');
        box = el;
      }
    }
    // Подгонку повторяем только при смене ширины карточки: Ozon меняет её
    // при ресайзе окна и перестройке выдачи. Иначе каждый проход
    // пересчитывал бы кегль зря.
    const w = Math.round(card.getBoundingClientRect().width);
    if (!w || el.dataset.ocFitW === String(w)) return;
    el.dataset.ocFitW = String(w);
    fitTitle(el, box);
  }

  // Ozon режет название по строкам, но не подгоняет кегль, поэтому длинные
  // названия обрывались многоточием. Уменьшаем шрифт на пол-пункта, пока
  // содержимое не влезет в обрезку. Ниже 10px не опускаемся: там текст уже
  // нечитаем, и лучше остаться с многоточием, чем с серой полосой.
  const MIN_TITLE_FONT = 10;

  function fitTitle(el, clampEl) {
    if (!el.dataset.ocBase) {
      const own = parseFloat(el.style.fontSize);
      const base = own > 0 ? own : parseFloat(window.getComputedStyle(el).fontSize);
      if (!(base > 0)) return;
      el.dataset.ocBase = String(base);
      if (!el.hasAttribute('data-oc-font')) el.dataset.ocFont = el.style.fontSize || '';
    }
    const base = parseFloat(el.dataset.ocBase);
    let size = base;
    el.style.fontSize = size + 'px';
    let guard = 0;
    while (clampEl.scrollHeight > clampEl.clientHeight + 1 &&
           size > MIN_TITLE_FONT && guard < 16) {
      size -= 0.5;
      el.style.fontSize = size + 'px';
      guard++;
    }
  }

  function unmarkTitle(card) {
    const el = card.querySelector('.ozon-clean-title');
    if (!el) return;
    el.classList.remove('ozon-clean-title', 'ozon-clean-title-self');
    // Кегль, который подобрала подгонка, возвращаем к исходному.
    if (el.hasAttribute('data-oc-font')) {
      el.style.fontSize = el.dataset.ocFont;
      delete el.dataset.ocFont;
    }
    delete el.dataset.ocBase;
    delete el.dataset.ocFitW;
    const t = el.getAttribute('title');
    if (t && t === (el.textContent || '').trim()) el.removeAttribute('title');
    const box = card.querySelector('.ozon-clean-title-box');
    if (box) box.classList.remove('ozon-clean-title-box');
  }

  function applyTitles() {
    root.classList.toggle('ozon-clamp-titles', !!settings.clampTitles);
    document.querySelectorAll('.tile-root').forEach(function(card) {
      if (settings.clampTitles) markTitle(card);
      else unmarkTitle(card);
    });
  }

  // ===== Широкий режим =====
  // Ozon держит контент в 1472 px, и на широких мониторах остаются поля.
  // Расширяем контейнер и растягиваем карточки: число в ряду не меняется
  // (ряды Ozon нарезаны по 5), поэтому раскладка остаётся ровной.
  // Контейнер помечаем у любой карточки — на выдаче сетка растягивается
  // сама от max-width, и свои правила для карточек там не нужны. Ширину
  // задаём только flex-рядам: у выдачи родитель — grid на 12 колонок, и
  // своя ширина карточки ломает сетку.
  function markWide() {
    if (!settings.wideContent) return;
    document.querySelectorAll('.tile-root').forEach(function(card) {
      const box = card.closest('[data-widget="container"]');
      if (box && !box.classList.contains('ozon-wide-box')) box.classList.add('ozon-wide-box');
      const row = card.parentElement;
      if (!row || row.classList.contains('ozon-wide-row')) return;
      if (row.closest('[data-widget="infiniteVirtualPaginator"]')) return;
      if (window.getComputedStyle(row).display !== 'flex') return;
      // Только родные ряды: на главной это 5 или 10 карточек. Компактные
      // ряды (миниатюры, списки на карточке товара) при 5-колоночной ширине
      // съёжились бы вместо того, чтобы растянуться.
      const n = Array.prototype.filter.call(row.children, function(c) {
        return c.classList.contains('tile-root');
      }).length;
      if (n !== 5 && n !== 10) return;
      row.classList.add('ozon-wide-row');
    });
  }

  function applyWide() {
    root.classList.toggle('ozon-wide-content', !!settings.wideContent);
    if (!settings.wideContent) {
      document.querySelectorAll('.ozon-wide-row').forEach(function(el) {
        el.classList.remove('ozon-wide-row');
      });
      document.querySelectorAll('.ozon-wide-box').forEach(function(el) {
        el.classList.remove('ozon-wide-box');
      });
    }
  }

  // ===== Тема сайта =====
  // auto — следует системе и переключается на лету через matchMedia.
  const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

  function resolvedTheme() {
    if (settings.siteTheme === 'dark') return 'dark';
    if (settings.siteTheme === 'light') return 'light';
    return darkQuery.matches ? 'dark' : 'light';
  }

  // Переключение темы меняет исходный цвет текста, а оценённый контраст
  // в кэше относится к прежней теме — сбрасываем кэш и обходим заново.
  let themeWasDark = null;
  function applyTheme() {
    const dark = resolvedTheme() === 'dark';
    const changed = themeWasDark !== null && themeWasDark !== dark;
    themeWasDark = dark;
    root.classList.toggle('ozon-site-dark', dark);
    document.querySelectorAll('.ozon-clean-header').forEach(function(el) {
      el.classList.remove('ozon-clean-header');
    });
    if (changed) resetThemePasses();
    if (dark) {
      markSurfaces();
      markHeader();
      fixContrast();
      fixIcons();
      markDots();
    }
  }

  darkQuery.addEventListener('change', function() {
    if (settings.siteTheme === 'auto') applyTheme();
  });

  // ===== Тёмная тема: поверхности и контраст =====
  // Часть фонов и цветов текста на Ozon задана литералами в хешированных
  // классах, а не токенами. Такие места помечаем классами при обходе:
  // поверхность — если фон белый и под ней нет картинки; текст — если
  // контраст с фактическим фоном ниже 3:1.
  // Светлой считаем не только чистую белую подложку: у Ozon есть светлые
  // цветные панели (например, голубое объявление на оформлении заказа), и под
  // нашими светлыми токенами текст на них тоже становится невидимым.
  function isWhite(rgb) {
    const c = parseColor(rgb);
    return !!c && c.a > 0.5 && luminance(c) > 0.62;
  }

  // Собственная панель расширения живёт по своим токенам (styles.css,
  // класс osp-dark) — тёмная тема сайта не должна её перекрашивать.
  function ownUi(el) {
    return !!el.closest('#ozon-stats-panel');
  }

  // Повторный проход запускается после каждой мутации DOM, а на большой
  // выдаче один обход стоит ~25 мс. Уже проверенные узлы запоминаем, чтобы
  // платить только за новые. Нулевой размер — не проверено: панель или
  // всплывашка может быть ещё не разложена и появиться позже.
  // Ozon подключает свои таблицы стилей позже нашего скрипта, и литеральные
  // цвета у части узлов появляются уже после первого прохода. Кэш «уже
  // проверено» держал старую оценку, и подписи с тёмным литеральным цветом
  // (меню профиля, верхнее меню категорий) оставались нечитаемыми. Поэтому
  // при каждой новой таблице стилей кэш сбрасываем, а ранее осветлённый текст
  // снимаем с пометки и оцениваем заново.
  // Тексту и значкам, кроме того, дан срок: у уже проверенного узла цвет может
  // смениться сменой класса (активный пункт меню), а MutationObserver классы не
  // видит. Раз в 2 с оценка повторяется — это дешевле, чем пропущенная подпись.
  let checkedSurfaces = new WeakSet();
  let checkedText = new WeakMap();
  let checkedIcons = new WeakMap();

  function resetThemePasses() {
    checkedSurfaces = new WeakSet();
    checkedText = new WeakMap();
    checkedIcons = new WeakMap();
    document.querySelectorAll('.ozon-clean-dim, .ozon-clean-ink').forEach(function(el) {
      el.classList.remove('ozon-clean-dim', 'ozon-clean-ink');
    });
    document.querySelectorAll('.ozon-clean-icon').forEach(function(el) {
      el.classList.remove('ozon-clean-icon');
    });
    schedule();
  }

  new MutationObserver(function(records) {
    for (const rec of records) {
      for (const node of rec.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (node.tagName === 'STYLE' || node.tagName === 'LINK') {
          resetThemePasses();
          return;
        }
      }
    }
  }).observe(document.head, { childList: true, subtree: true });

  function markSurfaces() {
    document.querySelectorAll('body *').forEach(function(el) {
      if (ownUi(el)) return;
      if (checkedSurfaces.has(el)) return;
      if (el.classList.contains('ozon-clean-surface')) return;
      if (['IMG', 'VIDEO', 'SVG', 'PICTURE', 'CANVAS'].indexOf(el.tagName) >= 0) return;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      checkedSurfaces.add(el);
      if (r.width * r.height < 1200) return;
      const cs = window.getComputedStyle(el);
      if (!isWhite(cs.backgroundColor)) return;
      if (cs.backgroundImage && cs.backgroundImage !== 'none') return;
      el.classList.add('ozon-clean-surface');
    });
  }

  // Шапка на прокрутке — отдельный fixed-слой вне <header>, и её белая
  // подложка бывает псевдоэлементом, поэтому markSurfaces её не ловит:
  // помечаем сам слой, а фон и фоновую картинку гасим в CSS вместе с
  // ::before/::after. Ищем от стабильных виджетов вверх — хешированные
  // классы Ozon между релизами меняются.
  function markHeader() {
    document.querySelectorAll('[data-widget="searchBarDesktop"], [data-widget="catalogMenu"], [data-widget="profileLogo"]').forEach(function(anchor) {
      let cur = anchor;
      for (let i = 0; i < 8 && cur && cur !== document.body; i++) {
        const cs = window.getComputedStyle(cur);
        if (cs.position === 'fixed' || cs.position === 'sticky') {
          cur.classList.add('ozon-clean-header');
          return;
        }
        cur = cur.parentElement;
      }
    });
  }

  // Ozon включает закреплённую шапку сменой класса у уже существующего узла,
  // а MutationObserver следит только за childList. Без слушателя scroll
  // пометка приходит лишь со следующей вставкой карточек — а до неё шапка
  // остаётся светлой под нашими светлыми токенами. Метка дешёвая, поэтому
  // троттлинга в 50 мс достаточно, чтобы мигание было незаметно.
  let headerPending = false;
  window.addEventListener('scroll', function() {
    if (headerPending) return;
    headerPending = true;
    setTimeout(function() {
      headerPending = false;
      if (resolvedTheme() === 'dark') markHeader();
    }, 50);
  }, { passive: true });

  function parseColor(value) {
    const m = (value || '').match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?/);
    if (!m) return null;
    return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
  }

  function luminance(c) {
    function ch(v) {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    }
    return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b);
  }

  // Возвращает фон под элементом или null, если под ним картинка:
  // текст поверх изображения трогать нельзя.
  function backgroundOf(el) {
    let cur = el;
    while (cur && cur !== document.documentElement) {
      const cs = window.getComputedStyle(cur);
      if (cs.backgroundImage && cs.backgroundImage !== 'none') return null;
      const c = parseColor(cs.backgroundColor);
      if (c && c.a > 0.5) return c;
      cur = cur.parentElement;
    }
    const page = parseColor(window.getComputedStyle(document.body).backgroundColor);
    return page && page.a > 0.5 ? page : { r: 16, g: 19, b: 23, a: 1 };
  }

  function fixContrast() {
    document.querySelectorAll('body *').forEach(function(el) {
      if (ownUi(el)) return;
      const lastCheck = checkedText.get(el);
      if (lastCheck && Date.now() - lastCheck < 2000) return;
      // Значок + текст прямой нодой (пункты меню шапки): контейнер с картинкой
      // внутри тоже несёт текст, и пропускать его нельзя — над ним нет другой
      // пометки. Пропускаем только контейнеры с текстовыми потомками-элементами.
      const hasTextChild = Array.prototype.some.call(el.children, function(c) {
        // У SVG-узлов tagName в HTML-документе в нижнем регистре.
        return ['SVG', 'IMG', 'PICTURE', 'CANVAS', 'VIDEO'].indexOf(c.tagName.toUpperCase()) < 0;
      });
      if (hasTextChild || el.classList.contains('ozon-clean-dim')) return;
      const text = (el.textContent || '').trim();
      if (text.length < 2) return;
      const rect = el.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      if (rect.width < 4 || rect.height < 4) return;
      const color = parseColor(window.getComputedStyle(el).color);
      if (!color || color.a < 0.5) return;
      checkedText.set(el, Date.now());
      const bg = backgroundOf(el);
      if (!bg) return;
      const l1 = luminance(color);
      const l2 = luminance(bg);
      const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
      // Гасим только тёмное на тёмном: это следствие нашей темы. Светлый
      // текст на цветном бейдже («Сегодня», «Цена что надо») — задумка
      // Ozon, и осветлить его сильнее белого некуда. Обратный случай —
      // светлый текст на светлой цветной плашке, которую нельзя перекрасить
      // (слишком мелкая): там текст возвращаем к тёмному.
      if (ratio >= 3) return;
      if (l2 < 0.2) el.classList.add('ozon-clean-dim');
      else if (l2 > 0.62) el.classList.add('ozon-clean-ink');
    });
  }

  // Значки в кнопках Ozon нарисованы путями с fill="currentColor", а сам
  // цвет унаследован от литерального тёмно-синего (rgb(8, 27, 43)): на
  // тёмной кнопке значок пропадает. Проход по тексту такие узлы не видит —
  // он смотрит только листья с текстом, а внутри svg текста нет.
  function fixIcons() {
    document.querySelectorAll('svg').forEach(function(svg) {
      if (ownUi(svg)) return;
      const lastCheck = checkedIcons.get(svg);
      if (lastCheck && Date.now() - lastCheck < 2000) return;
      if (svg.classList.contains('ozon-clean-icon')) return;
      const r = svg.getBoundingClientRect();
      if (!r.width || !r.height) return;
      checkedIcons.set(svg, Date.now());
      const color = parseColor(window.getComputedStyle(svg).color);
      if (!color || color.a < 0.5) return;
      const bg = backgroundOf(svg);
      if (!bg) return;
      const l1 = luminance(color);
      const l2 = luminance(bg);
      const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
      // Порог ниже текстового: синий акцент Ozon (#005bff) на тёмном даёт
      // около 2,7 и остаётся узнаваемым, а тёмно-синий значок — около 1,2.
      if (ratio >= 2.2) return;
      if (l2 < 0.2) svg.classList.add('ozon-clean-icon');
    });
  }

  // ===== Цена за единицу =====
  // Только точный режим: размер берётся из характеристик карточки товара
  // (webAspects). Разбор названия намеренно не используется — в названиях
  // Ozon единицы измерения встречаются в любом контексте («до 20 кг»,
  // «1 шт х 50 г»), и цена за единицу по названию часто врёт.
  function formatPerAmount(price, amount, label) {
    if (!(amount > 0)) return null;
    const perUnit = price / amount;
    if (!isFinite(perUnit) || perUnit <= 0) return null;
    const rounded = perUnit >= 100 ? Math.round(perUnit) : Math.round(perUnit * 10) / 10;
    const num = rounded.toLocaleString('ru-RU').replace(/,00$/, '');
    return num + ' ₽/' + label;
  }

  function findPriceElement(card) {
    const spans = card.querySelectorAll('span');
    for (const el of spans) {
      if (el.children.length) continue;
      const t = (el.textContent || '').trim();
      if (!/^\d[\d\s]*\s*₽$/.test(t)) continue;
      if (isStruck(el)) continue;
      return { el: el, price: parseInt(t.replace(/[^\d]/g, ''), 10) };
    }
    return null;
  }

  function setBadge(card, text) {
    const price = findPriceElement(card);
    if (!price) return;
    let badge = card.querySelector('.ozon-clean-unit');
    if (!badge) {
      badge = document.createElement('div');
      badge.className = 'ozon-clean-unit';
      price.el.insertAdjacentElement('afterend', badge);
    }
    badge.textContent = text;
  }

  function removeBadge(card) {
    const badge = card.querySelector('.ozon-clean-unit');
    if (badge) badge.remove();
  }

  // ===== Точный режим: вес/объём из карточки товара =====
  // На выдаче размер есть только в названии, поэтому в режиме «точно»
  // доспрашиваем характеристики у composer-api (тот же запрос делает сам
  // Ozon), кладём размер в chrome.storage.local по SKU на 7 дней и
  // пересчитываем бейдж по актуальной цене. Запросы идут пачками не больше
  // 30 в минуту и по 3 одновременно.
  const unitCache = {};
  const failedSession = new Set();
  const queue = [];
  let cacheDirty = false;
  let inFlight = 0;
  let windowStart = Date.now();
  let windowCount = 0;
  const MAX_PER_MINUTE = 30;

  function hasStorage() {
    return typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;
  }

  function loadCache() {
    if (!hasStorage()) return;
    chrome.storage.local.get(UNIT_CACHE_KEY).then(function(res) {
      const saved = res && res[UNIT_CACHE_KEY];
      if (!saved || typeof saved !== 'object') return;
      const now = Date.now();
      Object.keys(saved).forEach(function(id) {
        const v = saved[id];
        if (v && now - v.ts < CACHE_TTL) unitCache[id] = v;
      });
      schedule();
    }).catch(function() {});
  }

  function saveCache() {
    if (!cacheDirty || !hasStorage()) return;
    cacheDirty = false;
    chrome.storage.local.set({ [UNIT_CACHE_KEY]: unitCache }).catch(function() {});
  }
  setInterval(function() { saveCache(); saveCartStore(); }, 5000);

  function productInfo(card) {
    const a = card.querySelector('a[href*="/product/"]');
    if (!a) return null;
    const m = (a.getAttribute('href') || '').match(/^\/product\/([^/?#]+)\//);
    if (!m) return null;
    const slug = m[1];
    return { id: (slug.match(/-(\d+)$/) || [])[1] || slug, path: '/product/' + slug + '/' };
  }

  function charValues(widget) {
    const out = {};
    (widget.characteristics || []).forEach(function(c) {
      const title = ((c.title && c.title.textRs) || []).map(function(r) {
        return r.content || '';
      }).join('');
      const values = (c.values || []).map(function(v) { return v.text || ''; });
      if (title) out[title] = values.join(' ');
    });
    return out;
  }

  // webAspects — характеристики, привязанные к вариантам SKU. У активного
  // варианта значение лежит в data.searchableText. Это точнее короткого
  // блока характеристик: там веса обычно нет (только тип, бренд, обжарка).
  function aspectAmounts(widget, id) {
    const out = { weight: 0, volume: 0 };
    (widget.aspects || []).forEach(function(a) {
      const variants = a.variants || [];
      const variant = variants.find(function(v) { return v.sku === id; })
        || variants.find(function(v) { return v.active; });
      const text = variant && variant.data && variant.data.searchableText;
      if (!text) return;
      const n = parseFloat(String(text).replace(',', '.'));
      if (!(n > 0)) return;
      const name = String(a.aspectName || '').toLowerCase();
      if (/^вес/.test(name)) out.weight = n;
      else if (/^объ[её]м/.test(name)) out.volume = n;
    });
    return out;
  }

  // Вес/объём в характеристиках — общий для товара, а не на единицу:
  // у набора «5 г × 200 шт» вес товара 1000 г. Поэтому на количество
  // единиц («Единиц в одном товаре») не умножаем.
  function parseExactJson(json, id) {
    const states = json.widgetStates || {};
    const keys = Object.keys(states);

    const aspectKey = keys.find(function(k) { return /^webAspects-/.test(k); });
    if (aspectKey) {
      const a = aspectAmounts(JSON.parse(states[aspectKey]), id);
      if (a.weight > 0) return { amount: a.weight / 1000, label: 'кг' };
      if (a.volume > 0) return { amount: a.volume / 1000, label: 'л' };
    }

    const charKey = keys.find(function(k) { return /^webCharacteristics-/.test(k); })
      || keys.find(function(k) { return /^webShortCharacteristics-/.test(k); });
    if (!charKey) return null;
    const chars = charValues(JSON.parse(states[charKey]));
    const weight = parseFloat(String(chars['Вес товара, г'] || '').replace(',', '.'));
    const volume = parseFloat(String(chars['Объем, мл'] || chars['Объём, мл'] || '').replace(',', '.'));
    if (weight > 0) return { amount: weight / 1000, label: 'кг' };
    if (volume > 0) return { amount: volume / 1000, label: 'л' };
    return null;
  }

  function enqueueExact(id, path) {
    if (!id || unitCache[id] || failedSession.has(id)) return;
    if (queue.some(function(job) { return job.id === id; })) return;
    queue.push({ id: id, path: path });
    pump();
  }

  function pump() {
    const now = Date.now();
    if (now - windowStart > 60000) { windowStart = now; windowCount = 0; }
    while (inFlight < 3 && queue.length && windowCount < MAX_PER_MINUTE) {
      const job = queue.shift();
      inFlight++;
      windowCount++;
      fetchExact(job).finally(function() { inFlight--; pump(); });
    }
  }

  async function fetchExact(job) {
    try {
      const url = '/api/composer-api.bx/page/json/v2?url=' + encodeURIComponent(job.path);
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const parsed = parseExactJson(await res.json(), job.id);
      if (!parsed) { failedSession.add(job.id); return; }
      unitCache[job.id] = { amount: parsed.amount, label: parsed.label, ts: Date.now() };
      cacheDirty = true;
      refreshCard(job.id);
    } catch (e) {
      failedSession.add(job.id);
      console.error('[ozon-stats] характеристики товара не получены:', job.id, e);
    }
  }

  function refreshCard(id) {
    document.querySelectorAll('.tile-root').forEach(function(card) {
      if (card.dataset.ocSku === id) decorateTile(card, true);
    });
  }

  function decorateTile(card, force) {
    if (!settings.unitExact) {
      removeBadge(card);
      card.dataset.ocUnitDone = '0';
      return;
    }
    if (!force && card.dataset.ocUnitDone === '1') return;

    const info = productInfo(card);
    if (!info) return;
    card.dataset.ocSku = info.id;

    // Точный размер уже в кеше — цена берётся из текущей разметки.
    const cached = unitCache[info.id];
    if (cached) {
      const price = findPriceElement(card);
      const text = price && formatPerAmount(price.price, cached.amount, cached.label);
      if (text) { setBadge(card, text); card.dataset.ocUnitDone = '1'; return; }
    }
    // Бейдж появится, когда придёт ответ по карточке товара.
    enqueueExact(info.id, info.path);
  }

  // Карточка товара: вес/объём берём из блока характеристик. Полный блок
  // (webCharacteristics) надёжнее короткого: в коротком бывает вес другого
  // варианта товара.
  function decorateProductPage() {
    const priceWidget = document.querySelector('[data-widget="webPrice"]');
    const charsWidget = document.querySelector('[data-widget="webCharacteristics"]')
      || document.querySelector('[data-widget="webShortCharacteristics"]');
    if (!priceWidget || !charsWidget) return;

    let badge = priceWidget.querySelector('.ozon-clean-unit');
    if (!settings.unitExact) { if (badge) badge.remove(); return; }
    if (badge) return;

    const chars = charsWidget.innerText;
    const m = chars.match(/(?:Вес товара, г|Объем, мл|Объём, мл)\s*:?\s*(\d+(?:[.,]\d+)?)/i);
    if (!m) return;
    const isVolume = /Объ[её]м/i.test(m[0]);
    const qty = parseFloat(m[1].replace(',', '.'));

    const price = findPriceElement(priceWidget);
    if (!price) return;

    // «Вес товара, г» / «Объём, мл» — общий вес всего товара (у набора
    // «5 г × 200 шт» это 1000 г), поэтому на количество единиц не умножаем.
    const amount = qty / 1000;
    const text = formatPerAmount(price.price, amount, isVolume ? 'л' : 'кг');
    if (!text) return;
    badge = document.createElement('div');
    badge.className = 'ozon-clean-unit';
    badge.textContent = text;
    priceWidget.appendChild(badge);
  }

  // ===== Точки количества фото =====
  // Неактивные точки Ozon — полупрозрачный тёмно-синий (alpha 0.2). На тёмной
  // подложке карточки они пропадают, видна только активная (alpha 1). Ищем их
  // по размеру, круглой форме и промежуточной прозрачности и перекрашиваем
  // через CSS; активную не трогаем — она синяя и видна и так.
  //
  // React при листании фото переписывает class на точках целиком и затирает
  // нашу метку, а сам узел при этом остаётся тем же. Поэтому общий
  // MutationObserver (childList) здесь не помогает: за каждым рядом точек
  // следим отдельно, по смене класса, и метку ставим заново.
  const dotRows = new WeakSet();

  function isDot(el) {
    if (el.children.length) return false;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height || r.width > 8 || r.height > 8) return false;
    return parseFloat(window.getComputedStyle(el).borderTopLeftRadius) >= 2;
  }

  function markDotRow(row) {
    Array.prototype.forEach.call(row.children, function(el) {
      // Своя же перекраска делает точку непрозрачной, поэтому помеченную
      // заново не оцениваем — иначе класс будет ставиться и сниматься по
      // кругу. При смене фото React переписывает class целиком, метка
      // пропадает, и точка оценивается заново уже по родному цвету.
      if (el.classList.contains('ozon-clean-dot')) return;
      if (!isDot(el)) return;
      const bg = parseColor(window.getComputedStyle(el).backgroundColor);
      if (!bg || bg.a <= 0 || bg.a >= 0.9) return;
      el.classList.add('ozon-clean-dot');
    });
  }

  function watchDotRow(row) {
    if (!row || dotRows.has(row)) return;
    dotRows.add(row);
    new MutationObserver(function() { markDotRow(row); }).observe(row, {
      childList: true, subtree: true, attributes: true, attributeFilter: ['class']
    });
    markDotRow(row);
  }

  function markDots() {
    document.querySelectorAll('.tile-root span').forEach(function(el) {
      // Уже наблюдаемый ряд сам ловит новые точки.
      if (dotRows.has(el.parentElement)) return;
      if (isDot(el)) watchDotRow(el.parentElement);
    });
  }

  // ===== Память цен в корзине =====
  // В корзине Ozon нет ни ссылок на товар, ни data-атрибутов с SKU: вся
  // разметка позиций — дивы с хешированными классами. Опознаём позицию по
  // номеру фото из ir.ozone.ru/s3/multimedia-*/…/<id>.jpg и названию:
  // фото стабильно, а название разделяет варианты одного товара. Запоминаем
  // цену при каждом заходе в корзину и показываем разницу с прошлым заходом.
  // Хранилище — localStorage, как и настройки: данные лежат только на
  // устройстве и никуда не уходят.
  let cartStore = readCartStore();
  // Ключи, уже сопоставленные в этой загрузке страницы: сравнение делаем
  // ровно один раз, иначе после перерисовки разница обнулилась бы.
  const cartSeen = new Set();
  const cartDeltas = {};
  let cartDirty = false;

  function readCartStore() {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(CART_KEY) || '{}'); } catch (e) {}
    const now = Date.now();
    const out = {};
    Object.keys(saved).forEach(function(k) {
      const v = saved[k];
      if (v && v.p > 0 && v.t && now - v.t < CART_TTL) out[k] = v;
    });
    return out;
  }

  function saveCartStore() {
    if (!cartDirty) return;
    const keys = Object.keys(cartStore);
    if (keys.length > CART_LIMIT) {
      keys.sort(function(a, b) { return cartStore[a].t - cartStore[b].t; });
      keys.slice(0, keys.length - CART_LIMIT).forEach(function(k) { delete cartStore[k]; });
    }
    try { localStorage.setItem(CART_KEY, JSON.stringify(cartStore)); } catch (e) {}
    cartDirty = false;
  }

  function cartPriceEl(item) {
    let found = null;
    item.querySelectorAll('span').forEach(function(el) {
      if (found || el.children.length) return;
      const t = (el.textContent || '').trim();
      if (!/^\d[\d\s]*\s*₽$/.test(t)) return;
      if (isStruck(el)) return;
      found = el;
    });
    return found;
  }

  // Корень позиции — самый высокий предок фото, который ещё содержит только
  // это фото: у группы позиций (шапка «Доступны для заказа») фото уже
  // несколько. Классы не используем, они хешированные.
  function cartItemOf(img) {
    const root = document.querySelector('[data-widget="cartSplit"]');
    let cur = img;
    while (cur !== root && cur.parentElement && cur.parentElement !== root) {
      if (cur.parentElement.querySelectorAll('img[src*="/multimedia"]').length > 1) break;
      cur = cur.parentElement;
    }
    return cur;
  }

  function cartItemKey(item) {
    const img = item.querySelector('img[src*="/multimedia"]');
    const m = img && (img.getAttribute('src') || '').match(/\/multimedia[^/]*\/[^/]*\/(\d+)\./);
    const titleEl = findTitleEl(item);
    const title = titleEl ? (titleEl.textContent || '').replace(/\s+/g, ' ').trim() : '';
    if (!m && !title) return '';
    return (m ? m[1] : '') + '|' + title;
  }

  function formatCartDelta(delta) {
    const num = Math.abs(delta).toLocaleString('ru-RU');
    return (delta < 0 ? '↓ ' : '↑ ') + num + ' ₽';
  }

  function setCartBadge(item, priceEl, d) {
    let badge = item.querySelector('.ozon-clean-cart-delta');
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'ozon-clean-cart-delta';
      priceEl.insertAdjacentElement('afterend', badge);
    }
    badge.classList.toggle('ozon-clean-cart-up', d.delta > 0);
    badge.textContent = formatCartDelta(d.delta);
    badge.title = 'В прошлый раз ' + d.was.toLocaleString('ru-RU') + ' ₽';
  }

  function cartPass() {
    const root = document.querySelector('[data-widget="cartSplit"]');
    if (!root) return;
    root.querySelectorAll('img[src*="/multimedia"]').forEach(function(img) {
      const item = cartItemOf(img);
      if (!item) return;
      const priceEl = cartPriceEl(item);
      if (!priceEl) return;
      const key = cartItemKey(item);
      if (!key) return;
      const price = parseInt((priceEl.textContent || '').replace(/[^\d]/g, ''), 10);
      if (!(price > 0)) return;

      if (!cartSeen.has(key)) {
        cartSeen.add(key);
        const prev = cartStore[key];
        // Цена изменилась между заходами — запоминаем разницу; иначе метки нет.
        if (prev && prev.p !== price) cartDeltas[key] = { delta: price - prev.p, was: prev.p };
        cartStore[key] = { p: price, t: Date.now() };
        cartDirty = true;
      }
      if (cartDeltas[key]) setCartBadge(item, priceEl, cartDeltas[key]);
    });
  }

  function applyCart() {
    root.classList.toggle('ozon-cart-prices', !!settings.cartPrices);
    if (!settings.cartPrices) {
      document.querySelectorAll('.ozon-clean-cart-delta').forEach(function(el) { el.remove(); });
      return;
    }
    cartPass();
  }

  // ===== Акцентный цвет =====
  // Ozon рисует акцент (кнопки, ссылки, чекбоксы, выделение) токенами
  // --bgActionPrimary / --textAction / --ozCtrlPrimary и другими. Подменяем
  // их своим цветом на <html>: токены наследуются вниз, и перекрашивается
  // всё, что на них построено. Места, заданные литералами и картинками
  // (логотип, платёжные значки), остаются как есть.
  //
  // Белый текст на светлом акценте нечитаем, поэтому цвет текста на плашке
  // выбираем по контрасту и размечаем сами плашки классом
  // ozon-clean-accent-bg: у наследников Ozon встречается белый текст
  // литералом, переопределение токена его не достаёт.
  let accentRgb = null;
  let accentHex = '';

  const INK_DARK = { r: 20, g: 24, b: 29, a: 1 };
  const INK_LIGHT = { r: 255, g: 255, b: 255, a: 1 };

  function hexToRgb(hex) {
    const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '');
    if (!m) return null;
    return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16), a: 1 };
  }

  function rgbToHex(c) {
    function h(v) { return ('0' + Math.round(v).toString(16)).slice(-2); }
    return '#' + h(c.r) + h(c.g) + h(c.b);
  }

  function darken(c, k) {
    return { r: c.r * (1 - k), g: c.g * (1 - k), b: c.b * (1 - k), a: 1 };
  }

  function contrastOf(a, b) {
    const l1 = luminance(a);
    const l2 = luminance(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  }

  function applyAccent() {
    const base = settings.accentOn ? hexToRgb(settings.accentColor) : null;
    root.classList.toggle('ozon-accent', !!base);
    // Метки плашек привязаны к конкретному цвету: при его смене старые
    // снимаем, проход разметит заново.
    const hex = base ? rgbToHex(base) : '';
    if (hex !== accentHex) {
      accentHex = hex;
      document.querySelectorAll('.ozon-clean-accent-bg, .ozon-clean-accent-cut, .ozon-clean-pink, ' +
        '.ozon-clean-pink-dark, .ozon-clean-pink-bg, .ozon-clean-pink-bg-soft').forEach(function(el) {
        el.classList.remove('ozon-clean-accent-bg', 'ozon-clean-accent-cut', 'ozon-clean-pink',
          'ozon-clean-pink-dark', 'ozon-clean-pink-bg', 'ozon-clean-pink-bg-soft');
        el.style.removeProperty('--oc-pink-a');
      });
      accentLastPass = 0;
      accentLastFull = 0;
      accentPending.clear();
    }
    if (!base) {
      accentRgb = null;
      accentPending.clear();
      ['--oc-a', '--oc-ah', '--oc-aa', '--oc-ink', '--oc-text'].forEach(function(p) {
        root.style.removeProperty(p);
      });
      return;
    }
    accentRgb = base;
    // На светлой подложке акцентный текст затемняем до контраста 4.5:1
    // с белым; на тёмной сам акцент уже читается. Шаг мелкий, чтобы цвет
    // оставался насыщенным, а не уходил в коричневый.
    let text = base;
    for (let i = 0; i < 40 && contrastOf(text, INK_LIGHT) < 4.5; i++) text = darken(text, 0.04);
    const ink = contrastOf(base, INK_DARK) >= contrastOf(base, INK_LIGHT) ? INK_DARK : INK_LIGHT;
    root.style.setProperty('--oc-a', rgbToHex(base));
    root.style.setProperty('--oc-ah', rgbToHex(darken(base, 0.14)));
    root.style.setProperty('--oc-aa', rgbToHex(darken(base, 0.24)));
    root.style.setProperty('--oc-ink', rgbToHex(ink));
    root.style.setProperty('--oc-text', rgbToHex(text));
  }

  // Ценники Ozon красит брендовым розовым двумя способами: цветом из токена
  // (тогда он уже перекрашен CSS-подменой токенов) и инлайновым градиентом с
  // background-clip: text, где color прозрачный. Градиент токеном не достать,
  // как и литеральные розовые, поэтому проход по DOM размечает такие узлы, а
  // CSS перекрашивает их в акцент. Розовые токены уже подменены акцентом —
  // их значения при поиске не используются.
  // Оттенки розового Ozon лежат в одном углу RGB: красный канал максимум,
  // зелёный минимум и заметно ниже синего, красный выше синего. Фиксированный
  // список сюда не годится — кроме трёх брендовых тонов есть светлые подложки
  // (rgba(255, 121, 171, .08)) и их непрозрачные смеси, а лиловый и красный
  // этим условием не проходят.
  function pinkish(c, minDelta) {
    return c.a >= 0.05 && c.r > c.b && c.g < c.b && c.r - c.g >= minDelta;
  }

  function isPink(c) {
    return !!c && pinkish(c, 12);
  }

  function isPinkText(c) {
    return !!c && pinkish(c, 40);
  }

  function isPinkGradient(image) {
    if (!image || image === 'none') return false;
    const m = image.match(/rgba?\(\d+,\s*\d+,\s*\d+(?:,\s*[\d.]+)?\)/g);
    return !!m && m.some(function(part) {
      return isPinkText(parseColor(part));
    });
  }

  // Плашки с акцентным фоном получают контрастный текст и значки (у них
  // fill="currentColor"). Отрицательный результат не кэшируем: фон плашки
  // часто меняется сменой класса у уже проверенного узла (активная вкладка,
  // выбранный пункт меню), а MutationObserver классы не видит. Поэтому проход
  // повторяется при каждой пачке мутаций. В этом же проходе убирается
  // розовый: он бывает токеном, литеральным цветом и градиентом, и токены до
  // двух последних не достают. Полный обход документа дорог на длинных
  // страницах, поэтому по свежим мутациям проверяются только вставленные
  // поддеревья, а весь документ — не чаще раза в 2,5 с: смена класса без
  // вставки узлов иначе не попадёт в разметку.
  let accentLastPass = 0;
  let accentLastFull = 0;
  // Новые поддеревья из MutationObserver: их проверяем сразу, не дожидаясь
  // полного обхода — Ozon дорисовывает карточки порциями.
  const accentPending = new Set();

  // Внутри акцентной плашки бывают свои подложки: у строки поиска акцентом
  // красится «рамка» формы, а поле ввода внутри — отдельная тёмная панель.
  // Правило «текст на акцентной плашке тёмный» каскадом доставало и до неё,
  // из-за чего в тёмной теме текст поля становился невидимым. Такие поддеревья
  // помечаем и исключаем из правила — цвет их текста ведёт проход тёмной темы.
  function markAccentCuts(container) {
    container.querySelectorAll('*').forEach(function(child) {
      if (child.classList.contains('ozon-clean-accent-cut')) return;
      const cbg = parseColor(window.getComputedStyle(child).backgroundColor);
      if (!cbg || cbg.a < 0.9) return;
      if (Math.abs(cbg.r - accentRgb.r) <= 6 && Math.abs(cbg.g - accentRgb.g) <= 6 &&
          Math.abs(cbg.b - accentRgb.b) <= 6) return;
      child.classList.add('ozon-clean-accent-cut');
    });
  }

  function accentPass() {
    if (!accentRgb) return;
    const now = Date.now();
    const full = now - accentLastFull >= 2500;
    if (!full && !accentPending.size) return;
    if (now - accentLastPass < 400) return;
    accentLastPass = now;
    let nodes;
    if (full) {
      accentLastFull = now;
      accentPending.clear();
      nodes = document.querySelectorAll('body *');
    } else {
      nodes = [];
      accentPending.forEach(function(root) {
        if (!root.isConnected || root.nodeType !== 1) return;
        nodes.push(root);
        root.querySelectorAll('*').forEach(function(child) { nodes.push(child); });
      });
      accentPending.clear();
    }
    nodes.forEach(function(el) {
      if (ownUi(el)) return;
      const cs = window.getComputedStyle(el);
      const bg = parseColor(cs.backgroundColor);
      if (bg && bg.a >= 0.05 && isPink(bg)) {
        // Долю розового в подложке сохраняем: плашка остаётся полупрозрачной.
        // У полупрозрачной подложки текст на светлой теме всегда тёмный:
        // --oc-ink подобран под сплошной акцент и на светлом тоне не читается.
        const cls = bg.a < 0.5 ? 'ozon-clean-pink-bg-soft' : 'ozon-clean-pink-bg';
        if (!el.classList.contains(cls)) {
          el.style.setProperty('--oc-pink-a', bg.a.toFixed(2));
          el.classList.add(cls);
        }
        return;
      }
      if (el.classList.contains('ozon-clean-accent-bg')) return;
      if (bg && bg.a >= 0.5 && Math.abs(bg.r - accentRgb.r) <= 6 &&
          Math.abs(bg.g - accentRgb.g) <= 6 && Math.abs(bg.b - accentRgb.b) <= 6) {
        el.classList.add('ozon-clean-accent-bg');
        markAccentCuts(el);
        return;
      }
      // Розовый текст и градиентные ценники — только листья, чтобы не
      // перекрашивать контейнеры целиком.
      if (el.children.length) return;
      if (el.closest('.ozon-clean-pink-bg, .ozon-clean-pink-bg-soft, .ozon-clean-accent-bg')) return;
      const pinkGradient = isPinkGradient(cs.backgroundImage);
      if (!pinkGradient && !isPinkText(parseColor(cs.color))) return;
      // Под текстом должна быть известная подложка: на картинке цвет не меняем.
      // У градиентного ценника картинка лежит в нём самом (background-clip:
      // text), подложку ищем начиная с родителя.
      const under = backgroundOf(pinkGradient ? el.parentElement : el);
      if (!under) return;
      // На тёмной подложке акцент и так читается, на светлой — затемняем.
      const cls = luminance(under) < 0.35 ? 'ozon-clean-pink-dark' : 'ozon-clean-pink';
      if (!el.classList.contains(cls)) el.classList.add(cls);
    });
  }

  // ===== Общий проход =====
  let scheduled = false;
  function processPage() {
    scheduled = false;
    if (settings.hideOldPrice || settings.hideDiscount) {
      document.querySelectorAll('.tile-root').forEach(markPrices);
    }
    // decorateTile и decorateProductPage сами убирают бейджи, когда опция выключена.
    document.querySelectorAll('.tile-root').forEach(function(card) { decorateTile(card); });
    decorateProductPage();
    applyCart();
    accentPass();
    markWide();
    if (settings.clampTitles) applyTitles();
    if (resolvedTheme() === 'dark') {
      markSurfaces();
      markHeader();
      fixContrast();
      fixIcons();
      markDots();
    }
  }
  function schedule(records) {
    // Запоминаем только что вставленные поддеревья: их размечаем сразу, а
    // полный обход документа остаётся для смены классов без вставки узлов.
    if (records) {
      for (let i = 0; i < records.length; i++) {
        const added = records[i].addedNodes;
        for (let j = 0; j < added.length; j++) {
          if (added[j].nodeType === 1) accentPending.add(added[j]);
        }
      }
    }
    if (scheduled) return;
    scheduled = true;
    setTimeout(processPage, 250);
  }

  const observer = new MutationObserver(schedule);

  function applyAll() {
    applyAds();
    applyPrices();
    applyWide();
    applyTheme();
    applyAccent();
    applyTitles();
    processPage();
  }

  window.__ozonStats.clean = {
    getSettings: function() { return Object.assign({}, settings); },
    set: function(key, value) {
      settings[key] = value;
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch (e) {}
      applyAll();
    },
    apply: applyAll
  };

  // Событие storage приходит только в другие вкладки того же origin. Без него
  // включённая в одной вкладке галочка не применялась в уже открытых: они
  // держали настройки, прочитанные при загрузке.
  window.addEventListener('storage', function(e) {
    if (e.key !== STORAGE_KEY) return;
    settings = readSettings();
    applyAll();
  });

  loadCache();
  applyAll();
  observer.observe(document.body, { childList: true, subtree: true });
})();
