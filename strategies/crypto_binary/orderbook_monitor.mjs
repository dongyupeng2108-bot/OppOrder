// orderbook_monitor.mjs — Polymarket 盘口监控（REST + WebSocket 双模式）
// ws 模式：pm_ws_client 为主 + REST 定期校验 + REST 兜底
// rest 模式：纯 REST 轮询（向后兼容）

import './proxy_agent.mjs';
import { createPmWsClient } from './pm_ws_client.mjs';

const PM_CLOB = 'https://clob.polymarket.com';
const VERIFY_INTERVAL_MS = 5 * 60_000; // 每 5 分钟 REST 全量校验

// tick_size 推断（与原版相同）
export function inferTickSize(price) {
  if (price >= 0.96 || price <= 0.04) return 0.001;
  return 0.01;
}

// 向下对齐 tick_size（浮点精度安全版）
export function floorToTick(price, tickSize) {
  const inv = Math.round(1 / tickSize);
  return Math.floor(price * inv) / inv;
}

export function createOrderbookMonitor(config) {
  const pollSec = config.polymarket_poll_sec || 2;
  const mode    = config.polymarket_mode || 'rest';
  let firstSnapshotLogged = false;

  // 当前盘口状态
  let state = _emptyState();
  let stale = false;  // true = 窗口切换中，策略层不应挂单

  // REST 轮询 timer
  let restTimer    = null;
  let verifyTimer  = null;

  // WebSocket 客户端
  let wsClient = null;

  // 当前窗口的 token IDs（ws 模式下用于订阅）
  let currentUpTokenId   = null;
  let currentDownTokenId = null;

  // 订阅者
  const subscribers = [];

  function _emptyState() {
    return {
      bid_up: null, ask_up: null, mid_up: null, spread_up: null,
      bid_down: null, ask_down: null, mid_down: null, spread_down: null,
      tick_size: 0.01, tick_size_changed: false,
      up_token_id: null, down_token_id: null,
      sampled_at: null,
    };
  }

  // ─── REST 拉取 ──────────────────────────────────────────

  async function fetchSnapshot(upTokenId, downTokenId) {
    try {
      const [upRes, downRes] = await Promise.all([
        fetch(`${PM_CLOB}/book?token_id=${upTokenId}`),
        fetch(`${PM_CLOB}/book?token_id=${downTokenId}`),
      ]);
      if (!upRes.ok || !downRes.ok) throw new Error('REST book fetch failed');
      const [upBook, downBook] = await Promise.all([upRes.json(), downRes.json()]);
      return _parseBooks(upBook, downBook, upTokenId, downTokenId);
    } catch (e) {
      console.error('[OrderbookMonitor] REST fetch error:', e.message);
      return null;
    }
  }

  function _parseBooks(upBook, downBook, upTokenId, downTokenId) {
    // Polymarket /book bids 升序（最优在最后），asks 降序（最优在最后）
    const upBids   = upBook.bids   || [];
    const upAsks   = upBook.asks   || [];
    const downBids = downBook.bids || [];
    const downAsks = downBook.asks || [];

    const bid_up   = parseFloat(upBids[upBids.length - 1]?.price     ?? 0);
    const ask_up   = parseFloat(upAsks[upAsks.length - 1]?.price     ?? 1);
    const bid_down = parseFloat(downBids[downBids.length - 1]?.price ?? 0);
    const ask_down = parseFloat(downAsks[downAsks.length - 1]?.price ?? 1);
    const mid_up   = (bid_up + ask_up) / 2;
    const mid_down = (bid_down + ask_down) / 2;
    const tick_size = inferTickSize(mid_up);

    return {
      bid_up, ask_up, mid_up, spread_up: ask_up - bid_up,
      bid_down, ask_down, mid_down, spread_down: ask_down - bid_down,
      tick_size, tick_size_changed: tick_size !== state.tick_size,
      up_token_id: upTokenId, down_token_id: downTokenId,
      sampled_at: new Date(),
    };
  }

  function _applySnapshot(snapshot) {
    const prevTick = state.tick_size;
    state = { ...snapshot };
    if (!firstSnapshotLogged) {
      firstSnapshotLogged = true;
      console.log(`[OrderbookMonitor] snapshot ready: mid_up=${snapshot.mid_up?.toFixed(4)} mid_down=${snapshot.mid_down?.toFixed(4)}`);
    }
    if (state.tick_size !== prevTick) {
      state.tick_size_changed = true;
      console.log(`[OrderbookMonitor] tick_size_change: ${prevTick} → ${state.tick_size}`);
    } else {
      state.tick_size_changed = false;
    }
    _notify();
  }

  function _notify() {
    const snap = { ...state, stale };
    subscribers.forEach(cb => {
      try { cb(snap); } catch (e) {
        console.error('[OrderbookMonitor] subscriber error:', e.message);
      }
    });
  }

  // ─── REST 模式 ──────────────────────────────────────────

  async function _restPoll() {
    if (!currentUpTokenId || !currentDownTokenId) return;
    const snapshot = await fetchSnapshot(currentUpTokenId, currentDownTokenId);
    if (snapshot) _applySnapshot(snapshot);
  }

  function startRest() {
    if (restTimer) return;
    _restPoll();
    restTimer = setInterval(_restPoll, pollSec * 1000);
  }

  function stopRest() {
    if (restTimer) { clearInterval(restTimer); restTimer = null; }
  }

  // ─── WebSocket 模式 ─────────────────────────────────────

  function _startWs() {
    wsClient = createPmWsClient();

    wsClient.on('connected', async () => {
      // 连通后立即用 REST 拉全量快照建立基准状态
      if (currentUpTokenId && currentDownTokenId) {
        const snapshot = await fetchSnapshot(currentUpTokenId, currentDownTokenId);
        if (snapshot) _applySnapshot(snapshot);
        stale = false;
      }
      stopRest(); // WebSocket 连通后停止 REST 兜底
      _startVerifyTimer();
    });

    wsClient.on('disconnected', () => {
      // 断线后启动 REST 兜底
      _stopVerifyTimer();
      startRest();
    });

    wsClient.on('book', (msg) => {
      // 增量 delta 更新盘口
      _applyBookDelta(msg);
    });

    wsClient.on('last_trade_price', (msg) => {
      // 最新成交价，更新 mid
      if (msg.asset_id === currentUpTokenId) {
        state.mid_up = parseFloat(msg.price);
      } else if (msg.asset_id === currentDownTokenId) {
        state.mid_down = parseFloat(msg.price);
      }
      _notify();
    });

    wsClient.on('tick_size_change', (msg) => {
      const newTick = parseFloat(msg.new_tick_size || msg.tick_size);
      if (newTick && newTick !== state.tick_size) {
        console.log(`[OrderbookMonitor] tick_size_change event: ${state.tick_size} → ${newTick}`);
        state.tick_size         = newTick;
        state.tick_size_changed = true;
        _notify();
        state.tick_size_changed = false; // 通知后重置，避免重复触发
      }
    });

    wsClient.on('price_change', (msg) => {
      // price_change 事件：更新对应侧的 mid
      if (msg.asset_id === currentUpTokenId) {
        state.mid_up = parseFloat(msg.price);
      } else if (msg.asset_id === currentDownTokenId) {
        state.mid_down = parseFloat(msg.price);
      }
      _notify();
    });

    if (currentUpTokenId && currentDownTokenId) {
      wsClient.connect([currentUpTokenId, currentDownTokenId]);
    }
  }

  function _applyBookDelta(msg) {
    // Polymarket book delta 格式：{ asset_id, changes: [{price, side, size}] }
    if (!msg.changes) return;
    for (const change of msg.changes) {
      const price = parseFloat(change.price);
      const side  = change.side; // 'BUY' | 'SELL'
      if (msg.asset_id === currentUpTokenId) {
        if (side === 'BUY')  state.bid_up  = price;
        if (side === 'SELL') state.ask_up  = price;
        state.mid_up    = (state.bid_up + state.ask_up) / 2;
        state.spread_up = state.ask_up - state.bid_up;
      } else if (msg.asset_id === currentDownTokenId) {
        if (side === 'BUY')  state.bid_down  = price;
        if (side === 'SELL') state.ask_down  = price;
        state.mid_down    = (state.bid_down + state.ask_down) / 2;
        state.spread_down = state.ask_down - state.bid_down;
      }
    }
    state.sampled_at = new Date();
    // 检查 tick_size 变化（基于 mid_up）
    const newTick = inferTickSize(state.mid_up || 0.5);
    if (newTick !== state.tick_size) {
      state.tick_size         = newTick;
      state.tick_size_changed = true;
    } else {
      state.tick_size_changed = false;
    }
    _notify();
  }

  // ─── REST 全量校验 ──────────────────────────────────────

  function _startVerifyTimer() {
    if (verifyTimer) return;
    verifyTimer = setInterval(async () => {
      if (!currentUpTokenId || !currentDownTokenId) return;
      const fresh = await fetchSnapshot(currentUpTokenId, currentDownTokenId);
      if (!fresh) return;
      // 简单一致性检查：bid/ask 偏差超过 0.02 则重新初始化
      const upDiff   = Math.abs((fresh.bid_up   - state.bid_up)   ?? 0);
      const downDiff = Math.abs((fresh.bid_down - state.bid_down) ?? 0);
      if (upDiff > 0.02 || downDiff > 0.02) {
        console.warn('[OrderbookMonitor] State inconsistency detected, reinitializing...');
        _applySnapshot(fresh);
      }
    }, VERIFY_INTERVAL_MS);
  }

  function _stopVerifyTimer() {
    if (verifyTimer) { clearInterval(verifyTimer); verifyTimer = null; }
  }

  // ─── 窗口切换 ───────────────────────────────────────────

  /**
   * 更新当前监控的 token IDs（每个新窗口开始时调用）
   * ws 模式：标记 stale → 全量初始化 → 更新订阅 → 取消 stale
   * rest 模式：直接更新 token IDs，下次轮询生效
   */
  async function setTokenIds(upTokenId, downTokenId) {
    currentUpTokenId   = upTokenId;
    currentDownTokenId = downTokenId;
    state.up_token_id   = upTokenId;
    state.down_token_id = downTokenId;

    if (mode === 'ws' && wsClient) {
      stale = true;  // 切换期间标记 stale
      const snapshot = await fetchSnapshot(upTokenId, downTokenId);
      if (snapshot) _applySnapshot(snapshot);
      wsClient.updateSubscription([upTokenId, downTokenId]);
      stale = false;
    }
  }

  // ─── 公开接口 ───────────────────────────────────────────

  function start(upTokenId, downTokenId) {
    currentUpTokenId   = upTokenId   || null;
    currentDownTokenId = downTokenId || null;

    console.log(`[OrderbookMonitor] Starting in ${mode} mode`);
    if (mode === 'ws') {
      _startWs();
    } else {
      startRest();
    }
  }

  function stop() {
    stopRest();
    _stopVerifyTimer();
    if (wsClient) { wsClient.disconnect(); wsClient = null; }
  }

  function subscribe(callback) {
    subscribers.push(callback);
  }

  function getLatestSnapshot() {
    return { ...state, stale };
  }

  function isStale() { return stale; }

  return {
    start, stop, subscribe, setTokenIds,
    getLatestSnapshot, isStale,
    // 向后兼容（原版接口）
    inferTickSize, floorToTick,
  };
}
