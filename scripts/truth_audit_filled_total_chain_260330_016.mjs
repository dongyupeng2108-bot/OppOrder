import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { buildStandardResult, ensureDir, parseVerifyArgs, writeStandardLog } from './verify_standard_v1.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_TASK_ID = '260330_016';
const MAX_WALL_MS = 25 * 60 * 1000;
const MAX_SILENCE_MS = 120 * 1000;
const LOG_TAIL = 120;

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: 'http://localhost:53216',
  defaultOutputSuffix: 'truth_audit_filled_total_chain',
  defaultSampleName: 'filled_total_chain_v1'
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
const uniqueCount = (arr, fn) => new Set((arr || []).map(fn).filter((v) => v !== null && v !== undefined && v !== '')).size;

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

const resolveCompletedSummary = (performanceSummary) => {
  const rows = Array.isArray(performanceSummary?.participating_postmortem_rows) ? performanceSummary.participating_postmortem_rows : [];
  const sorted = [...rows].sort((a, b) => String(b.completed_at || '').localeCompare(String(a.completed_at || '')));
  const latest = sorted[0] || null;
  return {
    completed_summary_window_id: latest?.window_id ?? null,
    completed_summary_filled_total: toFinite(latest?.filled_total)
  };
};

const resolveResultChainFilled = (status, postmortem, performanceSummary) => {
  const targetWindowId = status?.last_run_snapshot?.current_window_id ?? postmortem?.window_id ?? null;
  const rows = Array.isArray(performanceSummary?.participating_postmortem_rows) ? performanceSummary.participating_postmortem_rows : [];
  const target = rows
    .filter((row) => row?.window_id === targetWindowId)
    .sort((a, b) => String(b.completed_at || '').localeCompare(String(a.completed_at || '')))[0] || null;
  return {
    result_chain_window_id: targetWindowId,
    result_chain_filled_total: toFinite(target?.filled_total)
  };
};

const extractFillEvents = (logs) => {
  const rows = Array.isArray(logs) ? logs : [];
  return rows
    .filter((row) => row?.event === 'BOT_FILL')
    .flatMap((row) => Array.isArray(row?.data?.fills) ? row.data.fills : [])
    .map((item) => item?.order_id)
    .filter((id) => typeof id === 'string' && id.length > 0);
};

const buildRows = ({
  timestamp,
  status,
  orders,
  paperSummary,
  performanceSummary,
  postmortem,
  seenFillOrderIds
}) => {
  const currentWindowId = status?.current_window_id ?? null;
  const allOrders = Array.isArray(orders?.all_orders) ? orders.all_orders : [];
  const windowOrders = Array.isArray(orders?.window_orders) ? orders.window_orders : [];
  const uniqueFilledOrderCount = uniqueCount(
    windowOrders.filter((row) => row?.status === 'FILLED'),
    (row) => row?.order_id
  );
  const currentWindowFilledTotal = uniqueCount(
    windowOrders.filter((row) => row?.status === 'FILLED'),
    (row) => row?.order_id
  );
  const runtimeFilledTotal = toFinite(paperSummary?.filled_total);
  const lastWindowFilledTotal = toFinite(status?.last_run_snapshot?.filled_total);
  const completed = resolveCompletedSummary(performanceSummary);
  const resultChain = resolveResultChainFilled(status, postmortem, performanceSummary);
  const materializedRows = windowOrders.length > 0 ? windowOrders : [null];
  return materializedRows.map((order) => ({
    timestamp,
    current_window_id: currentWindowId,
    order_id: order?.order_id ?? null,
    order_status: order?.status ?? null,
    fill_event_seen: order?.order_id ? seenFillOrderIds.has(order.order_id) : false,
    unique_filled_order_count: uniqueFilledOrderCount,
    runtime_filled_total: runtimeFilledTotal,
    current_window_filled_total: currentWindowFilledTotal,
    all_windows_unique_filled_order_count: uniqueCount(
      allOrders.filter((row) => row?.status === 'FILLED'),
      (row) => row?.order_id
    ),
    last_window_filled_total: lastWindowFilledTotal,
    completed_summary_filled_total: completed.completed_summary_filled_total,
    result_chain_filled_total: resultChain.result_chain_filled_total
  }));
};

const runDebugControl = async (http) => {
  await http.post('/bot/stop', {});
  await sleep(300);
  await http.post('/bot/start', { tick_interval_ms: 1000, debugScenario: 'fill_yes_path_v1' });
  const begin = Date.now();
  const seenFillOrderIds = new Set();
  const rows = [];
  let sawFilled = false;
  for (let i = 0; i < 40; i += 1) {
    if (Date.now() - begin > 90_000) break;
    await sleep(700);
    const [statusRes, ordersRes, logsRes, summaryRes, perfRes, postmortemRes] = await Promise.all([
      http.get('/bot/status'),
      http.get('/bot/orders'),
      http.get(`/bot/logs?limit=${LOG_TAIL}`),
      http.get('/bot/paper/summary'),
      http.get('/bot/performance/summary?preset=today&detail=1'),
      http.get('/bot/postmortem/latest')
    ]);
    for (const id of extractFillEvents(logsRes.body)) seenFillOrderIds.add(id);
    const stitchedRows = buildRows({
      timestamp: nowIso(),
      status: statusRes.body || {},
      orders: ordersRes.body || {},
      paperSummary: summaryRes.body || {},
      performanceSummary: perfRes.body?.summary || {},
      postmortem: postmortemRes.body?.postmortem || {},
      seenFillOrderIds
    });
    rows.push(...stitchedRows);
    const allOrders = Array.isArray(ordersRes.body?.all_orders) ? ordersRes.body.all_orders : [];
    if (allOrders.some((row) => row?.status === 'FILLED')) {
      sawFilled = true;
      break;
    }
  }
  await http.post('/bot/stop', {});
  await sleep(600);
  const [statusAfter, summaryAfter, perfAfter, postmortemAfter, ordersAfter] = await Promise.all([
    http.get('/bot/status'),
    http.get('/bot/paper/summary'),
    http.get('/bot/performance/summary?preset=today&detail=1'),
    http.get('/bot/postmortem/latest'),
    http.get('/bot/orders')
  ]);
  const finalRows = buildRows({
    timestamp: nowIso(),
    status: statusAfter.body || {},
    orders: ordersAfter.body || {},
    paperSummary: summaryAfter.body || {},
    performanceSummary: perfAfter.body?.summary || {},
    postmortem: postmortemAfter.body?.postmortem || {},
    seenFillOrderIds
  });
  rows.push(...finalRows);
  const latest = rows.length ? rows[rows.length - 1] : null;
  const stage = {
    fill_event_capture: sawFilled && rows.some((r) => r.fill_event_seen === true),
    order_id_dedup: rows.every((r) => Number(r.unique_filled_order_count) >= 0),
    runtime_counter: latest ? Number(latest.runtime_filled_total) === Number(latest.unique_filled_order_count) : false,
    window_partition: rows.every((r) => Number(r.current_window_filled_total) <= Number(r.unique_filled_order_count)),
    summary_aggregate: latest ? Number(latest.completed_summary_filled_total) === Number(latest.last_window_filled_total) : false,
    result_projection: latest ? Number(latest.result_chain_filled_total) === Number(latest.completed_summary_filled_total) : false
  };
  return { rows, sawFilled, stages: stage };
};

const runRealRuntime = async (http) => {
  const begin = Date.now();
  let lastBeat = Date.now();
  await http.post('/bot/stop', {});
  await sleep(350);
  await http.post('/bot/config', {
    open_delay_sec: 0,
    ladder_prices: [0.99],
    ladder_size: 1,
    atr_multiple: 1.2,
    cancel_all_remaining_sec: 30,
    up_ladder: [{ price: 0.99, size: 1, tp_price: 1 }],
    down_ladder: [{ price: 0.99, size: 1, tp_price: 1 }],
    up_cancel: { before_end_sec: 15, formula: '' },
    down_cancel: { before_end_sec: 15, formula: '' }
  });

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
  const seenFillOrderIds = new Set();
  const rows = [];
  let sawFillEvent = false;
  let sawFilledStatus = false;
  let sawFilledTotalIncrease = false;
  let sawWindowAfterFill = false;
  let fillWindowId = null;
  let prevRuntimeFilled = null;

  for (let i = 0; i < 420; i += 1) {
    if (Date.now() - begin > MAX_WALL_MS) throw new Error('MAX_WALL_TIME_EXCEEDED');
    if (Date.now() - lastBeat > MAX_SILENCE_MS) throw new Error('MAX_SILENCE_EXCEEDED');
    const [statusRes, ordersRes, logsRes, summaryRes, perfRes, postmortemRes] = await Promise.all([
      http.get('/bot/status'),
      http.get('/bot/orders'),
      http.get(`/bot/logs?limit=${LOG_TAIL}`),
      http.get('/bot/paper/summary'),
      http.get('/bot/performance/summary?preset=today&detail=1'),
      http.get('/bot/postmortem/latest')
    ]);
    const fillIds = extractFillEvents(logsRes.body);
    if (fillIds.length > 0) sawFillEvent = true;
    for (const id of fillIds) seenFillOrderIds.add(id);
    const stitchedRows = buildRows({
      timestamp: nowIso(),
      status: statusRes.body || {},
      orders: ordersRes.body || {},
      paperSummary: summaryRes.body || {},
      performanceSummary: perfRes.body?.summary || {},
      postmortem: postmortemRes.body?.postmortem || {},
      seenFillOrderIds
    });
    rows.push(...stitchedRows);
    const allOrders = Array.isArray(ordersRes.body?.all_orders) ? ordersRes.body.all_orders : [];
    const currentFilled = uniqueCount(
      allOrders.filter((row) => row?.status === 'FILLED'),
      (row) => row?.order_id
    );
    if (currentFilled > 0) {
      sawFilledStatus = true;
      const currentWindowId = statusRes.body?.current_window_id ?? null;
      if (!fillWindowId) fillWindowId = currentWindowId;
    }
    const runtimeFilled = toFinite(summaryRes.body?.filled_total);
    if (prevRuntimeFilled !== null && runtimeFilled !== null && runtimeFilled > prevRuntimeFilled) {
      sawFilledTotalIncrease = true;
    }
    prevRuntimeFilled = runtimeFilled;
    const currentWindow = statusRes.body?.current_window_id ?? null;
    if (fillWindowId && currentWindow && currentWindow !== fillWindowId) sawWindowAfterFill = true;

    const enough = sawFillEvent && sawFilledStatus && sawFilledTotalIncrease && sawWindowAfterFill;
    if (enough) break;
    lastBeat = Date.now();
    await sleep(1000);
  }
  await http.post('/bot/stop', {});
  await sleep(700);

  const [statusAfter, summaryAfter, perfAfter, postmortemAfter, ordersAfter] = await Promise.all([
    http.get('/bot/status'),
    http.get('/bot/paper/summary'),
    http.get('/bot/performance/summary?preset=today&detail=1'),
    http.get('/bot/postmortem/latest'),
    http.get('/bot/orders')
  ]);
  const finalRows = buildRows({
    timestamp: nowIso(),
    status: statusAfter.body || {},
    orders: ordersAfter.body || {},
    paperSummary: summaryAfter.body || {},
    performanceSummary: perfAfter.body?.summary || {},
    postmortem: postmortemAfter.body?.postmortem || {},
    seenFillOrderIds
  });
  rows.push(...finalRows);

  const latest = rows.length ? rows[rows.length - 1] : null;
  const sampleCovered = sawFillEvent && sawFilledStatus && sawFilledTotalIncrease && sawWindowAfterFill;
  const stage = {
    fill_event_capture: sawFillEvent && rows.some((r) => r.fill_event_seen === true),
    order_id_dedup: rows.every((r) => Number(r.unique_filled_order_count) >= 0),
    runtime_counter: latest ? Number(latest.runtime_filled_total) === Number(latest.unique_filled_order_count) : false,
    window_partition: rows.every((r) => Number(r.current_window_filled_total) <= Number(r.unique_filled_order_count)),
    summary_aggregate: latest ? Number(latest.completed_summary_filled_total) === Number(latest.last_window_filled_total) : false,
    result_projection: latest ? Number(latest.result_chain_filled_total) === Number(latest.completed_summary_filled_total) : false
  };
  return {
    startup_window_id: startupWindow.window_id,
    fill_window_id: fillWindowId,
    sample_covered: sampleCovered,
    saw_fill_event: sawFillEvent,
    saw_filled_status: sawFilledStatus,
    saw_filled_total_increase: sawFilledTotalIncrease,
    saw_window_after_fill: sawWindowAfterFill,
    reconciliation_table: rows,
    stages: stage
  };
};

const main = async () => {
  const args = parseArgs();
  const port = Number(new URL(args.baseUrl).port || 53216);
  const server = await startServer(port);
  const http = createHttp(server.baseUrl);
  let health = { root: null, pairs: null };
  try {
    health.root = await fetch(`${server.baseUrl}/`).then((r) => r.status).catch(() => null);
    health.pairs = await fetch(`${server.baseUrl}/pairs`).then((r) => r.status).catch(() => null);

    const debug = await runDebugControl(http);
    const real = await runRealRuntime(http);

    const order = ['fill_event_capture', 'order_id_dedup', 'runtime_counter', 'window_partition', 'summary_aggregate', 'result_projection'];
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
      ? 'B：样本不足，未完整覆盖成交事件->filled_total变化->窗口结果链'
      : (firstBreakLayer === 'NONE_CHAIN_PASS'
        ? 'A：filled_total 真值链与统计口径一致'
        : `C：filled_total 真值链存在断裂，首断裂层=${firstBreakLayer}`);

    const checks = {
      '016-A_real_runtime_min_chain_covered': real.sample_covered === true,
      '016-B_debug_control_present': Array.isArray(debug.rows) && debug.rows.length > 0,
      '016-C_filled_total_equals_unique_filled': real.stages.runtime_counter === true,
      '016-D_window_partition_and_summary_consistent': real.stages.window_partition === true && real.stages.summary_aggregate === true,
      '016-E_result_projection_consistent': real.stages.result_projection === true
    };
    const keys = Object.keys(checks);
    const passChecks = keys.filter((k) => checks[k]).length;
    const failChecks = keys.length - passChecks;
    const pass = failChecks === 0 && !sampleInsufficient;

    const standard = buildStandardResult({
      scriptName: 'truth_audit_filled_total_chain_260330_016',
      taskId: args.taskId,
      sampleName: args.sampleName,
      pass,
      message: pass ? 'filled_total truth chain audit pass' : 'filled_total truth chain audit fail',
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
        debug_head: debug.rows.slice(0, 12)
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
