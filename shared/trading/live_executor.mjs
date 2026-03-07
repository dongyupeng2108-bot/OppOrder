// live_executor.mjs — Signal → LiveExecutor 薄封装
// 将 BTCQDD Signal 转换为 trading_executor_live.mjs 期望的 order 格式

import '../../OppRadar/proxy_agent.mjs';
import { executeLive, checkSignerHealth } from '../../OppRadar/trading_executor_live.mjs';
import { getDb } from '../data/db.mjs';
import crypto from 'crypto';

export function createLiveExecutor(config) {
  const { max_position_usd, max_open_orders } = config.risk;

  let openOrders = 0;

  /**
   * 将 Signal 写入 trading_orders 表，然后调用 executeLive
   * @param {object} signal — signal_engine 产出的 Signal
   * @returns {object} FillResult 或 { filled: false, reason }
   */
  async function execute(signal) {
    if (openOrders >= max_open_orders) {
      console.log(`[LiveExecutor] Skipped: max_open_orders (${max_open_orders}) reached`);
      return { filled: false, reason: 'MAX_OPEN_ORDERS' };
    }

    // 检查 Signer Agent 是否在线
    const signerOk = await checkSignerHealth();
    if (!signerOk) {
      console.warn('[LiveExecutor] Signer offline, skipping signal');
      return { filled: false, reason: 'SIGNER_OFFLINE' };
    }

    const db = await getDb();
    const order_id = crypto.randomUUID();
    const shares = max_position_usd / signal.ask;
    const now = new Date().toISOString();

    // 写入 trading_orders（复用 OppRadar 交易表）
    await db.run(`
      INSERT INTO trading_orders (
        order_id, market_id, token_id, side, price, shares,
        order_type, status, executor_type, strategy_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      order_id,
      signal.token_id,          // market_id 用 token_id 代替（BTCQDD 无单独 market_id）
      signal.token_id,
      'BUY',
      signal.ask,
      shares,
      'FOK',
      'PENDING',
      'LIVE',
      config.strategy_id,
      now,
      now,
    ]);

    const order = {
      order_id,
      market_id: signal.token_id,
      token_id: signal.token_id,
      side: 'BUY',
      price: signal.ask,
      shares,
      order_type: 'FOK',
    };

    try {
      const fillResult = await executeLive(order);
      if (fillResult.status === 'FILLED') {
        openOrders++;
        console.log(`[LiveExecutor] Filled: ${signal.direction} @ ${signal.ask.toFixed(4)} order_id=${order_id}`);
        return {
          filled: true,
          fill_price: fillResult.fill_price,
          fill_amount_usd: max_position_usd,
          shares: fillResult.fill_shares,
          direction: signal.direction,
          token_id: signal.token_id,
          filled_at: new Date(fillResult.filled_at),
          order_id,
        };
      } else {
        console.warn(`[LiveExecutor] Not filled: ${fillResult.status} reason=${fillResult.reject_reason}`);
        return { filled: false, reason: fillResult.reject_reason || fillResult.status };
      }
    } catch (e) {
      console.error(`[LiveExecutor] executeLive error: ${e.message}`);
      return { filled: false, reason: e.message };
    }
  }

  /**
   * 窗口结算，计算 PnL（与 PaperExecutor 接口一致）
   */
  function settle(fill, settled_outcome) {
    if (!fill || !fill.filled) return 0;
    openOrders = Math.max(0, openOrders - 1);
    const won = fill.direction === settled_outcome;
    const payout = won ? fill.shares * 1.0 : 0;
    const pnl = payout - fill.fill_amount_usd;
    console.log(`[LiveExecutor] Settle: ${fill.direction} vs outcome=${settled_outcome} won=${won} pnl=${pnl.toFixed(4)}`);
    return pnl;
  }

  return { execute, settle };
}
