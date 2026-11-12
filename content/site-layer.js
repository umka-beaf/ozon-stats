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
  const CACHE_TTL = 7 * 24 * 60 * 60 * 1000;
  const DEFAULTS = {
    hideAds: false,
    hideOldPrice: false,
    hideDiscount: false,
    unitExact: false,
    clampTitles: false,
    wideContent: false,
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

  function applyTheme() {
    const dark = resolvedTheme() === 'dark';
    root.classList.toggle('ozon-site-dark', dark);
    document.querySelectorAll('.ozon-clean-header').forEach(function(el) {
      el.classList.remove('ozon-clean-header');
    });
    if (dark) {
      markSurfaces();
      markHeader();
      fixContrast();
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
  function isWhite(rgb) {
    const m = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    return !!m && +m[1] > 238 && +m[2] > 238 && +m[3] > 238;
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
  const checkedSurfaces = new WeakSet();
  const checkedText = new WeakSet();

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
      if (checkedText.has(el)) return;
      if (el.children.length || el.classList.contains('ozon-clean-dim')) return;
      const text = (el.textContent || '').trim();
      if (text.length < 2) return;
      const rect = el.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      if (rect.width < 4 || rect.height < 4) return;
      const color = parseColor(window.getComputedStyle(el).color);
      if (!color || color.a < 0.5) return;
      checkedText.add(el);
      const bg = backgroundOf(el);
      if (!bg) return;
      const l1 = luminance(color);
      const l2 = luminance(bg);
      const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
      // Гасим только тёмное на тёмном: это следствие нашей темы. Светлый
      // текст на цветном бейдже («Сегодня», «Цена что надо») — задумка
      // Ozon, и осветлить его сильнее белого некуда.
      if (ratio < 3 && l2 < 0.2) el.classList.add('ozon-clean-dim');
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
  setInterval(saveCache, 5000);

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
    markWide();
    if (settings.clampTitles) applyTitles();
    if (resolvedTheme() === 'dark') {
      markSurfaces();
      markHeader();
      fixContrast();
      markDots();
    }
  }
  function schedule() {
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
