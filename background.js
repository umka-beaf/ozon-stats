// =====================================================
// Ozon Stats — background.js (Service Worker)
// Фоновый скрипт расширения
// =====================================================

// Обработка сообщений от content script (см. content/orders-panel.js)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'osp-active-orders-count') {
    const count = message.count || 0;
    chrome.action.setBadgeText({ text: count > 0 ? String(count) : '' });
    chrome.action.setBadgeBackgroundColor({ color: '#005BFF' });
  } else if (message.type === 'osp-order-notification') {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'Ozon Stats',
      message: message.message,
    });
  }
});

// При установке расширения
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('[Ozon Stats] Расширение установлено!');
  } else if (details.reason === 'update') {
    console.log('[Ozon Stats] Расширение обновлено до версии', chrome.runtime.getManifest().version);
  }
});
