// M8-P2 | trading_fee_model.mjs

import { getMarketRules } from './trading_market_rules.mjs';

export async function getFeeRate(market_id) {
  const rules = await getMarketRules(market_id);
  return rules.feeRateBps;
}

export function calculateFee(amount_usdc, feeRateBps) {
  return parseFloat((amount_usdc * feeRateBps / 10000).toFixed(6));
}
