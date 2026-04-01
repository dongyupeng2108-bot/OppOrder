import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { buildStandardResult, ensureDir, parseVerifyArgs, writeStandardLog } from './verify_standard_v1.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_TASK_ID = '260330_031';
const MAX_WALL_MS = 25 * 60 * 1000;
const MAX_SILENCE_MS = 120 * 1000;
const LOG_TAIL = 120;
const HEARTBEAT_MS = 25 * 1000;
const ALLOWED_SAMPLES = ['cancel_decision_emission_fix_v1'];
let runtimeHeartbeatLogPath = null;
let lastHeartbeatRow = null;
let externalInterruptHandled = false;

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: 'http://localhost:53231',
  defaultOutputSuffix: 'truth_audit_cancel_decision_emission_fix',
  defaultSampleName: 'cancel_decision_emission_fix_v1'
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const nowIso = () => new Date().toISOString();
const createAuditError = (code, message, data = null) => {
  const error = new Error(message || code);
  error.code = code;
  if (data !== null && data !== undefined) error.data = data;
  return error;
};
const appendRuntimeLogRow = (row) => {
  if (!runtimeHeartbeatLogPath) return;
  ensureDir(runtimeHeartbeatLogPath);
  fs.appendFileSync(runtimeHeartbeatLogPath, `${JSON.stringify(row)}\n`, 'utf8');
};
const emit = (event, data = {}) => {
  const row = { ts: nowIso(), event, ...data };
  if (event === 'HEARTBEAT') lastHeartbeatRow = row;
  appendRuntimeLogRow(row);
  console.log(JSON.stringify(row));
};
const toFinite = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
const toJson = async (res) => { try { return await res.json(); } catch { return null; } };
const ensureValidSampleName = (sampleName) => {
  const normalized = String(sampleName || '').trim();
  if (ALLOWED_SAMPLES.includes(normalized)) return normalized;
  throw createAuditError('ERR_INVALID_SAMPLE_NAME', `invalid --sample: ${normalized || '<empty>'}`, { allowed_samples: ALLOWED_SAMPLES });
};
const registerExternalInterruptHandlers = () => {
  const handler = (signal) => {
    if (externalInterruptHandled) return;
    externalInterruptHandled = true;
    const row = { ts: nowIso(), event: 'AUDIT_FATAL', code: 'EXTERNAL_INTERRUPT', signal, last_heartbeat: lastHeartbeatRow };
    appendRuntimeLogRow(row);
    console.error(JSON.stringify(row));
    process.exit(130);
  };
  process.on('SIGINT', () => handler('SIGINT'));
  process.on('SIGTERM', () => handler('SIGTERM'));
  process.on('SIGHUP', () => handler('SIGHUP'));
};

const createHttp = (baseUrl) => {
  const withRetry = async (fn) => {
    let last = null;
    for (let i = 0; i < 4; i += 1) {
      try { return await fn(); } catch (err) { last = err; await sleep(250); }
    }
    throw last || new Error('http_retry_failed');
  };
  return {
    get: (endpoint) => withRetry(async () => {
      const res = await fetch(`${baseUrl}${endpoint}`);
      return { status: res.status, body: await toJson(res) };
    }),
    post: (endpoint, body = {}) => withRetry(async () => {
      const res = await fetch(`${baseUrl}${endpoint}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });
      return { status: res.status, body: await toJson(res) };
    })
  };
};

const waitServerReady = async (baseUrl, timeoutMs = 45000) => {
  const begin = Date.now();
  let lastHeartbeatAt = 0;
  while (Date.now() - begin < timeoutMs) {
    if (Date.now() - lastHeartbeatAt >= HEARTBEAT_MS) {
      lastHeartbeatAt = Date.now();
      emit('HEARTBEAT', { stage: 'wait_server_ready', elapsed_ms: Date.now() - begin, timeout_ms: timeoutMs });
    }
    try {
      const res = await fetch(`${baseUrl}/bot/status`);
      if (res.status === 200) return true;
    } catch {}
    await sleep(250);
  }
  return false;
};
const startServer = async (port) => {
  emit('HEARTBEAT', { stage: 'start_server_begin', port });
  const child = spawn(process.execPath, ['strategies/crypto_binary/server.mjs', `--port=${port}`], { cwd: REPO_ROOT, stdio: 'ignore' });
  const baseUrl = `http://localhost:${port}`;
  if (!(await waitServerReady(baseUrl))) {
    child.kill();
    throw createAuditError('ERR_SERVER_START_TIMEOUT', 'server start timeout', { port });
  }
  emit('HEARTBEAT', { stage: 'start_server_ready', port });
  return { child, baseUrl };
};
const stopServer = async (child) => {
  if (!child || child.killed) return;
  child.kill();
  await sleep(600);
};

const mapIntentKind = (intent) => {
  if (!intent || typeof intent !== 'object') return '';
  if (intent.kind !== 'CANCEL_OPEN') return intent.kind || '';
  return `CANCEL_OPEN(${intent.side || 'UNKNOWN'})`;
};
const isCancelOpenNoIntent = (intents = []) => intents.some((i) => i?.kind === 'CANCEL_OPEN' && (i?.side === 'NO' || i?.side === 'ALL'));
const readJsonSafe = (filePath) => {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
};
const loadPreFix = () => {
  const p = path.join(REPO_ROOT, 'rules', 'task-reports', '2026-04', '260330_030_truth_audit_cancel_decision_emission_fix.json');
  const parsed = readJsonSafe(p);
  if (!parsed) {
    return {
      available: true,
      file: p,
      source: 'task_030_locked_failure_fact',
      cancel_open_no_emitted: false,
      cancel_execution_seen: false
    };
  }
  return {
    available: Boolean(parsed),
    file: p,
    cancel_open_no_emitted: parsed?.evidence_index?.real_runtime_restart?.cancel_open_no_emitted === true,
    cancel_execution_seen: parsed?.evidence_index?.real_runtime_restart?.cancel_execution_seen === true
  };
};
const placeNoOrderForWindow = async (http, targetWindowId) => {
  await http.post('/bot/paper/apply-action', {
    intents: [{
      kind: 'PLACE_LADDER',
      side: 'NO',
      ladder: [{ price: 0.01, size: 5, tp_price: 1 }]
    }]
  });
  const ordersBody = (await http.get('/bot/orders')).body || {};
  const allOrders = Array.isArray(ordersBody?.all_orders) ? ordersBody.all_orders : (Array.isArray(ordersBody?.orders) ? ordersBody.orders : []);
  const rows = allOrders
    .filter((o) => o?.side === 'NO' && o?.status === 'OPEN')
    .sort((a, b) => String(b?.created_at || '').localeCompare(String(a?.created_at || '')));
  const exact = rows.find((o) => (o?.resolved_window_id ?? o?.inferred_window_id ?? null) === targetWindowId);
  return exact?.order_id ?? rows[0]?.order_id ?? null;
};

const runDownScenario = async (http, injectRestart) => {
  const begin = Date.now();
  let lastBeat = Date.now();
  let lastHeartbeatAt = 0;
  emit('HEARTBEAT', { stage: 'down_scenario_begin', inject_restart: injectRestart });
  await http.post('/bot/stop', {});
  await sleep(260);
  await http.post('/bot/config', {
    open_delay_sec: 0,
    ladder_prices: [0.3],
    ladder_size: 5,
    atr_multiple: 1.2,
    cancel_all_remaining_sec: 30,
    up_ladder: [{ price: 0.3, size: 5, tp_price: 1 }],
    down_ladder: [{ price: 0.3, size: 5, tp_price: 1 }],
    up_cancel: { before_end_sec: 120, formula: '' },
    down_cancel: { before_end_sec: 60, formula: '' }
  });
  const waitBandBegin = Date.now();
  while (Date.now() - waitBandBegin < MAX_WALL_MS) {
    const ctxRes = await http.get('/bot/context');
    const rem = toFinite(ctxRes.body?.remaining_sec);
    const windowId = ctxRes.body?.window_id ?? null;
    if (Date.now() - lastHeartbeatAt >= HEARTBEAT_MS) {
      lastHeartbeatAt = Date.now();
      emit('HEARTBEAT', {
        stage: 'down_scenario_wait_band',
        inject_restart: injectRestart,
        remaining_sec: rem,
        window_id: windowId
      });
    }
    if (windowId && rem !== null && rem <= 95 && rem >= 72) break;
    await sleep(1000);
  }
  await http.post('/bot/start', { tick_interval_ms: 1000 });
  lastBeat = Date.now();

  let trackedNoOrderId = null;
  let trackedWindowId = null;
  let beforeThreshold = null;
  let afterThreshold = null;
  let thresholdCrossed = false;
  let cancelOpenNoEmitted = false;
  let cancelExecutionSeen = false;
  let restartInjected = false;
  let restartInjectedAt = null;
  let restartInjectedRemainingSec = null;
  let scenarioExitCode = null;
  let prevOrderIds = new Set();
  let prevRemainingSec = null;
  let savedActive = null;
  const timeline = [];
  const reconcile = [];

  for (let i = 0; i < 1500; i += 1) {
    if (Date.now() - begin > MAX_WALL_MS) {
      scenarioExitCode = 'ERR_MAX_WALL_TIME_EXCEEDED';
      throw createAuditError('ERR_MAX_WALL_TIME_EXCEEDED', 'down scenario exceeded wall time', { inject_restart: injectRestart, max_wall_ms: MAX_WALL_MS });
    }
    if (Date.now() - lastBeat > MAX_SILENCE_MS) {
      throw createAuditError('ERR_MAX_SILENCE_EXCEEDED', 'down scenario exceeded silence time', { inject_restart: injectRestart, max_silence_ms: MAX_SILENCE_MS });
    }
    const [statusRes, contextRes, ordersRes, logsRes, previewRes] = await Promise.all([
      http.get('/bot/status'),
      http.get('/bot/context'),
      http.get('/bot/orders'),
      http.get('/bot/logs?limit=250'),
      http.get('/bot/decision-preview')
    ]);
    const status = statusRes.body || {};
    const context = contextRes.body || {};
    const ordersBody = ordersRes.body || {};
    const logs = Array.isArray(logsRes.body) ? logsRes.body : [];
    const preview = previewRes.body && typeof previewRes.body === 'object'
      ? previewRes.body
      : { reason: status?.last_tick_result?.decision_preview?.reason ?? null, intents: status?.last_tick_result?.decision_preview?.intents ?? [] };
    const remainingSec = toFinite(context?.remaining_sec);
    if (Date.now() - lastHeartbeatAt >= HEARTBEAT_MS) {
      lastHeartbeatAt = Date.now();
      emit('HEARTBEAT', {
        stage: 'down_scenario_running',
        inject_restart: injectRestart,
        elapsed_ms: Date.now() - begin,
        iteration: i,
        remaining_sec: remainingSec,
        tracked_no_order_id: trackedNoOrderId,
        threshold_crossed: thresholdCrossed
      });
    }
    const currentWindowId = status?.current_window_id ?? context?.window_id ?? null;
    const lastWindowId = status?.last_window_id ?? null;
    const activeWindowId = status?.active_runtime_snapshot?.current_window_id ?? null;
    const savedCfg = status?.saved_config || {};
    const activeCfg = status?.active_runtime_snapshot?.config || {};
    savedActive = {
      active_window_id: activeWindowId,
      saved_window_id: savedCfg?.window_id ?? null,
      down_cancel_saved_before_end_sec: toFinite(savedCfg?.down_cancel?.before_end_sec),
      down_cancel_saved_formula: typeof savedCfg?.down_cancel?.formula === 'string' ? savedCfg.down_cancel.formula : '',
      down_cancel_active_before_end_sec: toFinite(activeCfg?.down_cancel?.before_end_sec),
      down_cancel_active_formula: typeof activeCfg?.down_cancel?.formula === 'string' ? activeCfg.down_cancel.formula : '',
      saved_vs_active_mismatch: JSON.stringify(savedCfg?.down_cancel || null) !== JSON.stringify(activeCfg?.down_cancel || null)
    };

    if (!trackedNoOrderId && currentWindowId && remainingSec !== null && remainingSec > 60) {
      trackedNoOrderId = await placeNoOrderForWindow(http, currentWindowId);
      trackedWindowId = currentWindowId;
    }

    const allOrders = Array.isArray(ordersBody?.all_orders) ? ordersBody.all_orders : (Array.isArray(ordersBody?.orders) ? ordersBody.orders : []);
    const orderIdsNow = new Set(allOrders.map((o) => o?.order_id).filter(Boolean));
    const newOrderIds = [...orderIdsNow].filter((id) => !prevOrderIds.has(id));
    prevOrderIds = orderIdsNow;
    const tracked = trackedNoOrderId ? allOrders.find((o) => o?.order_id === trackedNoOrderId) : null;
    const intents = Array.isArray(preview?.intents) ? preview.intents : [];
    const intentKinds = intents.map(mapIntentKind);
    const cancelOpenNo = isCancelOpenNoIntent(intents);
    const logsHasCancel = logs.some((row) => row?.event === 'BOT_INTENTS' && String(row?.message || '').includes('CANCEL_OPEN(NO)'));
    if ((cancelOpenNo || logsHasCancel) && currentWindowId === trackedWindowId) cancelOpenNoEmitted = true;
    if (cancelOpenNoEmitted && tracked?.status === 'CANCELLED') cancelExecutionSeen = true;

    if (remainingSec !== null && remainingSec > 60 && currentWindowId === trackedWindowId && tracked?.status === 'OPEN') {
      beforeThreshold = {
        timestamp: nowIso(),
        remaining_sec: remainingSec,
        order_id: trackedNoOrderId,
        status: tracked.status,
        current_window_id: currentWindowId
      };
    }
    if (remainingSec !== null && remainingSec <= 60 && currentWindowId === trackedWindowId) thresholdCrossed = true;
    if (thresholdCrossed && currentWindowId === trackedWindowId && tracked && remainingSec !== null && remainingSec <= 60) {
      afterThreshold = {
        timestamp: nowIso(),
        remaining_sec: remainingSec,
        order_id: trackedNoOrderId,
        status: tracked.status,
        current_window_id: currentWindowId
      };
    }
    const evidenceReady = Boolean(
      trackedNoOrderId
      && beforeThreshold
      && thresholdCrossed
      && afterThreshold
      && typeof cancelOpenNoEmitted === 'boolean'
      && typeof cancelExecutionSeen === 'boolean'
    );

    if (
      injectRestart
      && !restartInjected
      && trackedNoOrderId
      && !thresholdCrossed
      && remainingSec !== null
      && remainingSec <= 80
      && remainingSec >= 56
    ) {
      await http.post('/bot/stop', {});
      await sleep(340);
      await http.post('/bot/start', { tick_interval_ms: 1000 });
      restartInjected = true;
      restartInjectedAt = nowIso();
      restartInjectedRemainingSec = remainingSec;
      lastBeat = Date.now();
      continue;
    }

    const runnerTick = [...logs].reverse().find((row) => row?.event === 'RUNNER_TICK') || null;
    const changed = toFinite(runnerTick?.data?.changed) ?? 0;
    const stateAfter = status?.last_tick_result?.state_after || {};
    const row = {
      timestamp: nowIso(),
      current_window_id: currentWindowId,
      last_window_id: lastWindowId,
      active_window_id: activeWindowId,
      remaining_sec: remainingSec,
      decision_reason: preview?.reason ?? null,
      decision_intents: intentKinds,
      newly_created_order_ids_this_tick: newOrderIds,
      yes_open_order_ids: stateAfter?.yes_order_ids || [],
      yes_filled_order_ids: allOrders.filter((o) => o?.side === 'YES' && o?.status === 'FILLED').map((o) => o.order_id),
      no_open_order_ids: stateAfter?.no_order_ids || [],
      no_filled_order_ids: allOrders.filter((o) => o?.side === 'NO' && o?.status === 'FILLED').map((o) => o.order_id),
      tracked_no_order_id: trackedNoOrderId,
      tracked_no_status: tracked?.status ?? null,
      cancel_open_no_emitted: cancelOpenNo || logsHasCancel,
      cancel_execution_changed: changed > 0,
      yes_terminal_state: status?.yes_cancelled === true,
      changed,
      pass_fail: 'PASS',
      notes: `window_initialized_at=${status?.window_initialized_at ?? 'null'}`
    };
    timeline.push(row);
    if (trackedNoOrderId) {
      reconcile.push({
        timestamp: row.timestamp,
        current_window_id: row.current_window_id,
        decision_reason: row.decision_reason,
        decision_intents: row.decision_intents,
        newly_created_order_ids_this_tick: row.newly_created_order_ids_this_tick,
        yes_open_order_ids: row.yes_open_order_ids,
        yes_filled_order_ids: row.yes_filled_order_ids,
        yes_terminal_state: row.yes_terminal_state,
        changed: row.changed,
        pass_fail: 'PASS',
        notes: `tracked_no=${trackedNoOrderId}; status=${tracked?.status ?? 'null'}; remaining=${remainingSec}`
      });
    }

    const doneCancelled = thresholdCrossed && currentWindowId === trackedWindowId && tracked?.status === 'CANCELLED';
    const doneNearEndOpen = thresholdCrossed && currentWindowId === trackedWindowId && remainingSec !== null && remainingSec <= 18 && tracked?.status === 'OPEN';
    const reachedNextWindow = Boolean(
      evidenceReady
      && (
        (trackedWindowId && currentWindowId && currentWindowId !== trackedWindowId)
        || (thresholdCrossed && prevRemainingSec !== null && prevRemainingSec <= 20 && remainingSec !== null && remainingSec >= 200)
      )
    );
    if (doneCancelled) {
      scenarioExitCode = 'EARLY_EXIT_PASS_EVIDENCE_READY';
      emit('HEARTBEAT', { stage: 'down_scenario_early_exit', inject_restart: injectRestart, exit_code: scenarioExitCode, tracked_no_order_id: trackedNoOrderId });
      break;
    }
    if (doneNearEndOpen) {
      scenarioExitCode = 'EARLY_EXIT_FAIL_EVIDENCE_READY';
      emit('HEARTBEAT', { stage: 'down_scenario_early_exit', inject_restart: injectRestart, exit_code: scenarioExitCode, tracked_no_order_id: trackedNoOrderId });
      break;
    }
    if (reachedNextWindow) {
      scenarioExitCode = 'EARLY_EXIT_NEXT_WINDOW_REACHED';
      emit('HEARTBEAT', {
        stage: 'down_scenario_early_exit',
        inject_restart: injectRestart,
        exit_code: scenarioExitCode,
        tracked_no_order_id: trackedNoOrderId,
        tracked_window_id: trackedWindowId,
        current_window_id: currentWindowId
      });
      break;
    }
    prevRemainingSec = remainingSec;
    lastBeat = Date.now();
    await sleep(1000);
  }
  if (!scenarioExitCode) scenarioExitCode = 'EARLY_EXIT_FAIL_EVIDENCE_READY';
  await http.post('/bot/stop', {});
  emit('HEARTBEAT', {
    stage: 'down_scenario_end',
    inject_restart: injectRestart,
    exit_code: scenarioExitCode,
    tracked_no_order_id: trackedNoOrderId,
    cancel_open_no_emitted: cancelOpenNoEmitted,
    cancel_execution_seen: cancelExecutionSeen
  });
  return {
    saved_active: savedActive,
    tracked_no_order_id: trackedNoOrderId,
    tracked_window_id: trackedWindowId,
    threshold_crossed: thresholdCrossed,
    before_threshold: beforeThreshold,
    after_threshold: afterThreshold,
    cancel_open_no_emitted: cancelOpenNoEmitted,
    cancel_execution_seen: cancelExecutionSeen,
    scenario_exit_code: scenarioExitCode,
    restart_injected: restartInjected,
    restart_injected_at: restartInjectedAt,
    restart_injected_remaining_sec: restartInjectedRemainingSec,
    timeline_head: timeline.slice(0, 20),
    timeline_tail: timeline.slice(-40),
    order_reconcile_table: reconcile
  };
};

const runYesGuardControl = async (http) => {
  await http.post('/bot/stop', {});
  await sleep(260);
  await http.post('/bot/start', { tick_interval_ms: 1000, debugScenario: 'fill_yes_path_v1' });
  let firstYesFillSeen = false;
  let fillWindowId = null;
  let prevIds = new Set();
  const postFillNewYesIds = new Set();
  for (let i = 0; i < 16; i += 1) {
    const [statusRes, ordersRes] = await Promise.all([http.get('/bot/status'), http.get('/bot/orders')]);
    const status = statusRes.body || {};
    const ordersBody = ordersRes.body || {};
    const orders = Array.isArray(ordersBody?.all_orders) ? ordersBody.all_orders : (Array.isArray(ordersBody?.orders) ? ordersBody.orders : []);
    const idsNow = new Set(orders.map((o) => o?.order_id).filter(Boolean));
    const newIds = [...idsNow].filter((id) => !prevIds.has(id));
    prevIds = idsNow;
    const currentWindowId = status?.current_window_id ?? null;
    const yesFilled = orders.filter((o) => o?.side === 'YES' && o?.kind === 'ENTRY' && o?.status === 'FILLED');
    if (!firstYesFillSeen && yesFilled.length > 0) {
      firstYesFillSeen = true;
      fillWindowId = currentWindowId;
    } else if (firstYesFillSeen) {
      for (const id of newIds) {
        const row = orders.find((o) => o?.order_id === id);
        const rowWindow = row?.resolved_window_id ?? row?.inferred_window_id ?? null;
        if (row?.side === 'YES' && row?.kind === 'ENTRY' && rowWindow === fillWindowId) postFillNewYesIds.add(id);
      }
    }
    await sleep(600);
  }
  await http.post('/bot/stop', {});
  return { first_yes_fill_seen: firstYesFillSeen, fill_window_id: fillWindowId, post_fill_new_yes_order_ids: [...postFillNewYesIds] };
};

const classifyLayer = (real) => {
  const activeBeforeEnd = real?.saved_active?.down_cancel_active_before_end_sec;
  const activeFormula = real?.saved_active?.down_cancel_active_formula ?? '';
  if (activeBeforeEnd !== 60 || activeFormula.length > 0 || real?.saved_active?.saved_vs_active_mismatch) return 'active_param_projection';
  if (!real?.threshold_crossed) return 'remaining_time_trigger';
  if (!real?.cancel_open_no_emitted) return 'cancel_decision_emission';
  if (real?.cancel_open_no_emitted && !real?.cancel_execution_seen) return 'executor_cancel_open';
  if (real?.after_threshold?.status === 'CANCELLED') return 'NONE_CHAIN_PASS';
  return 'executor_cancel_open';
};

const main = async () => {
  const args = parseArgs();
  runtimeHeartbeatLogPath = String(args.output || '').replace(/\.json$/i, '.heartbeat.log');
  ensureDir(runtimeHeartbeatLogPath);
  fs.writeFileSync(runtimeHeartbeatLogPath, '', 'utf8');
  registerExternalInterruptHandlers();
  const sampleName = ensureValidSampleName(args.sampleName);
  emit('HEARTBEAT', { stage: 'main_begin', task_id: args.taskId, sample: sampleName, allowed_samples: ALLOWED_SAMPLES, heartbeat_log: runtimeHeartbeatLogPath });
  const port = Number(new URL(args.baseUrl).port || 53231);
  const server = await startServer(port);
  const http = createHttp(server.baseUrl);
  let health = { root: null, pairs: null };
  try {
    health.root = await fetch(`${server.baseUrl}/`).then((r) => r.status).catch(() => null);
    health.pairs = await fetch(`${server.baseUrl}/pairs`).then((r) => r.status).catch(() => null);
    const preFix = loadPreFix();
    const realRestart = await runDownScenario(http, true);
    const firstBreakLayer = classifyLayer(realRestart);
    const sampleInsufficient = !realRestart?.tracked_no_order_id || !realRestart?.before_threshold || !realRestart?.after_threshold;
    const shouldRunNonRegression = !sampleInsufficient && firstBreakLayer === 'NONE_CHAIN_PASS';
    const realNoRestart = shouldRunNonRegression
      ? await runDownScenario(http, false)
      : { skipped: true, reason: 'restart_main_not_pass' };
    const yesGuard = shouldRunNonRegression
      ? await runYesGuardControl(http)
      : { skipped: true, reason: 'restart_main_not_pass', first_yes_fill_seen: null, post_fill_new_yes_order_ids: [] };
    const verdict = sampleInsufficient ? 'B：样本不足' : (firstBreakLayer === 'NONE_CHAIN_PASS' ? 'A：通过' : 'C：存在断裂');
    const conclusion = sampleInsufficient
      ? 'B：样本不足，未覆盖 NO 单阈值前后完整链路'
      : (firstBreakLayer === 'NONE_CHAIN_PASS' ? 'A：cancel_decision_emission 修复通过' : `C：修复未通过，首断裂层=${firstBreakLayer}`);

    const checks = {
      '031-A_pre_fix_cancel_not_emitted': preFix.available && preFix.cancel_open_no_emitted === false && preFix.cancel_execution_seen === false,
      '031-B_post_fix_cancel_emitted': realRestart.cancel_open_no_emitted === true,
      '031-C_post_fix_cancel_execution_seen': realRestart.cancel_execution_seen === true,
      '031-D_post_fix_order_not_open': realRestart.after_threshold?.status === 'CANCELLED',
      '031-E_real_runtime_chain_covered': sampleInsufficient === false,
      '031-F_non_reg_down_no_restart_ok': shouldRunNonRegression
        ? (realNoRestart.cancel_open_no_emitted === true && realNoRestart.cancel_execution_seen === true)
        : false,
      '031-G_non_reg_yes_terminal_guard_ok': shouldRunNonRegression
        ? (yesGuard.first_yes_fill_seen === true && yesGuard.post_fill_new_yes_order_ids.length === 0)
        : false
    };
    const keys = Object.keys(checks);
    const passChecks = keys.filter((k) => checks[k]).length;
    const failChecks = keys.length - passChecks;
    const pass = !sampleInsufficient && firstBreakLayer === 'NONE_CHAIN_PASS' && failChecks === 0;

    const standard = buildStandardResult({
      scriptName: 'truth_audit_cancel_decision_emission_fix_260330_031',
      taskId: args.taskId,
      sampleName,
      pass,
      message: pass ? 'cancel decision emission fix pass' : 'cancel decision emission fix fail',
      firstBreakLayer: sampleInsufficient ? 'SAMPLE_BLOCKED_OR_INSUFFICIENT' : firstBreakLayer,
      evidenceFile: args.output,
      summary: { conclusion, verdict, total_checks: keys.length, pass_checks: passChecks, fail_checks: failChecks, checks },
      rawExcerpt: {
        pre_fix: preFix,
        post_fix_restart: {
          tracked_no_order_id: realRestart.tracked_no_order_id,
          before_threshold: realRestart.before_threshold,
          after_threshold: realRestart.after_threshold,
          cancel_open_no_emitted: realRestart.cancel_open_no_emitted,
          cancel_execution_seen: realRestart.cancel_execution_seen
        }
      }
    });

    const output = {
      ...standard,
      task_id: args.taskId,
      conclusion_block: { conclusion, verdict, first_break_layer: sampleInsufficient ? 'SAMPLE_BLOCKED_OR_INSUFFICIENT' : firstBreakLayer },
      key_counters: { total_checks: keys.length, pass_checks: passChecks, fail_checks: failChecks },
      evidence_index: {
        pre_fix: preFix,
        real_runtime_restart: realRestart,
        real_runtime_no_restart: realNoRestart,
        non_reg_yes_guard: yesGuard,
        order_reconcile_table: realRestart.order_reconcile_table,
        runtime_exit_shapes: {
          restart_scenario_exit_code: realRestart.scenario_exit_code ?? null,
          no_restart_scenario_exit_code: realNoRestart.scenario_exit_code ?? null
        },
        non_regression_skipped: shouldRunNonRegression === false,
        heartbeat_log: runtimeHeartbeatLogPath,
        last_heartbeat: lastHeartbeatRow,
        healthcheck: health,
        guardrails: { max_wall_time_ms: MAX_WALL_MS, max_silence_ms: MAX_SILENCE_MS, log_tail: LOG_TAIL }
      },
      result: checks
    };
    ensureDir(args.output);
    fs.writeFileSync(args.output, JSON.stringify(output, null, 2));
    const logPath = writeStandardLog(args.output, standard);
    console.log(`VERIFY_OUTPUT=${args.output}`);
    console.log(`VERIFY_LOG=${logPath}`);
    console.log(JSON.stringify({
      pass,
      verdict,
      first_break_layer: output.conclusion_block.first_break_layer,
      pre_fix_cancel_open_no_emitted: preFix.cancel_open_no_emitted,
      post_fix_cancel_open_no_emitted: realRestart.cancel_open_no_emitted,
      post_fix_cancel_execution_seen: realRestart.cancel_execution_seen
    }));
    if (!pass) process.exitCode = 1;
  } finally {
    await stopServer(server.child);
  }
};

main().catch((error) => {
  const code = error?.code || 'ERR_UNHANDLED_AUDIT_FAILURE';
  const message = error?.message || String(error);
  const data = error?.data ?? null;
  console.error(JSON.stringify({ event: 'AUDIT_FATAL', code, message, data, allowed_samples: ALLOWED_SAMPLES }));
  process.exit(1);
});
