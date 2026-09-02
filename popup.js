// ==============================
// Ozon Stats — popup.js
// Вся функциональность (профиль, баланс, баллы, заказы, статистика за всё
// время) находится в боковой панели на странице ozon.ru — см. content/.
// Всплывающее окно по клику на иконку расширения — просто короткая
// подсказка с кнопкой быстрого перехода на Ozon.
// ==============================

document.addEventListener('DOMContentLoaded', function() {
  var btn = document.getElementById('openOzonBtn');
  if (!btn) return;

  btn.addEventListener('click', async function() {
    const tabs = await chrome.tabs.query({ url: '*://*.ozon.ru/*' });
    const tab = tabs.find(function(t) { return t.url && t.url.indexOf('www.ozon.ru') >= 0; }) || tabs[0];

    if (tab) {
      chrome.tabs.update(tab.id, { active: true });
      chrome.windows.update(tab.windowId, { focused: true });
    } else {
      chrome.tabs.create({ url: 'https://www.ozon.ru/' });
    }
    window.close();
  });
});
