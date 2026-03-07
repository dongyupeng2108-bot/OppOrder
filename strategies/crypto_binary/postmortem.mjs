// 独立复盘：窗口结算后记录理论价/市场价/结算结果/PnL
// B0 阶段：工厂函数骨架，B2 实现完整逻辑
// postmortem 表名：cb_postmortem，按 strategy_id 字段隔离

export function createPostmortem(config) {
  const strategyId = config.strategy_id;

  async function record(windowData) {
    // TODO: B2 实现
    // 写入 cb_postmortem 表，字段包含：
    // strategy_id, window_start, window_end, K, S_at_signal,
    // p_up, p_down, ask_up, ask_down, fee_est, edge_net,
    // signal_direction, settlement_result, pnl, basis
    throw new Error('postmortem.record() not implemented (B2)');
  }

  return { record, strategyId };
}
