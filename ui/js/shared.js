// ── 配置 ──
window.BASE_URL = localStorage.getItem('btcqdd_base_url') || 'http://localhost:53123';
window.proxyFetch = (url, opts = {}) => fetch(url, opts);
window.STRAT_COLORS = ['#10b981', '#0ea5e9', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

// ── Tab 切换 ──
window.switchTab = function(tab) {
  document.querySelectorAll('.topbar-tab').forEach(el =>
    el.classList.toggle('active', el.dataset.tab === tab));
  document.querySelectorAll('.page').forEach(el =>
    el.classList.toggle('active', el.id === 'page-' + tab));
  if (tab === 'hall') window.initTradingHall?.();
  if (tab === 'lab')  window.initStrategyLab?.();
  if (tab === 'set')  window.initSettings?.();
};

// ── WS 连接 ──
const _wsHandlers = [];
window.onWsEvent = h => _wsHandlers.push(h);
(function connectWS() {
  try {
    const ws = new WebSocket(BASE_URL.replace(/^http/, 'ws') + '/events/stream');
    ws.onmessage = e => { try { const d = JSON.parse(e.data); _wsHandlers.forEach(h => h(d)); } catch {} };
    ws.onclose = () => setTimeout(connectWS, 3000);
  } catch (_) { setTimeout(connectWS, 3000); }
})();
