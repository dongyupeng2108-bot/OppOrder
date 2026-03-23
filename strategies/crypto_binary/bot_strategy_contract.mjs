const DEFAULT_LADDER_PRICES = [0.27, 0.24, 0.21, 0.18];
const DEFAULT_LADDER_SIZE = 5;

const INTENT_KINDS = {
  NOOP: 'NOOP',
  PLACE_LADDER: 'PLACE_LADDER',
  CANCEL_OPEN: 'CANCEL_OPEN',
  FLATTEN_POSITION: 'FLATTEN_POSITION'
};

const CANCEL_SIDES = new Set(['YES', 'NO', 'ALL']);
const LADDER_SIDES = new Set(['BOTH']);
const PAPER_ACTIONS = {
  PLACE_BOTH_LADDERS: 'PLACE_BOTH_LADDERS',
  CANCEL_NO_OPEN: 'CANCEL_NO_OPEN',
  CANCEL_YES_OPEN: 'CANCEL_YES_OPEN',
  CANCEL_ALL_OPEN: 'CANCEL_ALL_OPEN',
  FLATTEN_YES_POSITION: 'FLATTEN_YES_POSITION',
  FLATTEN_NO_POSITION: 'FLATTEN_NO_POSITION'
};

const toNumberOrNull = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const normalizeLadderPrices = (prices) => {
  if (!Array.isArray(prices) || prices.length === 0) return [...DEFAULT_LADDER_PRICES];
  const normalized = prices
    .map((value) => toNumberOrNull(value))
    .filter((value) => value !== null);
  return normalized.length ? normalized : [...DEFAULT_LADDER_PRICES];
};

const normalizeLadderSize = (size) => {
  const num = toNumberOrNull(size);
  return num !== null && num > 0 ? num : DEFAULT_LADDER_SIZE;
};

export function normalizeStrategyInput(input = {}) {
  return {
    config: input && typeof input.config === 'object' && input.config !== null ? input.config : {},
    context: input && typeof input.context === 'object' && input.context !== null ? input.context : {},
    state: input && typeof input.state === 'object' && input.state !== null ? input.state : {}
  };
}

export function createNoopIntent() {
  return { kind: INTENT_KINDS.NOOP };
}

export function createPlaceLadderIntent(payload = {}) {
  const side = typeof payload.side === 'string' ? payload.side.toUpperCase() : 'BOTH';
  return {
    kind: INTENT_KINDS.PLACE_LADDER,
    side: LADDER_SIDES.has(side) ? side : 'BOTH',
    prices: normalizeLadderPrices(payload.prices),
    size: normalizeLadderSize(payload.size)
  };
}

export function createCancelOpenIntent(side = 'ALL') {
  const normalizedSide = typeof side === 'string' ? side.toUpperCase() : 'ALL';
  return {
    kind: INTENT_KINDS.CANCEL_OPEN,
    side: CANCEL_SIDES.has(normalizedSide) ? normalizedSide : 'ALL'
  };
}

export function createFlattenPositionIntent(payload = {}) {
  const side = typeof payload.side === 'string' ? payload.side.toUpperCase() : 'YES';
  const price = toNumberOrNull(payload.price);
  return {
    kind: INTENT_KINDS.FLATTEN_POSITION,
    side: side === 'NO' ? 'NO' : 'YES',
    price
  };
}

export function normalizeStrategyOutput(output = {}) {
  const intents = Array.isArray(output.intents) ? output.intents : [];
  return {
    intents,
    reason: typeof output.reason === 'string' && output.reason ? output.reason : 'unspecified',
    patches: output.patches && typeof output.patches === 'object' ? output.patches : {},
    diagnostics: output.diagnostics && typeof output.diagnostics === 'object' ? output.diagnostics : {}
  };
}

export function summarizeIntents(intents = []) {
  if (!Array.isArray(intents) || intents.length === 0) return 'NOOP';
  return intents.map((intent) => {
    if (!intent || typeof intent !== 'object') return 'UNKNOWN';
    if (intent.kind === INTENT_KINDS.NOOP) return 'NOOP';
    if (intent.kind === INTENT_KINDS.PLACE_LADDER) {
      const side = intent.side || 'BOTH';
      const prices = Array.isArray(intent.prices) ? intent.prices.join(',') : '';
      const size = Number.isFinite(intent.size) ? intent.size : DEFAULT_LADDER_SIZE;
      return `PLACE_LADDER(${side}|${prices}|size=${size})`;
    }
    if (intent.kind === INTENT_KINDS.CANCEL_OPEN) return `CANCEL_OPEN(${intent.side || 'ALL'})`;
    if (intent.kind === INTENT_KINDS.FLATTEN_POSITION) {
      return `FLATTEN_POSITION(${intent.side || 'YES'}|price=${intent.price ?? 'null'})`;
    }
    return String(intent.kind);
  }).join(' + ');
}

export function normalizePaperIntent(intent = {}) {
  if (!intent || typeof intent !== 'object') return null;
  if (intent.kind === INTENT_KINDS.NOOP) {
    return { kind: INTENT_KINDS.NOOP };
  }
  if (intent.kind === INTENT_KINDS.PLACE_LADDER) {
    return createPlaceLadderIntent(intent);
  }
  if (intent.kind === INTENT_KINDS.CANCEL_OPEN) {
    return createCancelOpenIntent(intent.side);
  }
  if (intent.kind === INTENT_KINDS.FLATTEN_POSITION) {
    return createFlattenPositionIntent(intent);
  }
  return null;
}

export function mapIntentToPaperAction(intent = {}) {
  const normalized = normalizePaperIntent(intent);
  if (!normalized) {
    throw new Error(`unsupported intent kind: ${intent?.kind}`);
  }
  if (normalized.kind === INTENT_KINDS.NOOP) {
    return { action: null, params: {}, intent: normalized };
  }
  if (normalized.kind === INTENT_KINDS.PLACE_LADDER) {
    if (normalized.side !== 'BOTH') {
      throw new Error(`unsupported PLACE_LADDER side: ${normalized.side}`);
    }
    return {
      action: PAPER_ACTIONS.PLACE_BOTH_LADDERS,
      params: { prices: normalized.prices, size: normalized.size },
      intent: normalized
    };
  }
  if (normalized.kind === INTENT_KINDS.CANCEL_OPEN) {
    if (normalized.side === 'NO') return { action: PAPER_ACTIONS.CANCEL_NO_OPEN, params: {}, intent: normalized };
    if (normalized.side === 'YES') return { action: PAPER_ACTIONS.CANCEL_YES_OPEN, params: {}, intent: normalized };
    if (normalized.side === 'ALL') return { action: PAPER_ACTIONS.CANCEL_ALL_OPEN, params: {}, intent: normalized };
  }
  if (normalized.kind === INTENT_KINDS.FLATTEN_POSITION) {
    if (normalized.side === 'YES') {
      return {
        action: PAPER_ACTIONS.FLATTEN_YES_POSITION,
        params: { price: normalized.price },
        intent: normalized
      };
    }
    if (normalized.side === 'NO') {
      return {
        action: PAPER_ACTIONS.FLATTEN_NO_POSITION,
        params: { price: normalized.price },
        intent: normalized
      };
    }
    throw new Error(`unsupported FLATTEN_POSITION side: ${normalized.side}`);
  }
  throw new Error(`unsupported intent payload: ${JSON.stringify(normalized)}`);
}

export const BOT_STRATEGY_CONTRACT = {
  version: 'v1',
  input_shape: ['config', 'context', 'state'],
  output_shape: ['intents', 'reason', 'patches', 'diagnostics'],
  intent_kinds: INTENT_KINDS,
  defaults: {
    ladder_prices: [...DEFAULT_LADDER_PRICES],
    ladder_size: DEFAULT_LADDER_SIZE
  },
  paper_actions: PAPER_ACTIONS
};
