// strategy_runner_se.mjs
// 策略编辑器专用运行器（与现有 strategy_runner.mjs 独立，不冲突）
// SE-1: Paper 模式，BUY/SELL/PAIR_POST 只记录日志，不真实下单

import './proxy_agent.mjs';
import { createOrderManager } from './order_manager.mjs';

// ── 运行器状态 ────────────────────────────────────────────────────────────
let _running    = false;
let _period     = '15m';
let _decideFunc = null;
let _timer      = null;
let _startTime  = null;
let _orderManager = null;
let _stats      = { pnl: 0, trades: 0, wins: 0, losses: 0 };
let _pnlSeries  = [];   // [{ hour: 0, pnl: 0 }, ...]
let _logBuffer  = [];   // 环形缓冲，最多 500 条
let _lastPnlHour = -1;

// ── 内部工具 ──────────────────────────────────────────────────────────────
function _appendLog(type, msg) {
  const entry = { ts: new Date().toISOString(), type, msg };
  _logBuffer.push(entry);
  if (_logBuffer.length > 200) _logBuffer.shift();
}

function _updatePnlSeries() {
  if (!_startTime) return;
  const elapsedHours = Math.floor((Date.now() - _startTime) / 3600000);
  if (elapsedHours > _lastPnlHour) {
    _lastPnlHour = elapsedHours;
    _pnlSeries.push({ hour: elapsedHours, pnl: _stats.pnl });
  }
}

// ── 定时循环（2 秒） ──────────────────────────────────────────────────────
function _startLoop() {
  _timer = setInterval(async () => {
    if (!_running || !_decideFunc) return;
    try {
      const ctx = await _buildContext();
      let result;

      // 超时保护：1 秒
      const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('decide() timeout')), 1000)
      );
      result = await Promise.race([
        Promise.resolve(_decideFunc(ctx)),
        timeout,
      ]);

      await _handleAction(result, ctx);

      // ── 模拟成交 ────────────────────────────────────────────────────────
      try {
        if (_orderManager && typeof _orderManager.simulateFills === 'function') {
          const snapshot = _buildSnapshot(ctx);
          const fills = _orderManager.simulateFills(snapshot);
          
          if (fills && fills.length > 0) {
            for (const fill of fills) {
              // 计算 PnL: fill.price 与 mid_price 的差值 (假设立即平仓)
              // 注意：这里仅作演示，真实 PnL 需要 PositionManager
              const mid = fill.side === 'UP' ? ctx.price.up : ctx.price.down;
              const pnlDelta = (mid - fill.price) * fill.size; // 简单估算
              
              _stats.pnl += pnlDelta;
              if (pnlDelta > 0) _stats.wins++;
              else if (pnlDelta < 0) _stats.losses++;
              
              _appendLog('FILL', `order_id=${fill.order_id.slice(0,8)}... side=${fill.side} price=${fill.price.toFixed(4)} pnl=${pnlDelta.toFixed(4)}`);
            }
          }
        }
      } catch (err) {
        _appendLog('ERROR', `simulateFills: ${err.message}`);
      }
      
      _updatePnlSeries();
    } catch (err) {
      console.log('[SE_TICK_CATCH]', err.message, err.stack);
      _appendLog('ERROR', err.message);
    }
  }, 2000);
}

// 辅助：从 ctx 构建 snapshot 供 order_manager 使用
function _buildSnapshot(ctx) {
  return {
    bid_up: ctx.orderbook?.bid_up || ctx.price.up - 0.0005,
    ask_up: ctx.orderbook?.ask_up || ctx.price.up + 0.0005,
    bid_down: ctx.orderbook?.bid_down || ctx.price.down - 0.0005,
    ask_down: ctx.orderbook?.ask_down || ctx.price.down + 0.0005,
  };
}

// ── Context 构建 ──────────────────────────────────────────────────────────
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
      btc: null,
      up:          snapshot?.mid_up    || null,
      down:        snapshot?.mid_down  || null,
      spread_up:   snapshot?.spread_up   || null,
      spread_down: snapshot?.spread_down || null,
      // 兼容旧字段
      spread:      snapshot ? (Math.abs((snapshot.mid_up || 0) - (snapshot.mid_down || 0))) : null
    },
    regime: { score: null, sigma: null, alternation: null },
    window: { remaining_sec: null, period: _period, slug: null },
    position: null,
    orderbook: {
      bid_up:   snapshot?.bid_up   || null,
      ask_up:   snapshot?.ask_up   || null,
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
  if (!result || !result.action) {
    _appendLog('HOLD', 'no action');
    return;
  }

  const { action, side, price } = result;

  switch (action) {
    case 'HOLD':
      _appendLog('HOLD', `score=${ctx.regime?.score?.toFixed(2)}`);
      break;

    case 'BUY':
      _appendLog('BUY', `side=${side} price=${price}`);
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
      _appendLog('CANCEL_ALL', '');
      break;

    case 'PAIR_POST':
      _appendLog('PAIR_POST', `up=${result.up_price} down=${result.down_price}`);
      _stats.trades++;
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
  _startTime   = Date.now();
  _stats       = { pnl: 0, trades: 0, wins: 0, losses: 0 };
  _pnlSeries   = [{ hour: 0, pnl: 0 }];
  _lastPnlHour = 0;

  // 初始化 OrderManager (Paper 模式)
  _orderManager = createOrderManager({ mode: 'paper', fill_model: 'conservative' });

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
      return orders[0];
    };
  }

  _appendLog('SYSTEM', `策略已部署，周期: ${_period}`);
  _appendLog('SYSTEM', `定时器已启动，间隔 2s`);
  _startLoop();
  return { ok: true };
}

export function stop() {
  if (_timer) { clearInterval(_timer); _timer = null; }
  _running    = false;
  _decideFunc = null;
  _orderManager = null;
  _appendLog('SYSTEM', '策略已停止');
}

export function getStatus() {
  return {
    running:    _running,
    period:     _period,
    uptime_sec: _startTime ? Math.floor((Date.now() - _startTime) / 1000) : 0,
    stats:      { ..._stats },
    pnl_series: [..._pnlSeries],
  };
}

export function getLogs() {
  return { logs: [..._logBuffer] };
}
