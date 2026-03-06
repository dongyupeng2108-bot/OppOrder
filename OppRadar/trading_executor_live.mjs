// M8-P4 | trading_executor_live.mjs | MAX_POSITION_USD=10 硬编码，修改需Owner授权

import crypto from 'crypto';
import './proxy_agent.mjs';
import { DB } from './db.mjs';
import { getFeeRate, calculateFee } from './trading_fee_model.mjs';
import { isActivated } from './trading_kill_switch.mjs';
import { startHeartbeat } from './trading_heartbeat.mjs';
import { safeLog, sanitizeError } from './trading_log_sanitizer.mjs';

const MAX_POSITION_USD = 10;
const SIGNER_URL = 'http://127.0.0.1:53199';
const SIGNER_TIMEOUT_MS = 3000;

/**
 * Check if the signer agent is healthy.
 * @returns {Promise<boolean>}
 */
export async function checkSignerHealth() {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SIGNER_TIMEOUT_MS);
    const res = await fetch(`${SIGNER_URL}/health`, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return false;
    const data = await res.json();
    return data.status === 'ok';
  } catch (err) {
    safeLog('warn', '[LiveExecutor] signer health check failed:', sanitizeError(err));
    return false;
  }
}

async function rejectOrder(order, reject_reason) {
  await DB.runSql(
    "UPDATE trading_orders SET status = 'REJECTED', reject_reason = ?, updated_at = ? WHERE order_id = ?",
    [reject_reason, new Date().toISOString(), order.order_id]
  );
  return { status: 'REJECTED', order_id: order.order_id, reject_reason };
}

/**
 * Live execution of an order via signer agent.
 * @param {object} order - Row from trading_orders table
 * @param {object} [_deps] - Injectable dependencies for testing
 * @returns {Promise<object>} FillResult
 */
export async function executeLive(order, _deps = {}) {
  const healthCheck = _deps.checkSignerHealth || checkSignerHealth;
  const signFn = _deps.signOrder || signOrder;

  // 1. Check Kill Switch
  if (isActivated()) {
    throw new Error('KillSwitch activated');
  }

  // 2. Check position limit
  if (order.price * order.shares > MAX_POSITION_USD) {
    throw new Error('HR-LIVE-1: order exceeds MAX_POSITION_USD limit');
  }

  // 3. Check signer health
  const signerOk = await healthCheck();
  if (!signerOk) {
    return rejectOrder(order, 'SIGNER_OFFLINE');
  }

  // 4. Request signature
  const signResult = await signFn(order);
  if (!signResult) {
    return rejectOrder(order, 'SIGNER_TIMEOUT');
  }
  if (!signResult.signed) {
    return rejectOrder(order, 'SIGN_FAILED');
  }

  // 5. Submit to CLOB (stub) — use headers then null them
  let signerHeaders = signResult.headers;
  // TODO M8-P4-LIVE: replace stub with polymarket-cli / py-clob-client call
  // Requires: CLOB API endpoint, proxy_agent
  safeLog('info', '[LiveExecutor] would submit to CLOB:', order.order_id);
  signerHeaders = null; // LG-5: release reference

  // 6. Generate fill (simulated for now)
  const fill_price = order.price;
  const fill_shares = order.shares;
  const feeRateBps = await getFeeRate(order.market_id);
  const fees_paid_amount = calculateFee(fill_price * fill_shares, feeRateBps);
  const fees_paid_asset = 'USDC';
  const fill_id = crypto.randomUUID();
  const filled_at = new Date().toISOString();
  const sim_seed = `live:${order.order_id}:${Date.now()}`;

  // 7. Write to trading_fills
  await DB.runSql(
    `INSERT INTO trading_fills (fill_id, order_id, executor_type, fill_price, fill_shares, fees_paid_asset, fees_paid_amount, pnl_settlement, pnl_reversion, sim_seed, filled_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [fill_id, order.order_id, 'LIVE', fill_price, fill_shares, fees_paid_asset, fees_paid_amount, null, null, sim_seed, filled_at]
  );

  // 8. Update trading_orders status
  await DB.runSql(
    "UPDATE trading_orders SET status = 'FILLED', updated_at = ? WHERE order_id = ?",
    [new Date().toISOString(), order.order_id]
  );

  // 9. Start heartbeat
  startHeartbeat();

  // 10. Return FillResult
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

/**
 * Sign an order via the signer agent.
 * @param {object} order
 * @returns {Promise<object|null>} signResult or null on timeout
 */
async function signOrder(order) {
  const body = {
    order_id: order.order_id,
    action: 'create_order',
    payload: {
      token_id: order.token_id,
      side: order.side,
      price: String(order.price),
      size: String(order.shares),
      order_type: order.order_type,
      fee_rate_bps: 0,
    },
    timestamp: new Date().toISOString(),
  };

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SIGNER_TIMEOUT_MS);
    const res = await fetch(`${SIGNER_URL}/sign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return { signed: false };
    return await res.json();
  } catch (err) {
    safeLog('warn', '[LiveExecutor] sign request failed:', sanitizeError(err));
    return null;
  }
}

/**
 * Sign a cancel request for a LIVE order via signer agent.
 * @param {string} orderId
 */
export async function signCancelOrder(orderId) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SIGNER_TIMEOUT_MS);
    const res = await fetch(`${SIGNER_URL}/sign-cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_id: orderId, action: 'cancel_order', timestamp: new Date().toISOString() }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (res.ok) {
      safeLog('info', '[LiveExecutor] cancel signed:', orderId);
    }
  } catch (err) {
    safeLog('warn', '[LiveExecutor] sign-cancel failed:', sanitizeError(err));
  }
}
