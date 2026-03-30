import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { buildStandardResult, ensureDir, parseVerifyArgs, writeStandardLog } from './verify_standard_v1.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_TASK_ID = '260330_015';
const MAX_WALL_MS = 25 * 60 * 1000;
const MAX_SILENCE_MS = 120 * 1000;
const LOG_TAIL = 120;

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: 'http://localhost:53215',
  defaultOutputSuffix: 'truth_audit_executor_isolation',
  defaultSampleName: 'executor_isolation_v1'
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const nowIso = () => new Date().toISOString();
const toFinite = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
const toJson = async (res) => {
  try {
    return await res.json();
  } catch {
    return null;
  }
};

const createHttp = (baseUrl) => {
  const withRetry = async (fn) => {
    let lastError = null;
    for (let i = 0; i < 4; i += 1) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        await sleep(250);
      }
    }
    throw lastError || new Error('http_retry_failed');
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
  const ok = await waitServerReady(baseUrl);
  if (!ok) {
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

const getCompletedSummary = async (http, statusBody) => {
  const perfRes = await http.get('/bot/performance/summary?detail=1');
  const summary = perfRes.body?.summary || {};
  const rows = Array.isArray(summary?.participating_postmortem_rows) ? summary.participating_postmortem_rows : [];
  const row = rows.length ? rows[rows.length - 1] : null;
  const pmRes = await http.get('/bot/postmortem/latest');
  const pm = pmRes.body?.postmortem || null;
  const completedWindowId = row?.window_id
    ?? pm?.window_id
    ?? statusBody?.last_run_snapshot?.current_window_id
    ?? statusBody?.last_run_snapshot?.window_id
    ?? null;
  const completedFilledTotal = toFinite(row?.filled_total)
    ?? toFinite(pm?.filled_total)
    ?? toFinite(statusBody?.last_run_snapshot?.filled_total)
    ?? null;
  return {
    completed_summary_window_id: completedWindowId,
    completed_summary_filled_total: completedFilledTotal,
    running_window_excluded: summary?.running_window_excluded ?? null
  };
};

const extractDecision = (logs) => {
  const rows = Array.isArray(logs) ? logs : [];
  const lastRunner = [...rows].reverse().find((r) => r?.event === 'RUNNER_TICK') || null;
  const reason = typeof lastRunner?.message === 'string' && lastRunner.message.startsWith('tick ')
    ? lastRunner.message.slice(5)
    : null;
  const intents = typeof lastRunner?.data?.intents_summary === 'string'
    ? lastRunner.data.intents_summary
    : null;
  return { reason, intents };
};

const countTp = (rows) => (Array.isArray(rows) ? rows.filter((r) => r?.kind === 'TAKE_PROFIT').length : 0);

const runDebugControl = async (http) => {
  await http.post('/bot/stop', {});
  const w1 = `dbg-015-${Date.now()}-w1`;
  const w2 = `dbg-015-${Date.now()}-w2`;
  const steps = [];
  const ordersAfter = async (label, tickRes) => {
    const orders = await http.get('/bot/orders');
    const status = await http.get('/bot/status');
    const rows = Array.isArray(orders.body?.window_orders) ? orders.body.window_orders : [];
    steps.push({
      label,
      current_window_id: status.body?.current_window_id ?? null,
      decision_reason: tickRes.body?.decision_preview?.reason ?? null,
      decision_intents: tickRes.body?.decision_preview?.intents_summary ?? null,
      open_orders_count: toFinite(orders.body?.summary?.open_total) ?? 0,
      current_window_orders_count: rows.length,
      current_window_tp_count: countTp(rows),
      new_orders_this_tick: Number(tickRes.body?.outcome?.changed ?? 0)
    });
    return { orders, status };
  };
  const t1 = await http.post('/bot/runner/tick', {
    state_override: {
      current_window_id: w1,
      window_initialized_at: new Date(Date.now() - 45000).toISOString(),
      ladder_posted: false,
      yes_order_ids: [],
      no_order_ids: [],
      yes_cancelled: false,
      no_cancelled: false,
      anchor_btc: 65000,
      atr_5m: 90,
      upper_bound: 70000,
      lower_bound: 60000
    },
    context_override: {
      window_id: w1,
      period: '5m',
      remaining_sec: 290,
      btc_price: 65000,
      atr_5m: 90,
      bid_yes: 0.01,
      ask_yes: 0.99,
      bid_no: 0.01,
      ask_no: 0.99
    }
  });
  await ordersAfter('place_tick', t1);

  const t2 = await http.post('/bot/runner/tick', {
    state_override: {
      current_window_id: w1,
      window_initialized_at: new Date(Date.now() - 42000).toISOString(),
      ladder_posted: true
    },
    context_override: {
      window_id: w1,
      period: '5m',
      remaining_sec: 285,
      btc_price: 65001,
      atr_5m: 90,
      bid_yes: 0.01,
      ask_yes: 0.99,
      bid_no: 0.01,
      ask_no: 0.99
    }
  });
  await ordersAfter('same_window_non_place_tick', t2);

  const t3 = await http.post('/bot/runner/tick', {
    state_override: {
      current_window_id: w2,
      window_initialized_at: new Date(Date.now() - 42000).toISOString(),
      ladder_posted: false,
      yes_order_ids: [],
      no_order_ids: [],
      yes_cancelled: false,
      no_cancelled: false
    },
    context_override: {
      window_id: w2,
      period: '5m',
      remaining_sec: 290,
      btc_price: 65000,
      atr_5m: 90,
      bid_yes: 0.01,
      ask_yes: 0.99,
      bid_no: 0.01,
      ask_no: 0.99
    }
  });
  await ordersAfter('next_window_tick', t3);
  await http.post('/bot/stop', {});

  const placeCount = steps.filter((s) => String(s.decision_intents || '').includes('PLACE_LADDER(')).length;
  const nonPlaceWithNewOrders = steps.filter((s) => !String(s.decision_intents || '').includes('PLACE_LADDER(') && Number(s.new_orders_this_tick) > 0);
  const windowScopePass = steps.length >= 3
    && steps[0].current_window_id !== steps[2].current_window_id
    && steps[2].current_window_orders_count >= 0;
  return {
    steps,
    stages: {
      tick_gate: nonPlaceWithNewOrders.length === 0,
      state_persist: placeCount <= 2,
      window_scope_filter: windowScopePass,
      terminal_state_guard: true,
      summary_partition: true,
      order_status_projection: steps.every((s) => Number(s.current_window_tp_count) <= Number(s.current_window_orders_count))
    }
  };
};

const runRealRuntime = async (http) => {
  const begin = Date.now();
  let lastBeat = Date.now();
  await http.post('/bot/stop', {});
  await http.post('/bot/config', {
    open_delay_sec: 0,
    ladder_prices: [0.01],
    ladder_size: 1,
    atr_multiple: 1.2,
    cancel_all_remaining_sec: 295,
    up_ladder: [{ price: 0.01, size: 1, tp_price: 0.5 }],
    down_ladder: [{ price: 0.01, size: 1, tp_price: 0.5 }],
    up_cancel: { before_end_sec: 120, formula: '' },
    down_cancel: { before_end_sec: 60, formula: '' }
  });

  await http.post('/bot/start', { tick_interval_ms: 1000, debugScenario: 'main_path_v1' });
  await sleep(2200);
  await http.post('/bot/stop', {});

  const waitNearEnd = async () => {
    while (Date.now() - begin < MAX_WALL_MS) {
      const contextRes = await http.get('/bot/context');
      const wid = contextRes.body?.window_id ?? null;
      const rem = toFinite(contextRes.body?.remaining_sec);
      if (wid && rem !== null && rem <= 40) return { window_id: wid, remaining_sec: rem };
      await sleep(1000);
    }
    throw new Error('real_runtime_wait_start_timeout');
  };
  const startupWindow = await waitNearEnd();
  await http.post('/bot/start', { tick_interval_ms: 1000 });
  lastBeat = Date.now();

  const rows = [];
  let prevOrderIds = new Set();
  let lastWindowId = null;
  let windowOrderIdsAtPrevWindow = new Set();
  let placeWindowId = null;
  let cancelWindowId = null;
  let cancelAtTick = null;
  let sawSameWindowAfterPlace = false;
  let sawWindowAfterCancel = false;
  let nonPlaceAddedCount = 0;
  let repeatedPlaceAddedCount = 0;
  let crossWindowOverlapCount = 0;
  let postCancelRePlaceCount = 0;

  const seenPlaceByWindow = new Set();
  const seenPerWindowAnchor = new Map();

  for (let i = 0; i < 500; i += 1) {
    if (Date.now() - begin > MAX_WALL_MS) throw new Error('MAX_WALL_TIME_EXCEEDED');
    if (Date.now() - lastBeat > MAX_SILENCE_MS) throw new Error('MAX_SILENCE_EXCEEDED');

    const [statusRes, ordersRes, logsRes, contextRes] = await Promise.all([
      http.get('/bot/status'),
      http.get('/bot/orders'),
      http.get(`/bot/logs?limit=${LOG_TAIL}`),
      http.get('/bot/context')
    ]);
    const status = statusRes.body || {};
    const orders = ordersRes.body || {};
    const decision = extractDecision(logsRes.body);
    const windowOrders = Array.isArray(orders.window_orders) ? orders.window_orders : [];
    const currentOrderIds = new Set(windowOrders.map((r) => r?.order_id).filter(Boolean));
    const newOrders = [...currentOrderIds].filter((id) => !prevOrderIds.has(id));
    const openOrdersCount = toFinite(orders?.summary?.open_total) ?? 0;
    const currentWindowId = status.current_window_id ?? null;
    const activeWindowId = status?.active_runtime_snapshot?.current_window_id ?? orders?.window_scope?.active_window_id ?? null;
    const completed = await getCompletedSummary(http, status);
    const decisionIntents = decision.intents || 'NOOP';
    const isPlaceTick = String(decisionIntents).includes('PLACE_LADDER(');

    if (lastWindowId !== null && currentWindowId !== null && lastWindowId !== currentWindowId) {
      const overlap = [...windowOrderIdsAtPrevWindow].filter((id) => currentOrderIds.has(id));
      crossWindowOverlapCount += overlap.length;
      windowOrderIdsAtPrevWindow = new Set(currentOrderIds);
    } else if (currentWindowId !== null) {
      windowOrderIdsAtPrevWindow = new Set(currentOrderIds);
    }
    lastWindowId = currentWindowId;

    if (!isPlaceTick && newOrders.length > 0) nonPlaceAddedCount += newOrders.length;
    if (isPlaceTick && newOrders.length > 0) {
      if (seenPlaceByWindow.has(currentWindowId || '__null_window__')) repeatedPlaceAddedCount += newOrders.length;
      else seenPlaceByWindow.add(currentWindowId || '__null_window__');
      if (!placeWindowId && currentWindowId && currentWindowId !== startupWindow.window_id) placeWindowId = currentWindowId;
    }
    if (placeWindowId && currentWindowId === placeWindowId && !isPlaceTick) sawSameWindowAfterPlace = true;

    const maybeCancel = String(decision.reason || '').includes('cancel');
    if (!cancelWindowId && placeWindowId && currentWindowId === placeWindowId && maybeCancel) {
      cancelWindowId = currentWindowId;
      cancelAtTick = i;
    }
    if (cancelWindowId && currentWindowId === cancelWindowId && isPlaceTick && newOrders.length > 0) {
      postCancelRePlaceCount += newOrders.length;
    }
    if (cancelWindowId && currentWindowId && currentWindowId !== cancelWindowId) sawWindowAfterCancel = true;

    if (currentWindowId && status.anchor_btc != null) {
      const anchor = toFinite(status.anchor_btc);
      if (anchor !== null) {
        const prev = seenPerWindowAnchor.get(currentWindowId);
        if (prev === undefined) seenPerWindowAnchor.set(currentWindowId, anchor);
      }
    }

    rows.push({
      timestamp: nowIso(),
      current_window_id: currentWindowId,
      last_window_id: status.last_window_id ?? null,
      active_window_id: activeWindowId,
      decision_reason: decision.reason,
      decision_intents: decisionIntents,
      open_orders_count: openOrdersCount,
      current_window_orders_count: windowOrders.length,
      current_window_tp_count: countTp(windowOrders),
      completed_summary_window_id: completed.completed_summary_window_id,
      completed_summary_filled_total: completed.completed_summary_filled_total,
      running_window_excluded: completed.running_window_excluded,
      remaining_sec: toFinite(contextRes.body?.remaining_sec),
      new_orders_this_tick: newOrders.length
    });

    prevOrderIds = currentOrderIds;
    lastBeat = Date.now();

    const done = placeWindowId
      && sawSameWindowAfterPlace
      && cancelWindowId
      && sawWindowAfterCancel;
    if (done) break;
    await sleep(1000);
  }
  await http.post('/bot/stop', {});

  const summaryRows = rows.filter((r) => r.current_window_id !== null);
  const summaryPartitionRows = summaryRows.filter((r) => r.completed_summary_window_id !== null);
  const summaryPartitionPass = summaryPartitionRows.length > 0
    && summaryPartitionRows.every((r) => r.completed_summary_window_id !== r.current_window_id)
    && summaryPartitionRows.every((r) => r.running_window_excluded !== false);
  const projectionPass = summaryRows.every((r) =>
    Number(r.current_window_tp_count) <= Number(r.current_window_orders_count)
    && Number(r.current_window_orders_count) <= Number(r.open_orders_count + 20)
  );

  const sampleCovered = Boolean(placeWindowId && sawSameWindowAfterPlace && cancelWindowId && sawWindowAfterCancel);
  return {
    startup_window_id: startupWindow.window_id,
    place_window_id: placeWindowId,
    cancel_window_id: cancelWindowId,
    cancel_tick: cancelAtTick,
    sample_covered: sampleCovered,
    reconciliation_table: rows,
    stages: {
      tick_gate: nonPlaceAddedCount === 0,
      state_persist: repeatedPlaceAddedCount === 0,
      window_scope_filter: crossWindowOverlapCount === 0,
      terminal_state_guard: postCancelRePlaceCount === 0 && cancelWindowId != null,
      summary_partition: summaryPartitionPass,
      order_status_projection: projectionPass
    },
    counters: {
      non_place_added_count: nonPlaceAddedCount,
      repeated_place_added_count: repeatedPlaceAddedCount,
      cross_window_overlap_count: crossWindowOverlapCount,
      post_cancel_replace_count: postCancelRePlaceCount
    }
  };
};

const main = async () => {
  const args = parseArgs();
  const port = Number(new URL(args.baseUrl).port || 53215);
  const server = await startServer(port);
  const http = createHttp(server.baseUrl);
  let health = { root: null, pairs: null };
  try {
    health.root = await fetch(`${server.baseUrl}/`).then((r) => r.status).catch(() => null);
    health.pairs = await fetch(`${server.baseUrl}/pairs`).then((r) => r.status).catch(() => null);

    const debug = await runDebugControl(http);
    const real = await runRealRuntime(http);

    const order = ['tick_gate', 'state_persist', 'window_scope_filter', 'terminal_state_guard', 'summary_partition', 'order_status_projection'];
    let firstBreakLayer = 'NONE_CHAIN_PASS';
    for (const key of order) {
      if (!real.stages[key]) {
        firstBreakLayer = key;
        break;
      }
    }
    let divergenceLayer = 'none';
    for (const key of order) {
      if (Boolean(real.stages[key]) !== Boolean(debug.stages[key])) {
        divergenceLayer = key;
        break;
      }
    }

    const sampleInsufficient = !real.sample_covered;
    const verdict = sampleInsufficient
      ? 'B：样本不足'
      : (firstBreakLayer === 'NONE_CHAIN_PASS' ? 'A：通过' : 'C：存在断裂');
    const conclusion = sampleInsufficient
      ? 'B：样本不足，未完整覆盖同窗后续 tick + 终态 + 下一窗显示链'
      : (firstBreakLayer === 'NONE_CHAIN_PASS'
        ? 'A：执行层幂等与窗口隔离链路通过'
        : `C：执行层链路存在断裂，首断裂层=${firstBreakLayer}`);

    const checks = {
      '015-A_real_runtime_chain_covered': real.sample_covered === true,
      '015-B_debug_control_present': Array.isArray(debug.steps) && debug.steps.length >= 3,
      '015-C_non_place_no_new_orders': real.stages.tick_gate === true,
      '015-D_no_repeated_place_same_window': real.stages.state_persist === true && real.stages.terminal_state_guard === true,
      '015-E_window_scope_and_summary_partition': real.stages.window_scope_filter === true && real.stages.summary_partition === true
    };
    const keys = Object.keys(checks);
    const passChecks = keys.filter((k) => checks[k]).length;
    const failChecks = keys.length - passChecks;
    const pass = failChecks === 0 && !sampleInsufficient;

    const standard = buildStandardResult({
      scriptName: 'truth_audit_executor_isolation_260330_015',
      taskId: args.taskId,
      sampleName: args.sampleName,
      pass,
      message: pass ? 'P1 executor idempotency/window isolation audit pass' : 'P1 executor idempotency/window isolation audit fail',
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
        real_head: real.reconciliation_table.slice(0, 12),
        real_tail: real.reconciliation_table.slice(-12),
        debug_steps: debug.steps
      }
    });

    const output = {
      ...standard,
      task_id: args.taskId,
      conclusion_block: {
        conclusion,
        verdict,
        first_break_layer: sampleInsufficient ? 'SAMPLE_BLOCKED_OR_INSUFFICIENT' : firstBreakLayer,
        real_debug_diverged: divergenceLayer !== 'none',
        real_debug_first_divergence_layer: divergenceLayer
      },
      key_counters: {
        total_checks: keys.length,
        pass_checks: passChecks,
        fail_checks: failChecks
      },
      evidence_index: {
        reconciliation_table: real.reconciliation_table,
        real_runtime: real,
        debug_control: debug,
        stage_matrix: {
          real: real.stages,
          debug: debug.stages
        },
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
      conclusion,
      verdict,
      first_break_layer: sampleInsufficient ? 'SAMPLE_BLOCKED_OR_INSUFFICIENT' : firstBreakLayer,
      divergence_layer: divergenceLayer,
      pass_checks: passChecks,
      fail_checks: failChecks
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
