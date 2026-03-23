import { summarizeIntents } from './bot_strategy_contract.mjs';

const cloneValue = (value) => JSON.parse(JSON.stringify(value ?? null));

const mergeOverride = (base, override) => {
  if (!override || typeof override !== 'object') return { ...base };
  return { ...base, ...override };
};

const inferPhase = (decision, summary) => {
  const firstIntent = Array.isArray(decision?.intents) && decision.intents.length > 0 ? decision.intents[0] : null;
  if (!firstIntent || firstIntent.kind === 'NOOP') return 'IDLE';
  if (firstIntent.kind === 'PLACE_LADDER') return 'LADDER_POSTED';
  if (firstIntent.kind === 'CANCEL_OPEN') {
    return summary.open_total > 0 ? 'LADDER_POSTED' : 'IDLE';
  }
  return 'IDLE';
};

const toDecisionPreview = (decision, context, state) => ({
  intents: decision.intents,
  intents_summary: summarizeIntents(decision.intents),
  reason: decision.reason,
  patches: decision.patches,
  diagnostics: decision.diagnostics,
  context_snapshot: context,
  state_snapshot: { ladder_posted: state.ladder_posted === true },
  fixture: null
});

export function createBotRunner(options = {}) {
  const getContext = options.getContext;
  const getState = options.getState;
  const patchState = options.patchState;
  const decide = options.decide;
  const applyIntents = options.applyIntents;
  const getOrders = options.getOrders;
  const getSummary = options.getSummary;
  const log = options.log;
  const config = options.config || {};
  if (typeof getContext !== 'function') throw new Error('getContext required');
  if (typeof getState !== 'function') throw new Error('getState required');
  if (typeof patchState !== 'function') throw new Error('patchState required');
  if (typeof decide !== 'function') throw new Error('decide required');
  if (typeof applyIntents !== 'function') throw new Error('applyIntents required');
  if (typeof getOrders !== 'function') throw new Error('getOrders required');
  if (typeof getSummary !== 'function') throw new Error('getSummary required');
  if (typeof log !== 'function') throw new Error('log required');

  const runSingleTick = async (params = {}) => {
    const contextBase = await getContext();
    const stateBase = getState();
    const context = mergeOverride(contextBase, params.context_override);
    const state = mergeOverride(stateBase, params.state_override);

    const decision = decide({
      config,
      context,
      state
    });

    const intentResult = applyIntents(decision.intents, { source: 'runner_tick' });
    const summary = intentResult.summary || getSummary();
    const orders = intentResult.orders || getOrders();
    const openYes = orders.filter((order) => order.status === 'OPEN' && order.side === 'YES').map((order) => order.order_id);
    const openNo = orders.filter((order) => order.status === 'OPEN' && order.side === 'NO').map((order) => order.order_id);
    const statePatch = {
      current_window_id: context.window_id ?? null,
      remaining_sec: context.remaining_sec ?? null,
      anchor_btc: context.btc_price ?? null,
      atr_5m: context.atr_5m ?? null,
      upper_bound: context.upper_bound ?? null,
      lower_bound: context.lower_bound ?? null,
      last_reason: decision.reason,
      last_intents: Array.isArray(decision.intents) ? decision.intents : [],
      ladder_posted: openYes.length > 0 || openNo.length > 0,
      yes_order_ids: openYes,
      no_order_ids: openNo,
      phase: inferPhase(decision, summary),
      ...(decision.patches && typeof decision.patches === 'object' ? decision.patches : {})
    };
    const stateAfter = patchState(statePatch);

    const beforeLogCount = options.getLogCount ? options.getLogCount() : null;
    log({
      level: 'info',
      source: 'bot_runner',
      event: 'RUNNER_TICK',
      message: `tick ${decision.reason}`,
      mode: stateAfter.mode ?? null,
      window_id: context.window_id ?? null,
      data: {
        intents_summary: summarizeIntents(decision.intents),
        changed: intentResult.changed,
        open_total: summary.open_total,
        cancelled_total: summary.cancelled_total
      }
    });
    const afterLogCount = options.getLogCount ? options.getLogCount() : null;
    const logsAdded = beforeLogCount !== null && afterLogCount !== null ? Math.max(0, afterLogCount - beforeLogCount) : 1;

    return {
      context_snapshot: cloneValue(context),
      decision_preview: toDecisionPreview(decision, context, state),
      state_before: cloneValue(state),
      state_after: cloneValue(stateAfter),
      order_summary: cloneValue(summary),
      logs_added: logsAdded
    };
  };

  return { runSingleTick };
}
