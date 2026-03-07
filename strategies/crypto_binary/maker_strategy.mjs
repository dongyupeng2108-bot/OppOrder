// maker_strategy.mjs — S1 配对成本做市策略
// 工厂函数模式：createMakerStrategy(config, deps)
// deps: { orderManager, pairTracker, cancelEngine }

/**
 * S1 核心逻辑：
 * 1. 首单条件：BTC 偏离 0.50 超过 min_price_deviation 才挂单
 * 2. price_zone_filter：只在 [0,0.35]∪[0.65,1.0] 区间挂单
 * 3. 挂单定价：bid = mid_price - offset（固定或动态）
 * 4. 仓位平衡：严重不平衡时只在少的一侧挂单
 * 5. pair_cost 达标时停止挂单，持有到结算
 * 6. 接收 regime_score，不在激活区间时休眠
 */

export function createMakerStrategy(config, deps) {
  const { orderManager, pairTracker, cancelEngine } = deps;

  const {
    entry_offset,
    entry_offset_base,
    vol_adjust_enabled = false,
    vol_adjust_factor = 1.0,
    min_price_deviation,
    price_zone_filter,   // [[0, 0.35], [0.65, 1.0]]
    balance_max_ratio,
    requote_threshold = 0.01,
  } = config.strategy;

  const {
    min_score = 0.5,
    max_score = 1.0,
  } = config.regime || {};

  let lastMidUp = null;
  let windowActive = false;

  /**
   * 检查 price_zone_filter：mid_up 是否在允许区间内
   */
  function inPriceZone(midUp) {
    if (!price_zone_filter || price_zone_filter.length === 0) return true;
    return price_zone_filter.some(([lo, hi]) => midUp >= lo && midUp <= hi);
  }

  /**
   * 计算动态/固定 offset
   * @param {number} sigma — 当前年化波动率
   */
  function calcOffset(sigma) {
    if (!vol_adjust_enabled) return entry_offset ?? entry_offset_base ?? 0.02;
    const base = entry_offset_base ?? entry_offset ?? 0.02;
    // sigma 标准化：用 0~1 范围的 sigmoid 近似，避免极端值
    const sigmaNorm = Math.min(sigma / 2.0, 1.0); // 200% 波动率时饱和
    return base * (1 + vol_adjust_factor * sigmaNorm);
  }

  /**
   * 检查首单条件：mid_up 偏离 0.50 是否超过阈值
   */
  function meetsFirstOrderCondition(midUp) {
    return Math.abs(midUp - 0.5) >= min_price_deviation;
  }

  /**
   * 主入口：每次收到盘口快照时调用
   * @param {object} params
   * @param {object} params.snapshot     — OrderbookSnapshot
   * @param {number} params.regime_score — 来自 regime_detector（0~1）
   * @param {number} params.sigma        — 当前波动率
   * @param {Date}   params.windowEnd    — 当前窗口结束时间
   * @returns {{ actions: string[] }}    — 本次执行的动作列表（供日志记录）
   */
  function onMarketData({ snapshot, regime_score, sigma, windowEnd }) {
    const actions = [];

    // 1. regime_score 检查：不在激活区间则休眠
    if (regime_score < min_score || regime_score > max_score) {
      return { actions: ['SLEEP: regime_score out of range'] };
    }

    const { mid_up, tick_size } = snapshot;

    // 2. price_zone_filter
    if (!inPriceZone(mid_up)) {
      return { actions: [`SKIP: mid_up=${mid_up.toFixed(4)} not in price_zone_filter`] };
    }

    // 3. cancel_engine 综合检查（四重撤单）
    const cancelReason = cancelEngine.check({ sigma, windowEnd, snapshot });
    if (cancelReason) {
      actions.push(`CANCEL: ${cancelReason}`);
      lastMidUp = null; // 撤单后重置，下次重新挂单
      return { actions };
    }

    // 4. 首单条件
    if (!windowActive && !meetsFirstOrderCondition(mid_up)) {
      return { actions: [`WAIT: deviation=${Math.abs(mid_up - 0.5).toFixed(4)} < ${min_price_deviation}`] };
    }

    // 5. 计算 offset
    const offset = calcOffset(sigma);

    // 6. quote refreshing：mid_up 变化超过 requote_threshold 时撤旧单重挂
    if (lastMidUp !== null && Math.abs(mid_up - lastMidUp) > requote_threshold) {
      orderManager.cancelAll('requote');
      actions.push(`REQUOTE: mid_up ${lastMidUp.toFixed(4)} → ${mid_up.toFixed(4)}`);
    }

    // 7. 对两侧分别评估是否挂单
    for (const side of ['UP', 'DOWN']) {
      const tokenId = side === 'UP' ? snapshot.up_token_id : snapshot.down_token_id;
      if (!tokenId) continue;

      // 已有该侧 OPEN 挂单则跳过
      const existing = orderManager.getOpenOrders().filter(o => o.side === side);
      if (existing.length > 0) continue;

      // pair_tracker 评估
      const simPairCost = pairTracker.simulateFill(side, mid_up - offset, config.risk.max_position_usd);
      if (!pairTracker.shouldPlaceOrder(side, simPairCost)) {
        actions.push(`SKIP_${side}: pair_cost or balance constraint`);
        continue;
      }

      // 挂单
      const newOrders = orderManager.placeOrders({
        side,
        token_id: tokenId,
        mid_price: mid_up,
        offset,
        tick_size,
      });
      actions.push(`PLACE_${side}: ${newOrders.length} orders offset=${offset.toFixed(4)}`);
      windowActive = true;
    }

    lastMidUp = mid_up;

    // 8. 模拟成交检查（Paper 模式）
    const filled = orderManager.simulateFills(snapshot);
    for (const order of filled) {
      pairTracker.recordFill(order.side, order.price, order.size);
      actions.push(`FILL_${order.side}: price=${order.price.toFixed(4)} size=${order.size.toFixed(2)}`);
    }

    // 9. pair_cost 达标日志
    const st = pairTracker.getState();
    if (st.pair_cost !== null) {
      actions.push(`pair_cost=${st.pair_cost.toFixed(4)} target=${config.strategy.pair_cost_target}`);
    }

    return { actions };
  }

  function reset() {
    windowActive = false;
    lastMidUp = null;
    pairTracker.reset();
    orderManager.cancelAll('window_reset');
    cancelEngine.resetSigma();
  }

  return { onMarketData, calcOffset, meetsFirstOrderCondition, inPriceZone, reset };
}
