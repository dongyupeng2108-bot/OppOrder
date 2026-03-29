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
  if (firstIntent.kind === 'FLATTEN_POSITION') return 'IDLE';
  return 'IDLE';
};

const isCriticalBtcReady = (value) => toFiniteNumber(value) !== null;

const isBoundsReady = (state = {}, context = {}) => (
  toFiniteNumber(state.anchor_btc ?? context.anchor_btc) !== null
  && toFiniteNumber(state.upper_bound ?? context.upper_bound) !== null
  && toFiniteNumber(state.lower_bound ?? context.lower_bound) !== null
);

const hasBoundsDependentIntent = (intents = []) => intents.some((intent) => (
  intent?.kind === 'CANCEL_OPEN'
  && intent?.requires_bounds === true
));

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
  const onTickResult = typeof options.onTickResult === 'function' ? options.onTickResult : null;
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
  const executedPlaceIntentByWindow = new Map();
  let startupWindowGateMode = 'inactive';
  let startupWindowGateId = null;

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
    if (startupWindowGateMode === 'pending') {
      if (lifecycleWindowId === null) {
        startupWindowGateMode = 'open';
      } else {
        startupWindowGateMode = 'wait_next_window';
        startupWindowGateId = lifecycleWindowId;
        log({
          level: 'info',
          source: 'bot_runner',
          event: 'BOT_STARTUP_WAIT_NEXT_WINDOW',
          message: `startup observed active window ${lifecycleWindowId}, waiting next window`,
          mode: state.mode ?? null,
          window_id: lifecycleWindowId,
          data: { startup_window_id: lifecycleWindowId }
        });
      }
    }
    if (
      startupWindowGateMode === 'wait_next_window'
      && lifecycleWindowId !== null
      && lifecycleWindowId !== startupWindowGateId
    ) {
      const releasedFrom = startupWindowGateId;
      startupWindowGateMode = 'open';
      startupWindowGateId = null;
      log({
        level: 'info',
        source: 'bot_runner',
        event: 'BOT_STARTUP_WAIT_RELEASED',
        message: `startup wait released on new window ${lifecycleWindowId}`,
        mode: state.mode ?? null,
        window_id: lifecycleWindowId,
        data: { startup_window_id: releasedFrom, active_window_id: lifecycleWindowId }
      });
    }
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
    const lifecycleBtcPrice = toFiniteNumber(context.btc_price) ?? toFiniteNumber(context.strike_price);
    const atrMultiplier = toFiniteNumber(config.atr_multiplier) ?? 1.2;
    const hasWindow = state.current_window_id != null;
    const anchorReady = toFiniteNumber(state.anchor_btc) !== null;
    const boundsPersistedReady = toFiniteNumber(state.upper_bound) !== null && toFiniteNumber(state.lower_bound) !== null;
    const needAnchorInit = hasWindow && !anchorReady;
    const needBoundsInit = hasWindow && anchorReady && !boundsPersistedReady && lifecycleAtr !== null;
    if (needAnchorInit || needBoundsInit) {
      const initAnchor = needAnchorInit ? lifecycleBtcPrice : toFiniteNumber(state.anchor_btc);
      const initPatch = options.createWindowInitPatch
        ? options.createWindowInitPatch({
            window_id: state.current_window_id,
            btc_price: initAnchor,
            atr_5m: lifecycleAtr,
            atr_multiplier: atrMultiplier
          })
        : {
            current_window_id: state.current_window_id,
            anchor_btc: initAnchor,
            atr_5m: lifecycleAtr,
            upper_bound: initAnchor != null && lifecycleAtr != null ? initAnchor + (lifecycleAtr * atrMultiplier) : null,
            lower_bound: initAnchor != null && lifecycleAtr != null ? initAnchor - (lifecycleAtr * atrMultiplier) : null
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
          atr_multiplier: atrMultiplier,
          need_anchor_init: needAnchorInit,
          need_bounds_init: needBoundsInit
        }
      });
    }

    const contextForDecision = {
      ...context,
      atr_5m: state.atr_5m ?? context.atr_5m ?? null,
      upper_bound: state.upper_bound ?? null,
      lower_bound: state.lower_bound ?? null
    };

    const decisionRaw = decide({
      config,
      context: contextForDecision,
      state
    });
    const currentWindowPresent = state.current_window_id != null;
    const btcReady = isCriticalBtcReady(contextForDecision.btc_price);
    const boundsReady = isBoundsReady(state, contextForDecision);
    const rawIntents = Array.isArray(decisionRaw?.intents) ? decisionRaw.intents : [];
    const hasActionIntent = rawIntents.some((intent) => intent?.kind && intent.kind !== 'NOOP');
    const boundsDependentIntent = hasBoundsDependentIntent(rawIntents);
    const gateByBtcNotReady = currentWindowPresent && hasActionIntent && !btcReady;
    const gateByWindowNotInitialized = currentWindowPresent && hasActionIntent && !state.window_initialized_at;
    const gateByBoundsNotReady = currentWindowPresent && boundsDependentIntent && !boundsReady;
    const gateByStartupWait = startupWindowGateMode === 'wait_next_window';
    const shouldGate = gateByStartupWait || gateByBtcNotReady || gateByWindowNotInitialized || gateByBoundsNotReady;
    const gatedReason = gateByStartupWait
      ? 'wait_next_window_after_start'
      : (gateByBtcNotReady
      ? 'gate_context_not_ready_btc_price'
      : (gateByWindowNotInitialized
        ? 'gate_context_not_ready_window_init'
        : (gateByBoundsNotReady ? 'gate_context_not_ready_bounds' : null)));
    const decision = shouldGate
      ? {
          intents: [{ kind: 'NOOP' }],
          reason: gatedReason,
          patches: {},
          diagnostics: {
            ...(decisionRaw?.diagnostics && typeof decisionRaw.diagnostics === 'object' ? decisionRaw.diagnostics : {}),
            gate_context_not_ready: true,
            gate_reason: gatedReason,
            gate_current_window_present: currentWindowPresent,
            gate_btc_ready: btcReady,
            gate_bounds_ready: boundsReady,
            gate_window_initialized: Boolean(state.window_initialized_at),
            gate_startup_wait_active: gateByStartupWait,
            gate_startup_window_id: startupWindowGateId
          }
        }
      : decisionRaw;
    const intentsSummary = summarizeIntents(decision.intents);
    const windowKey = state.current_window_id ?? contextForDecision.window_id ?? '__null_window__';
    const hasPlaceLadder = Array.isArray(decision.intents) && decision.intents.some((intent) => intent?.kind === 'PLACE_LADDER');
    const placeSignature = hasPlaceLadder ? intentsSummary : null;
    const alreadyExecutedSamePlace = hasPlaceLadder
      && executedPlaceIntentByWindow.get(windowKey) === placeSignature;
    const intentsForExecution = alreadyExecutedSamePlace
      ? decision.intents.filter((intent) => intent?.kind !== 'PLACE_LADDER')
      : decision.intents;

    const executionWindowId = state.current_window_id ?? contextForDecision.window_id ?? 'null';
    const intentResult = applyIntents(intentsForExecution, {
      source: `runner_tick|window=${executionWindowId}`
    });
    if (hasPlaceLadder && !alreadyExecutedSamePlace && Number(intentResult?.changed) > 0) {
      executedPlaceIntentByWindow.set(windowKey, placeSignature);
    }
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
    const activeWindowAfter = stateAfter?.current_window_id ?? null;
    for (const key of [...executedPlaceIntentByWindow.keys()]) {
      if (activeWindowAfter == null || key !== activeWindowAfter) {
        executedPlaceIntentByWindow.delete(key);
      }
    }

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
    const exitFillAction = Array.isArray(intentResult?.applied)
      ? (intentResult.applied.find((item) => (
          (item?.action === 'FLATTEN_YES_POSITION' || item?.action === 'FLATTEN_NO_POSITION')
          && Number(item?.changed) > 0
        ))?.action ?? null)
      : null;
    if (exitFillAction) {
      log({
        level: 'info',
        source: 'bot_runner',
        event: 'BOT_EXIT_FILL',
        message: exitFillAction === 'FLATTEN_NO_POSITION' ? 'flatten no position filled' : 'flatten yes position filled',
        mode: state.mode ?? null,
        window_id: contextForDecision.window_id ?? null,
        data: {
          action: exitFillAction
        }
      });
    }
    log({
      level: 'info',
      source: 'bot_runner',
      event: 'BOT_INTENTS',
      message: intentsSummary,
      mode: state.mode ?? null,
      window_id: contextForDecision.window_id ?? null,
      data: {
        reason: decision.reason
      }
    });
    if (shouldGate) {
      log({
        level: 'info',
        source: 'bot_runner',
        event: 'BOT_DECISION_GATED',
        message: gatedReason || 'gate_context_not_ready',
        mode: state.mode ?? null,
        window_id: contextForDecision.window_id ?? null,
        data: {
          startup_wait_active: gateByStartupWait,
          btc_ready: btcReady,
          bounds_ready: boundsReady,
          window_initialized: Boolean(state.window_initialized_at)
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
        intents_summary: intentsSummary,
        changed: intentResult.changed,
        filled: fillResult.changed,
        open_total: summary.open_total,
        cancelled_total: summary.cancelled_total,
        filled_total: summary.filled_total
      }
    });
    const afterLogCount = options.getLogCount ? options.getLogCount() : null;
    const logsAdded = beforeLogCount !== null && afterLogCount !== null ? Math.max(0, afterLogCount - beforeLogCount) : 1;

    const tickResult = {
      context_snapshot: cloneValue(contextForDecision),
      decision_preview: toDecisionPreview(decision, contextForDecision, state),
      state_before: cloneValue(state),
      state_after: cloneValue(stateAfter),
      order_summary: cloneValue(summary),
      fills: cloneValue(fillResult.filled_orders || []),
      logs_added: logsAdded
    };
    if (onTickResult) {
      onTickResult(cloneValue(tickResult));
    }
    return tickResult;
  };

  const runScheduledTick = async () => {
    if (!running || tickInProgress) return null;
    tickInProgress = true;
    try {
      const scheduledTick = typeof options.getScheduledTickParams === 'function' ? await options.getScheduledTickParams() : null;
      const tickParams = scheduledTick && typeof scheduledTick === 'object' && scheduledTick.params ? scheduledTick.params : (scheduledTick || {});
      const result = await runSingleTick(tickParams);
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
      if (scheduledTick && typeof scheduledTick === 'object' && scheduledTick.stop_after_tick === true) {
        log({
          level: 'info',
          source: 'bot_runner',
          event: 'BOT_DEBUG_SCENARIO_DONE',
          message: scheduledTick.stop_reason || 'debug scenario completed',
          mode: result?.state_after?.mode ?? null,
          window_id: result?.context_snapshot?.window_id ?? null,
          data: {
            debug_scenario: scheduledTick.debug_scenario ?? null,
            frame_index: scheduledTick.frame_index ?? null
          }
        });
        stop();
      }
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
    startupWindowGateMode = 'pending';
    startupWindowGateId = null;
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
    setTimeout(() => {
      runScheduledTick();
    }, 0);
    return { already_running: false, ...getRuntimeState() };
  };

  const stop = () => {
    if (!running) {
      return { already_stopped: true, ...getRuntimeState() };
    }
    running = false;
    startupWindowGateMode = 'inactive';
    startupWindowGateId = null;
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
