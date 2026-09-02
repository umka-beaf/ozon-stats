// ==============================
// Ozon Stats — content/bootstrap.js
// Запускает первую загрузку панели. Выполняется последним из "панельных"
// файлов, когда loadData уже определена и опубликована orders-panel.js.
// ==============================
(function() {
  if (!window.__ozonStats || !window.__ozonStats.currentInjectionOk || !window.__ozonStats.loadData) return;

  // Мгновенно показываем закэшированные данные (если есть), пока идёт
  // настоящая загрузка — панель не выглядит пустой первые секунды.
  if (window.__ozonStats.renderCachedPreview) {
    window.__ozonStats.renderCachedPreview();
  }

  setTimeout(window.__ozonStats.loadData, 500);

  window.__ozonStats.log('[Ozon Stats] Боковая панель инициализирована');
})();
