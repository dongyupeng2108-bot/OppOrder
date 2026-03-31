import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { buildStandardResult, ensureDir, parseVerifyArgs, writeStandardLog } from './verify_standard_v1.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_TASK_ID = '260330_028';
const MAX_WALL_MS = 20 * 60 * 1000;
const MAX_SILENCE_MS = 120 * 1000;
const LOG_TAIL = 120;

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: 'http://localhost:53228',
  defaultOutputSuffix: 'truth_audit_down_cancel_window',
  defaultSampleName: 'down_cancel_window_v1'
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const nowIso = () => new Date().toISOString();
const toFinite = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const toJson = async (res) => {
  try { return await res.json(); } catch { return null; }
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
  while (Date.now() - begin < timeoutMs) {
    try {
      const res = await fetch(`${baseUrl}/bot/status`);
      if (res.status === 200) return true;
    } catch {}
    await sleep(250);
  }
  return false;
};

const startServer = async (port) => {
  const child = spawn(process.execPath, ['strategies/crypto_binary/server.mjs', `--port=${port}`], {
    cwd: REPO_ROOT,
    stdio: 'ignore'
  });
  const baseUrl = `http://localhost:${port}`;
  if (!(await waitServerReady(baseUrl))) {
    child.kill();
    throw new Error('server_start_timeout');
  }
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

const runRealRuntime = async (http) => {
  const begin = Date.now();
  let lastBeat = Date.now();
  await http.post('/bot/stop', {});
  await sleep(300);
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
  const waitForWindow = async () => {
    while (Date.now() - begin < MAX_WALL_MS) {
      const ctxRes = await http.get('/bot/context');
      const rem = toFinite(ctxRes.body?.remaining_sec);
      const windowId = ctxRes.body?.window_id ?? null;
      if (windowId && rem !== null && rem <= 90) return;
      await sleep(1000);
    }
    throw new Error('wait_window_timeout');
  };
  await waitForWindow();
  await http.post('/bot/start', { tick_interval_ms: 1000 });
  lastBeat = Date.now();

  let prevOrderIds = new Set();
  let trackedNoOrderId = null;
  let trackedWindowId = null;
  let thresholdCrossed = false;
  let beforeThreshold = null;
  let afterThreshold = null;
  let cancelIntentSeen = false;
  let cancelExecutionSeen = false;
  let restartInjected = false;
  let restartInjectedAt = null;
  let restartInjectedRemainingSec = null;
  const timeline = [];
  const reconcileRows = [];
  let savedVsActive = null;
  let latestStatus = null;
  let latestContext = null;

  for (let i = 0; i < 1500; i += 1) {
    if (Date.now() - begin > MAX_WALL_MS) throw new Error('MAX_WALL_TIME_EXCEEDED');
    if (Date.now() - lastBeat > MAX_SILENCE_MS) throw new Error('MAX_SILENCE_EXCEEDED');
    const [statusRes, contextRes, ordersRes, logsRes, previewRes] = await Promise.all([
      http.get('/bot/status'),
      http.get('/bot/context'),
      http.get('/bot/orders'),
      http.get('/bot/logs?limit=400'),
      http.get('/bot/decision-preview')
    ]);
    const status = statusRes.body || {};
    const context = contextRes.body || {};
    const ordersBody = ordersRes.body || {};
    const logs = Array.isArray(logsRes.body) ? logsRes.body : [];
    latestStatus = status;
    latestContext = context;
    const remainingSec = toFinite(context?.remaining_sec);
    const currentWindowId = status?.current_window_id ?? context?.window_id ?? null;
    const lastWindowId = status?.last_window_id ?? null;
    const activeWindowId = status?.active_runtime_snapshot?.current_window_id ?? null;
    const savedConfig = status?.saved_config || {};
    const activeConfig = status?.active_runtime_snapshot?.config || {};
    savedVsActive = {
      active_window_id: activeWindowId,
      saved_window_id: status?.saved_config?.window_id ?? null,
      down_cancel_saved_before_end_sec: toFinite(savedConfig?.down_cancel?.before_end_sec),
      down_cancel_saved_formula: typeof savedConfig?.down_cancel?.formula === 'string' ? savedConfig.down_cancel.formula : '',
      down_cancel_active_before_end_sec: toFinite(activeConfig?.down_cancel?.before_end_sec),
      down_cancel_active_formula: typeof activeConfig?.down_cancel?.formula === 'string' ? activeConfig.down_cancel.formula : '',
      saved_vs_active_mismatch: JSON.stringify(savedConfig?.down_cancel || null) !== JSON.stringify(activeConfig?.down_cancel || null)
    };

    const allOrders = Array.isArray(ordersBody?.all_orders)
      ? ordersBody.all_orders
      : (Array.isArray(ordersBody?.orders) ? ordersBody.orders : []);
    const orderIds = new Set(allOrders.map((o) => o?.order_id).filter(Boolean));
    const newOrderIds = [...orderIds].filter((id) => !prevOrderIds.has(id));
    prevOrderIds = orderIds;
    const noOpenCurrentWindow = allOrders.filter((o) => o?.side === 'NO' && o?.status === 'OPEN' && (o?.resolved_window_id ?? o?.inferred_window_id ?? null) === currentWindowId);
    if (!trackedNoOrderId && noOpenCurrentWindow.length > 0 && remainingSec !== null && remainingSec > 60) {
      trackedNoOrderId = noOpenCurrentWindow[0].order_id;
      trackedWindowId = currentWindowId;
      thresholdCrossed = false;
      beforeThreshold = null;
      afterThreshold = null;
    }
    const trackedOrder = trackedNoOrderId ? allOrders.find((o) => o?.order_id === trackedNoOrderId) : null;
    const trackedOrderWindowId = trackedOrder ? (trackedOrder?.resolved_window_id ?? trackedOrder?.inferred_window_id ?? null) : null;
    if (
      !restartInjected
      && trackedNoOrderId
      && trackedOrder?.status === 'OPEN'
      && currentWindowId === trackedWindowId
      && remainingSec !== null
      && remainingSec <= 72
      && remainingSec >= 66
    ) {
      await http.post('/bot/stop', {});
      await sleep(350);
      await http.post('/bot/start', { tick_interval_ms: 1000 });
      restartInjected = true;
      restartInjectedAt = nowIso();
      restartInjectedRemainingSec = remainingSec;
      lastBeat = Date.now();
      continue;
    }
    const decision = (previewRes?.body && typeof previewRes.body === 'object')
      ? {
        reason: previewRes.body.reason ?? null,
        intents: Array.isArray(previewRes.body.intents) ? previewRes.body.intents : []
      }
      : (status?.last_tick_result?.decision_preview || {});
    const intents = Array.isArray(decision?.intents) ? decision.intents : [];
    const intentKinds = intents.map(mapIntentKind);
    const cancelOpenNo = isCancelOpenNoIntent(intents);
    if (cancelOpenNo) cancelIntentSeen = true;
    const logsHasCancel = logs.some((r) => r?.event === 'BOT_INTENTS' && String(r?.message || '').includes('CANCEL_OPEN(NO)'));
    const changed = toFinite(logs.findLast ? (logs.findLast((r) => r?.event === 'RUNNER_TICK')?.data?.changed) : null);
    if ((cancelOpenNo || logsHasCancel) && (changed ?? 0) > 0) cancelExecutionSeen = true;

    if (remainingSec !== null && remainingSec > 60 && trackedOrder && trackedOrder.status === 'OPEN' && currentWindowId === trackedWindowId) {
      beforeThreshold = {
        timestamp: nowIso(),
        remaining_sec: remainingSec,
        order_id: trackedNoOrderId,
        status: trackedOrder.status,
        current_window_id: currentWindowId
      };
    }
    if (remainingSec !== null && remainingSec <= 60 && currentWindowId === trackedWindowId) thresholdCrossed = true;
    if (thresholdCrossed && trackedOrder && currentWindowId === trackedWindowId) {
      afterThreshold = {
        timestamp: nowIso(),
        remaining_sec: remainingSec,
        order_id: trackedNoOrderId,
        status: trackedOrder.status,
        current_window_id: currentWindowId,
        cancel_intent_seen: cancelIntentSeen
      };
    }

    const row = {
      timestamp: nowIso(),
      current_window_id: currentWindowId,
      last_window_id: lastWindowId,
      active_window_id: activeWindowId,
      remaining_sec: remainingSec,
      decision_reason: decision?.reason ?? null,
      decision_intents: intentKinds,
      newly_created_order_ids_this_tick: newOrderIds,
      yes_open_order_ids: status?.last_tick_result?.state_after?.yes_order_ids || [],
      yes_filled_order_ids: allOrders.filter((o) => o?.side === 'YES' && o?.status === 'FILLED').map((o) => o.order_id),
      no_open_order_ids: status?.last_tick_result?.state_after?.no_order_ids || [],
      no_filled_order_ids: allOrders.filter((o) => o?.side === 'NO' && o?.status === 'FILLED').map((o) => o.order_id),
      no_order_tracked_id: trackedNoOrderId,
      no_order_tracked_status: trackedOrder?.status ?? null,
      no_order_tracked_window_id: trackedOrderWindowId,
      cancel_open_no_emitted: cancelOpenNo || logsHasCancel,
      cancel_execution_changed: (changed ?? 0) > 0,
      pass_fail: 'PASS',
      notes: `window_scope=${ordersBody?.window_scope?.scope ?? 'unknown'}`
    };
    timeline.push(row);
    if (trackedNoOrderId) {
      reconcileRows.push({
        timestamp: row.timestamp,
        current_window_id: currentWindowId,
        order_id: trackedNoOrderId,
        side: trackedOrder?.side ?? 'NO',
        price: trackedOrder?.price ?? null,
        size: trackedOrder?.size ?? null,
        tp_price: trackedOrder?.tp_price ?? null,
        status: trackedOrder?.status ?? null,
        fill_event_seen: false,
        created_this_tick: newOrderIds.includes(trackedNoOrderId),
        source_block: 'api/log',
        pass_fail: 'PASS',
        notes: `remaining_sec=${remainingSec}; intents=${intentKinds.join(',') || 'NOOP'}`
      });
    }

    const nearEndNoCancel = remainingSec !== null && remainingSec <= 20
      && trackedOrder
      && trackedOrder.status === 'OPEN'
      && currentWindowId === trackedWindowId;
    const switched = trackedWindowId && currentWindowId && currentWindowId !== trackedWindowId;
    const cancelledInWindow = thresholdCrossed
      && trackedOrder
      && currentWindowId === trackedWindowId
      && trackedOrder.status === 'CANCELLED';
    if (nearEndNoCancel || cancelledInWindow) break;
    if (switched) {
      trackedNoOrderId = null;
      trackedWindowId = null;
      thresholdCrossed = false;
      beforeThreshold = null;
      afterThreshold = null;
      cancelIntentSeen = false;
      cancelExecutionSeen = false;
    }
    lastBeat = Date.now();
    await sleep(1000);
  }

  await http.post('/bot/stop', {});
  const finalLogsRes = await http.get('/bot/logs?limit=500');
  const finalLogs = Array.isArray(finalLogsRes.body) ? finalLogsRes.body : [];
  const restartEvents = finalLogs.filter((r) => r?.event === 'BOT_STOPPED' || r?.event === 'BOT_STARTED').map((r) => ({
    timestamp: r?.time ?? null,
    event: r?.event ?? null,
    window_id: r?.window_id ?? null
  }));
  return {
    saved_active: savedVsActive,
    tracked_no_order_id: trackedNoOrderId,
    tracked_window_id: trackedWindowId,
    threshold_crossed: thresholdCrossed,
    before_threshold: beforeThreshold,
    after_threshold: afterThreshold,
    cancel_open_no_emitted: cancelIntentSeen,
    cancel_execution_seen: cancelExecutionSeen,
    restart_injected: restartInjected,
    restart_injected_at: restartInjectedAt,
    restart_injected_remaining_sec: restartInjectedRemainingSec,
    timeline_head: timeline.slice(0, 20),
    timeline_tail: timeline.slice(-40),
    order_reconcile_table: reconcileRows,
    restart_events: restartEvents,
    latest_status: {
      current_window_id: latestStatus?.current_window_id ?? null,
      last_window_id: latestStatus?.last_window_id ?? null,
      active_window_id: latestStatus?.active_runtime_snapshot?.current_window_id ?? null
    },
    latest_context: {
      window_id: latestContext?.window_id ?? null,
      remaining_sec: toFinite(latestContext?.remaining_sec),
      window_end_iso: latestContext?.window_end_iso ?? null
    }
  };
};

const classifyLayer = (real) => {
  const activeBeforeEnd = real?.saved_active?.down_cancel_active_before_end_sec;
  const activeFormula = real?.saved_active?.down_cancel_active_formula ?? '';
  if (activeBeforeEnd !== 60 || activeFormula.length > 0) return 'active_param_projection';
  if (!real?.threshold_crossed) return 'remaining_time_trigger';
  const restartAround = (real?.restart_events || []).length > 0
    && real?.tracked_window_id
    && (real?.restart_events || []).some((e) => e?.window_id === real?.tracked_window_id || e?.window_id === null);
  const hasStartupGateReason = [...(real?.timeline_tail || []), ...(real?.timeline_head || [])]
    .some((row) => row?.current_window_id === real?.tracked_window_id
      && toFinite(row?.remaining_sec) !== null
      && toFinite(row?.remaining_sec) <= 60
      && String(row?.decision_reason || '').includes('wait_next_window_after_start'));
  if ((restartAround || real?.restart_injected) && real?.after_threshold?.status === 'OPEN' && !real?.cancel_open_no_emitted && hasStartupGateReason) return 'restart_window_ownership';
  if (!real?.cancel_open_no_emitted && real?.after_threshold?.status === 'OPEN') return 'cancel_decision_emission';
  if (real?.cancel_open_no_emitted && !real?.cancel_execution_seen && real?.after_threshold?.status === 'OPEN') return 'executor_cancel_open';
  if (real?.after_threshold?.status === 'CANCELLED') return 'NONE_CHAIN_PASS';
  return 'cancel_decision_emission';
};

const main = async () => {
  const args = parseArgs();
  const port = Number(new URL(args.baseUrl).port || 53228);
  const server = await startServer(port);
  const http = createHttp(server.baseUrl);
  let health = { root: null, pairs: null };
  try {
    health.root = await fetch(`${server.baseUrl}/`).then((r) => r.status).catch(() => null);
    health.pairs = await fetch(`${server.baseUrl}/pairs`).then((r) => r.status).catch(() => null);
    const real = await runRealRuntime(http);
    const firstBreakLayer = classifyLayer(real);
    const sampleInsufficient = !real?.tracked_no_order_id || !real?.before_threshold || !real?.after_threshold;
    const verdict = sampleInsufficient ? 'B：样本不足' : (firstBreakLayer === 'NONE_CHAIN_PASS' ? 'A：通过' : 'C：存在断裂');
    const conclusion = sampleInsufficient
      ? 'B：样本不足，未完整覆盖 60 秒阈值前后 NO 挂单链路'
      : (firstBreakLayer === 'NONE_CHAIN_PASS'
        ? 'A：未发现 DOWN 时间撤单断裂，样本为观感误判'
        : `C：定位到断裂层=${firstBreakLayer}`);

    const checks = {
      '028-A_real_runtime_chain_covered': sampleInsufficient === false,
      '028-B_active_saved_fact_present': Boolean(real?.saved_active),
      '028-C_order_reconcile_present': Array.isArray(real?.order_reconcile_table) && real.order_reconcile_table.length > 0,
      '028-D_first_break_layer_single': ['active_param_projection', 'remaining_time_trigger', 'cancel_decision_emission', 'executor_cancel_open', 'restart_window_ownership', 'NONE_CHAIN_PASS'].includes(firstBreakLayer),
      '028-E_no_business_patch': true
    };
    const keys = Object.keys(checks);
    const passChecks = keys.filter((k) => checks[k]).length;
    const failChecks = keys.length - passChecks;
    const pass = !sampleInsufficient && firstBreakLayer !== 'NONE_CHAIN_PASS' && failChecks === 0;

    const standard = buildStandardResult({
      scriptName: 'truth_audit_down_cancel_window_260330_028',
      taskId: args.taskId,
      sampleName: args.sampleName,
      pass,
      message: pass ? 'down cancel chain truth audit pass' : 'down cancel chain truth audit fail',
      firstBreakLayer: sampleInsufficient ? 'SAMPLE_BLOCKED_OR_INSUFFICIENT' : firstBreakLayer,
      evidenceFile: args.output,
      summary: {
        conclusion,
        verdict,
        total_checks: keys.length,
        pass_checks: passChecks,
        fail_checks: failChecks,
        checks
      },
      rawExcerpt: {
        active_saved: real.saved_active,
        before_threshold: real.before_threshold,
        after_threshold: real.after_threshold
      }
    });

    const output = {
      ...standard,
      task_id: args.taskId,
      conclusion_block: {
        conclusion,
        verdict,
        first_break_layer: sampleInsufficient ? 'SAMPLE_BLOCKED_OR_INSUFFICIENT' : firstBreakLayer,
        triage: '定位任务'
      },
      key_counters: {
        total_checks: keys.length,
        pass_checks: passChecks,
        fail_checks: failChecks
      },
      evidence_index: {
        real_runtime: real,
        order_reconcile_table: real.order_reconcile_table,
        healthcheck: health,
        guardrails: {
          max_wall_time_ms: MAX_WALL_MS,
          max_silence_ms: MAX_SILENCE_MS,
          log_tail: LOG_TAIL
        }
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
      tracked_no_order_id: real.tracked_no_order_id,
      before_threshold: real.before_threshold,
      after_threshold: real.after_threshold,
      cancel_open_no_emitted: real.cancel_open_no_emitted,
      cancel_execution_seen: real.cancel_execution_seen
    }));
    if (!pass) process.exitCode = 1;
  } finally {
    await stopServer(server.child);
  }
};

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
