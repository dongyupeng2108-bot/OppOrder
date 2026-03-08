// price_feed.mjs — Binance 价格数据（REST + WebSocket 双模式）
// ws 模式：aggTrade WebSocket 为主 + REST 兜底 + 指数退避重连
// rest 模式：纯 REST 轮询（向后兼容）

import './proxy_agent.mjs';
import { logger, EVENTS } from './logger.mjs';

const BINANCE_REST = 'https://api.binance.com';
const BINANCE_WS   = 'wss://stream.binance.com:9443/ws';

// 成交量分桶：30 秒一桶
const BUCKET_SIZE_MS   = 30_000;
// 最大保留桶数：保留 2 小时的桶（240 桶）
const MAX_BUCKETS      = 240;

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
  let wsRetryDelay  = 1000;   // 初始重试间隔 1s
  const WS_MAX_DELAY = 30_000;
  let wsRetryTimer  = null;
  let wsFallbackActive = false; // REST 兜底是否激活

  // 订阅者列表
  const subscribers = [];

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
    currentPrice  = price;
    lastUpdatedAt = new Date();
    const volStats = calcVolumeStats();
    const snapshot = {
      price,
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
      const res = await fetch(`${BINANCE_REST}/api/v3/ticker/price?symbol=${symbol.toUpperCase()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const price = parseFloat(data.price);
      // REST 模式下无法获得单笔成交量，只更新价格
      notify(price, 'rest');
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

    const streamUrl = `${BINANCE_WS}/${symbol}@aggTrade`;
    logger.info(EVENTS.WS_CONNECT_START, { module: 'price_feed', market_id: symbol.toUpperCase(), msg: streamUrl });

    // 尝试裸连，5s 超时后切换代理模式
    let agent = null;
    const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;

    function createWs(useProxy) {
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
    ws = createWs(false); // 先裸连

    connectTimeout = setTimeout(() => {
      if (!wsConnected) {
        logger.warn(EVENTS.WS_RECONNECT_ATTEMPT, { module: 'price_feed', msg: 'bare connect timed out, retrying with proxy' });
        ws.terminate();
        ws = createWs(true); // 切换代理模式
        attachWsHandlers();
      }
    }, 5000);

    function attachWsHandlers() {
      ws.on('open', () => {
        clearTimeout(connectTimeout);
        wsConnected      = true;
        wsRetryDelay     = 1000;
        wsFallbackActive = false;
        stopRest(); // WebSocket 连通后停止 REST 兜底
        logger.info(EVENTS.WS_CONNECT_OK, { module: 'price_feed', market_id: symbol.toUpperCase() });
      });

      ws.on('message', (data) => {
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
        wsConnected = false;
        logger.warn(EVENTS.WS_DISCONNECT, { module: 'price_feed', market_id: symbol.toUpperCase(), msg: 'starting REST fallback' });
        if (!wsFallbackActive) {
          wsFallbackActive = true;
          startRest();
        }
        scheduleReconnect();
      });

      ws.on('error', (err) => {
        logger.error(EVENTS.WS_CONNECT_FAIL, { module: 'price_feed', market_id: symbol.toUpperCase(), err: err.message });
        // error 后会紧接着触发 close，close handler 里处理重连
      });
    }

    attachWsHandlers();
  }

  function scheduleReconnect() {
    if (wsRetryTimer) return;
    logger.info(EVENTS.WS_RECONNECT_SCHEDULED, { module: 'price_feed', delay_ms: wsRetryDelay });
    wsRetryTimer = setTimeout(() => {
      wsRetryTimer = null;
      connectWs();
    }, wsRetryDelay);
    wsRetryDelay = Math.min(wsRetryDelay * 2, WS_MAX_DELAY);
  }

  // ─── 公开接口 ──────────────────────────────────────────

  function start() {
    const currentMode = config.price_feed?.mode || 'rest';
    console.log(`[PriceFeed] Starting in ${currentMode} mode (symbol=${symbol.toUpperCase()})`);
    if (currentMode === 'ws') {
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
    if (currentPrice !== null) return currentPrice;
    const res = await fetch(`${BINANCE_REST}/api/v3/ticker/price?symbol=${symbol.toUpperCase()}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return parseFloat(data.price);
  }

  async function getKlines() {
    const limit = config.price_feed?.kline_limit || 50;
    const interval = config.price_feed?.kline_interval || '1m';
    const res = await fetch(
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
