import {
  BOT_STRATEGY_CONTRACT,
  createCancelOpenIntent,
  createFlattenPositionIntent,
  createNoopIntent,
  createPlaceLadderIntent,
  normalizeStrategyInput,
  normalizeStrategyOutput
} from './bot_strategy_contract.mjs';

const toNumberOrNull = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const toPeriodSec = (period) => {
  if (typeof period !== 'string' || !period) return null;
  const text = period.trim().toLowerCase();
  if (text.endsWith('m')) return Number.parseInt(text, 10) * 60;
  if (text.endsWith('h')) return Number.parseInt(text, 10) * 3600;
  return null;
};

const toOpenElapsedSec = (context) => {
  const periodSec = toPeriodSec(context?.period);
  const remainingSec = toNumberOrNull(context?.remaining_sec);
  if (periodSec === null || remainingSec === null) return null;
  return Math.max(0, periodSec - remainingSec);
};

const toNonNegativeIntegerOrNull = (value) => {
  const num = Number(value);
  if (!Number.isInteger(num) || num < 0) return null;
  return num;
};
const normalizeLadderRows = (rows, fallbackPrices, fallbackSize) => {
  if (Array.isArray(rows) && rows.length > 0) {
    const normalized = rows.map((item) => {
      const price = toNumberOrNull(item?.price);
      const size = toNumberOrNull(item?.size);
      const tpPriceRaw = item?.tp_price;
      const tpPrice = tpPriceRaw === null || tpPriceRaw === undefined || tpPriceRaw === ''
        ? price
        : toNumberOrNull(tpPriceRaw);
      if (price === null || price <= 0 || price >= 1) return null;
      if (size === null || size <= 0) return null;
      if (tpPrice === null || tpPrice <= 0 || tpPrice >= 1) return null;
      return { price, size, tp_price: tpPrice };
    }).filter(Boolean);
    if (normalized.length > 0) return normalized;
  }
  const basePrices = Array.isArray(fallbackPrices) && fallbackPrices.length > 0
    ? fallbackPrices
    : BOT_STRATEGY_CONTRACT.defaults.ladder_prices;
  const baseSize = Number.isFinite(Number(fallbackSize))
    ? Number(fallbackSize)
    : BOT_STRATEGY_CONTRACT.defaults.ladder_size;
  return basePrices.map((price) => ({ price: Number(price), size: baseSize, tp_price: Number(price) }));
};
const parseCancelConfig = (value, fallbackBeforeEndSec) => {
  const beforeEndSec = toNonNegativeIntegerOrNull(value?.before_end_sec);
  const formula = typeof value?.formula === 'string' ? value.formula.trim() : '';
  return {
    before_end_sec: beforeEndSec ?? fallbackBeforeEndSec,
    formula
  };
};
const computeFormulaVars = ({ context, state, prices }) => {
  const secsLeft = toNumberOrNull(context?.remaining_sec);
  const askYes = toNumberOrNull(context?.ask_yes);
  const bidYes = toNumberOrNull(context?.bid_yes);
  const askNo = toNumberOrNull(context?.ask_no);
  const bidNo = toNumberOrNull(context?.bid_no);
  const yesSpread = askYes !== null && bidYes !== null ? Math.max(0, askYes - bidYes) : null;
  const noSpread = askNo !== null && bidNo !== null ? Math.max(0, askNo - bidNo) : null;
  const spread = yesSpread !== null && noSpread !== null ? Math.max(yesSpread, noSpread) : (yesSpread ?? noSpread ?? null);
  const atr = toNumberOrNull(context?.atr_5m);
  const btc = toNumberOrNull(context?.btc_price);
  return {
    secs_left: secsLeft ?? -1,
    spread: spread ?? -1,
    volatility_ratio: atr !== null && btc !== null && btc !== 0 ? atr / btc : -1,
    has_open_up_orders: Array.isArray(state?.yes_order_ids) && state.yes_order_ids.length > 0,
    has_open_down_orders: Array.isArray(state?.no_order_ids) && state.no_order_ids.length > 0,
    btc_price: prices.btcPrice ?? -1,
    upper_bound: prices.upperBound ?? -1,
    lower_bound: prices.lowerBound ?? -1
  };
};
const evaluateCancelFormula = (formula, vars) => {
  if (typeof formula !== 'string') return false;
  const text = formula.trim();
  if (!text) return false;
  if (text.length > 240) return false;
  if (!/^[\w\s()+\-*/%<>=!&|.:]+$/.test(text)) return false;
  const keys = Object.keys(vars);
  const values = keys.map((key) => vars[key]);
  try {
    return Boolean(Function(...keys, `'use strict'; return (${text});`)(...values));
  } catch {
    return false;
  }
};

const hasPriceBounds = (context) => {
  const btcPrice = toNumberOrNull(context?.btc_price);
  const upperBound = toNumberOrNull(context?.upper_bound);
  const lowerBound = toNumberOrNull(context?.lower_bound);
  return {
    btcPrice,
    upperBound,
    lowerBound,
    ready: btcPrice !== null && upperBound !== null && lowerBound !== null
  };
};

export function decideBotAction(inputOrContext = {}, maybeState = {}) {
  const input = (
    inputOrContext
    && typeof inputOrContext === 'object'
    && ('config' in inputOrContext || 'context' in inputOrContext || 'state' in inputOrContext)
  )
    ? inputOrContext
    : { context: inputOrContext, state: maybeState, config: {} };
  const { config, context, state } = normalizeStrategyInput(input);
  const remainingSec = toNumberOrNull(context?.remaining_sec);
  const openElapsedSec = toOpenElapsedSec(context);
  const ladderPosted = state?.ladder_posted === true;
  const prices = hasPriceBounds(context);
  const openDelaySec = toNonNegativeIntegerOrNull(config?.open_delay_sec) ?? 10;
  const cancelAllRemainingSec = toNonNegativeIntegerOrNull(config?.cancel_all_remaining_sec) ?? 100;
  const ladderPrices = Array.isArray(config?.ladder_prices) ? config.ladder_prices : BOT_STRATEGY_CONTRACT.defaults.ladder_prices;
  const ladderSize = Number.isFinite(Number(config?.ladder_size))
    ? Number(config.ladder_size)
    : BOT_STRATEGY_CONTRACT.defaults.ladder_size;
  const upLadder = normalizeLadderRows(config?.up_ladder, ladderPrices, ladderSize);
  const downLadder = normalizeLadderRows(config?.down_ladder, ladderPrices, ladderSize);
  const upCancel = parseCancelConfig(config?.up_cancel, cancelAllRemainingSec);
  const downCancel = parseCancelConfig(config?.down_cancel, cancelAllRemainingSec);
  const formulaVars = computeFormulaVars({ context, state, prices });
  const hasOpenUpOrders = formulaVars.has_open_up_orders;
  const hasOpenDownOrders = formulaVars.has_open_down_orders;
  const upBeforeEndHit = remainingSec !== null && remainingSec <= upCancel.before_end_sec;
  const downBeforeEndHit = remainingSec !== null && remainingSec <= downCancel.before_end_sec;
  const upFormulaHit = evaluateCancelFormula(upCancel.formula, formulaVars);
  const downFormulaHit = evaluateCancelFormula(downCancel.formula, formulaVars);
  const canTriggerUpFormula = state?.up_formula_cancelled !== true;
  const canTriggerDownFormula = state?.down_formula_cancelled !== true;
  const wantCancelUpFormula = hasOpenUpOrders && canTriggerUpFormula && upFormulaHit;
  const wantCancelDownFormula = hasOpenDownOrders && canTriggerDownFormula && downFormulaHit;
  const wantCancelUpBeforeEnd = hasOpenUpOrders && !state?.yes_cancelled && upBeforeEndHit;
  const wantCancelDownBeforeEnd = hasOpenDownOrders && !state?.no_cancelled && downBeforeEndHit;
  const wantCancelUp = wantCancelUpFormula || wantCancelUpBeforeEnd;
  const wantCancelDown = wantCancelDownFormula || wantCancelDownBeforeEnd;
  const flattenYesNow = context?.exit_yes_now === true;
  const flattenNoNow = context?.exit_no_now === true;
  const flattenYesPrice = toNumberOrNull(context?.exit_yes_price);
  const flattenNoPrice = toNumberOrNull(context?.exit_no_price);
  const diagnosticsBase = {
    remaining_sec: remainingSec,
    open_elapsed_sec: openElapsedSec,
    ladder_posted: ladderPosted,
    btc_price: prices.btcPrice,
    upper_bound: prices.upperBound,
    lower_bound: prices.lowerBound,
    bounds_ready: prices.ready,
    config_open_delay_sec: openDelaySec,
    config_cancel_all_remaining_sec: cancelAllRemainingSec,
    config_ladder_size: ladderSize,
    config_ladder_prices: ladderPrices,
    config_up_ladder: upLadder,
    config_down_ladder: downLadder,
    config_up_cancel: upCancel,
    config_down_cancel: downCancel,
    formula_vars: formulaVars,
    trigger_up_before_end: upBeforeEndHit,
    trigger_down_before_end: downBeforeEndHit,
    trigger_up_formula: upFormulaHit,
    trigger_down_formula: downFormulaHit,
    can_trigger_up_formula: canTriggerUpFormula,
    can_trigger_down_formula: canTriggerDownFormula
  };

  if (flattenYesNow) {
    return normalizeStrategyOutput({
      intents: [createFlattenPositionIntent({ side: 'YES', price: flattenYesPrice })],
      reason: 'exit_yes_now',
      patches: {},
      diagnostics: {
        ...diagnosticsBase,
        exit_yes_now: true,
        exit_yes_price: flattenYesPrice
      }
    });
  }

  if (flattenNoNow) {
    return normalizeStrategyOutput({
      intents: [createFlattenPositionIntent({ side: 'NO', price: flattenNoPrice })],
      reason: 'exit_no_now',
      patches: {},
      diagnostics: {
        ...diagnosticsBase,
        exit_no_now: true,
        exit_no_price: flattenNoPrice
      }
    });
  }

  if (wantCancelUp && wantCancelDown) {
    const patchBoth = { yes_cancelled: true, no_cancelled: true };
    if (wantCancelUpFormula) patchBoth.up_formula_cancelled = true;
    if (wantCancelDownFormula) patchBoth.down_formula_cancelled = true;
    return normalizeStrategyOutput({
      intents: [createCancelOpenIntent('ALL')],
      reason: 'directional_cancel_both_triggered',
      patches: patchBoth,
      diagnostics: diagnosticsBase
    });
  }

  if (wantCancelUp) {
    const upByFormula = wantCancelUpFormula;
    return normalizeStrategyOutput({
      intents: [createCancelOpenIntent('YES')],
      reason: upByFormula ? 'up_cancel_formula' : 'up_cancel_before_end',
      patches: upByFormula
        ? { yes_cancelled: true, up_formula_cancelled: true }
        : { yes_cancelled: true },
      diagnostics: diagnosticsBase
    });
  }

  if (wantCancelDown) {
    const downByFormula = wantCancelDownFormula;
    return normalizeStrategyOutput({
      intents: [createCancelOpenIntent('NO')],
      reason: downByFormula ? 'down_cancel_formula' : 'down_cancel_before_end',
      patches: downByFormula
        ? { no_cancelled: true, down_formula_cancelled: true }
        : { no_cancelled: true },
      diagnostics: diagnosticsBase
    });
  }

  if (remainingSec !== null && remainingSec <= cancelAllRemainingSec) {
    return normalizeStrategyOutput({
      intents: [createCancelOpenIntent('ALL')],
      reason: 'remaining_sec<=cancel_all_remaining_sec',
      patches: {},
      diagnostics: diagnosticsBase
    });
  }

  if (openElapsedSec !== null && openElapsedSec < openDelaySec) {
    return normalizeStrategyOutput({
      intents: [createNoopIntent()],
      reason: 'pre_open_or_open_not_open_delay',
      patches: {},
      diagnostics: diagnosticsBase
    });
  }

  if (!ladderPosted) {
    const intents = [];
    if (upLadder.length > 0) intents.push(createPlaceLadderIntent({ side: 'YES', ladder: upLadder }));
    if (downLadder.length > 0) intents.push(createPlaceLadderIntent({ side: 'NO', ladder: downLadder }));
    return normalizeStrategyOutput({
      intents: intents.length > 0 ? intents : [createNoopIntent()],
      reason: 'ladder_not_posted',
      patches: { ladder_posted: true },
      diagnostics: diagnosticsBase
    });
  }

  if (prices.ready && prices.btcPrice >= prices.upperBound) {
    if (state?.no_cancelled === true) {
      return normalizeStrategyOutput({
        intents: [createNoopIntent()],
        reason: 'btc_price>=upper_bound_already_cancelled',
        patches: {},
        diagnostics: diagnosticsBase
      });
    }
    return normalizeStrategyOutput({
      intents: [createCancelOpenIntent('NO', { requires_bounds: true })],
      reason: 'btc_price>=upper_bound',
      patches: { no_cancelled: true },
      diagnostics: diagnosticsBase
    });
  }

  if (prices.ready && prices.btcPrice <= prices.lowerBound) {
    if (state?.yes_cancelled === true) {
      return normalizeStrategyOutput({
        intents: [createNoopIntent()],
        reason: 'btc_price<=lower_bound_already_cancelled',
        patches: {},
        diagnostics: diagnosticsBase
      });
    }
    return normalizeStrategyOutput({
      intents: [createCancelOpenIntent('YES', { requires_bounds: true })],
      reason: 'btc_price<=lower_bound',
      patches: { yes_cancelled: true },
      diagnostics: diagnosticsBase
    });
  }

  return normalizeStrategyOutput({
    intents: [createNoopIntent()],
    reason: prices.ready ? 'within_bounds_or_no_trigger' : 'price_or_bounds_null',
    patches: {},
    diagnostics: diagnosticsBase
  });
}

export const BOT_DECISION_ACTIONS = BOT_STRATEGY_CONTRACT.intent_kinds;
