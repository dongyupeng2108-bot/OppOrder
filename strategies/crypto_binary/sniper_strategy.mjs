// sniper_strategy.mjs — S2 低价接博策略
// 工厂函数模式：createSniperStrategy(config, deps)
// deps: { orderManager, cancelEngine }

/**
 * S2 触发条件：
 *   目标侧 ask <= sniper_max_price（如 0.12）
 *   AND 对面侧 ask >= opposite_min_price（如 0.85）
 * 挂单：target_ask - sniper_offset，被动等待
 * 平仓：持有到结算（不提前退出）
 * 接收 regime_score，在激活区间内运行（默认 0.0~0.6）
 */

export function createSniperStrategy(config, deps) {
  const { orderManager, cancelEngine } = deps;

  const {
    sniper_max_price,
    sniper_offset,
    opposite_min_price,
  } = config.strategy;

  const {
    min_score = 0.0,
    max_score = 0.6,
  } = config.regime || {};

  /**
   * 主入口：每次收到盘口快照时调用
   * @param {object} params
   * @param {object} params.snapshot     — OrderbookSnapshot
   * @param {number} params.regime_score — 来自 regime_detector（0~1）
   * @param {number} params.sigma        — 当前波动率
   * @param {Date}   params.windowEnd    — 当前窗口结束时间
   * @returns {{ actions: string[] }}
   */
  function onMarketData({ snapshot, regime_score, sigma, windowEnd }) {
    const actions = [];

    // 1. regime_score 检查
    if (regime_score < min_score || regime_score > max_score) {
      return { actions: ['SLEEP: regime_score out of range'] };
    }

    // 2. cancel_engine 综合检查
    const cancelReason = cancelEngine.check({ sigma, windowEnd, snapshot });
    if (cancelReason) {
      actions.push(`CANCEL: ${cancelReason}`);
      return { actions };
    }

    const { ask_up, ask_down, tick_size } = snapshot;

    // 3. 对 UP 侧和 DOWN 侧分别检查触发条件
    for (const side of ['UP', 'DOWN']) {
      const targetAsk  = side === 'UP' ? ask_up   : ask_down;
      const oppositeAsk = side === 'UP' ? ask_down : ask_up;
      const tokenId    = side === 'UP' ? snapshot.up_token_id : snapshot.down_token_id;

      if (!tokenId) continue;

      // 触发条件
      const triggered = targetAsk <= sniper_max_price && oppositeAsk >= opposite_min_price;
      if (!triggered) continue;

      // 已有该侧 OPEN 挂单则跳过
      const existing = orderManager.getOpenOrders().filter(o => o.side === side);
      if (existing.length > 0) continue;

      // 挂单价格：target_ask - sniper_offset，对齐 tick_size
      const bidPrice = Math.max(targetAsk - sniper_offset, tick_size);
      const newOrders = orderManager.placeOrders({
        side,
        token_id: tokenId,
        mid_price: targetAsk,  // 以 ask 为基准，offset 在 placeOrders 内减去
        offset: sniper_offset,
        tick_size,
      });
      actions.push(`PLACE_${side}: ask=${targetAsk.toFixed(4)} opposite=${oppositeAsk.toFixed(4)} bid=${bidPrice.toFixed(4)}`);
    }

    // 4. 模拟成交检查（Paper 模式）
    const filled = orderManager.simulateFills(snapshot);
    for (const order of filled) {
      actions.push(`FILL_${order.side}: price=${order.price.toFixed(4)} size=${order.size.toFixed(2)}`);
    }

    if (actions.length === 0) {
      actions.push(`WAIT: ask_up=${ask_up.toFixed(4)} ask_down=${ask_down.toFixed(4)} (no trigger)`);
    }

    return { actions };
  }

  function reset() {
    orderManager.cancelAll('window_reset');
    cancelEngine.resetSigma();
  }

  return { onMarketData, reset };
}
