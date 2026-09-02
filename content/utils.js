// ==============================
// Ozon Stats — content/utils.js
// Общие чистые хелперы, используемые и панелью активных заказов
// (orders-panel.js), и статистикой за всё время (full-stats.js).
// ==============================
(function() {
  if (!window.__ozonStats || !window.__ozonStats.currentInjectionOk) return;

  // Форматирование денег
  function formatMoney(value) {
    return new Intl.NumberFormat('ru-RU').format(value) + ' ₽';
  }

  // Разбор русской даты вида «12 сентября» → Date (год берём текущий/следующий)
  const RU_MONTHS = {
    'январ': 1, 'феврал': 2, 'март': 3, 'апрел': 4, 'ма': 5, 'июн': 6, 'июл': 7,
    'август': 8, 'сентябр': 9, 'октябр': 10, 'ноябр': 11, 'декабр': 12,
  };

  function parseRuDeadline(text) {
    if (!text) return null;
    const m = text.match(/(\d{1,2})\s+([а-яё]+)/i);
    if (!m) return null;
    const day = parseInt(m[1], 10);
    const monthName = m[2].toLowerCase();
    let month = null;
    for (const key in RU_MONTHS) {
      if (monthName.indexOf(key) === 0) { month = RU_MONTHS[key]; break; }
    }
    if (!month) return null;
    const now = new Date();
    let deadline = new Date(now.getFullYear(), month - 1, day, 23, 59, 59);
    // если дата "в прошлом" больше чем на полгода — это, скорее всего, следующий год
    if (deadline < now && (now - deadline) > 1000 * 60 * 60 * 24 * 180) {
      deadline = new Date(now.getFullYear() + 1, month - 1, day, 23, 59, 59);
    }
    return deadline;
  }

  // Группировка отдельных товаров обратно в заказы (по orderNumber) — только чтобы
  // не повторять общую дату заказа над каждым товаром; фото/статус/цена у каждого
  // товара остаются свои собственные карточки внутри группы.
  function groupOrdersByNumber(list) {
    const map = {};
    const groups = [];
    for (const o of list) {
      const key = o.orderNumber || o.title;
      let group = map[key];
      if (!group) {
        group = { orderNumber: o.orderNumber, orderDate: o.orderDate, pickupPoint: o.pickupPoint, items: [] };
        map[key] = group;
        groups.push(group);
      }
      group.items.push(o);
    }
    return groups;
  }

  window.__ozonStats.formatMoney = formatMoney;
  window.__ozonStats.parseRuDeadline = parseRuDeadline;
  window.__ozonStats.groupOrdersByNumber = groupOrdersByNumber;
})();
