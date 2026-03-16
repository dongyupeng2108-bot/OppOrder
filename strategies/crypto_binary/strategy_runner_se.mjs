// strategy_runner_se.mjs
// 策略编辑器专用运行器（与现有 strategy_runner.mjs 独立，不冲突）
// SE-1: Paper 模式，BUY/SELL/PAIR_POST 只记录日志，不真实下单

import fs from 'fs';
import './proxy_agent.mjs';
import { createOrderManager } from './order_manager.mjs';
import { subscribe, EVENT_TYPES } from './event_bus.mjs';
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
let _priceBuf = [];  // 滚动价格缓冲，最多 15 个 BTC 价格

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

function _calcVolatility() {
  if (_priceBuf.length < 2) return 0;
  let sumPctChange = 0;
  for (let i = 1; i < _priceBuf.length; i++) {
    sumPctChange += Math.abs(_priceBuf[i] - _priceBuf[i - 1]) / _priceBuf[i - 1];
  }
  return sumPctChange / (_priceBuf.length - 1) * 100;  // 百分比
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
          const bestBid = parseFloat(bids[bids.length-1]?.price ?? 0);
          const bestAsk = parseFloat(asks[asks.length-1]?.price ?? 1);
          const midUp = (bestBid + bestAsk) / 2;
          
          let upWon = null;
          if (midUp >= 0.99) upWon = true;
          else if (midUp <= 0.01) upWon = false;
          
          if (upWon !== null) {
            settled = true;
            for (const order of orders) {
              const won = (order.side === 'UP' && upWon) || (order.side === 'DOWN' && !upWon);
              const pnlDelta = won ? (1.0 - order.price) * order.size : (-order.price) * order.size;
              // PnL 已在 simulateFills 中计算，此处不重复更新 _stats
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

  // 清除所有已结算（FILLED）订单，防止下次窗口切换重复结算
  if (_orderManager) _orderManager.clearSettled();
}

// ── 定时循环（2 秒） ──────────────────────────────────────────────────────
function _startLoop() {
  _timer = setInterval(_tick, 2000);
}

// ── 决策核心逻辑 ────────────────────────────────────────────────────────
async function _tick() {
  if (!_running || !_decideFunc) return;
  try {
    const ctx = await _buildContext();
    
    // 记录 BTC 价格到滚动缓冲
    if (ctx.price.btc) {
      _priceBuf.push(ctx.price.btc);
      if (_priceBuf.length > 15) _priceBuf.shift();
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

    await _handleAction(result, ctx);

    // ── 模拟成交 ────────────────────────────────────────────────────────
    if (_orderManager && typeof _orderManager.simulateFills === 'function') {
      const snapshot = _buildSnapshot(ctx);
      const fills = _orderManager.simulateFills(snapshot);
      
      if (fills && fills.length > 0) {
        for (const fill of fills) {
          // 计算 PnL: fill.price 与 mid_price 的差值 (假设立即平仓)
          // 注意：这里仅作演示，真实 PnL 需要 PositionManager
          const mid = fill.side === 'UP' ? (ctx.price.up || 0.5) : (ctx.price.down || 0.5);
          const pnlDelta = (mid - fill.price) * fill.size; // 简单估算
          
          _stats.pnl += pnlDelta;
          if (pnlDelta > 0) _stats.wins++;
          else if (pnlDelta < 0) _stats.losses++;
          
          _appendLog('FILL', `order_id=${fill.order_id.slice(0,8)}... side=${fill.side} price=${fill.price.toFixed(4)} pnl=${pnlDelta.toFixed(4)}`);
        }
        _pushPnlPoint();
      }
    }
  } catch (err) {
    console.log('[SE_TICK_CATCH]', err.message, err.stack);
    _appendLog('ERROR', err.message);
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

async function _getWindowInfo() {
  let remaining_sec = null;
  let slug = null;
  try {
    const scanner = global._btcqddGlobalScanner;
    if (scanner) {
      const win = await scanner.findCurrentWindow();
      if (win) {
        slug = win.slug || null;
        if (win.end_date) {
          remaining_sec = Math.max(0, Math.floor((new Date(win.end_date) - Date.now()) / 1000));
        }
      }
    }
  } catch (_) {}
  return { remaining_sec, period: _period, slug };
}

// ── Context 构建 ────────────────────────────────────────────────────
async function _buildContext() {
  let snapshot = null;
  
  // 优先使用 global._btcqddGetSnapshot 获取快照（避免 fetch 开销和 import 循环）
  if (global._btcqddGetSnapshot) {
    snapshot = global._btcqddGetSnapshot();
  } else {
    try {
      const res = await fetch('http://localhost:53123/book/snapshot');
      if (res.ok) {
          snapshot = await res.json();
      }
    } catch (_) {}
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
async function _handleAction(result, ctx) {
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
          const actives = _orderManager.getActiveOrders();
          for (const o of actives) {
            await _orderManager.cancelOrder(o.order_id);
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
  _priceBuf    = [];

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
      _lastBtcPrice = snapshot?.price ?? null;
      // 节流：价格变化超过 0.1% 才触发决策
      if (_lastBtcPrice && _lastTriggerPrice) {
        const change = Math.abs(_lastBtcPrice - _lastTriggerPrice) / _lastTriggerPrice;
        if (change < 0.001) return; // 小于 0.1% 不触发
      }
      _lastTriggerPrice = _lastBtcPrice;
      _tick(); // 触发一次决策
    });
  }
  
  // 启动结算轮询
  setInterval(_checkSettlement, 10000);

  // 监听窗口切换，加入待结算池
  subscribe(async (evt) => {
    if (evt.type !== EVENT_TYPES.WINDOW_SWITCH) return;
    // 将当前所有 FILLED 订单加入待结算池
    if (_orderManager && global._btcqddLastWindowTokenIds) {
      const filledOrders = _orderManager.getAllOrders().filter(o => o.status === 'FILLED');
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
  });

  return { ok: true };
}

export function stop() {
  if (_timer) { clearInterval(_timer); _timer = null; }
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

  // 获取订单状态
  let openOrders = [];
  let pendingSettle = [];
  let filledOrders = [];
  if (_orderManager) {
    try {
      openOrders = _orderManager.getAllOrders()
        .filter(o => o.status === 'OPEN')
        .map(o => ({ side: o.side, price: o.price, size: o.size }));
      filledOrders = _orderManager.getAllOrders()
        .filter(o => o.status === 'FILLED')
        .map(o => ({ side: o.side, price: o.price, size: o.size }));
    } catch (_) {}
  }

  return {
    ok: true,
    running:    _running,
    period:     _period,
    uptime_sec: uptime,
    stats:      { ..._stats, trades: (_stats.wins || 0) + (_stats.losses || 0) },
    pnl_series: [..._pnlSeries],
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
