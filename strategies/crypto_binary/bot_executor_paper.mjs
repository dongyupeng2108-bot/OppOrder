import { BOT_LEDGER_DEFAULTS } from './bot_order_ledger.mjs';
import { mapIntentToPaperAction } from './bot_strategy_contract.mjs';

const ALLOWED_ACTIONS = new Set([
  'PLACE_BOTH_LADDERS',
  'CANCEL_NO_OPEN',
  'CANCEL_YES_OPEN',
  'CANCEL_ALL_OPEN'
]);

export function createBotExecutorPaper(options = {}) {
  const ledger = options.ledger;
  if (!ledger) throw new Error('ledger required');

  const applyAction = (action, params = {}) => {
    if (!ALLOWED_ACTIONS.has(action)) {
      throw new Error(`unsupported action: ${action}`);
    }
    return ledger.applyAction(action, {
      prices: params.prices ?? BOT_LEDGER_DEFAULTS.prices,
      size: params.size ?? BOT_LEDGER_DEFAULTS.size,
      source: params.source || 'manual'
    });
  };

  const getOrders = () => ledger.getOrders();
  const getSummary = () => ledger.getSummary();
  const reset = () => ledger.reset();

  const applyIntents = (intents, params = {}) => {
    if (!Array.isArray(intents)) {
      throw new Error('intents must be an array');
    }
    const source = params.source || 'manual';
    const applied = [];
    let changed = 0;
    for (const rawIntent of intents) {
      const mapped = mapIntentToPaperAction(rawIntent);
      if (!mapped.action) {
        applied.push({
          kind: mapped.intent.kind,
          action: null,
          changed: 0
        });
        continue;
      }
      const result = applyAction(mapped.action, {
        ...mapped.params,
        source
      });
      changed += result.changed;
      applied.push({
        kind: mapped.intent.kind,
        action: result.action,
        changed: result.changed
      });
    }
    return {
      mode: 'INTENTS',
      changed,
      applied,
      summary: getSummary(),
      orders: getOrders()
    };
  };

  return { applyAction, applyIntents, getOrders, getSummary, reset };
}

export const BOT_PAPER_ALLOWED_ACTIONS = [...ALLOWED_ACTIONS];
