// strategy_router.mjs — score 广播 + 多策略并行调度

export function createStrategyRouter(strategies) {
  /**
   * 广播市场数据给所有策略，收集动作
   * @param {object} marketData — { snapshot, regime_score, sigma, windowEnd }
   * @returns {object} { results: [{strategy_id, actions}] }
   */
  function dispatch(marketData) {
    const results = [];
    for (const [strategyId, strategy] of Object.entries(strategies)) {
      try {
        const result = strategy.onMarketData(marketData);
        results.push({ strategy_id: strategyId, actions: result.actions });
      } catch (e) {
        console.error(`[Router] Error in ${strategyId}:`, e.message);
        results.push({ strategy_id: strategyId, actions: [`ERROR: ${e.message}`] });
      }
    }
    return { results };
  }

  /**
   * 窗口重置：通知所有策略清理状态
   */
  function resetAll() {
    for (const [id, strategy] of Object.entries(strategies)) {
      if (typeof strategy.reset === 'function') {
        strategy.reset();
        console.log(`[Router] Reset: ${id}`);
      }
    }
  }

  return { dispatch, resetAll };
}
