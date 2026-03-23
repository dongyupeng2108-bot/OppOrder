import { summarizeIntents } from './bot_strategy_contract.mjs';

const cloneValue = (value) => JSON.parse(JSON.stringify(value ?? null));

const mergeOverride = (base, override) => {
  if (!override || typeof override !== 'object') return { ...base };
  return { ...base, ...override };
};

const toFiniteNumber = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const isOrderInCurrentWindow = (order, state) => {
  if (!state?.window_initialized_at) return false;
  const orderTs = Date.parse(order?.created_at || '');
  const initTs = Date.parse(state.window_initialized_at);
  if (Number.isNaN(orderTs) || Number.isNaN(initTs)) return false;
  return orderTs >= initTs;
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
  const applyFills = options.applyFills;
  const getOrders = options.getOrders;
  const getSummary = options.getSummary;
  const log = options.log;
  const onRuntimeUpdate = typeof options.onRuntimeUpdate === 'function' ? options.onRuntimeUpdate : null;
  const config = options.config || {};
  if (typeof getContext !== 'function') throw new Error('getContext required');
  if (typeof getState !== 'function') throw new Error('getState required');
  if (typeof patchState !== 'function') throw new Error('patchState required');
  if (typeof decide !== 'function') throw new Error('decide required');
  if (typeof applyIntents !== 'function') throw new Error('applyIntents required');
  if (typeof applyFills !== 'function') throw new Error('applyFills required');
  if (typeof getOrders !== 'function') throw new Error('getOrders required');
  if (typeof getSummary !== 'function') throw new Error('getSummary required');
  if (typeof log !== 'function') throw new Error('log required');

  let running = false;
  let tickIntervalMs = 2000;
  let lastTickAt = null;
  let timerRef = null;
  let tickInProgress = false;

  const getRuntimeState = () => ({
    running,
    tick_interval_ms: tickIntervalMs,
    last_tick_at: lastTickAt
  });

  const publishRuntime = () => {
    if (!onRuntimeUpdate) return;
    onRuntimeUpdate(getRuntimeState());
  };

  const runSingleTick = async (params = {}) => {
    const contextBase = await getContext();
    let state = getState();
    const context = mergeOverride(contextBase, params.context_override);
    state = mergeOverride(state, params.state_override);

    const lifecycleWindowId = context.window_id ?? null;
    const prevWindowId = state.current_window_id ?? null;
    if (lifecycleWindowId !== prevWindowId) {
      const resetPatch = options.createWindowResetPatch
        ? options.createWindowResetPatch(lifecycleWindowId)
        : {
            last_window_id: prevWindowId,
            current_window_id: lifecycleWindowId,
            ladder_posted: false,
            yes_order_ids: [],
            no_order_ids: [],
            yes_cancelled: false,
            no_cancelled: false,
            anchor_btc: null,
            atr_5m: null,
            upper_bound: null,
            lower_bound: null,
            phase: 'WAIT_WINDOW_INIT'
          };
      state = patchState(resetPatch);
      log({
        level: 'info',
        source: 'bot_runner',
        event: 'BOT_WINDOW_CHANGED',
        message: `window changed: ${prevWindowId ?? 'null'} -> ${lifecycleWindowId ?? 'null'}`,
        mode: state.mode ?? null,
        window_id: lifecycleWindowId,
        data: { from_window_id: prevWindowId, to_window_id: lifecycleWindowId }
      });
    }

    const lifecycleAtr = toFiniteNumber(context.atr_5m);
    const lifecycleBtcPrice = toFiniteNumber(context.btc_price);
    const atrMultiplier = toFiniteNumber(config.atr_multiplier) ?? 1.2;
    const needWindowInit = state.current_window_id != null && state.anchor_btc == null;
    if (needWindowInit) {
      const initPatch = options.createWindowInitPatch
        ? options.createWindowInitPatch({
            window_id: state.current_window_id,
            btc_price: lifecycleBtcPrice,
            atr_5m: lifecycleAtr,
            atr_multiplier: atrMultiplier
          })
        : {
            current_window_id: state.current_window_id,
            anchor_btc: lifecycleBtcPrice,
            atr_5m: lifecycleAtr,
            upper_bound: lifecycleBtcPrice != null && lifecycleAtr != null ? lifecycleBtcPrice + (lifecycleAtr * atrMultiplier) : null,
            lower_bound: lifecycleBtcPrice != null && lifecycleAtr != null ? lifecycleBtcPrice - (lifecycleAtr * atrMultiplier) : null
          };
      state = patchState(initPatch);
      log({
        level: 'info',
        source: 'bot_runner',
        event: 'BOT_WINDOW_INITIALIZED',
        message: state.upper_bound != null && state.lower_bound != null ? 'window initialized' : 'window init pending required values',
        mode: state.mode ?? null,
        window_id: state.current_window_id ?? null,
        data: {
          anchor_btc: state.anchor_btc ?? null,
          atr_5m: state.atr_5m ?? null,
          upper_bound: state.upper_bound ?? null,
          lower_bound: state.lower_bound ?? null,
          atr_multiplier: atrMultiplier
        }
      });
    }

    const contextForDecision = {
      ...context,
      atr_5m: state.atr_5m ?? context.atr_5m ?? null,
      upper_bound: state.upper_bound ?? null,
      lower_bound: state.lower_bound ?? null
    };

    const decision = decide({
      config,
      context: contextForDecision,
      state
    });

    const intentResult = applyIntents(decision.intents, { source: 'runner_tick' });
    const fillResult = applyFills(contextForDecision);
    const summary = fillResult.summary || intentResult.summary || getSummary();
    const orders = fillResult.orders || intentResult.orders || getOrders();
    const windowOpenOrders = orders.filter((order) => order.status === 'OPEN' && isOrderInCurrentWindow(order, state));
    const openYes = windowOpenOrders.filter((order) => order.side === 'YES').map((order) => order.order_id);
    const openNo = windowOpenOrders.filter((order) => order.side === 'NO').map((order) => order.order_id);
    const statePatch = {
      current_window_id: state.current_window_id ?? context.window_id ?? null,
      last_window_id: state.last_window_id ?? null,
      remaining_sec: contextForDecision.remaining_sec ?? null,
      anchor_btc: state.anchor_btc ?? null,
      atr_5m: state.atr_5m ?? contextForDecision.atr_5m ?? null,
      upper_bound: state.upper_bound ?? null,
      lower_bound: state.lower_bound ?? null,
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
    if (Array.isArray(fillResult.filled_orders) && fillResult.filled_orders.length > 0) {
      log({
        level: 'info',
        source: 'bot_runner',
        event: 'BOT_FILL',
        message: `filled ${fillResult.filled_orders.length} orders`,
        mode: state.mode ?? null,
        window_id: contextForDecision.window_id ?? null,
        data: {
          fills: fillResult.filled_orders.map((order) => ({
            order_id: order.order_id,
            side: order.side,
            order_price: order.price,
            fill_price: order.fill_price
          }))
        }
      });
    }
    log({
      level: 'info',
      source: 'bot_runner',
      event: 'RUNNER_TICK',
      message: `tick ${decision.reason}`,
      mode: stateAfter.mode ?? null,
      window_id: contextForDecision.window_id ?? null,
      data: {
        intents_summary: summarizeIntents(decision.intents),
        changed: intentResult.changed,
        filled: fillResult.changed,
        open_total: summary.open_total,
        cancelled_total: summary.cancelled_total,
        filled_total: summary.filled_total
      }
    });
    const afterLogCount = options.getLogCount ? options.getLogCount() : null;
    const logsAdded = beforeLogCount !== null && afterLogCount !== null ? Math.max(0, afterLogCount - beforeLogCount) : 1;

    return {
      context_snapshot: cloneValue(contextForDecision),
      decision_preview: toDecisionPreview(decision, contextForDecision, state),
      state_before: cloneValue(state),
      state_after: cloneValue(stateAfter),
      order_summary: cloneValue(summary),
      fills: cloneValue(fillResult.filled_orders || []),
      logs_added: logsAdded
    };
  };

  const runScheduledTick = async () => {
    if (!running || tickInProgress) return null;
    tickInProgress = true;
    try {
      const result = await runSingleTick();
      lastTickAt = new Date().toISOString();
      publishRuntime();
      log({
        level: 'info',
        source: 'bot_runner',
        event: 'BOT_TICK_OK',
        message: 'scheduled tick ok',
        mode: result?.state_after?.mode ?? null,
        window_id: result?.context_snapshot?.window_id ?? null,
        data: {
          reason: result?.decision_preview?.reason ?? null,
          intents_summary: result?.decision_preview?.intents_summary ?? null
        }
      });
      return result;
    } catch (error) {
      lastTickAt = new Date().toISOString();
      publishRuntime();
      log({
        level: 'error',
        source: 'bot_runner',
        event: 'BOT_TICK_ERROR',
        message: error.message,
        mode: null,
        window_id: null,
        data: {}
      });
      return null;
    } finally {
      tickInProgress = false;
    }
  };

  const start = (tickMs = 2000) => {
    if (running) {
      return { already_running: true, ...getRuntimeState() };
    }
    tickIntervalMs = tickMs;
    running = true;
    publishRuntime();
    log({
      level: 'info',
      source: 'bot_runner',
      event: 'BOT_STARTED',
      message: 'bot runner started',
      mode: null,
      window_id: null,
      data: { tick_interval_ms: tickIntervalMs }
    });
    timerRef = setInterval(() => {
      runScheduledTick();
    }, tickIntervalMs);
    return { already_running: false, ...getRuntimeState() };
  };

  const stop = () => {
    if (!running) {
      return { already_stopped: true, ...getRuntimeState() };
    }
    running = false;
    if (timerRef) {
      clearInterval(timerRef);
      timerRef = null;
    }
    publishRuntime();
    log({
      level: 'info',
      source: 'bot_runner',
      event: 'BOT_STOPPED',
      message: 'bot runner stopped',
      mode: null,
      window_id: null,
      data: {}
    });
    return { already_stopped: false, ...getRuntimeState() };
  };

  publishRuntime();

  return { runSingleTick, start, stop, runScheduledTick, getRuntimeState };
}
