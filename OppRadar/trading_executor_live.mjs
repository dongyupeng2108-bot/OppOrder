// M8-P4 | trading_executor_live.mjs | MAX_POSITION_USD=10 硬编码，修改需Owner授权

import crypto from 'crypto';
import './proxy_agent.mjs';
import { DB } from './db.mjs';
import { getFeeRate, calculateFee } from './trading_fee_model.mjs';
import { isActivated } from './trading_kill_switch.mjs';
import { startHeartbeat } from './trading_heartbeat.mjs';

const MAX_POSITION_USD = 10;

/**
 * Live execution of an order.
 * @param {object} order - Row from trading_orders table
 * @returns {Promise<object>} FillResult
 */
export async function executeLive(order) {
  // 1. Check Kill Switch
  if (isActivated()) {
    throw new Error('KillSwitch activated');
  }

  // 2. Check position limit
  if (order.price * order.shares > MAX_POSITION_USD) {
    throw new Error('HR-LIVE-1: order exceeds MAX_POSITION_USD limit');
  }

  // 3. Place order stub
  // TODO M8-P4-LIVE: replace stub with polymarket-cli / py-clob-client call
  // Requires: private key, CLOB API endpoint, proxy_agent.setup()
  console.log(`[LiveExecutor] STUB: would place ${order.side} order on ${order.market_id}`);

  // Generate simulated fill (aligned with PaperExecutor structure)
  const fill_price = order.price;
  const fill_shares = order.shares;
  const feeRateBps = await getFeeRate(order.market_id);
  const fees_paid_amount = calculateFee(fill_price * fill_shares, feeRateBps);
  const fees_paid_asset = 'USDC';
  const fill_id = crypto.randomUUID();
  const filled_at = new Date().toISOString();
  const sim_seed = `live:${order.order_id}:${Date.now()}`;

  // 4. Write to trading_fills
  await DB.runSql(
    `INSERT INTO trading_fills (fill_id, order_id, executor_type, fill_price, fill_shares, fees_paid_asset, fees_paid_amount, pnl_settlement, pnl_reversion, sim_seed, filled_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [fill_id, order.order_id, 'LIVE', fill_price, fill_shares, fees_paid_asset, fees_paid_amount, null, null, sim_seed, filled_at]
  );

  // 5. Update trading_orders status
  await DB.runSql(
    "UPDATE trading_orders SET status = 'FILLED', updated_at = ? WHERE order_id = ?",
    [new Date().toISOString(), order.order_id]
  );

  // 6. Start heartbeat
  startHeartbeat();

  // 7. Return FillResult
  return {
    status: 'FILLED',
    fill_id,
    order_id: order.order_id,
    fill_price,
    fill_shares,
    fees_paid_asset,
    fees_paid_amount,
    pnl_settlement: null,
    pnl_reversion: null,
    sim_seed,
    filled_at,
  };
}
