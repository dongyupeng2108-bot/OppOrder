// paper_executor.mjs — 模拟执行器
// 接收 Signal，返回 FillResult（模拟立即以 ask 价格成交）

/**
 * FillResult 格式：
 * {
 *   filled: boolean,
 *   fill_price: number,
 *   fill_amount_usd: number,
 *   shares: number,
 *   direction: 'UP' | 'DOWN',
 *   token_id: string,
 *   filled_at: Date
 * }
 */

export function createPaperExecutor(config) {
  const { max_position_usd, max_open_orders } = config.risk;

  let openOrders = 0;

  /**
   * 模拟执行信号
   * @param {object} signal — signal_engine 产出的 Signal
   * @returns {FillResult}
   */
  function execute(signal) {
    if (openOrders >= max_open_orders) {
      console.log(`[PaperExecutor] Skipped: max_open_orders (${max_open_orders}) reached`);
      return { filled: false, reason: 'MAX_OPEN_ORDERS' };
    }

    // 以 ask 价格立即成交（taker 模式）
    const fill_price = signal.ask;
    const fill_amount_usd = Math.min(max_position_usd, max_position_usd); // 固定仓位
    const shares = fill_amount_usd / fill_price;

    openOrders++;

    const result = {
      filled: true,
      fill_price,
      fill_amount_usd,
      shares,
      direction: signal.direction,
      token_id: signal.token_id,
      filled_at: new Date(),
    };

    console.log(`[PaperExecutor] Filled: ${signal.direction} @ ${fill_price.toFixed(4)} shares=${shares.toFixed(4)} usd=${fill_amount_usd}`);
    return result;
  }

  /**
   * 窗口结束时结算，计算 PnL
   * @param {FillResult} fill
   * @param {string} settled_outcome — 'UP' | 'DOWN'
   * @returns {number} pnl（正数盈利，负数亏损）
   */
  function settle(fill, settled_outcome) {
    if (!fill || !fill.filled) return 0;

    openOrders = Math.max(0, openOrders - 1);

    // 二元期权：胜出方 payout = 1，败出方 = 0
    const won = fill.direction === settled_outcome;
    const payout = won ? fill.shares * 1.0 : 0;
    const pnl = payout - fill.fill_amount_usd;

    console.log(`[PaperExecutor] Settle: ${fill.direction} vs outcome=${settled_outcome} won=${won} pnl=${pnl.toFixed(4)}`);
    return pnl;
  }

  return { execute, settle };
}
