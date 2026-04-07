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
        ? 1
        : toNumberOrNull(tpPriceRaw);
      if (price === null || price <= 0 || price >= 1) return null;
      if (size === null || size <= 0) return null;
      if (tpPrice === null || tpPrice <= 0 || tpPrice > 1) return null;
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
  return basePrices.map((price) => ({ price: Number(price), size: baseSize, tp_price: 1 }));
};
const parseCancelConfig = (value, fallbackBeforeEndSec) => {
  const beforeEndSec = toNonNegativeIntegerOrNull(value?.before_end_sec);
  const formula = typeof value?.formula === 'string' ? value.formula.trim() : '';
  const beforeEndSource = beforeEndSec === null ? 'global_fallback' : 'explicit';
  return {
    before_end_sec: beforeEndSec ?? fallbackBeforeEndSec,
    formula,
    before_end_source: beforeEndSource
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
  const hasOpenUpOrders = (
    (Array.isArray(state?.yes_order_ids) && state.yes_order_ids.length > 0)
    || (Number.isFinite(Number(state?.yes_open_order_count)) && Number(state.yes_open_order_count) > 0)
  );
  const hasOpenDownOrders = (
    (Array.isArray(state?.no_order_ids) && state.no_order_ids.length > 0)
    || (Number.isFinite(Number(state?.no_open_order_count)) && Number(state.no_open_order_count) > 0)
  );
  return {
    secs_left: secsLeft ?? -1,
    spread: spread ?? -1,
    volatility_ratio: atr !== null && btc !== null && btc !== 0 ? atr / btc : -1,
    has_open_up_orders: hasOpenUpOrders,
    has_open_down_orders: hasOpenDownOrders,
    btc_price: prices.btcPrice ?? -1,
    upper_bound: prices.upperBound ?? -1,
    lower_bound: prices.lowerBound ?? -1
  };
};
const FORMULA_ALLOWED_IDENTIFIERS = [
  'secs_left',
  'spread',
  'volatility_ratio',
  'has_open_up_orders',
  'has_open_down_orders',
  'btc_price',
  'upper_bound',
  'lower_bound'
];
const FORMULA_ALLOWED_IDENTIFIER_SET = new Set(FORMULA_ALLOWED_IDENTIFIERS);
const FORMULA_MAX_LENGTH = 240;
const createFormulaEvalResult = ({ hit, ok, code, message }) => ({
  hit: hit === true,
  ok: ok === true,
  code: code || 'EVAL_ERROR',
  message: typeof message === 'string' ? message : null,
  allowed_identifiers: [...FORMULA_ALLOWED_IDENTIFIERS]
});
const parseFormulaError = (code, message) => {
  const err = new Error(message || code);
  err.code = code;
  return err;
};
const tokenizeFormula = (text) => {
  const tokens = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(text[i + 1] || ''))) {
      let j = i + 1;
      while (j < text.length && /[0-9.]/.test(text[j])) j += 1;
      const raw = text.slice(i, j);
      if (!/^\d+(\.\d+)?$|^\.\d+$/.test(raw)) {
        throw parseFormulaError('INVALID_NUMBER', `invalid number: ${raw}`);
      }
      tokens.push({ kind: 'number', value: Number(raw) });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i + 1;
      while (j < text.length && /[A-Za-z0-9_]/.test(text[j])) j += 1;
      const name = text.slice(i, j);
      tokens.push({ kind: 'identifier', value: name });
      i = j;
      continue;
    }
    const op3 = text.slice(i, i + 3);
    if (op3 === '===' || op3 === '!==') {
      tokens.push({ kind: 'operator', value: op3 });
      i += 3;
      continue;
    }
    const op2 = text.slice(i, i + 2);
    if (['&&', '||', '>=', '<=', '==', '!='].includes(op2)) {
      tokens.push({ kind: 'operator', value: op2 });
      i += 2;
      continue;
    }
    if (['(', ')', '+', '-', '*', '/', '%', '!', '<', '>'].includes(ch)) {
      tokens.push({ kind: 'operator', value: ch });
      i += 1;
      continue;
    }
    throw parseFormulaError('INVALID_CHARACTER', `invalid character: ${ch}`);
  }
  return tokens;
};
const evaluateFormulaTokens = (tokens, vars) => {
  let idx = 0;
  const peek = () => tokens[idx] || null;
  const consume = () => {
    const token = tokens[idx] || null;
    idx += 1;
    return token;
  };
  const matchOperator = (...ops) => {
    const token = peek();
    if (!token || token.kind !== 'operator' || !ops.includes(token.value)) return null;
    return consume();
  };
  const readPrimary = () => {
    const token = peek();
    if (!token) throw parseFormulaError('SYNTAX_ERROR', 'unexpected end of formula');
    if (token.kind === 'number') {
      consume();
      return token.value;
    }
    if (token.kind === 'identifier') {
      consume();
      if (token.value === 'true') return true;
      if (token.value === 'false') return false;
      if (!FORMULA_ALLOWED_IDENTIFIER_SET.has(token.value)) {
        throw parseFormulaError('IDENTIFIER_NOT_ALLOWED', `identifier not allowed: ${token.value}`);
      }
      return vars[token.value];
    }
    if (matchOperator('(')) {
      const value = readOr();
      if (!matchOperator(')')) throw parseFormulaError('SYNTAX_ERROR', 'missing closing parenthesis');
      return value;
    }
    throw parseFormulaError('SYNTAX_ERROR', `unexpected token: ${token.value}`);
  };
  const readUnary = () => {
    const op = matchOperator('!', '+', '-');
    if (!op) return readPrimary();
    const value = readUnary();
    if (op.value === '!') return !value;
    if (op.value === '+') return +value;
    return -value;
  };
  const readMul = () => {
    let value = readUnary();
    while (true) {
      const op = matchOperator('*', '/', '%');
      if (!op) break;
      const right = readUnary();
      if (op.value === '*') value = value * right;
      else if (op.value === '/') value = value / right;
      else value = value % right;
    }
    return value;
  };
  const readAdd = () => {
    let value = readMul();
    while (true) {
      const op = matchOperator('+', '-');
      if (!op) break;
      const right = readMul();
      if (op.value === '+') value = value + right;
      else value = value - right;
    }
    return value;
  };
  const readCompare = () => {
    let value = readAdd();
    while (true) {
      const op = matchOperator('<', '>', '<=', '>=');
      if (!op) break;
      const right = readAdd();
      if (op.value === '<') value = value < right;
      else if (op.value === '>') value = value > right;
      else if (op.value === '<=') value = value <= right;
      else value = value >= right;
    }
    return value;
  };
  const readEquality = () => {
    let value = readCompare();
    while (true) {
      const op = matchOperator('==', '!=', '===', '!==');
      if (!op) break;
      const right = readCompare();
      if (op.value === '==') value = value == right;
      else if (op.value === '!=') value = value != right;
      else if (op.value === '===') value = value === right;
      else value = value !== right;
    }
    return value;
  };
  const readAnd = () => {
    let value = readEquality();
    while (matchOperator('&&')) {
      const right = readEquality();
      value = Boolean(value && right);
    }
    return value;
  };
  const readOr = () => {
    let value = readAnd();
    while (matchOperator('||')) {
      const right = readAnd();
      value = Boolean(value || right);
    }
    return value;
  };
  const output = readOr();
  if (idx < tokens.length) {
    throw parseFormulaError('SYNTAX_ERROR', `unexpected token: ${tokens[idx].value}`);
  }
  return output;
};
const evaluateCancelFormula = (formula, vars) => {
  if (typeof formula !== 'string') {
    return createFormulaEvalResult({ hit: false, ok: false, code: 'FORMULA_NOT_STRING', message: 'formula is not a string' });
  }
  const text = formula.trim();
  if (!text) {
    return createFormulaEvalResult({ hit: false, ok: false, code: 'FORMULA_EMPTY', message: 'formula is empty' });
  }
  if (text.length > FORMULA_MAX_LENGTH) {
    return createFormulaEvalResult({ hit: false, ok: false, code: 'FORMULA_TOO_LONG', message: `formula length > ${FORMULA_MAX_LENGTH}` });
  }
  try {
    const tokens = tokenizeFormula(text);
    const value = evaluateFormulaTokens(tokens, vars);
    return createFormulaEvalResult({ hit: Boolean(value), ok: true, code: 'OK', message: null });
  } catch (err) {
    return createFormulaEvalResult({
      hit: false,
      ok: false,
      code: err?.code || 'EVAL_ERROR',
      message: err?.message || 'formula evaluation failed'
    });
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
  const maxSpreadBps = toNonNegativeIntegerOrNull(config?.max_spread_bps) ?? 10000;
  const ladderPrices = Array.isArray(config?.ladder_prices) ? config.ladder_prices : BOT_STRATEGY_CONTRACT.defaults.ladder_prices;
  const ladderSize = Number.isFinite(Number(config?.ladder_size))
    ? Number(config.ladder_size)
    : BOT_STRATEGY_CONTRACT.defaults.ladder_size;
  const upLadder = normalizeLadderRows(config?.up_ladder, ladderPrices, ladderSize);
  const downLadder = normalizeLadderRows(config?.down_ladder, ladderPrices, ladderSize);
  const upCancel = parseCancelConfig(config?.up_cancel, cancelAllRemainingSec);
  const downCancel = parseCancelConfig(config?.down_cancel, cancelAllRemainingSec);
  const formulaVars = computeFormulaVars({ context, state, prices });
  const upFormulaEval = evaluateCancelFormula(upCancel.formula, formulaVars);
  const downFormulaEval = evaluateCancelFormula(downCancel.formula, formulaVars);
  const hasOpenUpOrders = formulaVars.has_open_up_orders;
  const hasOpenDownOrders = formulaVars.has_open_down_orders;
  const upBeforeEndHit = remainingSec !== null && remainingSec <= upCancel.before_end_sec;
  const downBeforeEndHit = remainingSec !== null && remainingSec <= downCancel.before_end_sec;
  const upFormulaHit = upFormulaEval.hit === true;
  const downFormulaHit = downFormulaEval.hit === true;
  const canTriggerUpFormula = state?.up_formula_cancelled !== true;
  const canTriggerDownFormula = state?.down_formula_cancelled !== true;
  const wantCancelUpFormula = hasOpenUpOrders && canTriggerUpFormula && upFormulaHit;
  const wantCancelDownFormula = hasOpenDownOrders && canTriggerDownFormula && downFormulaHit;
  const wantCancelUpBeforeEnd = hasOpenUpOrders && !state?.yes_cancelled && upBeforeEndHit;
  const wantCancelDownBeforeEnd = hasOpenDownOrders && !state?.no_cancelled && downBeforeEndHit;
  const wantCancelUp = wantCancelUpFormula || wantCancelUpBeforeEnd;
  const wantCancelDown = wantCancelDownFormula || wantCancelDownBeforeEnd;
  const upGlobalCompat = upCancel.before_end_source === 'global_fallback'
    || (upCancel.before_end_sec === cancelAllRemainingSec && upCancel.formula.length === 0);
  const downGlobalCompat = downCancel.before_end_source === 'global_fallback'
    || (downCancel.before_end_sec === cancelAllRemainingSec && downCancel.formula.length === 0);
  const wantCancelUpByGlobal = remainingSec !== null
    && remainingSec <= cancelAllRemainingSec
    && hasOpenUpOrders
    && !state?.yes_cancelled
    && upGlobalCompat
    && !wantCancelUp;
  const wantCancelDownByGlobal = remainingSec !== null
    && remainingSec <= cancelAllRemainingSec
    && hasOpenDownOrders
    && !state?.no_cancelled
    && downGlobalCompat
    && !wantCancelDown;
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
    config_max_spread_bps: maxSpreadBps,
    config_cancel_all_remaining_sec: cancelAllRemainingSec,
    config_ladder_size: ladderSize,
    config_ladder_prices: ladderPrices,
    config_up_ladder: upLadder,
    config_down_ladder: downLadder,
    config_up_cancel: upCancel,
    config_down_cancel: downCancel,
    formula_allowed_identifiers: [...FORMULA_ALLOWED_IDENTIFIERS],
    formula_vars: formulaVars,
    up_formula_eval: upFormulaEval,
    down_formula_eval: downFormulaEval,
    trigger_up_before_end: upBeforeEndHit,
    trigger_down_before_end: downBeforeEndHit,
    trigger_up_formula: upFormulaHit,
    trigger_down_formula: downFormulaHit,
    can_trigger_up_formula: canTriggerUpFormula,
    can_trigger_down_formula: canTriggerDownFormula,
    up_global_compat: upGlobalCompat,
    down_global_compat: downGlobalCompat,
    trigger_up_global_compat: wantCancelUpByGlobal,
    trigger_down_global_compat: wantCancelDownByGlobal
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

  if (wantCancelUpByGlobal && wantCancelDownByGlobal) {
    return normalizeStrategyOutput({
      intents: [createCancelOpenIntent('ALL')],
      reason: 'remaining_sec<=cancel_all_remaining_sec',
      patches: {},
      diagnostics: diagnosticsBase
    });
  }
  if (wantCancelUpByGlobal) {
    return normalizeStrategyOutput({
      intents: [createCancelOpenIntent('YES')],
      reason: 'up_cancel_global_compat',
      patches: { yes_cancelled: true },
      diagnostics: diagnosticsBase
    });
  }
  if (wantCancelDownByGlobal) {
    return normalizeStrategyOutput({
      intents: [createCancelOpenIntent('NO')],
      reason: 'down_cancel_global_compat',
      patches: { no_cancelled: true },
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
    const spreadDecimal = toNumberOrNull(formulaVars.spread);
    const spreadBps = spreadDecimal === null ? null : Math.max(0, spreadDecimal * 10000);
    if (spreadBps !== null && spreadBps > maxSpreadBps) {
      return normalizeStrategyOutput({
        intents: [createNoopIntent()],
        reason: 'spread_too_wide_for_entry',
        patches: {},
        diagnostics: {
          ...diagnosticsBase,
          spread_bps: spreadBps,
          spread_bps_limit: maxSpreadBps
        }
      });
    }
    if (state?.yes_cancelled === true && state?.no_cancelled === true) {
      return normalizeStrategyOutput({
        intents: [createNoopIntent()],
        reason: 'window_cancel_terminal_after_directional_before_end',
        patches: {},
        diagnostics: diagnosticsBase
      });
    }
    const intents = [];
    if (upLadder.length > 0 && state?.yes_cancelled !== true) intents.push(createPlaceLadderIntent({ side: 'YES', ladder: upLadder }));
    if (downLadder.length > 0 && state?.no_cancelled !== true) intents.push(createPlaceLadderIntent({ side: 'NO', ladder: downLadder }));
    return normalizeStrategyOutput({
      intents: intents.length > 0 ? intents : [createNoopIntent()],
      reason: intents.length > 0 ? 'ladder_not_posted' : 'ladder_not_posted_all_sides_cancelled',
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
