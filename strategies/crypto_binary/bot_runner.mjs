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
  const currentWindowId = state?.current_window_id ?? null;
  const orderWindowId = order?.resolved_window_id ?? order?.inferred_window_id ?? null;
  if (currentWindowId != null && orderWindowId != null) {
    return orderWindowId === currentWindowId;
  }
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
  const onWindowChanged = typeof options.onWindowChanged === 'function' ? options.onWindowChanged : null;
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
  let startupWindowGateLastRemainingSec = null;

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
    const scheduledTick = params?.__scheduled_tick === true;
    const abortScheduledTickAfterStop = (stage, contextWindowId = null, mode = null) => {
      if (!scheduledTick || running === true) return false;
      log({
        level: 'info',
        source: 'bot_runner',
        event: 'BOT_SCHEDULED_TICK_ABORTED_AFTER_STOP',
        message: `scheduled tick aborted after stop at ${stage}`,
        mode,
        window_id: contextWindowId,
        data: { stage }
      });
      return true;
    };
    const contextBase = await getContext();
    let state = getState();
    if (params.state_override && typeof params.state_override === 'object') {
      state = patchState(params.state_override);
    }
    const context = mergeOverride(contextBase, params.context_override);

    const lifecycleWindowId = context.window_id ?? null;
    if (abortScheduledTickAfterStop('before_window_lifecycle', lifecycleWindowId, state.mode ?? null)) {
      return null;
    }
    if (startupWindowGateMode === 'pending') {
      if (lifecycleWindowId === null) {
        startupWindowGateMode = 'open';
        startupWindowGateLastRemainingSec = null;
      } else {
        startupWindowGateMode = 'wait_next_window';
        startupWindowGateId = lifecycleWindowId;
        startupWindowGateLastRemainingSec = toFiniteNumber(context.remaining_sec);
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
    const lifecycleRemainingSec = toFiniteNumber(context.remaining_sec);
    const releasedByRemainingRollover = (
      startupWindowGateMode === 'wait_next_window'
      && startupWindowGateId !== null
      && lifecycleWindowId === startupWindowGateId
      && startupWindowGateLastRemainingSec !== null
      && lifecycleRemainingSec !== null
      && lifecycleRemainingSec > startupWindowGateLastRemainingSec + 30
    );
    if (startupWindowGateMode === 'wait_next_window' && lifecycleRemainingSec !== null) {
      startupWindowGateLastRemainingSec = lifecycleRemainingSec;
    }
    if (
      startupWindowGateMode === 'wait_next_window'
      && lifecycleWindowId !== null
      && (lifecycleWindowId !== startupWindowGateId || releasedByRemainingRollover)
    ) {
      const releasedFrom = startupWindowGateId;
      startupWindowGateMode = 'open';
      startupWindowGateId = null;
      startupWindowGateLastRemainingSec = null;
      log({
        level: 'info',
        source: 'bot_runner',
        event: 'BOT_STARTUP_WAIT_RELEASED',
        message: `startup wait released on new window ${lifecycleWindowId}`,
        mode: state.mode ?? null,
        window_id: lifecycleWindowId,
        data: {
          startup_window_id: releasedFrom,
          active_window_id: lifecycleWindowId,
          release_reason: releasedByRemainingRollover ? 'remaining_rollover' : 'window_id_changed'
        }
      });
    }
    const prevWindowId = state.current_window_id ?? null;
    if (lifecycleWindowId !== prevWindowId) {
      const stateBeforeWindowChange = cloneValue(state);
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
      if (onWindowChanged) {
        try {
          onWindowChanged({
            from_window_id: prevWindowId,
            to_window_id: lifecycleWindowId,
            state_before: stateBeforeWindowChange,
            state_after: cloneValue(state)
          });
        } catch (error) {
          log({
            level: 'error',
            source: 'bot_runner',
            event: 'BOT_WINDOW_CHANGED_HOOK_FAILED',
            message: error?.message || String(error),
            mode: state.mode ?? null,
            window_id: lifecycleWindowId ?? null
          });
        }
      }
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

    const ordersBeforeDecision = getOrders();
    const activeWindowIdForDecision = state.current_window_id ?? contextForDecision.window_id ?? null;
    const isOpenOrderInActiveWindow = (order) => {
      if (!order || order?.status !== 'OPEN') return false;
      const orderWindowId = order?.resolved_window_id ?? order?.inferred_window_id ?? null;
      if (activeWindowIdForDecision !== null && orderWindowId !== null) {
        return orderWindowId === activeWindowIdForDecision;
      }
      return isOrderInCurrentWindow(order, state);
    };
    const openNoOrderIdsBeforeDecision = ordersBeforeDecision
      .filter((order) => order?.side === 'NO' && isOpenOrderInActiveWindow(order))
      .map((order) => order.order_id)
      .filter(Boolean);
    const openYesOrderIdsBeforeDecision = ordersBeforeDecision
      .filter((order) => order?.side === 'YES' && isOpenOrderInActiveWindow(order))
      .map((order) => order.order_id)
      .filter(Boolean);
    const startedAtTs = Date.parse(state?.started_at || '');
    const openNoFallbackByStartedAt = ordersBeforeDecision
      .filter((order) => {
        if (!order || order?.side !== 'NO' || order?.status !== 'OPEN') return false;
        const orderTs = Date.parse(order?.created_at || '');
        if (Number.isNaN(startedAtTs) || Number.isNaN(orderTs)) return true;
        return orderTs >= startedAtTs;
      })
      .map((order) => order.order_id)
      .filter(Boolean);
    const noOrderIdsForDecision = Array.isArray(state?.no_order_ids) && state.no_order_ids.length > 0
      ? state.no_order_ids
      : (
        openNoOrderIdsBeforeDecision.length > 0
          ? openNoOrderIdsBeforeDecision
          : (startupWindowGateMode === 'wait_next_window' ? openNoFallbackByStartedAt : [])
      );
    const downCancelBeforeEndSec = toFiniteNumber(config?.down_cancel?.before_end_sec ?? config?.cancel_all_remaining_sec);
    const remainingSecForStartupCancel = toFiniteNumber(contextForDecision.remaining_sec);
    const forceDownCancelInStartupWait = (
      startupWindowGateMode === 'wait_next_window'
      && noOrderIdsForDecision.length > 0
      && state?.no_cancelled !== true
      && downCancelBeforeEndSec !== null
      && remainingSecForStartupCancel !== null
      && remainingSecForStartupCancel <= downCancelBeforeEndSec
    );
    const decisionRaw = forceDownCancelInStartupWait
      ? {
          intents: [{ kind: 'CANCEL_OPEN', side: 'NO' }],
          reason: 'down_cancel_before_end_startup_wait_resume',
          patches: { no_cancelled: true },
          diagnostics: {
            startup_wait_force_down_cancel: true,
            startup_wait_force_remaining_sec: remainingSecForStartupCancel,
            startup_wait_force_before_end_sec: downCancelBeforeEndSec,
            startup_wait_force_open_no_count: noOrderIdsForDecision.length
          }
        }
      : decide({
      config,
      context: contextForDecision,
      state: {
        ...state,
        no_order_ids: noOrderIdsForDecision,
        yes_open_order_count: openYesOrderIdsBeforeDecision.length,
        no_open_order_count: noOrderIdsForDecision.length
      }
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
    const cancelOpenNoOnlyIntents = rawIntents.filter((intent) => intent?.kind === 'CANCEL_OPEN' && (intent?.side === 'NO' || intent?.side === 'ALL'));
    const startupWaitCancelableIntentOnly = gateByStartupWait
      && cancelOpenNoOnlyIntents.length > 0
      && rawIntents.every((intent) => intent?.kind === 'NOOP' || (intent?.kind === 'CANCEL_OPEN' && (intent?.side === 'NO' || intent?.side === 'ALL')));
    const gateByStartupWaitEffective = gateByStartupWait && !startupWaitCancelableIntentOnly;
    const shouldGate = gateByStartupWaitEffective || gateByBtcNotReady || gateByWindowNotInitialized || gateByBoundsNotReady;
    const gatedReason = gateByStartupWaitEffective
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
            gate_startup_wait_active: gateByStartupWaitEffective,
            gate_startup_window_id: startupWindowGateId
          }
        }
      : decisionRaw;
    if (startupWaitCancelableIntentOnly) {
      log({
        level: 'info',
        source: 'bot_runner',
        event: 'BOT_STARTUP_WAIT_BYPASS_CANCEL_OPEN_NO',
        message: 'startup wait bypassed for down cancel emission',
        mode: state.mode ?? null,
        window_id: contextForDecision.window_id ?? null,
        data: {
          startup_window_id: startupWindowGateId,
          remaining_sec: contextForDecision.remaining_sec ?? null,
          intents: cancelOpenNoOnlyIntents
        }
      });
    }
    if (forceDownCancelInStartupWait) {
      log({
        level: 'info',
        source: 'bot_runner',
        event: 'BOT_STARTUP_WAIT_FORCE_DOWN_CANCEL',
        message: 'startup wait forced down cancel emission for same-window ownership',
        mode: state.mode ?? null,
        window_id: contextForDecision.window_id ?? null,
        data: {
          remaining_sec: remainingSecForStartupCancel,
          down_cancel_before_end_sec: downCancelBeforeEndSec,
          no_open_count: noOrderIdsForDecision.length
        }
      });
    }
    const intentsSummary = summarizeIntents(decision.intents);
    const windowKey = state.current_window_id ?? contextForDecision.window_id ?? '__null_window__';
    const hasPlaceLadder = Array.isArray(decision.intents) && decision.intents.some((intent) => intent?.kind === 'PLACE_LADDER');
    const placeSignature = hasPlaceLadder ? intentsSummary : null;
    const alreadyExecutedSamePlace = hasPlaceLadder
      && executedPlaceIntentByWindow.get(windowKey) === placeSignature;
    const openDelaySecConfigured = toFiniteNumber(config?.open_delay_sec);
    const parseWindowStartEpochSec = (windowId) => {
      if (typeof windowId !== 'string') return null;
      const matched = windowId.match(/-(\d{10})$/);
      if (!matched) return null;
      const parsed = Number(matched[1]);
      return Number.isFinite(parsed) ? parsed : null;
    };
    const nowEpochSec = (() => {
      const parsed = Date.parse(contextForDecision?.updated_at || '');
      if (!Number.isNaN(parsed)) return parsed / 1000;
      return Date.now() / 1000;
    })();
    const windowStartEpochSec = parseWindowStartEpochSec(contextForDecision?.window_id ?? null);
    const openElapsedPreciseSec = (
      openDelaySecConfigured !== null && windowStartEpochSec !== null
        ? Math.max(0, nowEpochSec - windowStartEpochSec)
        : null
    );
    const gatePlaceByPreciseOpenDelay = (
      openDelaySecConfigured !== null
      && openDelaySecConfigured > 0
      && openElapsedPreciseSec !== null
      && openElapsedPreciseSec < openDelaySecConfigured
    );
    const intentsForExecutionBase = alreadyExecutedSamePlace
      ? decision.intents.filter((intent) => intent?.kind !== 'PLACE_LADDER')
      : decision.intents;
    const intentsForExecution = gatePlaceByPreciseOpenDelay
      ? intentsForExecutionBase.filter((intent) => intent?.kind !== 'PLACE_LADDER')
      : intentsForExecutionBase;
    const intentsExecutionSummary = summarizeIntents(intentsForExecution);
    if (gatePlaceByPreciseOpenDelay && intentsForExecutionBase.length !== intentsForExecution.length) {
      log({
        level: 'info',
        source: 'bot_runner',
        event: 'BOT_DECISION_GATED',
        message: 'NOOP',
        mode: state.mode ?? null,
        window_id: contextForDecision.window_id ?? null,
        data: {
          reason: 'pre_open_or_open_not_open_delay_precise',
          open_delay_sec: openDelaySecConfigured,
          open_elapsed_sec_precise: openElapsedPreciseSec
        }
      });
    }

    if (abortScheduledTickAfterStop('before_apply_intents', contextForDecision.window_id ?? null, state.mode ?? null)) {
      return null;
    }
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
    const decisionPatches = decision.patches && typeof decision.patches === 'object' ? decision.patches : {};
    const windowFilledNo = orders.filter((order) => (
      order.status === 'FILLED'
      && order.side === 'NO'
      && isOrderInCurrentWindow(order, state)
    ));
    const windowFilledYes = orders.filter((order) => (
      order.status === 'FILLED'
      && order.side === 'YES'
      && isOrderInCurrentWindow(order, state)
    ));
    const yesTerminalByFilled = openYes.length === 0 && windowFilledYes.length > 0;
    const noTerminalByFilled = openNo.length === 0 && windowFilledNo.length > 0;
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
      ...decisionPatches
    };
    if (yesTerminalByFilled && statePatch.yes_cancelled !== true) {
      statePatch.yes_cancelled = true;
    }
    if (noTerminalByFilled && statePatch.no_cancelled !== true) {
      statePatch.no_cancelled = true;
    }
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
            kind: order.kind,
            order_window_id: order.window_id ?? null,
            current_window_id: contextForDecision.window_id ?? null,
            order_price: order.price,
            decision_price: order.fill_price,
            fill_price: order.fill_price
          })),
          current_window_id: contextForDecision.window_id ?? null
        }
      });
    }
    if (Array.isArray(fillResult.blocked_cross_window_candidates) && fillResult.blocked_cross_window_candidates.length > 0) {
      log({
        level: 'info',
        source: 'bot_runner',
        event: 'BOT_CROSS_WINDOW_FILL_BLOCKED',
        message: `blocked ${fillResult.blocked_cross_window_candidates.length} cross-window fill candidates`,
        mode: state.mode ?? null,
        window_id: contextForDecision.window_id ?? null,
        data: {
          candidates: fillResult.blocked_cross_window_candidates.map((item) => ({
            order_id: item.order_id,
            side: item.side,
            kind: item.kind,
            order_window_id: item.order_window_id ?? null,
            current_window_id: item.current_window_id ?? null,
            order_price: item.order_price,
            candidate_fill_price: item.candidate_fill_price
          }))
        }
      });
    }
    if (state.yes_cancelled !== true && stateAfter.yes_cancelled === true && yesTerminalByFilled) {
      log({
        level: 'info',
        source: 'bot_runner',
        event: 'BOT_YES_TERMINAL_BY_FILL',
        message: 'yes terminal latched by filled orders in current window',
        mode: state.mode ?? null,
        window_id: contextForDecision.window_id ?? null,
        data: {
          yes_filled_count: windowFilledYes.length,
          yes_open_count: openYes.length
        }
      });
    }
    if (state.no_cancelled !== true && stateAfter.no_cancelled === true && noTerminalByFilled) {
      log({
        level: 'info',
        source: 'bot_runner',
        event: 'BOT_NO_TERMINAL_BY_FILL',
        message: 'no terminal latched by filled orders in current window',
        mode: state.mode ?? null,
        window_id: contextForDecision.window_id ?? null,
        data: {
          no_filled_count: windowFilledNo.length,
          no_open_count: openNo.length
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
      message: intentsExecutionSummary,
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
        snapshot_role: 'execution_snapshot',
        snapshot_source: 'runner_tick',
        context_updated_at: contextForDecision?.updated_at ?? null,
        intents_summary: intentsExecutionSummary,
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
      snapshot_role: 'execution_snapshot',
      snapshot_source: 'runner_tick',
      context_snapshot: cloneValue(contextForDecision),
      decision_preview: toDecisionPreview(decision, contextForDecision, state),
      state_before: cloneValue(state),
      state_after: cloneValue(stateAfter),
      order_summary: cloneValue(summary),
      fills: cloneValue(fillResult.filled_orders || []),
      blocked_cross_window_candidates: cloneValue(fillResult.blocked_cross_window_candidates || []),
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
      const result = await runSingleTick({ ...tickParams, __scheduled_tick: true });
      if (!result) return null;
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
    startupWindowGateLastRemainingSec = null;
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
    startupWindowGateLastRemainingSec = null;
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
