// pm_ws_client.mjs — Polymarket WebSocket 连接封装
// 连接：wss://ws-subscriptions-clob.polymarket.com/ws/market
// 订阅：book / last_trade_price / tick_size_change / price_change 事件
// 代理策略：裸连 5s 超时后切换 HttpsProxyAgent

import './proxy_agent.mjs';
import { randomUUID } from 'crypto';
import { logger, EVENTS } from './logger.mjs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const PM_WS_URL = 'wss://ws-subscriptions-clob.polymarket.com/ws/market';
const CONNECT_TIMEOUT_MS = 5000;

const RECONNECT_CONFIG = {
  maxAttempts: 5,
  baseDelayMs: 1000,
  maxDelayMs: 30_000,
  backoffFactor: 2,
};

export function createPmWsClient() {
  let ws              = null;
  let connected       = false;
  let retryTimer      = null;
  let reconnectAttempts = 0;
  let subscribedAssets = [];  // 当前订阅的 token IDs
  let activeSessionId  = null;

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
        logger.error(EVENTS.ERROR_UNHANDLED_PATH, { module: 'pm_ws_client', err: e.message, handler_event: event });
      }
    });
  }

  async function connect(assetIds) {
    subscribedAssets = assetIds || [];

    const sessionId = randomUUID();
    activeSessionId = sessionId;

    let WebSocket;
    try {
      const m = await import('ws');
      WebSocket = m.default;
    } catch (e) {
      logger.error(EVENTS.WS_CONNECT_FAIL, { module: 'pm_ws_client', session_id: sessionId, err: 'ws module not available' });
      return;
    }

    const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;

    function createWs(useProxy) {
      if (useProxy && proxyUrl) {
        try {
          const { HttpsProxyAgent } = require('https-proxy-agent');
          const agent = new HttpsProxyAgent(proxyUrl);
          logger.info(EVENTS.WS_CONNECT_START, { module: 'pm_ws_client', session_id: sessionId, url: PM_WS_URL, proxy: true });
          return new WebSocket(PM_WS_URL, { agent });
        } catch (e) {
          logger.warn(EVENTS.WS_CONNECT_FAIL, { module: 'pm_ws_client', session_id: sessionId, err: 'https-proxy-agent unavailable, trying bare' });
        }
      }
      logger.info(EVENTS.WS_CONNECT_START, { module: 'pm_ws_client', session_id: sessionId, url: PM_WS_URL, proxy: false });
      return new WebSocket(PM_WS_URL);
    }

    let connectTimeout = null;
    ws = createWs(false);

    connectTimeout = setTimeout(() => {
      if (!connected && sessionId === activeSessionId) {
        logger.warn(EVENTS.WS_CONNECT_FAIL, { module: 'pm_ws_client', session_id: sessionId, err: 'bare connect timed out, retrying with proxy' });
        ws.terminate();
        ws = createWs(true);
        attachHandlers();
      }
    }, CONNECT_TIMEOUT_MS);

    function attachHandlers() {
      ws.on('open', () => {
        if (sessionId !== activeSessionId) return;
        clearTimeout(connectTimeout);
        connected   = true;
        reconnectAttempts = 0;

        logger.info(EVENTS.WS_CONNECT_OK, { module: 'pm_ws_client', session_id: sessionId });

        // 订阅当前 asset IDs
        if (subscribedAssets.length > 0) {
          _sendSubscribe(subscribedAssets);
        }
        emit('connected', {});
      });

      ws.on('message', (data) => {
        // 单活连接检查：session 已过期则丢弃
        if (sessionId !== activeSessionId) {
          logger.debug(EVENTS.WS_MESSAGE_DROPPED_STALE, {
            module: 'pm_ws_client',
            session_id: sessionId,
            active_session_id: activeSessionId
          });
          return;
        }
        try {
          const msgs = JSON.parse(data.toString());
          const arr = Array.isArray(msgs) ? msgs : [msgs];
          for (const msg of arr) {
            if (msg.event_type && handlers[msg.event_type]) {
              emit(msg.event_type, msg);
            }
          }
        } catch (e) {
          logger.error(EVENTS.ERROR_PARSE_FAIL, { module: 'pm_ws_client', session_id: sessionId, err: e.message });
        }
      });

      ws.on('close', (code, reason) => {
        clearTimeout(connectTimeout);
        if (sessionId !== activeSessionId) return;
        connected = false;

        logger.info(EVENTS.WS_DISCONNECT, {
          module: 'pm_ws_client',
          session_id: sessionId,
          code,
          reason: reason?.toString() || ''
        });
        emit('disconnected', {});
        scheduleReconnect();
      });

      ws.on('error', (err) => {
        if (sessionId !== activeSessionId) return;
        logger.error(EVENTS.WS_CONNECT_FAIL, { module: 'pm_ws_client', session_id: sessionId, err: err.message });
      });
    }

    attachHandlers();
  }

  function _sendSubscribe(assetIds) {
    if (!ws || !connected) return;
    const msg = JSON.stringify({ type: 'market', assets_ids: assetIds });
    ws.send(msg);
    logger.info(EVENTS.SUBSCRIBE_OK, { module: 'pm_ws_client', asset_count: assetIds.length });
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

    if (reconnectAttempts >= RECONNECT_CONFIG.maxAttempts) {
      logger.error(EVENTS.WS_RECONNECT_EXHAUSTED, {
        module: 'pm_ws_client',
        attempt: reconnectAttempts,
        msg: 'max reconnect attempts reached'
      });
      return;
    }

    const delay = Math.min(
      RECONNECT_CONFIG.baseDelayMs * Math.pow(RECONNECT_CONFIG.backoffFactor, reconnectAttempts),
      RECONNECT_CONFIG.maxDelayMs
    );
    reconnectAttempts++;

    logger.info(EVENTS.WS_RECONNECT_SCHEDULED, { module: 'pm_ws_client', attempt: reconnectAttempts, delay_ms: delay });
    retryTimer = setTimeout(() => {
      retryTimer = null;
      logger.info(EVENTS.WS_RECONNECT_ATTEMPT, { module: 'pm_ws_client', attempt: reconnectAttempts });
      connect(subscribedAssets);
    }, delay);
  }

  function disconnect() {
    activeSessionId = null;
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
    if (ws) { ws.terminate(); ws = null; connected = false; }
  }

  function isConnected() { return connected; }

  return { connect, disconnect, updateSubscription, on, isConnected };
}
