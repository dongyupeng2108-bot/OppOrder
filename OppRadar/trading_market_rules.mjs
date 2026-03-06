// M8-P2 | trading_market_rules.mjs | stub，P4后替换真实API

const cache = new Map();
const TTL_MS = 60000;

const DEFAULT_RULES = {
  tick_size: 0.01,
  min_order_size: 5,
  neg_risk: false,
  feeRateBps: 200,
};

export async function getMarketRules(market_id) {
  const cached = cache.get(market_id);
  if (cached && Date.now() - cached.ts < TTL_MS) {
    return cached.rules;
  }

  // Stub: return default rules. P4 will replace with real API call.
  const rules = { ...DEFAULT_RULES };
  cache.set(market_id, { rules, ts: Date.now() });
  return rules;
}

export function clearCache() {
  cache.clear();
}
