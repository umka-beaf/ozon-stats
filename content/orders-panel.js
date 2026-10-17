// ==============================
// Ozon Stats — content/orders-panel.js
// Загрузка и отрисовка основного экрана панели: профиль, баланс, баллы,
// переключатель темы и карточки активных заказов. А также рендер экрана
// "Статистика за всё время" (сама сборка статистики — в full-stats.js).
// ==============================
(function() {
  if (!window.__ozonStats || !window.__ozonStats.currentInjectionOk) return;

  const { formatMoney, parseRuDeadline, groupOrdersByNumber } = window.__ozonStats;

  function statusClass(status) {
    const s = (status || '').toLowerCase();
    if (s.indexOf('забир') >= 0 || s.indexOf('готов') >= 0 || s.indexOf('ожидает') >= 0) return 'ready';
    if (s.indexOf('пути') >= 0 || s.indexOf('едет') >= 0 || s.indexOf('доставля') >= 0) return 'transit';
    if (s.indexOf('собир') >= 0 || s.indexOf('формир') >= 0 || s.indexOf('принят') >= 0) return 'pending';
    return 'service';
  }

  // Значок способа получения по тексту адреса (постамат / курьер / ПВЗ)
  function pickupIcon(text) {
    const t = (text || '').toLowerCase();
    if (t.indexOf('постамат') >= 0) return '📮';
    if (t.indexOf('курьер') >= 0) return '🚚';
    return '📍';
  }

  // Многоуровневая сортировка активных заказов:
  // 1) дата заказа (от старых к новым), 2) дата хранения/выдачи,
  // 3) цена (по убыванию), 4) название товара.
  function sortOrdersMultiLevel(list) {
    function dateVal(str) {
      if (!str) return Infinity;
      const d = parseRuDeadline(str);
      return d ? d.getTime() : Infinity;
    }
    return list.slice().sort(function(a, b) {
      const ad = dateVal(a.orderDate), bd = dateVal(b.orderDate);
      if (ad !== bd) return ad - bd;
      const ap = dateVal(a.planDate), bp = dateVal(b.planDate);
      if (ap !== bp) return ap - bp;
      if (a.price !== b.price) return b.price - a.price;
      return (a.title || '').localeCompare(b.title || '', 'ru');
    });
  }

  // Загрузка данных
  async function loadData() {
    window.__ozonStats.log('[Ozon Stats] Начинаем загрузку данных...');

    try {
      async function fetchAPI(pageUrl) {
        const endpoints = [
          '/api/composer-api.bx/page/json/v2',
          '/api/entrypoint-api.bx/page/json/v2',
        ];

        for (let endpoint of endpoints) {
          try {
            const url = endpoint + '?url=' + encodeURIComponent(pageUrl);
            const resp = await fetch(url, {
              credentials: 'include',
              headers: { 'Accept': 'application/json' },
            });
            if (resp.ok) {
              const data = await resp.json();
              return data;
            }
          } catch (e) {
            window.__ozonStats.log('[Ozon Stats] Ошибка endpoint:', e);
          }
        }
        return null;
      }

      // Загружаем профиль
      const mainData = await fetchAPI('/my/main');

      let name = '';
      let email = '';
      let avatar = '';
      let balance = 0;
      let points = 0;
      let regDate = '';
      let orders = [];

      if (mainData && mainData.widgetStates) {
        const wKeys = Object.keys(mainData.widgetStates);

        for (let i = 0; i < wKeys.length; i++) {
          const wKey = wKeys[i];
          try {
            const wRaw = mainData.widgetStates[wKey];
            const wVal = typeof wRaw === 'string' ? JSON.parse(wRaw) : wRaw;
            const wStr = typeof wRaw === 'string' ? wRaw : JSON.stringify(wRaw);

            // Аватар и имя из userAvatar
            if (wKey.indexOf('userAvatar') >= 0) {
              window.__ozonStats.log('[Ozon Stats] userAvatar найден:', wKey);
              if (wVal.avatar && wVal.avatar.icon && wVal.avatar.icon.image && !avatar) {
                avatar = wVal.avatar.icon.image;
                window.__ozonStats.log('[Ozon Stats] Аватар:', avatar);
              }
              if ((wVal.firstName || wVal.secondName) && !name) {
                name = ((wVal.firstName || '') + ' ' + (wVal.secondName || '')).trim();
                window.__ozonStats.log('[Ozon Stats] Имя:', name);
              }
            }

            // Email
            if (wVal.email && !email) {
              email = wVal.email;
            }

            // Баланс из actionCards
            if (wKey.indexOf('actionCards') >= 0) {
              window.__ozonStats.log('[Ozon Stats] actionCards найден:', wKey);

              // Проверяем cards массив
              if (wVal.cards && Array.isArray(wVal.cards)) {
                for (let c = 0; c < wVal.cards.length; c++) {
                  const card = wVal.cards[c];
                  const title = (card.title && card.title.text) ? card.title.text.toLowerCase() : '';

                  if (title.indexOf('ozon') >= 0 && title.indexOf('карта') >= 0) {
                    if (card.subtitle && card.subtitle.text) {
                      const match = card.subtitle.text.match(/([\d\s\u00a0]+)/);
                      if (match) {
                        balance = parseInt(match[1].replace(/[\s\u00a0]/g, '')) || 0;
                        window.__ozonStats.log('[Ozon Stats] Баланс:', balance);
                      }
                    }
                  }
                }
              }

              // Проверяем items массив
              if (wVal.items && Array.isArray(wVal.items)) {
                for (let c = 0; c < wVal.items.length; c++) {
                  const item = wVal.items[c];
                  const title = (item.title || '').toLowerCase();

                  if (title.indexOf('ozon') >= 0 && title.indexOf('карта') >= 0) {
                    if (item.subtitle) {
                      const match = item.subtitle.match(/([\d\s\u00a0]+)/);
                      if (match) {
                        balance = parseInt(match[1].replace(/[\s\u00a0]/g, '')) || 0;
                      }
                    }
                  }
                }
              }
            }

            // Баллы из menu (через sections.items)
            if (wKey.toLowerCase().indexOf('menu') >= 0) {
              window.__ozonStats.log('[Ozon Stats] Menu виджет:', wKey);

              // Способ 1: sections[].items[]
              if (wVal.sections && Array.isArray(wVal.sections)) {
                for (let si = 0; si < wVal.sections.length; si++) {
                  const section = wVal.sections[si];
                  if (section.items && Array.isArray(section.items)) {
                    for (let ii = 0; ii < section.items.length; ii++) {
                      const item = section.items[ii];
                      const itemTitle = (item.title || '').toLowerCase();
                      if (itemTitle.indexOf('балл') >= 0 && item.notification) {
                        if (item.notification.text && item.notification.text.text) {
                          const pMatch = item.notification.text.text.match(/([\d\s\u00a0]+)/);
                          if (pMatch) {
                            points = parseInt(pMatch[1].replace(/[\s\u00a0]/g, '')) || 0;
                            window.__ozonStats.log('[Ozon Stats] Баллы из sections:', points);
                          }
                        }
                      }
                    }
                  }
                }
              }

              // Способ 2: items[] напрямую
              if (!points && wVal.items && Array.isArray(wVal.items)) {
                for (let m = 0; m < wVal.items.length; m++) {
                  const mi = wVal.items[m];
                  const mt = (mi.title || '').toLowerCase();
                  if (mt.indexOf('балл') >= 0 && mi.notification && mi.notification.text && mi.notification.text.text) {
                    const pMatch = mi.notification.text.text.match(/([\d\s\u00a0]+)/);
                    if (pMatch) {
                      points = parseInt(pMatch[1].replace(/[\s\u00a0]/g, '')) || 0;
                      window.__ozonStats.log('[Ozon Stats] Баллы из items:', points);
                    }
                  }
                }
              }

              // Способ 3: regex fallback в JSON строке
              if (!points && wStr.indexOf('Баллы') >= 0) {
                const bMatch = wStr.match(/"title"\s*:\s*"[^"]*[Бб]алл[^"]*"[^}]*?"notification"\s*:\s*\{[^}]*?"text"\s*:\s*\{[^}]*?"text"\s*:\s*"([\d\s\u00a0]+)"/);
                if (bMatch) {
                  points = parseInt(bMatch[1].replace(/[\s\u00a0]/g, '')) || 0;
                  window.__ozonStats.log('[Ozon Stats] Баллы из regex:', points);
                }
              }
            }

            // Дата регистрации — ищем во ВСЕХ виджетах главной страницы
            if (!regDate) {
              // profileLogo — часто содержит "На Ozon с ..."
              if (wKey.indexOf('profileLogo') >= 0) {
                try {
                  if (wVal.iconHeader && wVal.iconHeader.subtitle && wVal.iconHeader.subtitle.text && !name) {
                    name = wVal.iconHeader.subtitle.text;
                  }
                  // Ищем дату в iconHeader
                  if (wVal.iconHeader && wVal.iconHeader.title && wVal.iconHeader.title.text) {
                    const titleText = wVal.iconHeader.title.text;
                    const rm = titleText.match(/(?:с|since)\s+(\d{1,2}\s+[а-яё]+\s+\d{4}|\d{4})/i);
                    if (rm) { regDate = rm[1]; window.__ozonStats.log('[Ozon Stats] Дата из profileLogo title:', regDate); }
                  }
                } catch (e) {}
              }
              // Поиск в JSON любого виджета
              if (wStr.indexOf('Ozon') >= 0 || wStr.indexOf('озон') >= 0 || wStr.indexOf('ozon') >= 0) {
                // "На Ozon с 2019 года" или "На Ozon с 15 марта 2019"
                const rm1 = wStr.match(/[Нн]а\s*(?:Ozon|озон|OZON)\s*с\s*(\d{1,2}\s+[а-яё]+\s+\d{4})/i);
                if (rm1) { regDate = rm1[1]; window.__ozonStats.log('[Ozon Stats] Дата из виджета (формат 1):', regDate); }
                if (!regDate) {
                  const rm2 = wStr.match(/[Нн]а\s*(?:Ozon|озон|OZON)\s*с\s*(\d{4})\s*(?:года|г\.?)?/i);
                  if (rm2) { regDate = rm2[1] + ' г.'; window.__ozonStats.log('[Ozon Stats] Дата из виджета (год):', regDate); }
                }
                if (!regDate) {
                  const rm3 = wStr.match(/(?:регистрац|зарегистр)[^"]*?(\d{1,2}[\.\-\/]\d{1,2}[\.\-\/]\d{4})/i);
                  if (rm3) { regDate = rm3[1]; window.__ozonStats.log('[Ozon Stats] Дата из виджета (дд.мм.гггг):', regDate); }
                }
              }
            }
          } catch (e) {
            window.__ozonStats.log('[Ozon Stats] Ошибка парсинга виджета:', e);
          }
        }
      }

      // Баллы через отдельный запрос если не нашли
      if (!points) {
        window.__ozonStats.log('[Ozon Stats] Баллы не найдены, пробуем /my/bonus...');
        try {
          const bonusData = await fetchAPI('/my/bonus');
          if (bonusData && bonusData.widgetStates) {
            const bStr = JSON.stringify(bonusData.widgetStates);
            const bMatch = bStr.match(/(\d[\d\s\u00a0]*)\s*(?:балл|бонус)/i);
            if (bMatch) {
              points = parseInt(bMatch[1].replace(/[\s\u00a0]/g, '')) || 0;
              window.__ozonStats.log('[Ozon Stats] Баллы из /my/bonus:', points);
            }
          }
        } catch (e) {}
      }

      // Дата регистрации
      window.__ozonStats.log('[Ozon Stats] Ищем дату регистрации...');
      const regUrls = ['/my/main', '/my/profile'];
      for (let ru = 0; ru < regUrls.length && !regDate; ru++) {
        try {
          const regData = ru === 0 ? mainData : await fetchAPI(regUrls[ru]);
          if (!regData) continue;

          // Способ 1: userInfo.user.registrationDate
          try {
            const rd = regData.userInfo && regData.userInfo.user && regData.userInfo.user.registrationDate;
            if (rd) {
              const d = new Date(rd);
              if (!isNaN(d.getTime()) && d.getFullYear() >= 2000) {
                regDate = d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
                window.__ozonStats.log('[Ozon Stats] Дата из userInfo:', regDate);
              }
            }
          } catch (e) {}

          // Способ 2: regex в JSON
          if (!regDate) {
            const text = JSON.stringify(regData);
            const isoReg = text.match(/registrationDate[":\s]+(\d{4})-(\d{2})-(\d{2})/);
            if (isoReg) {
              const d2 = new Date(parseInt(isoReg[1]), parseInt(isoReg[2]) - 1, parseInt(isoReg[3]));
              if (!isNaN(d2.getTime())) {
                regDate = d2.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
                window.__ozonStats.log('[Ozon Stats] Дата из ISO regex:', regDate);
              }
            }

            // Способ 3: текстовые паттерны
            if (!regDate) {
              const patterns = [
                /на\s+Ozon\s+с\s+(\d{1,2}\s+\S+\s+\d{4})/i,
                /с\s+нами\s+с\s+(\d{1,2}\s+\S+\s+\d{4})/i,
                /зарегистрирован\S*\s+(\d{1,2}\s+\S+\s+\d{4})/i,
              ];
              for (const pat of patterns) {
                const m = text.match(pat);
                if (m) { regDate = m[1]; window.__ozonStats.log('[Ozon Stats] Дата из паттерна:', regDate); break; }
              }
            }
          }
        } catch (e) {
          window.__ozonStats.log('[Ozon Stats] Ошибка загрузки даты:', e);
        }
      }

      // Загружаем заказы
      window.__ozonStats.log('[Ozon Stats] Загружаем заказы...');
      const ordersData = await fetchAPI('/my/orderlist');

      // Сначала собираем базовую информацию о заказах
      let ordersBasic = [];

      if (ordersData && ordersData.widgetStates) {
        const oKeys = Object.keys(ordersData.widgetStates);

        for (let k = 0; k < oKeys.length; k++) {
          const oKey = oKeys[k];
          if (oKey.toLowerCase().indexOf('orderlist') < 0) continue;

          try {
            const oRaw = ordersData.widgetStates[oKey];
            const oVal = typeof oRaw === 'string' ? JSON.parse(oRaw) : oRaw;

            // Ищем заказы в ordersV2
            const shipments = oVal.ordersV2 || oVal.orders || [];

            for (let s = 0; s < shipments.length && ordersBasic.length < 10; s++) {
              const shipment = shipments[s];
              if (!shipment || !shipment.leftBlock) continue;

              // Статус
              const ti = shipment.leftBlock.textIcon || {};
              const statusText = (ti.text && ti.text.text) || '';

              // Пропускаем завершённые
              const stLow = statusText.toLowerCase();
              if (stLow.indexOf('доставлен') >= 0 || stLow.indexOf('получен') >= 0 ||
                  stLow.indexOf('выдан') >= 0 || stLow.indexOf('отмен') >= 0 ||
                  stLow.indexOf('возвр') >= 0 || stLow.indexOf('завершен') >= 0) {
                continue;
              }

              // Номер заказа. automatizationId раньше давал orderListTile_XXXX, но Ozon
              // убрал это поле (теперь там статичное "tileStatus") — используем ссылку
              // на заказ у шеврона, она переживает такие перестановки надёжнее.
              const common = ti.common || {};
              const autoId = (common.testInfo && common.testInfo.automatizationId) || '';
              let orderNum = autoId.indexOf('orderListTile_') === 0 ? autoId.replace('orderListTile_', '') : '';

              if (!orderNum) {
                const chevronLink = (common.action && common.action.link) || '';
                const m = chevronLink.match(/[?&]order(?:Number)?=([^&]+)/);
                if (m) orderNum = decodeURIComponent(m[1]);
              }

              // Товары
              const rb = shipment.rightBlock || {};
              let products = [];

              if (rb.products && rb.products.products) {
                products = rb.products.products;
              } else if (rb.products && Array.isArray(rb.products)) {
                products = rb.products;
              } else if (rb.items) {
                products = rb.items;
              } else if (rb.cells) {
                products = rb.cells;
              }

              // Ещё один фолбэк — та же ссылка, но с картинки товара, на случай
              // если у шеврона её не будет: /my/orderdetails/?orderNumber=XXXX&postingId=YYYY
              if (!orderNum) {
                for (let lp = 0; lp < products.length; lp++) {
                  const link = products[lp] && products[lp].image && products[lp].image.productMedia &&
                      products[lp].image.productMedia.common && products[lp].image.productMedia.common.action &&
                      products[lp].image.productMedia.common.action.link;
                  if (link) {
                    const m = link.match(/[?&]order(?:Number)?=([^&]+)/);
                    if (m) { orderNum = decodeURIComponent(m[1]); break; }
                  }
                }
              }

              let allProducts = [];

              for (let p = 0; p < products.length; p++) {
                const prod = products[p];

                // Цена
                let prodPrice = 0;
                const priceArr = (prod.price && prod.price.price) || [];
                if (priceArr.length > 0) {
                  const priceText = priceArr[0].text || '';
                  prodPrice = parseInt(String(priceText).replace(/\D/g, '')) || 0;
                }

                // Изображение - проверяем разные пути
                let prodImage = null;
                if (prod.image && prod.image.productMedia && prod.image.productMedia.image &&
                    prod.image.productMedia.image.url) {
                  prodImage = prod.image.productMedia.image.url;
                } else if (prod.image && prod.image.image) {
                  prodImage = prod.image.image;
                } else if (prod.image && typeof prod.image === 'string') {
                  prodImage = prod.image;
                } else if (prod.images && prod.images[0]) {
                  prodImage = prod.images[0].image || prod.images[0];
                } else if (prod.tileImage && prod.tileImage.image) {
                  prodImage = prod.tileImage.image;
                }

                // Название
                let prodTitle = null;
                if (prod.title && typeof prod.title === 'string') {
                  prodTitle = prod.title;
                } else if (prod.title && prod.title.text) {
                  prodTitle = prod.title.text;
                } else if (prod.name) {
                  prodTitle = typeof prod.name === 'string' ? prod.name : (prod.name.text || null);
                } else if (prod.text) {
                  prodTitle = prod.text;
                }

                // Плановая дата (например «Хранится до 12 сентября» / «Ожидаем 20 августа»)
                const prodCaption = (prod.caption && prod.caption.text) || null;

                allProducts.push({
                  title: prodTitle || 'Товар',
                  image: prodImage,
                  price: prodPrice,
                  planDate: prodCaption
                });
              }

              // Плановая дата доставки/выдачи — из подписи товара, иначе из подписи
              // тайла (например «Сегодня с 09:00 до 21:00»)
              const shipmentPlanDate = (allProducts[0] && allProducts[0].planDate) ||
                  (shipment.leftBlock.subtitle && shipment.leftBlock.subtitle.text) || null;

              // Адрес ПВЗ / способ получения (если Ozon его отдаёт в заголовке тайла)
              const pickupPoint = (shipment.leftBlock.title && shipment.leftBlock.title.text) || null;

              ordersBasic.push({
                orderNumber: orderNum,
                status: statusText || 'В обработке',
                price: allProducts.reduce((s, p) => s + p.price, 0),
                image: (allProducts[0] && allProducts[0].image) || null,
                title: (allProducts[0] && allProducts[0].title) || 'Товар',
                products: allProducts,
                planDate: shipmentPlanDate,
                pickupPoint: pickupPoint,
                orderDate: null,
              });
            }
          } catch (e) {
            window.__ozonStats.log('[Ozon Stats] Ошибка парсинга заказов:', e);
          }
        }
      }

      window.__ozonStats.log('[Ozon Stats] Базовых заказов:', ordersBasic.length);

      // Загружаем детали каждого заказа для обновления картинок и названий
      for (let i = 0; i < ordersBasic.length; i++) {
        const order = ordersBasic[i];
        if (!order.orderNumber) continue;

        try {
          const detailsData = await fetchAPI('/my/orderdetails/?order=' + order.orderNumber);

          if (detailsData && detailsData.widgetStates) {
            const detailKeys = Object.keys(detailsData.widgetStates);
            let updatedProducts = [];

            // Дата оформления заказа — виджет titleWithTimer, текст вида «Заказ от 28 августа»
            for (let wk = 0; wk < detailKeys.length; wk++) {
              const wKey = detailKeys[wk];
              if (wKey.toLowerCase().indexOf('titlewithtimer') < 0) continue;
              let wRaw = detailsData.widgetStates[wKey];
              try { wRaw = typeof wRaw === 'string' ? JSON.parse(wRaw) : wRaw; } catch (e) { continue; }
              const titleText = (wRaw.title && wRaw.title.text) || '';
              const m = titleText.match(/Заказ\s+от\s+(.+)/i);
              if (m) order.orderDate = m[1].trim();
              break;
            }

            for (let dk = 0; dk < detailKeys.length; dk++) {
              const dKey = detailKeys[dk];
              if (dKey.toLowerCase().indexOf('shipmentwidget') < 0) continue;

              const dRaw = detailsData.widgetStates[dKey];
              let dVal;
              try { dVal = typeof dRaw === 'string' ? JSON.parse(dRaw) : dRaw; } catch(e) { continue; }

              // Извлекаем товары из разных структур
              let items = [];

              // Вариант 1: sellers[].products[]
              if (dVal.sellers && Array.isArray(dVal.sellers)) {
                for (let si = 0; si < dVal.sellers.length; si++) {
                  const seller = dVal.sellers[si];
                  if (seller.products && Array.isArray(seller.products)) {
                    items = items.concat(seller.products);
                  }
                }
              }

              // Вариант 2: items/products/cells напрямую
              if (items.length === 0) {
                const directItems = dVal.items || dVal.products || dVal.cells || dVal.goods || [];
                if (Array.isArray(directItems)) {
                  for (let di = 0; di < directItems.length; di++) {
                    const directItem = directItems[di];
                    if (directItem.sellers && Array.isArray(directItem.sellers)) {
                      for (let dsi = 0; dsi < directItem.sellers.length; dsi++) {
                        if (directItem.sellers[dsi].products) {
                          items = items.concat(directItem.sellers[dsi].products);
                        }
                      }
                    } else if (directItem.picture || directItem.productMedia || directItem.title) {
                      items.push(directItem);
                    }
                  }
                }
              }

              for (let ii = 0; ii < items.length; ii++) {
                const item = items[ii];

                // Картинка
                let itemImage = null;
                if (item.picture && item.picture.image && item.picture.image.image) {
                  itemImage = item.picture.image.image;
                } else if (item.productMedia && item.productMedia.image && item.productMedia.image[0] && item.productMedia.image[0].url) {
                  itemImage = item.productMedia.image[0].url;
                } else if (item.pictureV2 && item.pictureV2.image && item.pictureV2.image.image) {
                  itemImage = item.pictureV2.image.image;
                } else if (item.image && item.image.image) {
                  itemImage = item.image.image;
                }

                // Название
                let itemTitle = null;
                if (item.title && item.title.name && item.title.name.text) {
                  itemTitle = item.title.name.text;
                } else if (item.title && item.title.text) {
                  itemTitle = item.title.text;
                } else if (item.title && typeof item.title === 'string') {
                  itemTitle = item.title;
                } else if (item.name && item.name.text) {
                  itemTitle = item.name.text;
                }

                // Цена
                let itemPrice = 0;
                if (item.price && item.price.price && item.price.price[0]) {
                  itemPrice = parseInt(String(item.price.price[0].text).replace(/\D/g, '')) || 0;
                } else if (item.finalPrice) {
                  itemPrice = parseInt(String(item.finalPrice).replace(/\D/g, '')) || 0;
                }

                updatedProducts.push({ title: itemTitle || 'Товар', image: itemImage, price: itemPrice });
              }
            }

            // Сопоставляем по цене — обновляем картинки и названия
            if (updatedProducts.length > 0) {
              const originalProducts = order.products || [];
              for (let op = 0; op < originalProducts.length; op++) {
                const origProd = originalProducts[op];
                for (let up = 0; up < updatedProducts.length; up++) {
                  if (updatedProducts[up].price === origProd.price && updatedProducts[up].image && !updatedProducts[up]._used) {
                    origProd.image = updatedProducts[up].image;
                    if (updatedProducts[up].title && updatedProducts[up].title !== 'Товар') {
                      origProd.title = updatedProducts[up].title;
                    }
                    updatedProducts[up]._used = true;
                    break;
                  }
                }
              }
              // Обновляем основную картинку/название заказа
              if (!order.image && originalProducts[0] && originalProducts[0].image) {
                order.image = originalProducts[0].image;
              }
              if (originalProducts[0] && originalProducts[0].title !== 'Товар') {
                order.title = originalProducts[0].title;
              }
            }
          }
        } catch (e) {
          window.__ozonStats.log('[Ozon Stats] Ошибка загрузки деталей:', e);
        }
      }

      // Разбиваем заказы на отдельные товары
      orders = [];
      for (let so = 0; so < ordersBasic.length; so++) {
        const orderItem = ordersBasic[so];
        const prods = orderItem.products || [];

        if (prods.length > 0) {
          for (let sp = 0; sp < prods.length; sp++) {
            orders.push({
              orderNumber: orderItem.orderNumber,
              status: orderItem.status,
              price: prods[sp].price || 0,
              image: prods[sp].image || orderItem.image,
              title: prods[sp].title || 'Товар',
              orderDate: orderItem.orderDate,
              planDate: prods[sp].planDate || orderItem.planDate,
              pickupPoint: orderItem.pickupPoint,
            });
          }
        } else {
          orders.push(orderItem);
        }
      }

      window.__ozonStats.log('[Ozon Stats] Итого товаров:', orders.length);

      // Если имя не найдено
      if (!name) name = 'Пользователь';

      // Кэшируем — чтобы при следующем открытии панели показать данные
      // мгновенно, пока идёт свежая загрузка (см. renderCachedPreview).
      try {
        chrome.storage.local.set({ ospCache: { name, email, avatar, balance, points, regDate, orders, ts: Date.now() } });
      } catch (e) {}

      checkOrderNotifications(orders);

      renderOrdersScreen(name, email, avatar, regDate, balance, points, orders);
    } catch (err) {
      console.error('[Ozon Stats] Ошибка:', err);
      document.getElementById('osp-body').innerHTML =
        '<div class="osp-loading">' +
          '<div style="color: #ef4444; font-size: 32px; margin-bottom: 12px;">❌</div>' +
          '<div style="font-weight: 600; margin-bottom: 8px;">Ошибка загрузки</div>' +
          '<div style="font-size: 12px; margin-bottom: 16px;">' + err.message + '</div>' +
          '<button class="osp-btn" onclick="location.reload()">🔄 Обновить страницу</button>' +
        '</div>';
    }
  }

  // Экран профиля и активных заказов — вынесено в отдельную функцию, чтобы
  // мгновенно показать закэшированные данные (см. renderCachedPreview), пока
  // идёт свежая загрузка через loadData().
  function renderOrdersScreen(name, email, avatar, regDate, balance, points, orders) {
      // Рендерим
      const body = document.getElementById('osp-body');

      const prevDetails = document.getElementById('osp-profile-details');
      const wasOpen = prevDetails ? prevDetails.open : false;

      body.innerHTML = `
        <details class="osp-profile-details" id="osp-profile-details"${wasOpen ? ' open' : ''}>
          <summary class="osp-profile-summary">
            <span>👤 ${name}</span>
            <span class="osp-summary-arrow">▾</span>
          </summary>
          <div class="osp-profile-body">
            <div class="osp-profile">
              <div class="osp-profile-row">
                <div class="osp-avatar">
                  ${avatar ? '<img src="' + avatar + '" alt="">' : '👤'}
                </div>
                <div class="osp-user-info">
                  <div class="osp-name">${name}</div>
                  ${email ? '<div class="osp-email">' + email + '</div>' : ''}
                  ${regDate ? '<div class="osp-email">📅 На Ozon с ' + regDate + '</div>' : ''}
                </div>
              </div>
            </div>

            <div class="osp-cards">
              <div class="osp-card">
                <div class="osp-card-label">💳 Ozon Карта</div>
                <div class="osp-card-value blue">${formatMoney(balance)}</div>
              </div>
              <div class="osp-card">
                <div class="osp-card-label">🎁 Баллы</div>
                <div class="osp-card-value green">${points.toLocaleString('ru-RU')}</div>
              </div>
              <div class="osp-card osp-card-toggle" id="osp-dark-toggle">
                <div class="osp-card-label">🌙 Тема</div>
                <div class="osp-dark-switch${document.documentElement.classList.contains('darkreader') ? ' active' : ''}" id="osp-dark-switch"></div>
              </div>
            </div>
          </div>
        </details>

        <div class="osp-section-title">
          <span>📦 Активные заказы</span>
          <div class="osp-section-meta">
            <span class="osp-sum">${formatMoney(orders.reduce((s, o) => s + (o.price || 0), 0))}</span>
            <span class="osp-badge">${orders.length}</span>
          </div>
        </div>
        ${(function() {
          const labels = { ready: 'готово', transit: 'в пути', pending: 'собирается', service: 'в обработке' };
          const counts = {};
          for (const o of orders) {
            const c = statusClass(o.status);
            counts[c] = (counts[c] || 0) + 1;
          }
          const parts = Object.keys(counts)
              .filter(c => labels[c])
              .map(c => counts[c] + ' ' + labels[c]);
          return parts.length > 1 ? '<div class="osp-orders-breakdown">' + parts.join(' · ') + '</div>' : '';
        })()}

        <div class="osp-orders">
          ${orders.length === 0 ?
            '<div class="osp-empty"><div class="osp-empty-icon">📭</div><div>Нет активных заказов</div></div>' :
            groupOrdersByNumber(sortOrdersMultiLevel(orders)).map(function(group) {
              // Адрес ПВЗ и номер заказа — свойства всего заказа, а не отдельного
              // товара, поэтому показываем их один раз в заголовке группы.
              const pickupHtml = group.pickupPoint ?
                  '<div class="osp-order-group-pickup">' + pickupIcon(group.pickupPoint) + ' ' + group.pickupPoint + '</div>' : '';
              const copyHtml = group.orderNumber ?
                  '<button class="osp-copy-btn" data-copy-number="' + group.orderNumber + '" title="Скопировать номер заказа">📋</button>' : '';
              // Если товаров в заказе несколько — их сумма нигде больше не
              // показана, добавляем её тем же цветом/стилем, что и цена товара.
              const totalHtml = group.items.length > 1 ?
                  '<div class="osp-order-price">' + formatMoney(group.items.reduce((s, o) => s + (o.price || 0), 0)) + '</div>' : '';
              const groupHeader = (group.orderDate || pickupHtml) ?
                  '<div class="osp-order-group-header">' +
                    '<div class="osp-order-group-header-text">' +
                      (group.orderDate ? '📅 Заказ от ' + group.orderDate : '') +
                      pickupHtml +
                    '</div>' +
                    '<div class="osp-order-group-header-side">' +
                      totalHtml +
                      copyHtml +
                    '</div>' +
                  '</div>' : '';

              const itemsHtml = group.items.map(function(o) {
                let planDateHtml = '';
                if (o.planDate) {
                  const deadline = parseRuDeadline(o.planDate);
                  let cls = 'osp-order-date-row';
                  if (deadline) {
                    const daysLeft = Math.ceil((deadline - Date.now()) / 86400000);
                    if (daysLeft <= 1) cls += ' osp-date-urgent';
                    else if (daysLeft <= 3) cls += ' osp-date-soon';
                  }
                  planDateHtml = '<div class="osp-order-dates"><div class="' + cls + '">🚚 ' + o.planDate + '</div></div>';
                }

                return '<div class="osp-order" data-order-number="' + (o.orderNumber || '') + '">' +
                  '<div class="osp-order-info">' +
                    '<div class="osp-order-title">' + o.title + '</div>' +
                    '<span class="osp-order-status ' + statusClass(o.status) + '">' + o.status + '</span>' +
                    planDateHtml +
                  '</div>' +
                  '<div class="osp-order-side">' +
                    '<div class="osp-order-price">' + formatMoney(o.price) + '</div>' +
                    '<div class="osp-order-img">' +
                      (o.image ? '<img src="' + o.image + '" alt="">' : '📦') +
                    '</div>' +
                  '</div>' +
                '</div>';
              }).join('');

              return '<div class="osp-order-group">' + groupHeader + itemsHtml + '</div>';
            }).join('')
          }
        </div>

        <button class="osp-btn" id="osp-refresh">
          <span>🔄</span>
          <span>Обновить данные</span>
        </button>

        <button class="osp-btn green" id="osp-stats">
          <span>📊</span>
          <span>Статистика за всё время</span>
        </button>
      `;

      // Кнопка обновления
      document.getElementById('osp-refresh').addEventListener('click', function() {
        document.getElementById('osp-body').innerHTML =
          '<div class="osp-loading">' +
            '<div class="osp-spinner"></div>' +
            '<div>Загрузка данных...</div>' +
          '</div>';
        loadData();
      });

      // Клик по карточке заказа — открываем страницу заказа на Ozon в новой вкладке
      document.querySelectorAll('.osp-order[data-order-number]').forEach(function(card) {
        const num = card.getAttribute('data-order-number');
        if (!num) return;
        card.addEventListener('click', function() {
          window.open('https://www.ozon.ru/my/orderdetails/?order=' + encodeURIComponent(num), '_blank');
        });
      });

      // Копирование номера заказа по клику на значок (не открывая карточку)
      document.querySelectorAll('.osp-copy-btn').forEach(function(btn) {
        btn.addEventListener('click', function(e) {
          e.stopPropagation();
          const num = btn.getAttribute('data-copy-number');
          if (!num) return;
          navigator.clipboard.writeText(num).then(function() {
            const original = btn.textContent;
            btn.textContent = '✅';
            setTimeout(function() { btn.textContent = original; }, 1200);
          });
        });
      });

      // Бейдж на иконке расширения — число активных заказов (по числу карточек, а не товаров)
      chrome.runtime.sendMessage({
        type: 'osp-active-orders-count',
        count: groupOrdersByNumber(orders).length,
      });

      // Тёмная тема — переключатель (Dark Reader стиль)
      document.getElementById('osp-dark-toggle').addEventListener('click', function() {
        var html = document.documentElement;
        var sw = document.getElementById('osp-dark-switch');
        var isDark = html.classList.toggle('darkreader');
        if (sw) {
          if (isDark) {
            sw.classList.add('active');
          } else {
            sw.classList.remove('active');
          }
        }
        // Сбрасываем все фиксы тёмной темы при выключении
        if (!isDark && typeof window.__ozonResetDarkFixes === 'function') {
          window.__ozonResetDarkFixes();
        }
        try {
          localStorage.setItem('ozon_dark_theme', isDark ? '1' : '0');
        } catch(e) {}
        // Перезагружаем страницу для корректного применения/сброса темы
        location.reload();
      });

      // Кнопка статистики — проверяем сохранённые данные
      document.getElementById('osp-stats').addEventListener('click', function() {
        try {
          var saved = localStorage.getItem('ozon_stats_cache');
          if (saved) {
            var parsed = JSON.parse(saved);
            if (parsed && parsed.totalSpent !== undefined) {
              showSavedStats(parsed);
              return;
            }
          }
        } catch(e) {}
        window.__ozonStats.loadFullStats();
      });
  }

  // Уведомление о смене статуса заказа — только при переходе в "можно
  // забирать" или "в пути" (сравниваем со снимком статусов из прошлой загрузки).
  async function checkOrderNotifications(orders) {
    try {
      const groups = groupOrdersByNumber(orders);
      const stored = await chrome.storage.local.get('ospLastStatuses');
      const prev = (stored && stored.ospLastStatuses) || {};
      const isFirstRun = Object.keys(prev).length === 0;
      const next = {};

      for (const g of groups) {
        const key = g.orderNumber || (g.items[0] && g.items[0].title);
        if (!key) continue;
        const status = g.items[0] && g.items[0].status;
        next[key] = status;

        const cls = statusClass(status);
        if (!isFirstRun && prev[key] !== status && (cls === 'ready' || cls === 'transit')) {
          const title = (g.items[0] && g.items[0].title) || 'Товар';
          const message = cls === 'ready' ? 'Можно забирать: ' + title : 'В пути: ' + title;
          chrome.runtime.sendMessage({ type: 'osp-order-notification', message: message });
        }
      }

      chrome.storage.local.set({ ospLastStatuses: next });
    } catch (e) {}
  }

  // Мгновенный показ закэшированных данных при первом открытии панели —
  // пока настоящая loadData() ещё идёт по сети.
  async function renderCachedPreview() {
    try {
      const stored = await chrome.storage.local.get('ospCache');
      const c = stored && stored.ospCache;
      if (c) {
        renderOrdersScreen(c.name, c.email, c.avatar, c.regDate, c.balance, c.points, c.orders || []);
      }
    } catch (e) {}
  }

  // ====== Функция отображения сохранённой статистики ======
  function showSavedStats(data) {
    renderStatsResult(data, true);
  }

  // ====== Общая функция рендера результата статистики ======
  function renderStatsResult(data, isCached) {
    var body = document.getElementById('osp-body');
    var totalSpent = data.totalSpent || 0;
    var totalItems = data.totalItems || 0;
    var totalPages = data.totalPages || 0;
    var orderCount = data.orderCount || 0;
    var yearlySpending = data.yearlySpending || {};
    var yearlyOrders = data.yearlyOrders || {};
    var lastUpdated = data.lastUpdated || '';

    // Расширенная статистика
    var cancelledCount = data.cancelledCount || 0;
    var cancelledSum = data.cancelledSum || 0;
    var avgCheck = data.avgCheck || 0;
    var maxOrder = data.maxOrder || 0;
    var minOrder = data.minOrder || 0;
    var recordMonthLabel = data.recordMonthLabel || '';
    var recordMonthSpent = data.recordMonthSpent || 0;
    var recordMonthOrders = data.recordMonthOrders || 0;
    var recordDayLabel = data.recordDayLabel || '';
    var recordDayOrders = data.recordDayOrders || 0;
    var recordDayItems = data.recordDayItems || 0;

    var years = Object.keys(yearlySpending).filter(function(y) { return y !== 'null' && y !== '0' && parseInt(y) > 0; }).sort(function(a, b) { return parseInt(b) - parseInt(a); });
    var maxSpent = 1;
    for (var ms = 0; ms < years.length; ms++) {
      if ((yearlySpending[years[ms]] || 0) > maxSpent) maxSpent = yearlySpending[years[ms]];
    }

    var yearsHtml = '';
    for (var i2 = 0; i2 < years.length; i2++) {
      var y = years[i2];
      var spent = yearlySpending[y] || 0;
      var ordersCount = yearlyOrders[y] || 0;
      var pct = Math.round((spent / maxSpent) * 100);
      yearsHtml +=
        '<div style="background: white; border-radius: 12px; padding: 14px; margin-bottom: 10px; box-shadow: 0 2px 8px rgba(0,0,0,0.04);">' +
          '<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">' +
            '<span style="font-size: 15px; font-weight: 600; color: #1a1a2e;">' + y + '</span>' +
            '<span style="font-size: 11px; color: #9ca3af;">' + ordersCount + ' заказов</span>' +
          '</div>' +
          '<div style="background: #e5e7eb; border-radius: 6px; height: 8px; overflow: hidden; margin-bottom: 6px;">' +
            '<div style="background: linear-gradient(90deg, #005BFF, #0046cc); height: 100%; width: ' + pct + '%; border-radius: 6px; transition: width 0.6s ease;"></div>' +
          '</div>' +
          '<div style="font-size: 14px; font-weight: 700; color: #005BFF;">' + formatMoney(spent) + '</div>' +
        '</div>';
    }

    var updatedText = '';
    if (isCached && lastUpdated) {
      try {
        var d = new Date(lastUpdated);
        updatedText = '<div style="font-size: 11px; color: #9ca3af; margin-top: 4px;">Обновлено: ' + d.toLocaleString('ru-RU') + '</div>';
      } catch(e) {}
    }

    body.innerHTML =
      '<div style="padding: 0;">' +
        '<div style="text-align: center; margin-bottom: 20px;">' +
          '<div style="font-size: 32px; margin-bottom: 8px;">📊</div>' +
          '<div style="font-size: 16px; font-weight: 700; color: #1a1a2e;">Статистика за всё время</div>' +
          '<div style="font-size: 12px; color: #9ca3af;">Страниц: ' + totalPages + ' | Заказов: ' + orderCount + '</div>' +
          updatedText +
        '</div>' +

        /* --- Главные показатели --- */
        '<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 12px;">' +
          '<div style="background: white; border-radius: 14px; padding: 14px; box-shadow: 0 2px 12px rgba(0,0,0,0.06);">' +
            '<div style="font-size: 11px; color: #9ca3af; margin-bottom: 4px;">💰 Потрачено</div>' +
            '<div style="font-size: 20px; font-weight: 700; color: #005BFF; overflow: hidden; white-space: nowrap;" id="stat-spent">' + formatMoney(totalSpent) + '</div>' +
          '</div>' +
          '<div style="background: white; border-radius: 14px; padding: 14px; box-shadow: 0 2px 12px rgba(0,0,0,0.06);">' +
            '<div style="font-size: 11px; color: #9ca3af; margin-bottom: 4px;">📦 Товаров</div>' +
            '<div style="font-size: 20px; font-weight: 700; color: #10b981; overflow: hidden; white-space: nowrap;" id="stat-items">' + totalItems + '</div>' +
          '</div>' +
        '</div>' +

        /* --- Средний чек / Мин / Макс --- */
        '<div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; margin-bottom: 12px;">' +
          '<div style="background: white; border-radius: 12px; padding: 12px 10px; box-shadow: 0 2px 8px rgba(0,0,0,0.04); text-align: center;">' +
            '<div style="font-size: 10px; color: #9ca3af; margin-bottom: 4px;">Средний чек</div>' +
            '<div style="font-size: 16px; font-weight: 700; color: #8b5cf6; overflow: hidden; white-space: nowrap;">' + formatMoney(avgCheck) + '</div>' +
          '</div>' +
          '<div style="background: white; border-radius: 12px; padding: 12px 10px; box-shadow: 0 2px 8px rgba(0,0,0,0.04); text-align: center;">' +
            '<div style="font-size: 10px; color: #9ca3af; margin-bottom: 4px;">Макс. заказ</div>' +
            '<div style="font-size: 16px; font-weight: 700; color: #ef4444; overflow: hidden; white-space: nowrap;">' + formatMoney(maxOrder) + '</div>' +
          '</div>' +
          '<div style="background: white; border-radius: 12px; padding: 12px 10px; box-shadow: 0 2px 8px rgba(0,0,0,0.04); text-align: center;">' +
            '<div style="font-size: 10px; color: #9ca3af; margin-bottom: 4px;">Мин. заказ</div>' +
            '<div style="font-size: 16px; font-weight: 700; color: #f59e0b; overflow: hidden; white-space: nowrap;">' + formatMoney(minOrder) + '</div>' +
          '</div>' +
        '</div>' +

        /* --- Отменённые заказы --- */
        (cancelledCount > 0 ?
        '<div style="background: linear-gradient(135deg, #fef2f2, #fff1f2); border-radius: 12px; padding: 12px 14px; margin-bottom: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.04); display: flex; justify-content: space-between; align-items: center;">' +
          '<div>' +
            '<div style="font-size: 11px; color: #9ca3af; margin-bottom: 2px;">🚫 Отменённые заказы</div>' +
            '<div style="font-size: 15px; font-weight: 700; color: #ef4444;">' + formatMoney(cancelledSum) + '</div>' +
          '</div>' +
          '<div style="background: #fee2e2; border-radius: 8px; padding: 4px 10px;">' +
            '<span style="font-size: 13px; font-weight: 600; color: #ef4444;">' + cancelledCount + ' шт.</span>' +
          '</div>' +
        '</div>' : '') +

        /* --- Рекорды --- */
        '<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 16px;">' +
          /* Рекордный месяц */
          '<div style="background: linear-gradient(135deg, #eff6ff, #eef2ff); border-radius: 12px; padding: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.04);">' +
            '<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">' +
              '<span style="font-size: 10px; color: #9ca3af;">🏆 Рекорд. месяц</span>' +
              (recordMonthLabel ? '<span style="font-size: 9px; background: #dbeafe; color: #2563eb; padding: 2px 6px; border-radius: 6px; font-weight: 600;">' + recordMonthLabel + '</span>' : '') +
            '</div>' +
            '<div style="font-size: 14px; font-weight: 700; color: #2563eb; margin-bottom: 2px; overflow: hidden; white-space: nowrap;">' + formatMoney(recordMonthSpent) + '</div>' +
            '<div style="font-size: 10px; color: #6b7280;">' + recordMonthOrders + ' заказов</div>' +
          '</div>' +
          /* Рекордный шоппинг */
          '<div style="background: linear-gradient(135deg, #f0fdf4, #ecfdf5); border-radius: 12px; padding: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.04);">' +
            '<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">' +
              '<span style="font-size: 10px; color: #9ca3af;">🛍️ Рекорд. шоппинг</span>' +
              (recordDayLabel ? '<span style="font-size: 9px; background: #dcfce7; color: #16a34a; padding: 2px 6px; border-radius: 6px; font-weight: 600;">' + recordDayLabel + '</span>' : '') +
            '</div>' +
            '<div style="font-size: 14px; font-weight: 700; color: #16a34a; margin-bottom: 2px;">' + recordDayOrders + ' заказов</div>' +
            '<div style="font-size: 10px; color: #6b7280;">' + recordDayItems + ' товаров</div>' +
          '</div>' +
        '</div>' +

        '<div style="font-size: 14px; font-weight: 600; color: #1a1a2e; margin-bottom: 12px;">📅 По годам</div>' +
        '<div style="max-height: 250px; overflow-y: auto; padding-right: 4px;">' + yearsHtml + '</div>' +
        '<button class="osp-btn" id="stats-recalc" style="margin-top: 12px;"><span>🔄</span><span>Пересчитать</span></button>' +
        '<button class="osp-btn" id="back-to-main" style="margin-top: 8px;"><span>←</span><span>Назад</span></button>' +
      '</div>';

    document.getElementById('back-to-main').addEventListener('click', loadData);
    document.getElementById('stats-recalc').addEventListener('click', function() {
      window.__ozonStats.loadFullStats();
    });

    // Анимация счётчиков при показе
    animateCounter(document.getElementById('stat-spent'), 0, totalSpent, 1200, true);
    animateCounter(document.getElementById('stat-items'), 0, totalItems, 1200, false);
  }

  // ====== Анимация плавного счётчика ======
  function animateCounter(el, from, to, duration, isMoney) {
    if (!el || to === 0) return;
    var startTime = null;
    function easeOut(t) { return 1 - Math.pow(1 - t, 3); }
    function step(ts) {
      if (!startTime) startTime = ts;
      var progress = Math.min((ts - startTime) / duration, 1);
      var val = Math.round(from + (to - from) * easeOut(progress));
      el.textContent = isMoney ? formatMoney(val) : val.toLocaleString('ru-RU');
      if (progress < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  window.__ozonStats.loadData = loadData;
  window.__ozonStats.renderStatsResult = renderStatsResult;
  window.__ozonStats.renderCachedPreview = renderCachedPreview;
})();
