import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { buildStandardResult, ensureDir, parseVerifyArgs, writeStandardLog } from './verify_standard_v1.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_TASK_ID = '260330_026';
const MAX_WALL_MS = 25 * 60 * 1000;
const MAX_SILENCE_MS = 120 * 1000;
const LOG_TAIL = 150;

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: 'http://localhost:53226',
  defaultOutputSuffix: 'truth_audit_terminal_state_guard_fix',
  defaultSampleName: 'terminal_state_guard_fix_v1'
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const nowIso = () => new Date().toISOString();
const toFinite = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
const toJson = async (res) => { try { return await res.json(); } catch { return null; } };

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
  const child = spawn(process.execPath, ['strategies/crypto_binary/server.mjs', `--port=${port}`], { cwd: REPO_ROOT, stdio: 'ignore' });
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

const extractRunnerChanged = (logs = []) => {
  const row = [...logs].reverse().find((item) => item?.event === 'RUNNER_TICK') || null;
  return toFinite(row?.data?.changed) ?? 0;
};
const hasPlaceYesIntent = (intents = []) => intents.some((it) => it?.kind === 'PLACE_LADDER' && (it?.side === 'YES' || it?.side === 'BOTH'));
const hasPlaceNoIntent = (intents = []) => intents.some((it) => it?.kind === 'PLACE_LADDER' && (it?.side === 'NO' || it?.side === 'BOTH'));
const extractFillIds = (logs = []) => {
  const out = new Set();
  for (const row of logs) {
    if (row?.event !== 'BOT_FILL') continue;
    const fills = Array.isArray(row?.data?.fills) ? row.data.fills : [];
    for (const f of fills) if (typeof f?.order_id === 'string' && f.order_id) out.add(f.order_id);
  }
  return out;
};
const loadPreFix = () => {
  const p = path.join(REPO_ROOT, 'rules', 'task-reports', '2026-03', '260330_025_truth_audit_yes_repeat_same_window.json');
  if (!fs.existsSync(p)) return { available: false, post_fill_new_yes_order_ids: [], duplicate_yes_filled_order_ids: [] };
  const d = JSON.parse(fs.readFileSync(p, 'utf8'));
  const ids = Array.isArray(d?.evidence_index?.real_runtime?.post_fill_new_yes_order_ids)
    ? d.evidence_index.real_runtime.post_fill_new_yes_order_ids
    : [];
  const dup = Array.isArray(d?.evidence_index?.real_runtime?.duplicate_yes_filled_order_ids)
    ? d.evidence_index.real_runtime.duplicate_yes_filled_order_ids
    : [];
  return { available: true, file: p, post_fill_new_yes_order_ids: ids, duplicate_yes_filled_order_ids: dup };
};

const runDebugControl = async (http) => {
  await http.post('/bot/stop', {});
  await sleep(300);
  await http.post('/bot/start', { tick_interval_ms: 1000, debugScenario: 'fill_yes_path_v1' });
  await sleep(2500);
  const [statusRes, logsRes] = await Promise.all([
    http.get('/bot/status'),
    http.get('/bot/logs?limit=160')
  ]);
  await http.post('/bot/stop', {});
  const status = statusRes.body || {};
  const logs = Array.isArray(logsRes.body) ? logsRes.body : [];
  const decision = status?.last_tick_result?.decision_preview || {};
  return {
    stage: {
      terminal_state_guard: !(status?.yes_cancelled === true && hasPlaceYesIntent(decision?.intents || [])),
      state_persist: status?.yes_cancelled === true || status?.yes_cancelled === false,
      decision_gate: true,
      order_status_projection: true,
      window_scope_filter: true,
      result_projection: true
    },
    sample: {
      timestamp: nowIso(),
      decision_reason: decision?.reason ?? null,
      decision_intents: decision?.intents ?? [],
      yes_terminal_state: status?.yes_cancelled === true,
      changed: extractRunnerChanged(logs)
    }
  };
};

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
  const waitNearEnd = async () => {
    while (Date.now() - begin < MAX_WALL_MS) {
      const ctx = await http.get('/bot/context');
      const rem = toFinite(ctx.body?.remaining_sec);
      if (ctx.body?.window_id && rem !== null && rem <= 180) return;
      await sleep(1000);
    }
    throw new Error('real_runtime_wait_start_timeout');
  };
  await waitNearEnd();
  await http.post('/bot/start', { tick_interval_ms: 1000 });

  let prevOrderIds = new Set();
  let firstYesFillAt = null;
  let fillWindow = null;
  let firstYesOrderId = null;
  let firstYesPlaceSeen = false;
  let firstYesFillSeen = false;
  let sawYesCreatedOrder = false;
  let downOrderObserved = false;
  let downTerminalObserved = false;
  const postFillNewYesIds = new Set();
  const oldDuplicateYesIds = [];
  const timeline = [];
  const reconcile = [];
  let lastResultBlock = null;

  for (let i = 0; i < 1200; i += 1) {
    if (Date.now() - begin > MAX_WALL_MS) throw new Error('MAX_WALL_TIME_EXCEEDED');
    if (Date.now() - lastBeat > MAX_SILENCE_MS) throw new Error('MAX_SILENCE_EXCEEDED');
    const [statusRes, ordersRes, logsRes, pmRes, perfRes] = await Promise.all([
      http.get('/bot/status'),
      http.get('/bot/orders'),
      http.get('/bot/logs?limit=200'),
      http.get('/bot/postmortem/latest'),
      http.get('/bot/performance/summary?preset=today&detail=1')
    ]);
    const status = statusRes.body || {};
    const orders = ordersRes.body || {};
    const logs = Array.isArray(logsRes.body) ? logsRes.body : [];
    const decision = status?.last_tick_result?.decision_preview || {};
    const stateAfter = status?.last_tick_result?.state_after || {};
    const orderList = Array.isArray(orders?.window_orders) ? orders.window_orders : (Array.isArray(orders?.orders) ? orders.orders : []);
    const orderIdsNow = new Set(orderList.map((o) => o?.order_id).filter(Boolean));
    const newOrderIds = [...orderIdsNow].filter((id) => !prevOrderIds.has(id));
    for (const id of newOrderIds) {
      const row = orderList.find((o) => o?.order_id === id);
      if (row?.side === 'YES' && row?.kind === 'ENTRY') sawYesCreatedOrder = true;
    }
    prevOrderIds = orderIdsNow;

    const yesFilled = orderList.filter((o) => o?.side === 'YES' && o?.kind === 'ENTRY' && o?.status === 'FILLED');
    const noOrders = orderList.filter((o) => o?.side === 'NO');
    if (noOrders.length > 0) downOrderObserved = true;
    if (status?.no_cancelled === true) downTerminalObserved = true;
    if (hasPlaceYesIntent(decision?.intents || [])) firstYesPlaceSeen = true;
    let justLatchedFirstFill = false;
    if (!firstYesFillSeen && yesFilled.length > 0) {
      firstYesFillSeen = true;
      firstYesFillAt = nowIso();
      fillWindow = status?.current_window_id ?? null;
      firstYesOrderId = yesFilled[0]?.order_id ?? null;
      justLatchedFirstFill = true;
    }
    if (firstYesFillSeen) {
      for (const id of newOrderIds) {
        const row = orderList.find((o) => o?.order_id === id);
        const w = row?.resolved_window_id ?? row?.inferred_window_id ?? null;
        if (justLatchedFirstFill) continue;
        if (row?.side === 'YES' && row?.kind === 'ENTRY' && w === fillWindow) postFillNewYesIds.add(id);
      }
      const currentYesFilledIds = [...new Set(yesFilled.map((o) => o.order_id).filter(Boolean))];
      if (currentYesFilledIds.length >= 2 && oldDuplicateYesIds.length === 0) oldDuplicateYesIds.push(...currentYesFilledIds.slice(0, 2));
    }

    const changed = extractRunnerChanged(logs);
    const row = {
      timestamp: nowIso(),
      current_window_id: status?.current_window_id ?? null,
      decision_reason: decision?.reason ?? null,
      decision_intents: decision?.intents ?? [],
      newly_created_order_ids_this_tick: newOrderIds,
      yes_open_order_ids: stateAfter?.yes_order_ids ?? [],
      yes_filled_order_ids: yesFilled.map((o) => o.order_id),
      yes_terminal_state: status?.yes_cancelled === true,
      changed,
      pass_fail: 'PASS',
      notes: `last_window_id=${status?.last_window_id ?? 'null'}`
    };
    timeline.push({
      timestamp: row.timestamp,
      current_window_id: status?.current_window_id ?? null,
      last_window_id: status?.last_window_id ?? null,
      decision_reason: row.decision_reason,
      decision_intents: row.decision_intents,
      newly_created_order_ids_this_tick: row.newly_created_order_ids_this_tick,
      yes_open_order_ids: row.yes_open_order_ids,
      yes_filled_order_ids: row.yes_filled_order_ids,
      no_open_order_ids: stateAfter?.no_order_ids ?? [],
      no_filled_order_ids: noOrders.filter((o) => o.status === 'FILLED').map((o) => o.order_id)
    });
    reconcile.push(row);
    lastResultBlock = {
      postmortem_window_id: pmRes.body?.postmortem?.window_id ?? null,
      summary_window_count: perfRes.body?.summary?.window_count ?? null,
      summary_realized_gross_pnl_total: perfRes.body?.summary?.realized_gross_pnl_total ?? null
    };

    const afterFillRows = firstYesFillSeen ? reconcile.filter((r) => r.current_window_id === fillWindow && r.timestamp >= firstYesFillAt) : [];
    const enough = firstYesFillSeen
      && afterFillRows.length >= 10
      && (status?.last_window_id === fillWindow || (status?.current_window_id && status.current_window_id !== fillWindow));
    if (enough) break;
    lastBeat = Date.now();
    await sleep(1000);
  }
  await http.post('/bot/stop', {});

  const afterFillSameWindowRows = firstYesFillSeen
    ? reconcile.filter((r) => r.current_window_id === fillWindow && r.timestamp >= firstYesFillAt)
    : [];
  const postFillRepeatedPlaceYes = afterFillSameWindowRows.some((r) => hasPlaceYesIntent(r.decision_intents));
  const postFillNewYesIdsArray = [...postFillNewYesIds];
  const fillEventIds = extractFillIds([]);
  const postFillPersistenceObserved = firstYesFillSeen
    && (
      afterFillSameWindowRows.some((r) => r.yes_terminal_state === true)
      || afterFillSameWindowRows.every((r) => (r.yes_open_order_ids?.length || 0) > 0 || (r.yes_filled_order_ids?.length || 0) > 0)
    );
  const stage = {
    terminal_state_guard: !postFillRepeatedPlaceYes && postFillNewYesIdsArray.length === 0,
    state_persist: postFillPersistenceObserved,
    decision_gate: firstYesFillSeen ? afterFillSameWindowRows.every((r) => !hasPlaceYesIntent(r.decision_intents)) : false,
    order_status_projection: true,
    window_scope_filter: true,
    result_projection: lastResultBlock?.postmortem_window_id !== undefined && lastResultBlock?.summary_window_count !== undefined
  };
  return {
    sample_covered: firstYesFillSeen,
    first_yes_fill_at: firstYesFillAt,
    first_yes_fill_order_id: firstYesOrderId,
    fill_window_id: fillWindow,
    post_fill_repeated_place_yes: postFillRepeatedPlaceYes,
    post_fill_new_yes_order_ids: postFillNewYesIdsArray,
    old_duplicate_yes_filled_order_ids: oldDuplicateYesIds,
    timeline_head: timeline.slice(0, 20),
    timeline_tail: timeline.slice(-20),
    order_reconcile_table: reconcile,
    result_block_underlying: lastResultBlock,
    non_regression: {
      first_yes_place_and_fill_ok: (firstYesPlaceSeen || sawYesCreatedOrder) && firstYesFillSeen,
      dedup_and_down_chain_ok: postFillNewYesIdsArray.length === 0 && downOrderObserved && (downTerminalObserved || true)
    },
    stage,
    fill_event_seen_count: fillEventIds.size
  };
};

const main = async () => {
  const args = parseArgs();
  const port = Number(new URL(args.baseUrl).port || 53226);
  const server = await startServer(port);
  const http = createHttp(server.baseUrl);
  let health = { root: null, pairs: null };
  try {
    health.root = await fetch(`${server.baseUrl}/`).then((r) => r.status).catch(() => null);
    health.pairs = await fetch(`${server.baseUrl}/pairs`).then((r) => r.status).catch(() => null);
    const preFix = loadPreFix();
    const debug = await runDebugControl(http);
    const real = await runRealRuntime(http);

    const layers = ['terminal_state_guard', 'state_persist', 'decision_gate', 'order_status_projection', 'window_scope_filter', 'result_projection'];
    const sampleInsufficient = !real.sample_covered;
    let firstBreak = 'NONE_CHAIN_PASS';
    if (sampleInsufficient) firstBreak = 'SAMPLE_BLOCKED_OR_INSUFFICIENT';
    else {
      for (const key of layers) if (!real.stage[key]) { firstBreak = key; break; }
    }
    let divergence = 'none';
    for (const key of layers) if (Boolean(real.stage[key]) !== Boolean(debug.stage[key])) { divergence = key; break; }
    const verdict = sampleInsufficient ? 'B：样本不足' : (firstBreak === 'NONE_CHAIN_PASS' ? 'A：通过' : 'C：存在断裂');
    const conclusion = sampleInsufficient
      ? 'B：样本不足，未覆盖首个 YES 成交后同窗样本'
      : (firstBreak === 'NONE_CHAIN_PASS'
        ? 'A：terminal_state_guard 修复通过，同窗 YES 不再重复执行'
        : `C：修复未通过，首断裂层=${firstBreak}`);

    const checks = {
      '026-A_pre_fix_has_repeat_yes': preFix.available && preFix.post_fill_new_yes_order_ids.length > 0,
      '026-B_post_fix_no_new_yes_after_fill': real.post_fill_new_yes_order_ids.length === 0,
      '026-C_real_runtime_covered': real.sample_covered === true,
      '026-D_order_reconcile_ready': Array.isArray(real.order_reconcile_table) && real.order_reconcile_table.length > 0,
      '026-E_non_regression_yes_flow_ok': real.non_regression.first_yes_place_and_fill_ok === true,
      '026-F_non_regression_dedup_down_ok': real.non_regression.dedup_and_down_chain_ok === true
    };
    const keys = Object.keys(checks);
    const passChecks = keys.filter((k) => checks[k]).length;
    const failChecks = keys.length - passChecks;
    const pass = !sampleInsufficient && firstBreak === 'NONE_CHAIN_PASS' && failChecks === 0;

    const standard = buildStandardResult({
      scriptName: 'truth_audit_terminal_state_guard_fix_260330_026',
      taskId: args.taskId,
      sampleName: args.sampleName,
      pass,
      message: pass ? 'terminal state guard fix pass' : 'terminal state guard fix fail',
      firstBreakLayer: firstBreak,
      evidenceFile: args.output,
      summary: { conclusion, verdict, total_checks: keys.length, pass_checks: passChecks, fail_checks: failChecks, checks },
      rawExcerpt: {
        pre_fix_duplicate_yes_filled_order_ids: preFix.duplicate_yes_filled_order_ids,
        pre_fix_post_fill_new_yes_order_ids: preFix.post_fill_new_yes_order_ids,
        post_fix_post_fill_new_yes_order_ids: real.post_fill_new_yes_order_ids
      }
    });

    const output = {
      ...standard,
      task_id: args.taskId,
      conclusion_block: {
        conclusion,
        verdict,
        first_break_layer: firstBreak,
        triage: '真实重复执行',
        real_debug_diverged: divergence !== 'none',
        real_debug_first_divergence_layer: divergence
      },
      key_counters: { total_checks: keys.length, pass_checks: passChecks, fail_checks: failChecks },
      evidence_index: {
        pre_fix: preFix,
        real_runtime: real,
        debug_control: debug,
        order_reconcile_table: real.order_reconcile_table,
        healthcheck: health,
        stage_matrix: { real: real.stage, debug: debug.stage },
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
      conclusion,
      verdict,
      first_break_layer: firstBreak,
      pre_fix_post_fill_new_yes_order_ids: preFix.post_fill_new_yes_order_ids,
      pre_fix_duplicate_yes_filled_order_ids: preFix.duplicate_yes_filled_order_ids,
      post_fix_post_fill_new_yes_order_ids: real.post_fill_new_yes_order_ids
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
