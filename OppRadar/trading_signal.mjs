// M8-P1 | trading_signal.mjs
// Signal data structure + validation for OppRadar trading pipeline

import crypto from 'crypto';

const VALID_SIDES = ['BUY', 'SELL'];
const VALID_ORDER_TYPES = ['GTC', 'GTD', 'FOK', 'FAK'];
const VALID_CONFIDENCE = ['HIGH', 'MEDIUM', 'LOW'];
const VALID_VETO_STATUS = ['RED', 'YELLOW', 'GREEN'];
const VALID_RISK_LEVEL = ['HIGH', 'MEDIUM', 'LOW'];

/**
 * Create a new trading signal.
 * @param {object} fields - Signal fields (opp_id, market_id, token_id, side, order_type, price_target, recommended_shares, context, decision_snapshot_id, core_snapshot_id, b5_run_id, strategy_id)
 * @returns {object} Signal object with auto-generated signal_id and ts
 */
export function createSignal(fields) {
  return {
    signal_id: crypto.randomUUID(),
    opp_id: fields.opp_id,
    market_id: fields.market_id,
    token_id: fields.token_id,
    side: fields.side,
    order_type: fields.order_type,
    price_target: fields.price_target,
    recommended_shares: fields.recommended_shares,
    context: fields.context,
    decision_snapshot_id: fields.decision_snapshot_id,
    core_snapshot_id: fields.core_snapshot_id,
    b5_run_id: fields.b5_run_id ?? null,
    strategy_id: fields.strategy_id ?? null,
    ts: new Date().toISOString(),
  };
}

/**
 * Validate a trading signal object.
 * @param {object} signal
 * @returns {true} if valid
 * @throws {Error} with field name in message if invalid
 */
export function validateSignal(signal) {
  if (!signal || typeof signal !== 'object') throw new Error('signal must be an object');

  const requiredStrings = ['signal_id', 'opp_id', 'market_id', 'token_id', 'side', 'order_type', 'decision_snapshot_id', 'core_snapshot_id', 'ts'];
  for (const field of requiredStrings) {
    if (typeof signal[field] !== 'string' || signal[field] === '') {
      throw new Error(`${field} is required and must be a non-empty string`);
    }
  }

  if (!VALID_SIDES.includes(signal.side)) {
    throw new Error(`side must be one of: ${VALID_SIDES.join(', ')}`);
  }

  if (!VALID_ORDER_TYPES.includes(signal.order_type)) {
    throw new Error(`order_type must be one of: ${VALID_ORDER_TYPES.join(', ')}`);
  }

  if (typeof signal.price_target !== 'number' || signal.price_target <= 0 || signal.price_target >= 1) {
    throw new Error('price_target must be a number between 0 and 1 (exclusive)');
  }

  if (typeof signal.recommended_shares !== 'number' || signal.recommended_shares <= 0) {
    throw new Error('recommended_shares must be a positive number');
  }

  if (!signal.context || typeof signal.context !== 'object') {
    throw new Error('context is required and must be an object');
  }

  const ctx = signal.context;
  if (typeof ctx.p_baseline_mid !== 'number') throw new Error('context.p_baseline_mid must be a number');
  if (typeof ctx.edge_net !== 'number') throw new Error('context.edge_net must be a number');
  if (!VALID_CONFIDENCE.includes(ctx.confidence)) throw new Error('context.confidence must be HIGH, MEDIUM, or LOW');
  if (!VALID_VETO_STATUS.includes(ctx.veto_status)) throw new Error('context.veto_status must be RED, YELLOW, or GREEN');
  if (!VALID_RISK_LEVEL.includes(ctx.risk_level)) throw new Error('context.risk_level must be HIGH, MEDIUM, or LOW');

  return true;
}
