// M8-P3 | trading_executor_paper.mjs

import crypto from 'crypto';
import { DB } from './db.mjs';
import { getFeeRate, calculateFee } from './trading_fee_model.mjs';

/**
 * Paper (simulated) execution of an order.
 * @param {object} order - Row from trading_orders table
 * @param {string|null} _seed - Optional seed for deterministic testing
 * @returns {Promise<object>} FillResult
 */
export async function executePaper(order, _seed = null) {
  // 1. Look up best_bid / best_ask from core_snapshots via trading_snapshots
  let best_bid, best_ask;

  const tsRows = await DB.allSql(
    'SELECT core_snapshot_id FROM trading_snapshots WHERE order_id = ? LIMIT 1',
    [order.order_id]
  );

  if (tsRows.length > 0 && tsRows[0].core_snapshot_id) {
    const csRows = await DB.allSql(
      'SELECT best_bid, best_ask FROM core_snapshots WHERE snapshot_id = ? LIMIT 1',
      [tsRows[0].core_snapshot_id]
    );
    if (csRows.length > 0) {
      best_bid = csRows[0].best_bid;
      best_ask = csRows[0].best_ask;
    }
  }

  // Fallback if no core snapshot found
  if (best_bid === undefined || best_ask === undefined) {
    best_bid = order.price - 0.01;
    best_ask = order.price + 0.01;
  }

  // 2. Fill decision
  let filled = false;
  let fill_price;

  if (order.side === 'BUY') {
    if (order.price >= best_ask) {
      filled = true;
      fill_price = best_ask;
    }
  } else if (order.side === 'SELL') {
    if (order.price <= best_bid) {
      filled = true;
      fill_price = best_bid;
    }
  }

  if (!filled) {
    return { status: 'PENDING', order_id: order.order_id };
  }

  // 3. Build fill record
  const sim_seed = _seed !== null ? _seed : `${order.order_id}:${Date.now()}`;
  const fill_shares = order.shares;
  const feeRateBps = await getFeeRate(order.market_id);
  const fees_paid_amount = calculateFee(fill_price * fill_shares, feeRateBps);
  const fees_paid_asset = 'USDC';
  const fill_id = crypto.randomUUID();
  const filled_at = new Date().toISOString();

  // 4. Write to trading_fills
  await DB.runSql(
    `INSERT INTO trading_fills (fill_id, order_id, executor_type, fill_price, fill_shares, fees_paid_asset, fees_paid_amount, pnl_settlement, pnl_reversion, sim_seed, filled_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [fill_id, order.order_id, 'PAPER', fill_price, fill_shares, fees_paid_asset, fees_paid_amount, null, null, sim_seed, filled_at]
  );

  // 5. Update trading_orders status
  await DB.runSql(
    `UPDATE trading_orders SET status = 'FILLED', updated_at = ? WHERE order_id = ?`,
    [new Date().toISOString(), order.order_id]
  );

  // 6. Return FillResult
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
