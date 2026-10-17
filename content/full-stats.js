// ==============================
// Ozon Stats — content/full-stats.js
// Сбор статистики за всё время: сначала актуальные заказы, затем постранично
// весь архив (API отдаёт следующую страницу через paginator), склейка в один
// список с дедупликацией и подсчётом сумм/годовой разбивки/рекордов.
// Отображение результата — через renderStatsResult из orders-panel.js.
// ==============================
(function() {
  if (!window.__ozonStats || !window.__ozonStats.currentInjectionOk) return;

  const { formatMoney, renderStatsResult, loadData } = window.__ozonStats;

  // Функция сбора полной статистики
  async function loadFullStats() {
    var body = document.getElementById('osp-body');
    var cancelled = false;

    // Показываем live-счётчики с анимацией
    body.innerHTML =
      '<div style="padding: 0;">' +
        '<div style="text-align: center; margin-bottom: 16px;">' +
          '<div class="osp-spinner" style="margin: 0 auto 12px;"></div>' +
          '<div style="font-size: 15px; font-weight: 700; color: #1a1a2e;" id="stats-phase">Загрузка статистики...</div>' +
        '</div>' +
        '<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 16px;">' +
          '<div style="background: white; border-radius: 14px; padding: 14px; box-shadow: 0 2px 12px rgba(0,0,0,0.06);">' +
            '<div style="font-size: 11px; color: #9ca3af; margin-bottom: 4px;">📦 Заказов</div>' +
            '<div style="font-size: 20px; font-weight: 700; color: #10b981; transition: transform 0.15s; overflow: hidden; white-space: nowrap;" id="live-orders">0</div>' +
          '</div>' +
          '<div style="background: white; border-radius: 14px; padding: 14px; box-shadow: 0 2px 12px rgba(0,0,0,0.06);">' +
            '<div style="font-size: 11px; color: #9ca3af; margin-bottom: 4px;">💰 Сумма</div>' +
            '<div style="font-size: 20px; font-weight: 700; color: #005BFF; transition: transform 0.15s; overflow: hidden; white-space: nowrap;" id="live-sum">' + formatMoney(0) + '</div>' +
          '</div>' +
        '</div>' +
        '<div style="background: white; border-radius: 14px; padding: 10px 14px; margin-bottom: 16px; box-shadow: 0 2px 12px rgba(0,0,0,0.06);">' +
          '<div style="font-size: 11px; color: #9ca3af; margin-bottom: 2px;">📄 Прогресс</div>' +
          '<div style="font-size: 13px; color: #6b7280;" id="stats-detail">Подготовка...</div>' +
        '</div>' +
        '<button class="osp-btn red" id="stats-cancel" style="margin-top: 4px;">Отмена</button>' +
      '</div>';

    document.getElementById('stats-cancel').addEventListener('click', function() {
      cancelled = true;
      loadData();
    });

    // === Живой счётчик ===
    var displayedOrders = 0;
    var displayedSum = 0;
    var targetOrders = 0;
    var targetSum = 0;
    var tickerRunning = true;

    function tickCounters() {
      if (!tickerRunning) return;
      var changed = false;
      // Плавно приближаем отображаемое значение к целевому
      if (displayedOrders < targetOrders) {
        var stepO = Math.max(1, Math.ceil((targetOrders - displayedOrders) / 12));
        displayedOrders = Math.min(displayedOrders + stepO, targetOrders);
        changed = true;
      }
      if (displayedSum < targetSum) {
        var stepS = Math.max(1, Math.ceil((targetSum - displayedSum) / 12));
        displayedSum = Math.min(displayedSum + stepS, targetSum);
        changed = true;
      }
      if (changed) {
        var ordEl = document.getElementById('live-orders');
        var sumEl = document.getElementById('live-sum');
        if (ordEl) ordEl.textContent = displayedOrders.toLocaleString('ru-RU');
        if (sumEl) sumEl.textContent = formatMoney(displayedSum);
      }
      requestAnimationFrame(tickCounters);
    }
    requestAnimationFrame(tickCounters);

    function updateLive(phase, count, sum, detail) {
      if (cancelled) return;
      targetOrders = count;
      targetSum = sum;
      var phaseEl = document.getElementById('stats-phase');
      var detailEl = document.getElementById('stats-detail');
      if (phaseEl) phaseEl.textContent = phase;
      if (detailEl) detailEl.textContent = detail || '';
    }

    try {
      // --- Утилиты ---
      function parsePrice(text) {
        if (typeof text === 'number') return text;
        if (!text) return 0;
        var s = String(text).replace(/\s/g, '').replace(',', '.');
        var m = s.match(/([\d]+(?:\.[\d]+)?)/);
        return m ? parseFloat(m[1]) : 0;
      }

      var MONTHS_RU = {
        'январ': 1, 'феврал': 2, 'март': 3, 'марта': 3,
        'апрел': 4, 'ма': 5, 'мая': 5, 'июн': 6, 'июл': 7,
        'август': 8, 'сентябр': 9, 'октябр': 10,
        'ноябр': 11, 'декабр': 12,
      };

      function isDelivered(t) {
        if (!t) return false;
        var low = t.toLowerCase();
        return ['доставлен', 'получен', 'вручен', 'выдан', 'завершён', 'завершен',
                'забрал', 'выполнен', 'закрыт', 'доставлено', 'забрали'].some(function(w) { return low.indexOf(w) >= 0; });
      }

      function isCancelled(t) {
        if (!t) return false;
        var low = t.toLowerCase();
        return ['отмен', 'возвр', 'cancel', 'return'].some(function(w) { return low.indexOf(w) >= 0; });
      }

      // --- API ---
      async function fetchAPI(pageUrl) {
        var endpoints = [
          '/api/entrypoint-api.bx/page/json/v2',
          '/api/composer-api.bx/page/json/v2',
        ];
        for (var i = 0; i < endpoints.length; i++) {
          try {
            var url = endpoints[i] + '?url=' + encodeURIComponent(pageUrl);
            var resp = await fetch(url, {
              credentials: 'include',
              headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
            });
            if (resp.ok) {
              var data = await resp.json();
              if (data && data.widgetStates) {
                return data;
              }
            }
          } catch (e) {
            window.__ozonStats.log('[Ozon Stats] API error:', e.message);
          }
        }
        return null;
      }

      // --- Парсинг виджетов ---
      function extractOrdersFromWidgets(widgetStates, debugFirst, isArchive) {
        var orders = [];
        var keys = Object.keys(widgetStates);
        var currentYear = new Date().getFullYear();

        for (var k = 0; k < keys.length; k++) {
          var widgetKey = keys[k];
          if (widgetKey.toLowerCase().indexOf('orderlist') < 0) continue;

          var rawVal = widgetStates[widgetKey];
          var val;
          try { val = typeof rawVal === 'string' ? JSON.parse(rawVal) : rawVal; } catch(e) { continue; }

          var shipments = val && val.ordersV2;
          if (!shipments || !Array.isArray(shipments)) continue;

          for (var i = 0; i < shipments.length; i++) {
            var shipment = shipments[i];
            var order = parseShipment(shipment, debugFirst && orders.length < 5, isArchive, currentYear, MONTHS_RU);
            if (order) {
              orders.push(order);
            }
          }
        }
        return orders;
      }

      function parseShipment(shipment, doLog, isArchive, currentYear, MONTHS_RU) {
        if (!shipment || !shipment.leftBlock) return null;

        var ti = shipment.leftBlock.textIcon || {};
        var statusText = (ti.text && ti.text.text) || '';
        var common = ti.common || {};
        var autoId = (common.testInfo && common.testInfo.automatizationId) || '';
        var orderNum = autoId.replace('orderListTile_', '');

        if (!orderNum) {
          // Ozon переименовал параметр ссылки order= в orderNumber= без предупреждения.
          var link = (common.action && common.action.link) || '';
          var linkMatch = link.match(/order(?:Number)?=(\d{5,}-\d{4})/);
          if (linkMatch) orderNum = linkMatch[1];
        }

        var totalPrice = 0;
        var itemCount = 0;
        var rb = shipment.rightBlock || {};
        var products = (rb.products && rb.products.products) || [];

        for (var p = 0; p < products.length; p++) {
          var prod = products[p];
          var priceArr = (prod.price && prod.price.price) || [];
          if (priceArr.length > 0) {
            var priceText = priceArr[0].text || '';
            var priceVal = parsePrice(priceText);
            if (priceVal > 0) totalPrice += priceVal;
          }
          var badge = (prod.image && prod.image.badge) || {};
          var qtyText = badge.text || '';
          var qtyMatch = qtyText.match(/(\d+)/);
          var qty = qtyMatch ? parseInt(qtyMatch[1]) : 1;
          itemCount += qty;
        }

        if (totalPrice <= 0 && rb) {
          try {
            var rbStr = JSON.stringify(rb);
            var priceMatches = rbStr.match(/(\d[\d\s\u00a0\u202f]*)[\s\u00a0\u202f]*₽/g);
            if (priceMatches) {
              for (var pm = 0; pm < priceMatches.length; pm++) {
                var v = parsePrice(priceMatches[pm]);
                if (v > 0) { totalPrice += v; break; }
              }
            }
          } catch (e) {}
        }

        if (itemCount === 0) itemCount = products.length || 1;

        // Год и месяц
        var year = null;
        var month = null;
        var orderDate = null;
        var timeline = (common.timeline && common.timeline.steps) || [];
        for (var t = 0; t < timeline.length; t++) {
          var sub = timeline[t].subtitle || '';
          var dm = sub.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
          if (dm) {
            var yr = parseInt(dm[3]);
            if (yr >= 2010 && yr <= 2030) {
              year = yr;
              month = parseInt(dm[2]);
              orderDate = dm[3] + '-' + dm[2].padStart(2, '0') + '-' + dm[1].padStart(2, '0');
              break;
            }
          }
        }

        if (!year) {
          var ruDate = statusText.match(/(\d{1,2})\s+([а-яё]+)\s+(\d{4})/i);
          if (ruDate) {
            var yr2 = parseInt(ruDate[3]);
            if (yr2 >= 2010 && yr2 <= 2030) {
              year = yr2;
              var mnName = ruDate[2].toLowerCase();
              var mkAll = Object.keys(MONTHS_RU);
              for (var mki = 0; mki < mkAll.length; mki++) {
                if (mnName.indexOf(mkAll[mki]) === 0) { month = MONTHS_RU[mkAll[mki]]; break; }
              }
              if (month) orderDate = yr2 + '-' + String(month).padStart(2, '0') + '-' + ruDate[1].padStart(2, '0');
            }
          }
        }

        if (!year) {
          var shortDate = statusText.match(/(\d{1,2})\s+([а-яё]+)/i);
          if (shortDate) {
            var mn = shortDate[2].toLowerCase();
            var validM = false;
            var mkeys = Object.keys(MONTHS_RU);
            for (var mi = 0; mi < mkeys.length; mi++) {
              if (mn.indexOf(mkeys[mi]) === 0) { validM = true; break; }
            }
            if (validM) year = currentYear;
          }
        }

        if (!year) {
          var stLow = statusText.toLowerCase();
          if (stLow.indexOf('доставк') >= 0 || stLow.indexOf('в пути') >= 0 || stLow.indexOf('доставляется') >= 0) {
            year = currentYear;
          }
        }

        var delivered = isDelivered(statusText);
        var cancelledFlag = isCancelled(statusText);

        if (isArchive && !cancelledFlag) {
          delivered = true;
        }

        var dedupKey = orderNum + '|' + statusText + '|' + totalPrice + '|' + itemCount;

        return {
          orderNumber: orderNum,
          price: totalPrice,
          status: statusText,
          itemCount: itemCount,
          year: year,
          month: month,
          orderDate: orderDate,
          isDelivered: delivered,
          isCancelled: cancelledFlag,
          dedupKey: dedupKey,
        };
      }

      // ============ MAIN ============
      var allOrders = [];
      var pagesData = [];
      var totalPages = 0;
      var currentYear = new Date().getFullYear();
      var globalSeen = {};

      function calcRunning() {
        var delivered = allOrders.filter(function(o) { return o.isDelivered && !o.isCancelled; });
        var toCount = delivered.length > 0 ? delivered : allOrders.filter(function(o) { return !o.isCancelled; });
        var sum = 0;
        for (var i = 0; i < toCount.length; i++) sum += toCount[i].price;
        return { count: toCount.length, sum: Math.round(sum) };
      }

      // 1) Актуальные заказы
      if (!cancelled) {
        window.__ozonStats.log('[Ozon Stats] Актуальные: /my/orderlist');
        updateLive('Актуальные заказы...', 0, 0, 'Загрузка...');
        var activeData = await fetchAPI('/my/orderlist');
        if (activeData) {
          totalPages++;
          var rawOrders = extractOrdersFromWidgets(activeData.widgetStates, true, false);
          for (var u = 0; u < rawOrders.length; u++) {
            var dk = rawOrders[u].dedupKey;
            if (!globalSeen[dk]) {
              globalSeen[dk] = true;
              allOrders.push(rawOrders[u]);
            }
          }
          if (allOrders.length > 0) {
            pagesData.push({ orders: allOrders.slice(0), sampleYear: null });
          }
          var running = calcRunning();
          updateLive('Актуальные заказы', running.count, running.sum, 'Стр. ' + totalPages);
        }
      }

      await new Promise(function(r) { setTimeout(r, 300); });

      // 2) Архив (постранично)
      if (!cancelled) {
        window.__ozonStats.log('[Ozon Stats] Архив стр.1');
        var r1 = calcRunning();
        updateLive('Архив (1)...', r1.count, r1.sum, 'Загрузка архива...');
        var firstPage = await fetchAPI('/my/orderlist?selectedTab=archive');
        if (firstPage) {
          totalPages++;
          var rawOrders2 = extractOrdersFromWidgets(firstPage.widgetStates, true, true);
          var uniqueOrders = [];
          for (var u2 = 0; u2 < rawOrders2.length; u2++) {
            if (!globalSeen[rawOrders2[u2].dedupKey]) {
              globalSeen[rawOrders2[u2].dedupKey] = true;
              uniqueOrders.push(rawOrders2[u2]);
            }
          }
          if (uniqueOrders.length > 0) {
            pagesData.push({ orders: uniqueOrders, sampleYear: null });
            allOrders = allOrders.concat(uniqueOrders);
          }

          var running2 = calcRunning();
          updateLive('Архив (1)', running2.count, running2.sum, 'Стр. ' + totalPages);

          // Находим nextPage через paginator
          var nextUrl = null;
          if (firstPage.widgetStates) {
            var wkeys = Object.keys(firstPage.widgetStates);
            for (var wi = 0; wi < wkeys.length; wi++) {
              if (wkeys[wi].indexOf('paginator') < 0) continue;
              try {
                var pRaw = firstPage.widgetStates[wkeys[wi]];
                var pParsed = typeof pRaw === 'string' ? JSON.parse(pRaw) : pRaw;
                if (pParsed && pParsed.nextPage && pParsed.layoutContainer &&
                    pParsed.layoutContainer.indexOf('order-list') >= 0) {
                  nextUrl = pParsed.nextPage;
                  break;
                }
              } catch (e) {}
            }
          }

          // Следующие страницы архива
          var emptyStreak = 0;
          var pageIdx = 2;

          while (nextUrl && !cancelled && emptyStreak < 5 && pageIdx < 500) {
            var data = await fetchAPI(nextUrl);
            if (!data) {
              emptyStreak++;
              nextUrl = null;
              continue;
            }

            totalPages++;
            var rawOrd = extractOrdersFromWidgets(data.widgetStates, false, true);
            nextUrl = data.nextPage || null;

            if (rawOrd.length === 0) {
              emptyStreak++;
              pageIdx++;
              continue;
            }

            emptyStreak = 0;
            var uniq = [];
            for (var j = 0; j < rawOrd.length; j++) {
              if (!globalSeen[rawOrd[j].dedupKey]) {
                globalSeen[rawOrd[j].dedupKey] = true;
                uniq.push(rawOrd[j]);
              }
            }
            if (uniq.length > 0) {
              pagesData.push({ orders: uniq, sampleYear: null });
              allOrders = allOrders.concat(uniq);
            }

            var running3 = calcRunning();
            updateLive('Архив (' + pageIdx + ')', running3.count, running3.sum, 'Стр. ' + totalPages);

            pageIdx++;
            await new Promise(function(r) { setTimeout(r, 300); });
          }
        }
      }

      if (cancelled) { tickerRunning = false; return; }

      // 3) Определяем годы для страниц без даты
      var r3 = calcRunning();
      updateLive('Определение дат...', r3.count, r3.sum, 'Анализ заказов');

      var pageYears = [];
      var pagesNeedSample = [];

      for (var pi = 0; pi < pagesData.length; pi++) {
        var confirmedYear = null;
        var pageOrders = pagesData[pi].orders;
        for (var oi = 0; oi < pageOrders.length; oi++) {
          if (pageOrders[oi].year) {
            confirmedYear = pageOrders[oi].year;
            break;
          }
        }
        pageYears.push(confirmedYear);
        if (!confirmedYear) {
          pagesNeedSample.push(pi);
        }
      }

      // Запрашиваем детали для страниц без даты
      var sampleStep = pagesNeedSample.length <= 30 ? 1 : Math.max(1, Math.floor(pagesNeedSample.length / 30));

      for (var si = 0; si < pagesNeedSample.length && !cancelled; si += sampleStep) {
        var pi2 = pagesNeedSample[si];
        var pageData = pagesData[pi2];

        var sampleOrder = null;
        for (var oi2 = 0; oi2 < pageData.orders.length; oi2++) {
          if (pageData.orders[oi2].orderNumber) {
            sampleOrder = pageData.orders[oi2];
            break;
          }
        }
        if (!sampleOrder) continue;

        var r4 = calcRunning();
        updateLive('Определение дат...', r4.count, r4.sum, 'Заказ ' + sampleOrder.orderNumber);

        var detailUrl = '/my/orderdetails/?order=' + sampleOrder.orderNumber;
        var detailData = await fetchAPI(detailUrl);
        if (detailData) {
          var detailJson = JSON.stringify(detailData);
          var foundYear = null;

          // Ищем дату в titleWithTimer
          if (detailData.widgetStates) {
            var wKeys = Object.keys(detailData.widgetStates);
            for (var wi2 = 0; wi2 < wKeys.length; wi2++) {
              if (wKeys[wi2].indexOf('titleWithTimer') >= 0) {
                var twJson = detailData.widgetStates[wKeys[wi2]];
                var twMatch = twJson.match(/(\d{1,2})\s+([а-яё]+)\s+(\d{4})/i);
                if (twMatch) {
                  var twYear = parseInt(twMatch[3]);
                  if (twYear >= 2010 && twYear <= 2030) foundYear = twYear;
                }
                if (!foundYear) {
                  var twMatch2 = twJson.match(/от\s+(\d{1,2})\s+([а-яё]+)/i);
                  if (twMatch2) foundYear = currentYear;
                }
                break;
              }
            }
          }

          // Ищем дату в формате дд.мм.гггг
          if (!foundYear) {
            var allDates = detailJson.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/g) || [];
            if (allDates.length > 0) {
              var earliest = null;
              for (var di = 0; di < allDates.length; di++) {
                var parts = allDates[di].match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
                if (parts) {
                  var yy = parseInt(parts[3]);
                  if (yy < 2010 || yy > 2030) continue;
                  var dateObj = new Date(yy, parseInt(parts[2]) - 1, parseInt(parts[1]));
                  if (!earliest || dateObj < earliest) earliest = dateObj;
                }
              }
              if (earliest) foundYear = earliest.getFullYear();
            }
          }

          // ISO формат
          if (!foundYear) {
            var isoMatch = detailJson.match(/(\d{4})-(\d{2})-(\d{2})T/);
            if (isoMatch) {
              var yr3 = parseInt(isoMatch[1]);
              if (yr3 >= 2010 && yr3 <= 2030) foundYear = yr3;
            }
          }

          if (foundYear) {
            pageYears[pi2] = foundYear;
            pagesData[pi2].sampleYear = foundYear;
          }
        }

        await new Promise(function(r) { setTimeout(r, 300); });
      }

      if (cancelled) { tickerRunning = false; return; }

      // Интерполяция годов
      var lastKnown = currentYear;
      for (var pi3 = 0; pi3 < pagesData.length; pi3++) {
        if (pageYears[pi3]) {
          lastKnown = pageYears[pi3];
        } else {
          pageYears[pi3] = lastKnown;
        }
      }

      // Применяем годы
      for (var pi4 = 0; pi4 < pagesData.length; pi4++) {
        var pgOrders = pagesData[pi4].orders;
        for (var oi3 = 0; oi3 < pgOrders.length; oi3++) {
          if (!pgOrders[oi3].year) {
            pgOrders[oi3].year = pageYears[pi4] || currentYear;
          }
        }
      }

      // 4) Финальный подсчёт (доставленные и не отменённые)
      var delivered = allOrders.filter(function(o) { return o.isDelivered && !o.isCancelled; });
      var toCount = delivered.length > 0 ? delivered : allOrders.filter(function(o) { return !o.isCancelled; });
      var totalSpent = Math.round(toCount.reduce(function(s, o) { return s + o.price; }, 0));
      var totalItems = toCount.reduce(function(s, o) { return s + (o.itemCount || 1); }, 0);

      // --- Расширенная статистика ---
      // Отменённые заказы
      var cancelledOrders = allOrders.filter(function(o) { return o.isCancelled; });
      var cancelledCount = cancelledOrders.length;
      var cancelledSum = Math.round(cancelledOrders.reduce(function(s, o) { return s + o.price; }, 0));

      // Средний чек, мин/макс заказ
      var avgCheck = toCount.length > 0 ? Math.round(totalSpent / toCount.length) : 0;
      var maxOrder = 0;
      var minOrder = Infinity;
      for (var ei = 0; ei < toCount.length; ei++) {
        if (toCount[ei].price > maxOrder) maxOrder = toCount[ei].price;
        if (toCount[ei].price > 0 && toCount[ei].price < minOrder) minOrder = toCount[ei].price;
      }
      if (minOrder === Infinity) minOrder = 0;
      maxOrder = Math.round(maxOrder);
      minOrder = Math.round(minOrder);

      // Рекордный месяц (больше всего потрачено)
      var monthlySpending = {};
      var monthlyOrders = {};
      for (var mi2 = 0; mi2 < toCount.length; mi2++) {
        var mKey = (toCount[mi2].year || 0) + '-' + (toCount[mi2].month || 0);
        if (!toCount[mi2].year || !toCount[mi2].month) continue;
        if (!monthlySpending[mKey]) { monthlySpending[mKey] = 0; monthlyOrders[mKey] = 0; }
        monthlySpending[mKey] += toCount[mi2].price;
        monthlyOrders[mKey]++;
      }
      var recordMonth = '';
      var recordMonthSpent = 0;
      var recordMonthOrders = 0;
      var mKeys2 = Object.keys(monthlySpending);
      for (var mk2 = 0; mk2 < mKeys2.length; mk2++) {
        if (monthlySpending[mKeys2[mk2]] > recordMonthSpent) {
          recordMonthSpent = Math.round(monthlySpending[mKeys2[mk2]]);
          recordMonthOrders = monthlyOrders[mKeys2[mk2]];
          recordMonth = mKeys2[mk2];
        }
      }
      var recordMonthLabel = '';
      if (recordMonth) {
        var rmParts = recordMonth.split('-');
        var MONTH_NAMES = ['', 'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
        recordMonthLabel = (MONTH_NAMES[parseInt(rmParts[1])] || '') + ' ' + rmParts[0];
      }

      // Рекордный шоппинг-день (больше всего заказов в один день)
      var dailyOrders = {};
      var dailyItems = {};
      for (var di2 = 0; di2 < toCount.length; di2++) {
        var dKey = toCount[di2].orderDate;
        if (!dKey) continue;
        if (!dailyOrders[dKey]) { dailyOrders[dKey] = 0; dailyItems[dKey] = 0; }
        dailyOrders[dKey]++;
        dailyItems[dKey] += toCount[di2].itemCount || 1;
      }
      var recordDay = '';
      var recordDayOrders = 0;
      var recordDayItems = 0;
      var dKeys = Object.keys(dailyOrders);
      for (var dk2 = 0; dk2 < dKeys.length; dk2++) {
        if (dailyOrders[dKeys[dk2]] > recordDayOrders) {
          recordDayOrders = dailyOrders[dKeys[dk2]];
          recordDayItems = dailyItems[dKeys[dk2]];
          recordDay = dKeys[dk2];
        }
      }
      var recordDayLabel = '';
      if (recordDay) {
        var rdParts = recordDay.split('-');
        var MONTH_SHORT = ['', 'янв.', 'фев.', 'мар.', 'апр.', 'мая', 'июн.', 'июл.', 'авг.', 'сен.', 'окт.', 'ноя.', 'дек.'];
        recordDayLabel = parseInt(rdParts[2]) + ' ' + (MONTH_SHORT[parseInt(rdParts[1])] || '') + ' ' + rdParts[0].slice(2);
      }

      // Подсчёт по годам
      var yearlySpending = {};
      var yearlyOrders = {};
      for (var yi = 0; yi < toCount.length; yi++) {
        var yr = toCount[yi].year || 0;
        if (!yearlySpending[yr]) { yearlySpending[yr] = 0; yearlyOrders[yr] = 0; }
        yearlySpending[yr] += toCount[yi].price;
        yearlyOrders[yr] += 1;
      }
      var yrKeys = Object.keys(yearlySpending);
      for (var yk = 0; yk < yrKeys.length; yk++) {
        yearlySpending[yrKeys[yk]] = Math.round(yearlySpending[yrKeys[yk]]);
      }

      // Останавливаем тикер
      tickerRunning = false;

      // Сохраняем результат в localStorage
      var statsData = {
        totalSpent: totalSpent,
        totalItems: totalItems,
        totalPages: totalPages,
        orderCount: toCount.length,
        yearlySpending: yearlySpending,
        yearlyOrders: yearlyOrders,
        cancelledCount: cancelledCount,
        cancelledSum: cancelledSum,
        avgCheck: avgCheck,
        maxOrder: maxOrder,
        minOrder: minOrder,
        recordMonthLabel: recordMonthLabel,
        recordMonthSpent: recordMonthSpent,
        recordMonthOrders: recordMonthOrders,
        recordDayLabel: recordDayLabel,
        recordDayOrders: recordDayOrders,
        recordDayItems: recordDayItems,
        lastUpdated: new Date().toISOString(),
      };
      try {
        localStorage.setItem('ozon_stats_cache', JSON.stringify(statsData));
      } catch(e) {}

      // Показываем результат с анимацией
      renderStatsResult(statsData, false);

    } catch (err) {
      tickerRunning = false;
      console.error('[Ozon Stats] Ошибка статистики:', err);
      body.innerHTML =
        '<div class="osp-loading">' +
          '<div style="color: #ef4444;">❌ Ошибка</div>' +
          '<div style="font-size: 12px; margin-top: 8px;">' + err.message + '</div>' +
          '<button class="osp-btn" id="back-to-main" style="margin-top: 16px;">← Назад</button>' +
        '</div>';
      document.getElementById('back-to-main').addEventListener('click', loadData);
    }
  }

  window.__ozonStats.loadFullStats = loadFullStats;
})();
