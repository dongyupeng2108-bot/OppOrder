// M8-P2 | trading_order_engine.mjs

import crypto from 'crypto';
import { validateSignal } from './trading_signal.mjs';
import { getMarketRules } from './trading_market_rules.mjs';
import { DB } from './db.mjs';

const MAX_SPREAD = 0.05;
const MIN_LIQUIDITY = 100;

export async function processSignal(signal) {
  validateSignal(signal);

  const marketRules = await getMarketRules(signal.market_id);

  // HR-1: tick_size alignment (floating-point safe)
  const remainder = Math.abs(signal.price_target - Math.round(signal.price_target / marketRules.tick_size) * marketRules.tick_size);
  if (remainder > 1e-9) {
    return { status: 'REJECTED', reject_reason: 'HR-1: price_target not aligned to tick_size', signal_id: signal.signal_id };
  }

  // HR-2: postOnly + FOK/FAK mutual exclusion
  if ((signal.order_type === 'FOK' || signal.order_type === 'FAK') && signal.post_only === true) {
    return { status: 'REJECTED', reject_reason: 'HR-2: postOnly incompatible with FOK/FAK', signal_id: signal.signal_id };
  }

  // HR-3: neg_risk
  if (marketRules.neg_risk === true) {
    return { status: 'REJECTED', reject_reason: 'HR-3: neg_risk market rejected', signal_id: signal.signal_id };
  }

  // HR-4: GTD expiry
  if (signal.order_type === 'GTD' && (!signal.expiry || new Date(signal.expiry) <= new Date())) {
    return { status: 'REJECTED', reject_reason: 'HR-4: GTD order missing or expired expiry', signal_id: signal.signal_id };
  }

  // HR-5: min_order_size
  if (signal.price_target * signal.recommended_shares < marketRules.min_order_size) {
    return { status: 'REJECTED', reject_reason: 'HR-5: order size below minimum', signal_id: signal.signal_id };
  }

  // HR-6: spread
  if (signal.spread !== undefined && signal.spread > MAX_SPREAD) {
    return { status: 'REJECTED', reject_reason: 'HR-6: spread exceeds MAX_SPREAD', signal_id: signal.signal_id };
  }

  // HR-7: liquidity
  if (signal.top5_liquidity !== undefined && signal.top5_liquidity < MIN_LIQUIDITY) {
    return { status: 'REJECTED', reject_reason: 'HR-7: top5_liquidity below MIN_LIQUIDITY', signal_id: signal.signal_id };
  }

  // Calculate shares
  let shares;
  if (signal.side === 'BUY' && (signal.order_type === 'FOK' || signal.order_type === 'FAK')) {
    shares = signal.recommended_shares * signal.price_target;
  } else {
    shares = signal.recommended_shares;
  }

  const now = new Date().toISOString();
  const order_id = crypto.randomUUID();

  // Write order to DB
  await DB.runSql(
    `INSERT INTO trading_orders (order_id, signal_id, opp_id, market_id, token_id, side, order_type, price, shares, status, reject_reason, executor_type, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [order_id, signal.signal_id, signal.opp_id, signal.market_id, signal.token_id, signal.side, signal.order_type, signal.price_target, shares, 'PENDING', null, 'PAPER', now, now]
  );

  // Write trading snapshot to DB
  const snapshot_id = crypto.randomUUID();
  await DB.runSql(
    `INSERT INTO trading_snapshots (snapshot_id, order_id, core_snapshot_id, decision_snapshot_id, p_baseline_mid, edge_buy_net, edge_sell_net, veto_status, risk_level, confidence, ts)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [snapshot_id, order_id, signal.core_snapshot_id, signal.decision_snapshot_id, signal.context.p_baseline_mid, signal.context.edge_net, signal.context.edge_net, signal.context.veto_status, signal.context.risk_level, signal.context.confidence, now]
  );

  return { status: 'ACCEPTED', order_id, signal_id: signal.signal_id };
}
