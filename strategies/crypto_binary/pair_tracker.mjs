// pair_tracker.mjs — 配对成本实时追踪（S1 专用）
// 工厂函数模式：createPairTracker(config)

/**
 * PairState 格式：
 * {
 *   qty_up: number,       // UP 侧已成交份额总量
 *   cost_up: number,      // UP 侧已成交 USD 总成本
 *   avg_up: number,       // UP 侧加权均价
 *   qty_down: number,
 *   cost_down: number,
 *   avg_down: number,
 *   pair_cost: number,    // 配对成本 = avg_up + avg_down（完全配对时）
 *   balance_ratio: number // qty_up / qty_down（或反向，>1 表示不平衡）
 * }
 */

export function createPairTracker(config) {
  const { pair_cost_target } = config.strategy;

  let state = _emptyState();

  function _emptyState() {
    return {
      qty_up: 0, cost_up: 0, avg_up: 0,
      qty_down: 0, cost_down: 0, avg_down: 0,
      pair_cost: null,
      balance_ratio: null,
    };
  }

  /**
   * 记录一笔成交
   * @param {'UP'|'DOWN'} side
   * @param {number} price  — 成交价格（0~1）
   * @param {number} size   — 成交 USD 金额
   */
  function recordFill(side, price, size) {
    const qty = size / price; // 份额 = USD / 价格

    if (side === 'UP') {
      state.cost_up += size;
      state.qty_up += qty;
      state.avg_up = state.qty_up > 0 ? state.cost_up / state.qty_up : 0;
    } else {
      state.cost_down += size;
      state.qty_down += qty;
      state.avg_down = state.qty_down > 0 ? state.cost_down / state.qty_down : 0;
    }

    _recalc();
    console.log(`[PairTracker] fill ${side} price=${price.toFixed(4)} size=${size.toFixed(2)} pair_cost=${state.pair_cost?.toFixed(4) ?? 'N/A'}`);
  }

  /**
   * 多档成交批量记录
   * @param {Array<{side, price, size}>} fills
   */
  function recordFills(fills) {
    for (const f of fills) recordFill(f.side, f.price, f.size);
  }

  function _recalc() {
    // pair_cost 只在两侧都有持仓时有意义
    if (state.qty_up > 0 && state.qty_down > 0) {
      state.pair_cost = state.avg_up + state.avg_down;
    } else {
      state.pair_cost = null;
    }

    // balance_ratio：较多侧 / 较少侧，qty=0 时为 null
    if (state.qty_up > 0 && state.qty_down > 0) {
      state.balance_ratio = state.qty_up > state.qty_down
        ? state.qty_up / state.qty_down
        : state.qty_down / state.qty_up;
    } else {
      state.balance_ratio = null;
    }
  }

  /**
   * 模拟新增一笔成交后的 pair_cost（不改变实际状态）
   * 用于挂单前评估：new pair_cost < pair_cost_target 才挂
   */
  function simulateFill(side, price, size) {
    const qty = size / price;
    const simState = { ...state };

    if (side === 'UP') {
      simState.cost_up = state.cost_up + size;
      simState.qty_up = state.qty_up + qty;
      simState.avg_up = simState.cost_up / simState.qty_up;
    } else {
      simState.cost_down = state.cost_down + size;
      simState.qty_down = state.qty_down + qty;
      simState.avg_down = simState.cost_down / simState.qty_down;
    }

    if (simState.qty_up > 0 && simState.qty_down > 0) {
      return simState.avg_up + simState.avg_down;
    }
    // 只有单侧时，假设另一侧以 mid_price 成交估算
    return null;
  }

  /**
   * 判断是否还需要在指定侧挂单
   * - pair_cost 已达标时停止挂单
   * - balance_ratio 过高时只在少的一侧挂单
   */
  function shouldPlaceOrder(side, simulatedPairCost) {
    // pair_cost 已达标，停止所有挂单
    if (state.pair_cost !== null && state.pair_cost <= pair_cost_target) {
      return false;
    }
    // 模拟后 pair_cost 超标，不挂
    if (simulatedPairCost !== null && simulatedPairCost > pair_cost_target) {
      return false;
    }
    // 仓位严重不平衡时，只在少的一侧挂单
    const { balance_max_ratio } = config.strategy;
    if (state.balance_ratio !== null && state.balance_ratio > balance_max_ratio) {
      const heavySide = state.qty_up > state.qty_down ? 'UP' : 'DOWN';
      if (side === heavySide) return false;
    }
    return true;
  }

  function getState() { return { ...state }; }

  function reset() { state = _emptyState(); }

  return { recordFill, recordFills, simulateFill, shouldPlaceOrder, getState, reset };
}
