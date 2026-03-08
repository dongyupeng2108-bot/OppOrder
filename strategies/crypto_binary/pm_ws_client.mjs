// pm_ws_client.mjs — Polymarket WebSocket 连接封装
// 连接：wss://ws-subscriptions-clob.polymarket.com/ws/market
// 订阅：book / last_trade_price / tick_size_change / price_change 事件
// 代理策略：裸连 5s 超时后切换 HttpsProxyAgent

import './proxy_agent.mjs';

const PM_WS_URL = 'wss://ws-subscriptions-clob.polymarket.com/ws/market';
const CONNECT_TIMEOUT_MS = 5000;
const MAX_RETRY_DELAY_MS = 30_000;

export function createPmWsClient() {
  let ws              = null;
  let connected       = false;
  let retryDelay      = 1000;
  let retryTimer      = null;
  let subscribedAssets = [];  // 当前订阅的 token IDs

  // 事件订阅者
  const handlers = {
    book:              [],
    last_trade_price:  [],
    tick_size_change:  [],
    price_change:      [],
    connected:         [],
    disconnected:      [],
  };

  function on(event, handler) {
    if (handlers[event]) handlers[event].push(handler);
  }

  function emit(event, data) {
    (handlers[event] || []).forEach(h => {
      try { h(data); } catch (e) {
        console.error(`[PmWsClient] Handler error (${event}):`, e.message);
      }
    });
  }

  async function connect(assetIds) {
    subscribedAssets = assetIds || [];

    let WebSocket;
    try {
      const m = await import('ws');
      WebSocket = m.default;
    } catch (e) {
      console.error('[PmWsClient] ws module not available');
      return;
    }

    const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;

    function createWs(useProxy) {
      if (useProxy && proxyUrl) {
        try {
          // dynamic require for CommonJS compat
          const { HttpsProxyAgent } = require('https-proxy-agent');
          const agent = new HttpsProxyAgent(proxyUrl);
          console.log(`[PmWsClient] Connecting via proxy: ${proxyUrl}`);
          return new WebSocket(PM_WS_URL, { agent });
        } catch (e) {
          console.warn('[PmWsClient] https-proxy-agent unavailable, trying bare');
        }
      }
      console.log(`[PmWsClient] Connecting: ${PM_WS_URL}`);
      return new WebSocket(PM_WS_URL);
    }

    let connectTimeout = null;
    ws = createWs(false);

    connectTimeout = setTimeout(() => {
      if (!connected) {
        console.warn('[PmWsClient] Bare connect timed out, retrying with proxy...');
        ws.terminate();
        ws = createWs(true);
        attachHandlers();
      }
    }, CONNECT_TIMEOUT_MS);

    function attachHandlers() {
      ws.on('open', () => {
        clearTimeout(connectTimeout);
        connected   = true;
        retryDelay  = 1000;
        console.log('[PmWsClient] Connected');

        // 订阅当前 asset IDs
        if (subscribedAssets.length > 0) {
          _sendSubscribe(subscribedAssets);
        }
        emit('connected', {});
      });

      ws.on('message', (data) => {
        try {
          const msgs = JSON.parse(data.toString());
          const arr = Array.isArray(msgs) ? msgs : [msgs];
          for (const msg of arr) {
            if (msg.event_type && handlers[msg.event_type]) {
              emit(msg.event_type, msg);
            }
          }
        } catch (e) {
          console.error('[PmWsClient] Parse error:', e.message);
        }
      });

      ws.on('close', () => {
        clearTimeout(connectTimeout);
        connected = false;
        console.warn('[PmWsClient] Disconnected');
        emit('disconnected', {});
        scheduleReconnect();
      });

      ws.on('error', (err) => {
        console.error('[PmWsClient] Error:', err.message);
      });
    }

    attachHandlers();
  }

  function _sendSubscribe(assetIds) {
    if (!ws || !connected) return;
    const msg = JSON.stringify({ type: 'market', assets_ids: assetIds });
    ws.send(msg);
    console.log(`[PmWsClient] Subscribed to ${assetIds.length} assets`);
  }

  /**
   * 更新订阅（窗口切换时调用）
   * @param {string[]} newAssetIds
   */
  function updateSubscription(newAssetIds) {
    subscribedAssets = newAssetIds;
    if (connected && ws) {
      _sendSubscribe(newAssetIds);
    }
  }

  function scheduleReconnect() {
    if (retryTimer) return;
    console.log(`[PmWsClient] Reconnecting in ${retryDelay / 1000}s...`);
    retryTimer = setTimeout(() => {
      retryTimer = null;
      connect(subscribedAssets);
    }, retryDelay);
    retryDelay = Math.min(retryDelay * 2, MAX_RETRY_DELAY_MS);
  }

  function disconnect() {
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
    if (ws) { ws.terminate(); ws = null; connected = false; }
  }

  function isConnected() { return connected; }

  return { connect, disconnect, updateSubscription, on, isConnected };
}
