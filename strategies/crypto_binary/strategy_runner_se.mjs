// strategy_runner_se.mjs
// 策略编辑器专用运行器（与现有 strategy_runner.mjs 独立，不冲突）
// SE-1: Paper 模式，BUY/SELL/PAIR_POST 只记录日志，不真实下单

import fs from 'fs';
import './proxy_agent.mjs';
import { createOrderManager } from './order_manager.mjs';
import { subscribe, unsubscribe as unsubscribeFromBus, EVENT_TYPES } from './event_bus.mjs';
import { createPriceFeed } from './price_feed.mjs';

// ── 运行器状态 ────────────────────────────────────────────────────────────
let _running    = false;
let _period     = '15m';
let _decideFunc = null;
let _timer      = null;
let _startTime  = null;
let _orderManager = null;
let _stats      = { pnl: 0, trades: 0, wins: 0, losses: 0 };
let _pnlSeries  = [];   // [{ ts, pnl }, ...] 最多 50 个周期
let _logBuffer  = [];   // 环形缓冲，最多 500 条
const _pendingSettlement = []; // [{ upTokenId, downTokenId, orders, startedAt }]
let _priceFeed = null;
let _lastBtcPrice = null;
let _lastTriggerPrice = null; // 上次触发决策时的价格，用于节流
let _lastTickTime = 0;    // 上次 _tick 执行时间，用于事件驱动限频
let _tickRunning = false;  // _tick 互斥锁，防止并发执行
let _settlementTimer = null;       // _checkSettlement 定时器 ID
let _windowSwitchUnsub = null;     // WINDOW_SWITCH 订阅的 handler 引用（用于 unsubscribe）
let _orderbookSubscribed = false;  // orderbook 是否已订阅（全局对象无法移除，用标志避免重复）
let _latency = { decide_ms: null, order_ms: null, ts: 0 };
let _cachedVol = 0;       // 缓存的 ATR14 波动率百分比
let _volWindowSlug = null; // 上次计算波动率时的窗口 slug

// ── 内部工具 ──────────────────────────────────────────────────────────────
function _appendLog(type, msg) {
  const entry = { ts: new Date().toISOString(), type, msg };
  _logBuffer.push(entry);
  _writeLogFile(entry);
  if (_logBuffer.length > 200) _logBuffer.splice(0, _logBuffer.length - 200);
}

function _writeLogFile(entry) {
  try {
    const dir = 'data/crypto_binary/logs';
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    // 交易相关日志写 se_trades.jsonl
    const tradeTypes = ['BUY', 'ORDER', 'FILL', 'SETTLE', 'SETTLE_TIMEOUT', 'SETTLE_PENDING', 'CLOSE', 'CANCEL_ALL'];
    if (tradeTypes.includes(entry.type)) {
      fs.appendFileSync(`${dir}/se_trades.jsonl`, JSON.stringify(entry) + '\n');
    }

    // 系统日志写 se_system.log
    const sysTypes = ['SYSTEM', 'ERROR', 'WINDOW_SWITCH'];
    if (sysTypes.includes(entry.type)) {
      fs.appendFileSync(`${dir}/se_system.log`, `${entry.ts} [${entry.type}] ${entry.msg}\n`);
    }
  } catch (_) {}
}

function _pushPnlPoint() {
  _pnlSeries.push({ ts: Date.now(), pnl: _stats.pnl });
  if (_pnlSeries.length > 50) _pnlSeries.shift();
}

async function _fetchATR14() {
  try {
    const interval = _period === '15m' ? '15m' : '5m';
    const url = `https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=${interval}&limit=15`;
    const res = await fetch(url);
    if (!res.ok) return 0;
    const klines = await res.json();
    if (!klines || klines.length < 2) return 0;

    // klines 格式: [openTime, open, high, low, close, volume, ...]
    // 取最近 14 根已完成的 K 线（去掉最后一根未完成的）
    const completed = klines.slice(0, -1);
    if (completed.length < 2) return 0;

    let sumTR = 0;
    for (const k of completed) {
      const high = parseFloat(k[2]);
      const low = parseFloat(k[3]);
      sumTR += (high - low);
    }
    const atr = sumTR / completed.length;
    const lastClose = parseFloat(completed[completed.length - 1][4]) || 1;
    return (atr / lastClose) * 100;
  } catch (_) {
    return 0;
  }
}

function _calcVolatility() {
  return _cachedVol;
}

async function _checkSettlement() {
  if (_pendingSettlement.length === 0) return;
  const now = Date.now();
  const TIMEOUT_MS = 10 * 60 * 1000;
  const remaining = [];
  for (const entry of [..._pendingSettlement]) {
    if (!entry || !entry.startedAt) continue; // 防御性检查
    // 超时处理
    if (now - entry.startedAt > TIMEOUT_MS) {
      _appendLog('SETTLE_TIMEOUT', `upToken=${entry.upTokenId?.slice(0,8)} orders=${entry.orders?.length}`);
      _pushPnlPoint();
      continue; // 不加入 remaining，相当于删除
    }
    // Group orders by upTokenId
    const groups = {};
    const unSettledOrders = [];

    for (const order of entry.orders) {
      const tId = order.upTokenId || entry.upTokenId;
      if (!tId) {
        unSettledOrders.push(order);
        continue;
      }
      if (!groups[tId]) groups[tId] = [];
      groups[tId].push(order);
    }

    // Process groups
    for (const tId of Object.keys(groups)) {
      const orders = groups[tId];
      let settled = false;
      try {
        const res = await fetch(`https://clob.polymarket.com/book?token_id=${tId}`);
        if (res.ok) {
          const book = await res.json();
          const bids = book.bids || [];
          const asks = book.asks || [];
          const bestBid = parseFloat(bids[0]?.price ?? 0);
          const bestAsk = parseFloat(asks[0]?.price ?? 1);
          const midUp = (bestBid + bestAsk) / 2;
          
          let upWon = null;
          if (midUp >= 0.99) upWon = true;
          else if (midUp <= 0.01) upWon = false;
          
          if (upWon !== null) {
            settled = true;
            for (const order of orders) {
              const won = (order.side === 'UP' && upWon) || (order.side === 'DOWN' && !upWon);
              const pnlDelta = won ? (1.0 - order.price) * order.size : (-order.price) * order.size;
              _stats.pnl += pnlDelta;
              if (pnlDelta > 0) _stats.wins++;
              else _stats.losses++;
              _appendLog('SETTLE', `side=${order.side} price=${order.price.toFixed(4)} pnl=${pnlDelta.toFixed(4)} upWon=${upWon}`);
            }
          }
          _pushPnlPoint();
        }
      } catch(err) {
        _appendLog('ERROR', `Settle check failed: ${err.message}`);
      }
      
      if (!settled) {
        orders.forEach(o => unSettledOrders.push(o));
      }
    }

    if (unSettledOrders.length > 0) {
      entry.orders = unSettledOrders;
      remaining.push(entry);
    }
  }
  // 替换整个数组
  _pendingSettlement.length = 0;
  remaining.forEach(e => _pendingSettlement.push(e));

  // 清除所有已结算或已平仓的订单，防止下次窗口切换重复结算或残留显示
  if (_orderManager && typeof _orderManager.clearSettled === 'function') {
    _orderManager.clearSettled();
  }
}

// ── 定时循环（2 秒） ──────────────────────────────────────────────────────
function _startLoop() {
  _timer = setInterval(_tick, 2000);
}

// ── 决策核心逻辑 ────────────────────────────────────────────────────────
async function _tick() {
  if (!_running || !_decideFunc) return;
  if (_tickRunning) return;  // 已有 _tick 在执行，跳过
  _tickRunning = true;
  const _now = Date.now();
  _lastTickTime = _now;
  const _tickStartTime = _now;
  try {
    try {
      const ctx = await _buildContext();

      if (ctx.window.slug && ctx.window.slug !== _volWindowSlug) {
        _volWindowSlug = ctx.window.slug;
        _fetchATR14().then(v => { _cachedVol = v; });
      }

      // 记录 BTC 价格到滚动缓冲（此处仅作日志用途，波动率由 _fetchATR14 负责）
      if (ctx.price.btc) {
        // _updateCandle(ctx.price.btc); // 已移除
      }

      let result;

      // 超时保护：1 秒
      const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('decide() timeout')), 1000)
      );
      try {
        result = await Promise.race([
          Promise.resolve(_decideFunc(ctx)),
          timeout,
        ]);
      } catch (e) {
        _appendLog('ERROR', `decide() failed: ${e.message}`);
        return;
      }

      const _decideEndTime = Date.now();
      await _handleAction(result, ctx, _tickStartTime, _decideEndTime);

      // ── 模拟成交 ────────────────────────────────────────────────────────
      if (_orderManager && typeof _orderManager.simulateFills === 'function') {
        const snapshot = _buildSnapshot(ctx);
        const fills = _orderManager.simulateFills(snapshot);

        if (fills && fills.length > 0) {
          for (const fill of fills) {
            _appendLog('FILL', `order_id=${fill.order_id.slice(0,8)}... side=${fill.side} price=${fill.price.toFixed(4)}`);
          }
        }
      }
    } catch (err) {
      console.log('[SE_TICK_CATCH]', err.message, err.stack);
      _appendLog('ERROR', err.message);
    }
  } finally {
    _tickRunning = false;
  }
}

// 辅助：从 ctx 构建 snapshot 供 order_manager 使用
function _buildSnapshot(ctx) {
  return {
    bid_up: ctx.orderbook?.best_bid || ctx.orderbook?.bid_up || ctx.price.up - 0.0005,
    ask_up: ctx.orderbook?.best_ask || ctx.orderbook?.ask_up || ctx.price.up + 0.0005,
    bid_down: ctx.orderbook?.bid_down || ctx.price.down - 0.0005,
    ask_down: ctx.orderbook?.ask_down || ctx.price.down + 0.0005,
  };
}

let _windowInfoCache = null;
let _windowInfoCacheTime = 0;

async function _getWindowInfo() {
  const now = Date.now();
  // 30 秒缓存，防止高频调用 scanner API
  if (_windowInfoCache && (now - _windowInfoCacheTime) < 30000) {
    return _windowInfoCache;
  }

  let remaining_sec = null;
  let slug = null;
  let win = null;
  try {
    const scanner = global._btcqddGlobalScanner;
    if (scanner) {
      win = await scanner.findCurrentWindow();
      if (win) {
        slug = win.slug || null;
        if (win.end_date) {
          remaining_sec = Math.max(0, Math.floor((new Date(win.end_date) - Date.now()) / 1000));
        }
      }
    }
  } catch (_) {}
  _windowInfoCache = { remaining_sec, period: _period, slug, _endDate: win?.end_date ? new Date(win.end_date).getTime() : null };
  _windowInfoCacheTime = now;
  return _windowInfoCache;
}

// ── Context 构建 ────────────────────────────────────────────────────
async function _buildContext() {
  let snapshot = null;
  
  // 使用 global._btcqddGetSnapshot 获取快照（避免 fetch 开销和 import 循环）
  // 注：不再 fallback 到 fetch，global._btcqddGetSnapshot 在正常启动后始终可用
  if (global._btcqddGetSnapshot) {
    snapshot = global._btcqddGetSnapshot();
  }

  // 这里的 fetch 导致自调用死锁，已删除
  // regime 暂时为 null
  
  return {
    price: {
      btc: _lastBtcPrice,
      up:          snapshot?.mid_up    || null,
      down:        snapshot?.mid_down  || null,
      spread_up:   snapshot?.spread_up   || null,
      spread_down: snapshot?.spread_down || null,
      // 兼容旧字段
      spread:      snapshot ? (Math.abs((snapshot.mid_up || 0) - (snapshot.mid_down || 0))) : null
    },
    regime: { score: null, sigma: null, alternation: null },
    window: await _getWindowInfo(),
    position: null,
    orderbook: {
      bid_up:   snapshot?.bid_up   || snapshot?.best_bid || null,
      ask_up:   snapshot?.ask_up   || snapshot?.best_ask || null,
      best_bid: snapshot?.bid_up   || snapshot?.best_bid || null,
      best_ask: snapshot?.ask_up   || snapshot?.best_ask || null,
      mid_up:   snapshot?.mid_up   || null,
      bid_down: snapshot?.bid_down || null,
      ask_down: snapshot?.ask_down || null,
      mid_down: snapshot?.mid_down || null,
    },
  };
}

// ── 动作处理 ──────────────────────────────────────────────────────────────
// SE-1: BUY/SELL/PAIR_POST 只记日志，不真实下单；SE-3 联调时再接 order_manager
async function _handleAction(result, ctx, tickStartTime, decideEndTime) {
  // 兼容字符串格式（'BUY_UP' / 'BUY_DOWN' / 'HOLD' / 'CLOSE'）
  if (typeof result === 'string') {
    if (result === 'BUY_UP') result = { action: 'BUY', side: 'UP', price: ctx.price?.up };
    else if (result === 'BUY_DOWN') result = { action: 'BUY', side: 'DOWN', price: ctx.price?.down };
    else if (result === 'HOLD') result = { action: 'HOLD' };
    else if (result === 'CLOSE') result = { action: 'CANCEL_ALL' };
    else result = { action: 'HOLD' };
  }

  if (!result || !result.action) {
    _appendLog('HOLD', `up=${ctx.price?.up?.toFixed(3) ?? 'null'} down=${ctx.price?.down?.toFixed(3) ?? 'null'} vol=${_calcVolatility().toFixed(3)}%`);
    return;
  }

  const { action, side, price } = result;

  switch (action) {
    case 'HOLD':
      _appendLog('HOLD', `up=${ctx.price?.up?.toFixed(3) ?? 'null'} down=${ctx.price?.down?.toFixed(3) ?? 'null'} vol=${_calcVolatility().toFixed(3)}%`);
      break;

    case 'BUY':
      _appendLog('BUY', `side=${side} price=${typeof price === 'number' ? price.toFixed(4) : price} vol=${_calcVolatility().toFixed(3)}%`);
      try {
        const _orderStartTime = Date.now();
        const orderResult = await _orderManager.postOrder({
          side, price,
          type: 'limit',
          size: 1
        });
        _appendLog('ORDER', `order_id=${orderResult?.order_id || 'paper'}`);
        _latency = {
          decide_ms: (decideEndTime && tickStartTime) ? (decideEndTime - tickStartTime) : null,
          order_ms: Date.now() - _orderStartTime,
          ts: Date.now()
        };
      } catch (err) {
        _appendLog('ERROR', `order failed: ${err.message}`);
      }
      break;

    case 'SELL':
      _appendLog('SELL', `side=${side} price=${price}`);
      _stats.trades++;
      try {
        const orderResult = await _orderManager.postOrder({
          side, price,
          type: 'limit',
          size: 1
        });
        _appendLog('ORDER', `order_id=${orderResult?.order_id || 'paper'}`);
      } catch (err) {
        _appendLog('ERROR', `order failed: ${err.message}`);
      }
      break;

    case 'CANCEL_ALL':
      _appendLog('CLOSE', `up=${ctx.price?.up?.toFixed(3) ?? 'null'} down=${ctx.price?.down?.toFixed(3) ?? 'null'} vol=${_calcVolatility().toFixed(3)}%`);
      if (_orderManager) {
        try {
          const allOrders = _orderManager.getAllOrders();
          for (const o of allOrders) {
            if (o.status === 'OPEN') {
              _orderManager.cancelOrder(o.order_id);  // 未成交 → 撤单
            } else if (o.status === 'FILLED') {
              o.status = 'CLOSED';  // 已成交 → 平仓
            }
          }
        } catch (e) {
          _appendLog('ERROR', `CANCEL_ALL failed: ${e.message}`);
        }
      }
      break;

    case 'PAIR_POST':
      _appendLog('PAIR_POST', `up=${result.up_price} down=${result.down_price}`);
      try {
        await Promise.all([
          _orderManager.postOrder({ side: 'UP', price: result.up_price, type: 'limit', size: 1 }),
          _orderManager.postOrder({ side: 'DOWN', price: result.down_price, type: 'limit', size: 1 })
        ]);
        _appendLog('ORDER', 'pair orders posted');
      } catch (err) {
        _appendLog('ERROR', `pair post failed: ${err.message}`);
      }
      break;

    default:
      _appendLog('UNKNOWN', `action=${action}`);
  }
}

// ── 导出接口 ──────────────────────────────────────────────────────────────

const DEFAULT_CODE = `
// 策略函数 decide(ctx)
// 返回: 'BUY_UP' | 'BUY_DOWN' | 'HOLD' | 'CLOSE'
function decide(ctx) {
  // 1. 获取中间价
  const up = ctx.price.up;
  const down = ctx.price.down;
  if (!up || !down) return 'HOLD';

  // 2. 简单的均值回归
  if (ctx.window.remaining_sec != null && ctx.window.remaining_sec < 60) return 'CLOSE';

  // 如果 UP 价格过低 (<0.45) 且剩余时间 > 60s -> 买入 UP
  if (up < 0.45) return 'BUY_UP';
  if (down < 0.45) return 'BUY_DOWN';

  return 'HOLD';
}
`;

export function deploy(code, period) {
  // 停止已有运行
  stop();

  // 解析代码（new Function，不用 eval；只暴露 ctx，不暴露 require/process/fs 等）
  let fn;
  try {
    fn = new Function('ctx', `
      "use strict";
      ${code}
      if (typeof decide !== 'function') throw new Error('decide function not defined');
      return decide(ctx);
    `);
  } catch (err) {
    _appendLog('ERROR', `语法错误: ${err.message}`);
    return { ok: false, error: err.message };
  }

  _decideFunc  = fn;
  _period      = period || '15m';
  _running     = true;
  // 清除上一轮策略的 globalThis 状态变量
  const keysToClean = Object.keys(globalThis).filter(k => k.startsWith('_v') || k.startsWith('_s') || k.startsWith('_test') || k.startsWith('_simple'));
  for (const k of keysToClean) { delete globalThis[k]; }

  _startTime   = Date.now();
  _stats       = { pnl: 0, trades: 0, wins: 0, losses: 0 };
  _pnlSeries   = [{ ts: Date.now(), pnl: 0 }];
  _cachedVol   = 0;
  _volWindowSlug = null;
  _windowInfoCache = null;
  _windowInfoCacheTime = 0;
  _lastTickTime = 0;
  _tickRunning = false;
  _latency = { decide_ms: null, order_ms: null, ts: 0 };
  _pendingSettlement.length = 0;

  // 初始化 OrderManager (Paper 模式)
  _orderManager = createOrderManager({
    paper: { fill_model: 'optimistic', fill_discount: 1.0, fill_delay_ms: 0 },
    risk: { max_position_usd: 1 },
    strategy: { order_tranches: 1, tranche_weights: [1.0] }
  });

  // 适配器：poly-fill postOrder (因为 order_manager 只暴露 placeOrders)
  if (!_orderManager.postOrder) {
    _orderManager.postOrder = async (params) => {
      // params: { side, price, type, size }
      // placeOrders: { side, token_id, mid_price, offset, tick_size }
      const orders = _orderManager.placeOrders({
        side: params.side,
        token_id: params.side, // Paper 模式暂用 side 作 token_id
        mid_price: params.price,
        offset: 0,
        tick_size: 0.0001
      });

      // FIX: Bind current window token IDs
      const snapshot = global._btcqddGetSnapshot ? global._btcqddGetSnapshot() : null;
      if (snapshot && orders[0]) {
        orders[0].upTokenId = snapshot.up_token_id;
        orders[0].downTokenId = snapshot.down_token_id;
      }

      return orders[0];
    };
  }

  _appendLog('SYSTEM', `策略已部署，周期: ${_period}`);
  _appendLog('SYSTEM', `定时器已启动，间隔 2s`);
  _startLoop();
  
  // 启动 price_feed
  if (!_priceFeed) {
    _priceFeed = createPriceFeed({ symbol: 'BTCUSDT', price_feed: { mode: 'ws', poll_sec: 2 } });
    _priceFeed.start();
    _priceFeed.subscribe((snapshot) => {
      const newPrice = snapshot?.price ?? null;
      _lastBtcPrice = newPrice;

      // 事件驱动触发 _tick：价格变化 > 0.1% 且间隔 > 200ms
      if (newPrice && _running && _decideFunc) {
        const now = Date.now();
        const priceChanged = !_lastTriggerPrice || Math.abs(newPrice - _lastTriggerPrice) / _lastTriggerPrice > 0.001;
        const cooldownOk = (now - _lastTickTime) > 200;
        if (priceChanged && cooldownOk) {
          _lastTriggerPrice = newPrice;
          _lastTickTime = now;
          _tick();  // 事件驱动触发
        }
      }
    });

    // Level 1.5: Polymarket 盘口变化也触发 _tick（防重：只订阅一次）
    if (!_orderbookSubscribed && global._btcqddGlobalOrderbook && typeof global._btcqddGlobalOrderbook.subscribe === 'function') {
      _orderbookSubscribed = true;
      global._btcqddGlobalOrderbook.subscribe((snap) => {
        if (!_running || !_decideFunc) return;
        const now = Date.now();
        if ((now - _lastTickTime) > 200) {
          _lastTickTime = now;
          _tick();
        }
      });
    }
  }

  // 启动结算轮询
  if (_settlementTimer) clearInterval(_settlementTimer);
  _settlementTimer = setInterval(_checkSettlement, 10000);

  // 监听窗口切换，加入待结算池（防重：先移除旧 handler）
  if (_windowSwitchUnsub) { unsubscribeFromBus(_windowSwitchUnsub); _windowSwitchUnsub = null; }
  const _wsHandler = async (evt) => {
    if (evt.type !== EVENT_TYPES.WINDOW_SWITCH) return;
    // 将当前所有 FILLED 或 CLOSED 订单加入待结算池
    if (_orderManager && global._btcqddLastWindowTokenIds) {
      const filledOrders = _orderManager.getAllOrders().filter(o => o.status === 'FILLED' || o.status === 'CLOSED');
      if (filledOrders.length > 0) {
        _pendingSettlement.push({
          upTokenId: global._btcqddLastWindowTokenIds.up,
          downTokenId: global._btcqddLastWindowTokenIds.down,
          orders: filledOrders,
          startedAt: Date.now()
        });
        _appendLog('SETTLE_PENDING', `orders=${filledOrders.length} upToken=${global._btcqddLastWindowTokenIds.up.slice(0,8)}`);
      }
    }
  };
  subscribe(_wsHandler);
  _windowSwitchUnsub = _wsHandler;

  return { ok: true };
}

export function stop() {
  if (_timer) { clearInterval(_timer); _timer = null; }
  if (_settlementTimer) { clearInterval(_settlementTimer); _settlementTimer = null; }
  if (_windowSwitchUnsub) { unsubscribeFromBus(_windowSwitchUnsub); _windowSwitchUnsub = null; }
  if (_priceFeed) { _priceFeed.stop(); _priceFeed = null; _lastBtcPrice = null; _lastTriggerPrice = null; }
  _running    = false;
  _decideFunc = null;
  _orderManager = null;
  _appendLog('SYSTEM', '策略已停止');
}

export function getStatus() {
  if (!_running) return { ok: true, running: false };

  let uptime = 0;
  if (_startTime) uptime = Math.floor((Date.now() - _startTime) / 1000);

  // remaining_sec 实时计算（不走 30s 缓存），slug 用缓存值
  let _statusRemainingSec = null;
  let _statusSlug = _windowInfoCache?.slug || null;
  try {
    const scanner = global._btcqddGlobalScanner;
    if (scanner && _windowInfoCache?.slug) {
      // 用缓存的 end_date 重新算 remaining（纯数学，不调 API）
      if (_windowInfoCache._endDate) {
        _statusRemainingSec = Math.max(0, Math.floor((_windowInfoCache._endDate - Date.now()) / 1000));
      }
    }
  } catch (_) {}

  // 获取订单状态
  let openOrders = [];
  let pendingSettle = [];
  let filledOrders = [];
  if (_orderManager) {
    try {
      openOrders = _orderManager.getAllOrders()
        .filter(o => o.status === 'OPEN')
        .map(o => ({ side: o.side, price: o.price, size: o.size, status: 'open' }));
      filledOrders = _orderManager.getAllOrders()
        .filter(o => o.status === 'FILLED' || o.status === 'CLOSED' || o.status === 'CANCELLED')
        .map(o => ({
          side: o.side, price: o.price, size: o.size,
          status: o.status === 'CLOSED' ? 'closed' : o.status === 'CANCELLED' ? 'cancelled' : 'filled'
        }));
    } catch (_) {}
  }

  return {
    ok: true,
    running:    _running,
    latency: _latency.ts > 0 ? _latency : null,
    period:     _period,
    uptime_sec: uptime,
    stats:      { ..._stats, trades: (_stats.wins || 0) + (_stats.losses || 0) },
    pnl_series: [..._pnlSeries],
    window: {
      remaining_sec: _statusRemainingSec ?? _windowInfoCache?.remaining_sec ?? null,
      period: _period,
      slug: _statusSlug
    },
    orders: {
      open: openOrders,
      filled: filledOrders,
      pending_settlement: _pendingSettlement.map(e => ({
        upTokenId: e.upTokenId.slice(0,8),
        count: e.orders?.length || 0,
        startedAt: e.startedAt
      }))
    }
  };
}

export function getLogs() {
  return { logs: [..._logBuffer] };
}
