// ── 配置 ──
window.BASE_URL = localStorage.getItem('btcqdd_base_url') || 'http://localhost:53123';
window.proxyFetch = (url, opts = {}) => fetch(url, opts);
window.STRAT_COLORS = ['#10b981', '#0ea5e9', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

// ── Tab 切换 ──
window.switchTab = function(tab) {
  if (tab !== 'hall') window.cleanupTradingHall?.();
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
const _wsHandlerMap = new Map(); // 原始 handler → wrapper（type 过滤用）
let wsLastPong = 0;

// onWsEvent(handler) — 接收所有事件（原有行为）
// onWsEvent(type, handler) — 只接收指定 type 的事件，handler 收到 payload
window.onWsEvent = (typeOrHandler, handler) => {
  if (typeof typeOrHandler === 'function') {
    _wsHandlers.push(typeOrHandler);
  } else {
    const wrapper = (evt) => { if (evt.type === typeOrHandler) handler(evt.payload ?? evt, evt); };
    _wsHandlerMap.set(handler, wrapper);
    _wsHandlers.push(wrapper);
  }
};

// offWsEvent(handler) — 取消注册（支持 type 过滤和直接注册两种方式）
window.offWsEvent = (handler) => {
  const wrapper = _wsHandlerMap.get(handler);
  const toRemove = wrapper || handler;
  const idx = _wsHandlers.indexOf(toRemove);
  if (idx !== -1) _wsHandlers.splice(idx, 1);
  if (wrapper) _wsHandlerMap.delete(handler);
};

// isWsAlive() — 5s 内有消息则视为连接正常
window.isWsAlive = () => wsLastPong > 0 && (Date.now() - wsLastPong) < 5000;

(function connectWS() {
  try {
    const ws = new WebSocket(BASE_URL.replace(/^http/, 'ws') + '/events/stream');
    ws.onmessage = e => {
      wsLastPong = Date.now();
      try { const d = JSON.parse(e.data); _wsHandlers.forEach(h => h(d)); } catch {}
    };
    ws.onclose = () => setTimeout(connectWS, 3000);
  } catch (_) { setTimeout(connectWS, 3000); }
})();

// ── 重启服务 ──
async function restartServer() {
  if (!confirm('确认重启服务？当前运行中的策略将停止。')) return;
  try {
    await fetch(`${BASE_URL}/server/restart`, { method: 'POST' });
    const btn = document.querySelector('.restart-btn');
    if (btn) { btn.textContent = '重启中...'; btn.disabled = true; }
    // 3秒后刷新页面（等服务重启）
    setTimeout(() => location.reload(), 4000);
  } catch(_) {
    // fetch 失败是正常的（服务已关闭）
    setTimeout(() => location.reload(), 4000);
  }
}
