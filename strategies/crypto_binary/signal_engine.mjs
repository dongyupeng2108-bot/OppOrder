// 信号生成：edge_net 计算 + Signal 产出
// B0 阶段：工厂函数骨架，B1 实现完整逻辑

export function createSignalEngine(config) {
  const { edge_net_threshold, max_spread, basis_buffer, slippage_est } = config.signal;

  /**
   * @param {{ pUp, pDown, askUp, askDown, bidUp, bidDown, feeEst, timeToEnd }} params
   * @returns {{ signal: 'UP'|'DOWN'|null, edgeNet: number }}
   */
  function evaluate(params) {
    // TODO: B1 实现
    // edge_net_up  = pUp   - askUp   - feeEst - slippage_est - basis_buffer
    // edge_net_down= pDown - askDown - feeEst - slippage_est - basis_buffer
    // 双侧都超阈值时只取 edge_net 更大侧（单腿每窗口最多 1 方向）
    throw new Error('signal_engine.evaluate() not implemented (B1)');
  }

  return { evaluate };
}
