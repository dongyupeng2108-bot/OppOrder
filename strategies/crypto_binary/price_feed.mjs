// price_feed.mjs — Binance 价格数据（REST + WebSocket 双模式）
// ws 模式：aggTrade WebSocket 为主 + REST 兜底 + 指数退避重连
// rest 模式：纯 REST 轮询（向后兼容）

import './proxy_agent.mjs';
import { ProxyAgent, fetch as undiciFetch } from 'undici';
import { logger, EVENTS } from './logger.mjs';
import { randomUUID } from 'crypto';

const BINANCE_REST = 'https://api.binance.com';
const COINBASE_SPOT = 'https://api.coinbase.com/v2/prices/BTC-USD/spot';

// Use undici.fetch with explicit ProxyAgent so the dispatcher is never ignored.
// Node.js built-in fetch does not honour the `dispatcher` option; undici.fetch does.
const _proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || null;
const _dispatcher = _proxyUrl ? new ProxyAgent(_proxyUrl) : null;
if (_dispatcher) console.log('[PriceFeed] Proxy dispatcher ready:', _proxyUrl);

async function proxyFetch(url, options = {}) {
  if (_dispatcher) return undiciFetch(url, { ...options, dispatcher: _dispatcher });
  return fetch(url, options);
}
const BINANCE_WS   = 'wss://stream.binance.com:9443/ws';

// 成交量分桶：30 秒一桶
const BUCKET_SIZE_MS   = 30_000;
// 最大保留桶数：保留 2 小时的桶（240 桶）
const MAX_BUCKETS      = 240;

// 有界重连配置
const RECONNECT_CONFIG = {
  maxAttempts: 5,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  backoffFactor: 2,
  heartbeatIntervalMs: 20000,
  pongTimeoutMs: 5000,
};

export function createPriceFeed(config) {
  const symbol    = (config.price_feed?.symbol || 'BTCUSDT').toLowerCase();
  const mode      = config.price_feed?.mode || 'rest';
  const pollSec   = config.price_feed?.poll_sec || 2;

  const volRecentMin   = config.regime_detector?.volume_recent_minutes   || 3;
  const volBaselineMin = config.regime_detector?.volume_baseline_minutes || 60;

  // 当前价格状态
  let currentPrice  = null;
  let lastUpdatedAt = null;

  // 成交量分桶（30s 一桶）
  // 每桶：{ bucket_ts: number, volume: number }
  const volumeBuckets = [];

  // REST 轮询 timer
  let restTimer = null;

  // WebSocket 状态
  let ws            = null;
  let wsConnected   = false;
  let wsRetryTimer  = null;
  let wsFallbackActive = false; // REST 兜底是否激活

  // 单活连接：activeSessionId
  let activeSessionId = null;

  // 有界重连状态
  let reconnectAttempts = 0;

  // 订阅者列表
  const subscribers = [];
  const normalizePrice = (value) => {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  };

  // ─── 成交量分桶 ───────────────────────────────────────

  function recordTrade(price, quantity, tradeTs) {
    const bucketTs = Math.floor(tradeTs / BUCKET_SIZE_MS) * BUCKET_SIZE_MS;
    const last = volumeBuckets[volumeBuckets.length - 1];
    if (last && last.bucket_ts === bucketTs) {
      last.volume += quantity;
    } else {
      volumeBuckets.push({ bucket_ts: bucketTs, volume: quantity });
      if (volumeBuckets.length > MAX_BUCKETS) volumeBuckets.shift();
    }
  }

  function calcVolumeStats() {
    if (volumeBuckets.length === 0) {
      return { volume_recent: 0, volume_baseline: 0, volume_ratio: 1.0 };
    }
    const now = Date.now();
    const recentMs   = volRecentMin   * 60_000;
    const baselineMs = volBaselineMin * 60_000;

    const recentVol = volumeBuckets
      .filter(b => now - b.bucket_ts <= recentMs)
      .reduce((s, b) => s + b.volume, 0);

    const baselineBuckets = volumeBuckets.filter(b => now - b.bucket_ts <= baselineMs);

    if (baselineBuckets.length < 2) {
      // 数据不足，冷启动返回中性
      return { volume_recent: recentVol, volume_baseline: 0, volume_ratio: 1.0 };
    }

    // baseline = 过去 baselineMin 分钟内，每 volRecentMin 分钟的平均成交量
    const totalBaselineVol = baselineBuckets.reduce((s, b) => s + b.volume, 0);
    const bucketSpanMin = (baselineMs / BUCKET_SIZE_MS) * (BUCKET_SIZE_MS / 60_000);
    const intervalsInBaseline = Math.max(1, bucketSpanMin / volRecentMin);
    const volume_baseline = totalBaselineVol / intervalsInBaseline;
    const volume_ratio = volume_baseline > 0 ? recentVol / volume_baseline : 1.0;

    return {
      volume_recent:   recentVol,
      volume_baseline: volume_baseline,
      volume_ratio:    volume_ratio,
      volume_buckets:  [...volumeBuckets],
    };
  }

  // ─── 通知订阅者 ────────────────────────────────────────

  function notify(price, source) {
    const normalized = normalizePrice(price);
    if (normalized === null) return;
    currentPrice  = normalized;
    lastUpdatedAt = new Date();
    const volStats = calcVolumeStats();
    const snapshot = {
      price: normalized,
      timestamp:        lastUpdatedAt.getTime(),
      source,           // 'ws' | 'rest'
      ...volStats,
    };
    subscribers.forEach(cb => {
      try { cb(snapshot); } catch (e) {
        console.error('[PriceFeed] subscriber error:', e.message);
      }
    });
  }

  // ─── REST 轮询 ─────────────────────────────────────────

  async function fetchRest() {
    try {
      let price = null;
      let source = 'rest_binance';
      const res = await proxyFetch(`${BINANCE_REST}/api/v3/ticker/price?symbol=${symbol.toUpperCase()}`);
      if (res.ok) {
        const data = await res.json();
        price = normalizePrice(data.price);
      }
      if (price === null) {
        const backup = await proxyFetch(COINBASE_SPOT);
        if (!backup.ok) throw new Error(`HTTP ${res.status}/${backup.status}`);
        const backupData = await backup.json();
        price = normalizePrice(backupData?.data?.amount);
        source = 'rest_coinbase';
      }
      if (price === null) throw new Error('invalid price payload');
      notify(price, source);
    } catch (e) {
      console.error('[PriceFeed] REST fetch error:', e.message);
    }
  }

  function startRest() {
    if (restTimer) return;
    fetchRest();
    restTimer = setInterval(fetchRest, pollSec * 1000);
    console.log(`[PriceFeed] REST polling started (${pollSec}s interval)`);
  }

  function stopRest() {
    if (restTimer) { clearInterval(restTimer); restTimer = null; }
  }

  // ─── WebSocket ─────────────────────────────────────────

  function startHeartbeat(wsConn, sessionId) {
    const interval = setInterval(() => {
      if (sessionId !== activeSessionId) { clearInterval(interval); return; }
      if (wsConn.readyState !== 1 /* OPEN */) { clearInterval(interval); return; }
      if (typeof wsConn.ping === 'function') wsConn.ping();
      logger.debug(EVENTS.WS_PING_SENT, { module: 'price_feed', session_id: sessionId });

      const pongTimeout = setTimeout(() => {
        if (sessionId !== activeSessionId) return;
        logger.warn(EVENTS.WS_PONG_TIMEOUT, { module: 'price_feed', session_id: sessionId });
        if (typeof wsConn.terminate === 'function') wsConn.terminate();
      }, RECONNECT_CONFIG.pongTimeoutMs);

      wsConn.once('pong', () => clearTimeout(pongTimeout));
    }, RECONNECT_CONFIG.heartbeatIntervalMs);
  }

  async function connectWs() {
    // 动态 import ws（避免在 rest 模式下强依赖）
    let WebSocket;
    try {
      const wsModule = await import('ws');
      WebSocket = wsModule.default;
    } catch (e) {
      logger.error(EVENTS.WS_CONNECT_FAIL, { module: 'price_feed', msg: 'ws module not available, falling back to REST' });
      startRest();
      return;
    }

    // 单活连接：生成新 sessionId，废弃旧连接
    const sessionId = randomUUID();
    activeSessionId = sessionId;

    const streamUrl = `${BINANCE_WS}/${symbol}@aggTrade`;
    logger.info(EVENTS.WS_CONNECT_START, { module: 'price_feed', market_id: symbol.toUpperCase(), session_id: sessionId, msg: streamUrl });

    // 尝试裸连，5s 超时后切换代理模式
    let agent = null;
    const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;

    function createWsConn(useProxy) {
      if (useProxy && proxyUrl) {
        try {
          const { HttpsProxyAgent } = require('https-proxy-agent');
          agent = new HttpsProxyAgent(proxyUrl);
          console.log(`[PriceFeed] Using proxy: ${proxyUrl}`);
        } catch (e) {
          console.warn('[PriceFeed] https-proxy-agent not available');
        }
      }
      return agent
        ? new WebSocket(streamUrl, { agent })
        : new WebSocket(streamUrl);
    }

    let connectTimeout = null;
    ws = createWsConn(false); // 先裸连

    connectTimeout = setTimeout(() => {
      if (!wsConnected && sessionId === activeSessionId) {
        logger.warn(EVENTS.WS_RECONNECT_ATTEMPT, { module: 'price_feed', session_id: sessionId, msg: 'bare connect timed out, retrying with proxy' });
        ws.terminate();
        ws = createWsConn(true); // 切换代理模式
        attachWsHandlers();
      }
    }, 5000);

    function attachWsHandlers() {
      ws.on('open', () => {
        clearTimeout(connectTimeout);
        if (sessionId !== activeSessionId) return; // 旧连接打开，忽略
        wsConnected      = true;
        reconnectAttempts = 0; // 连接成功，重置计数
        wsFallbackActive = false;
        stopRest(); // WebSocket 连通后停止 REST 兜底
        logger.info(EVENTS.WS_CONNECT_OK, { module: 'price_feed', market_id: symbol.toUpperCase(), session_id: sessionId });
        startHeartbeat(ws, sessionId);
      });

      ws.on('message', (data) => {
        // 单活连接检查：旧 session 消息丢弃
        if (sessionId !== activeSessionId) {
          logger.debug(EVENTS.WS_MESSAGE_DROPPED_STALE, { module: 'price_feed', session_id: sessionId, active_session_id: activeSessionId });
          return;
        }
        try {
          const msg = JSON.parse(data.toString());
          if (msg.e !== 'aggTrade') return;
          const price    = parseFloat(msg.p);
          const quantity = parseFloat(msg.q);
          const tradeTs  = msg.T;
          recordTrade(price, quantity, tradeTs);
          notify(price, 'ws');
        } catch (e) {
          logger.error(EVENTS.ERROR_PARSE_FAIL, { module: 'price_feed', err: e.message });
        }
      });

      ws.on('close', () => {
        clearTimeout(connectTimeout);
        if (sessionId !== activeSessionId) return; // 旧连接关闭，忽略
        wsConnected = false;
        logger.warn(EVENTS.WS_DISCONNECT, { module: 'price_feed', market_id: symbol.toUpperCase(), session_id: sessionId, msg: 'starting REST fallback' });
        if (!wsFallbackActive) {
          wsFallbackActive = true;
          startRest();
        }
        scheduleReconnect('ws_close');
      });

      ws.on('error', (err) => {
        if (sessionId !== activeSessionId) return;
        logger.error(EVENTS.WS_CONNECT_FAIL, { module: 'price_feed', market_id: symbol.toUpperCase(), session_id: sessionId, err: err.message });
        // error 后会紧接着触发 close，close handler 里处理重连
      });
    }

    attachWsHandlers();
  }

  function scheduleReconnect(reason) {
    if (wsRetryTimer) return;

    if (reconnectAttempts >= RECONNECT_CONFIG.maxAttempts) {
      logger.error(EVENTS.WS_RECONNECT_EXHAUSTED, {
        module: 'price_feed',
        attempt: reconnectAttempts,
        msg: 'max reconnect attempts reached, entering degraded mode (REST fallback)'
      });
      // 确保 REST 兜底已激活
      if (!wsFallbackActive) { wsFallbackActive = true; startRest(); }
      return;
    }

    const delay = Math.min(
      RECONNECT_CONFIG.baseDelayMs * Math.pow(RECONNECT_CONFIG.backoffFactor, reconnectAttempts),
      RECONNECT_CONFIG.maxDelayMs
    );
    reconnectAttempts++;

    logger.info(EVENTS.WS_RECONNECT_SCHEDULED, { module: 'price_feed', attempt: reconnectAttempts, delay_ms: delay, reason });
    wsRetryTimer = setTimeout(() => {
      wsRetryTimer = null;
      logger.info(EVENTS.WS_RECONNECT_ATTEMPT, { module: 'price_feed', attempt: reconnectAttempts });
      connectWs();
    }, delay);
  }

  // ─── 公开接口 ──────────────────────────────────────────

  function start() {
    const currentMode = config.price_feed?.mode || 'rest';
    console.log(`[PriceFeed] Starting in ${currentMode} mode (symbol=${symbol.toUpperCase()})`);
    if (currentMode === 'ws') {
      startRest();
      connectWs();
    } else {
      startRest();
    }
  }

  function stop() {
    stopRest();
    if (ws) {
      ws.terminate();
      ws = null;
      wsConnected = false;
    }
    if (wsRetryTimer) { clearTimeout(wsRetryTimer); wsRetryTimer = null; }
    console.log('[PriceFeed] Stopped');
  }

  function subscribe(callback) {
    subscribers.push(callback);
  }

  function getLatestPrice() {
    return currentPrice;
  }

  function getVolumeStats() {
    return calcVolumeStats();
  }

  // 供 /config/reload 热切换模式
  function reload(newConfig) {
    config = newConfig;
    stop();
    start();
  }

  // ─── 向后兼容接口（供 strategy_runner / 旧测试使用）────

  async function getCurrentPrice() {
    if (normalizePrice(currentPrice) !== null) return currentPrice;
    let parsed = null;
    const res = await proxyFetch(`${BINANCE_REST}/api/v3/ticker/price?symbol=${symbol.toUpperCase()}`);
    if (res.ok) {
      const data = await res.json();
      parsed = normalizePrice(data.price);
    }
    if (parsed === null) {
      const backup = await proxyFetch(COINBASE_SPOT);
      if (!backup.ok) throw new Error(`HTTP ${res.status}/${backup.status}`);
      const backupData = await backup.json();
      parsed = normalizePrice(backupData?.data?.amount);
    }
    if (parsed === null) throw new Error('invalid price payload');
    currentPrice = parsed;
    lastUpdatedAt = new Date();
    return parsed;
  }

  async function getKlines() {
    const limit = config.price_feed?.kline_limit || 50;
    const interval = config.price_feed?.kline_interval || '1m';
    const res = await proxyFetch(
      `${BINANCE_REST}/api/v3/klines?symbol=${symbol.toUpperCase()}&interval=${interval}&limit=${limit}`
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = await res.json();
    return raw.map(k => parseFloat(k[4])); // close prices
  }

  function startPolling(callback) {
    if (callback) subscribe(snapshot => {
      const p = typeof snapshot === 'object' ? snapshot.price : snapshot;
      if (callback) callback(p);
    });
    start();
  }

  function stopPolling() {
    stop();
  }

  return {
    start, stop, subscribe, getLatestPrice, getVolumeStats, reload,
    // backward compat
    getCurrentPrice, getKlines, startPolling, stopPolling,
  };
}
