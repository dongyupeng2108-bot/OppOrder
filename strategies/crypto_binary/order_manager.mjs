// order_manager.mjs — 挂单生命周期管理
// 工厂函数模式：createOrderManager(config)

import './proxy_agent.mjs';
import { floorToTick } from './orderbook_monitor.mjs';
import crypto from 'crypto';

/**
 * Order 对象格式：
 * {
 *   order_id: string,
 *   strategy_id: string,
 *   side: 'UP' | 'DOWN',
 *   token_id: string,
 *   price: number,           // 已对齐 tick_size
 *   size: number,            // USD
 *   tranche_index: number,   // 0-based，单档时为 0
 *   status: 'OPEN' | 'FILLED' | 'CANCELLED' | 'STALE',
 *   fill_model: 'optimistic' | 'conservative',
 *   created_at: Date,
 *   cancel_issued_at: Date | null,
 *   cancel_confirmed_at: Date | null,
 *   cancel_latency_ms: number | null,
 * }
 */

export function createOrderManager(config) {
  const {
    order_tranches = 1,
    tranche_spread = 0.5,
    tranche_weights = [1.0],
  } = config.strategy || {};

  const fillModel = config.paper?.fill_model || 'conservative';
  const fillDiscount = config.paper?.fill_discount ?? 0.5;
  const fillDelayMs = config.paper?.fill_delay_ms ?? 500;
  const maxPositionUsd = config.risk?.max_position_usd ?? 5;

  // 活跃挂单列表
  const orders = new Map(); // order_id → Order

  /**
   * 计算多档挂单的价格和仓位
   * @param {number} midPrice   — 当前 mid_price
   * @param {number} offset     — 基础偏移量
   * @param {number} tickSize   — 当前 tick_size
   * @returns {Array<{price, size}>}
   */
  function calcTranches(midPrice, offset, tickSize) {
    const weights = tranche_weights.slice(0, order_tranches);
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    return weights.map((w, i) => {
      const trancheOffset = offset * (1 + i * tranche_spread);
      const rawPrice = midPrice - trancheOffset;
      const price = floorToTick(Math.max(rawPrice, tickSize), tickSize);
      const size = (w / totalWeight) * maxPositionUsd;
      return { price, size, tranche_index: i };
    });
  }

  /**
   * 挂单（Paper 模式）
   * @param {object} params
   * @returns {Order[]} 新建的挂单列表
   */
  function placeOrders({ side, token_id, mid_price, offset, tick_size }) {
    const tranches = calcTranches(mid_price, offset, tick_size);
    const newOrders = [];

    for (const t of tranches) {
      const order = {
        order_id: crypto.randomUUID(),
        strategy_id: config.strategy_id,
        side,
        token_id,
        price: t.price,
        size: t.size,
        tranche_index: t.tranche_index,
        status: 'OPEN',
        fill_model: fillModel,
        created_at: new Date(),
        cancel_issued_at: null,
        cancel_confirmed_at: null,
        cancel_latency_ms: null,
      };
      orders.set(order.order_id, order);
      newOrders.push(order);
      console.log(`[OrderManager] PLACE ${side} tranche=${t.tranche_index} price=${t.price.toFixed(4)} size=${t.size.toFixed(2)}`);
    }
    return newOrders;
  }

  /**
   * 撤单（埋点 cancel_issued_at）
   * @param {string} order_id
   */
  function cancelOrder(order_id) {
    const order = orders.get(order_id);
    if (!order || order.status !== 'OPEN') return;
    order.cancel_issued_at = new Date();
    order.status = 'CANCELLED';

    // Paper 模式：立即确认撤单
    setTimeout(() => {
      order.cancel_confirmed_at = new Date();
      order.cancel_latency_ms = order.cancel_confirmed_at - order.cancel_issued_at;
      console.log(`[OrderManager] CANCEL ${order.side} tranche=${order.tranche_index} latency=${order.cancel_latency_ms}ms`);
    }, 0);
  }

  /**
   * 撤销所有 OPEN 挂单（tick_size_change 或窗口结束时调用）
   * @returns {string[]} 撤销的 order_id 列表
   */
  function cancelAll(reason = 'manual') {
    const cancelled = [];
    for (const [id, order] of orders) {
      if (order.status === 'OPEN') {
        cancelOrder(id);
        cancelled.push(id);
      }
    }
    if (cancelled.length > 0) {
      console.log(`[OrderManager] cancelAll reason=${reason} count=${cancelled.length}`);
    }
    return cancelled;
  }

  /**
   * 将所有 OPEN 挂单标记为 STALE（tick_size 变更时调用）
   */
  function markAllStale() {
    for (const order of orders.values()) {
      if (order.status === 'OPEN') order.status = 'STALE';
    }
    console.log('[OrderManager] All open orders marked STALE');
  }

  /**
   * Paper fill 模拟：检查当前 bid/ask 是否触价，若触价则模拟成交
   * @param {object} snapshot — OrderbookSnapshot
   * @returns {Order[]} 本次成交的挂单列表
   */
  function simulateFills(snapshot) {
    const filled = [];
    for (const order of orders.values()) {
      if (order.status !== 'OPEN') continue;

      // UP 侧 bid 挂单：触价条件 = ask_up <= order.price（买方愿意接受）
      // DOWN 侧 bid 挂单：触价条件 = ask_down <= order.price
      const marketAsk = order.side === 'UP' ? snapshot.ask_up : snapshot.ask_down;
      const touched = marketAsk <= order.price;

      if (!touched) continue;

      if (order.fill_model === 'optimistic') {
        // 乐观：触价即成交
        order.status = 'FILLED';
        filled.push(order);
        console.log(`[OrderManager] FILL(optimistic) ${order.side} tranche=${order.tranche_index} price=${order.price.toFixed(4)}`);
      } else {
        // 保守：按 fill_discount 概率成交，且延迟 fillDelayMs
        if (Math.random() < fillDiscount) {
          setTimeout(() => {
            if (order.status === 'OPEN') {
              order.status = 'FILLED';
              filled.push(order);
              console.log(`[OrderManager] FILL(conservative) ${order.side} tranche=${order.tranche_index} price=${order.price.toFixed(4)}`);
            }
          }, fillDelayMs);
        }
      }
    }
    return filled;
  }

  /**
   * 获取所有 OPEN 挂单
   */
  function getOpenOrders() {
    return [...orders.values()].filter(o => o.status === 'OPEN');
  }

  /**
   * 获取所有挂单（含已成交/撤销）
   */
  function getAllOrders() {
    return [...orders.values()];
  }

  /**
   * 清除已完成/撤销挂单（窗口结束时调用，释放内存）
   */
  function clearSettled() {
    for (const [id, order] of orders) {
      if (['FILLED', 'CANCELLED', 'STALE'].includes(order.status)) {
        orders.delete(id);
      }
    }
  }

  return {
    placeOrders,
    cancelOrder,
    cancelAll,
    markAllStale,
    simulateFills,
    getOpenOrders,
    getAllOrders,
    clearSettled,
    calcTranches, // 暴露供测试
  };
}
