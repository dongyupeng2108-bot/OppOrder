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
  const ladderPrices = Array.isArray(config?.ladder_prices) ? config.ladder_prices : BOT_STRATEGY_CONTRACT.defaults.ladder_prices;
  const ladderSize = Number.isFinite(Number(config?.ladder_size))
    ? Number(config.ladder_size)
    : BOT_STRATEGY_CONTRACT.defaults.ladder_size;
  const flattenYesNow = context?.exit_yes_now === true;
  const flattenPrice = toNumberOrNull(context?.exit_yes_price);
  const diagnosticsBase = {
    remaining_sec: remainingSec,
    open_elapsed_sec: openElapsedSec,
    ladder_posted: ladderPosted,
    btc_price: prices.btcPrice,
    upper_bound: prices.upperBound,
    lower_bound: prices.lowerBound,
    bounds_ready: prices.ready
  };

  if (flattenYesNow) {
    return normalizeStrategyOutput({
      intents: [createFlattenPositionIntent({ side: 'YES', price: flattenPrice })],
      reason: 'exit_yes_now',
      patches: {},
      diagnostics: {
        ...diagnosticsBase,
        exit_yes_now: true,
        exit_yes_price: flattenPrice
      }
    });
  }

  if (remainingSec !== null && remainingSec <= 100) {
    return normalizeStrategyOutput({
      intents: [createCancelOpenIntent('ALL')],
      reason: 'remaining_sec<=100',
      patches: {},
      diagnostics: diagnosticsBase
    });
  }

  if ((remainingSec !== null && remainingSec > 290) || (openElapsedSec !== null && openElapsedSec < 10)) {
    return normalizeStrategyOutput({
      intents: [createNoopIntent()],
      reason: 'pre_open_or_open_not_10s',
      patches: {},
      diagnostics: diagnosticsBase
    });
  }

  if (!ladderPosted) {
    return normalizeStrategyOutput({
      intents: [createPlaceLadderIntent({ side: 'BOTH', prices: ladderPrices, size: ladderSize })],
      reason: 'ladder_not_posted',
      patches: { ladder_posted: true },
      diagnostics: diagnosticsBase
    });
  }

  if (prices.ready && prices.btcPrice >= prices.upperBound) {
    return normalizeStrategyOutput({
      intents: [createCancelOpenIntent('NO')],
      reason: 'btc_price>=upper_bound',
      patches: {},
      diagnostics: diagnosticsBase
    });
  }

  if (prices.ready && prices.btcPrice <= prices.lowerBound) {
    return normalizeStrategyOutput({
      intents: [createCancelOpenIntent('YES')],
      reason: 'btc_price<=lower_bound',
      patches: {},
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
