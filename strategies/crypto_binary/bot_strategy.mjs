const ACTIONS = {
  NOOP: 'NOOP',
  PLACE_BOTH_LADDERS: 'PLACE_BOTH_LADDERS',
  CANCEL_NO_OPEN: 'CANCEL_NO_OPEN',
  CANCEL_YES_OPEN: 'CANCEL_YES_OPEN',
  CANCEL_ALL_OPEN: 'CANCEL_ALL_OPEN'
};

const toNumberOrNull = (value) => {
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

export function decideBotAction(context = {}, state = {}) {
  const remainingSec = toNumberOrNull(context?.remaining_sec);
  const openElapsedSec = toOpenElapsedSec(context);
  const ladderPosted = state?.ladder_posted === true;
  const prices = hasPriceBounds(context);

  if (remainingSec !== null && remainingSec <= 100) {
    return {
      decision: ACTIONS.CANCEL_ALL_OPEN,
      reason: 'remaining_sec<=100'
    };
  }

  if ((remainingSec !== null && remainingSec > 290) || (openElapsedSec !== null && openElapsedSec < 10)) {
    return {
      decision: ACTIONS.NOOP,
      reason: 'pre_open_or_open_not_10s'
    };
  }

  if (!ladderPosted) {
    return {
      decision: ACTIONS.PLACE_BOTH_LADDERS,
      reason: 'ladder_not_posted'
    };
  }

  if (prices.ready && prices.btcPrice >= prices.upperBound) {
    return {
      decision: ACTIONS.CANCEL_NO_OPEN,
      reason: 'btc_price>=upper_bound'
    };
  }

  if (prices.ready && prices.btcPrice <= prices.lowerBound) {
    return {
      decision: ACTIONS.CANCEL_YES_OPEN,
      reason: 'btc_price<=lower_bound'
    };
  }

  return {
    decision: ACTIONS.NOOP,
    reason: prices.ready ? 'within_bounds_or_no_trigger' : 'price_or_bounds_null'
  };
}

export const BOT_DECISION_ACTIONS = ACTIONS;
