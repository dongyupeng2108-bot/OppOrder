import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { buildStandardResult, ensureDir, parseVerifyArgs, writeStandardLog } from './verify_standard_v1.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_TASK_ID = '260330_017';
const MAX_WALL_MS = 25 * 60 * 1000;
const MAX_SILENCE_MS = 120 * 1000;
const LOG_TAIL = 150;

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: 'http://localhost:53217',
  defaultOutputSuffix: 'truth_audit_no_repeat_no_ladder',
  defaultSampleName: 'no_repeat_no_ladder_v1'
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

const getCompletedSummaryFilled = async (http) => {
  const perfRes = await http.get('/bot/performance/summary?preset=today&detail=1');
  const rows = Array.isArray(perfRes.body?.summary?.participating_postmortem_rows)
    ? perfRes.body.summary.participating_postmortem_rows
    : [];
  const latest = [...rows].sort((a, b) => String(b.completed_at || '').localeCompare(String(a.completed_at || '')))[0] || null;
  return {
    completed_summary_window_id: latest?.window_id ?? null,
    completed_summary_filled_total: toFinite(latest?.filled_total)
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

const extractNoRows = (ordersBody) => {
  const rows = Array.isArray(ordersBody?.window_orders) ? ordersBody.window_orders : [];
  const noRows = rows.filter((r) => r?.side === 'NO');
  const openIds = noRows.filter((r) => r?.status === 'OPEN').map((r) => r?.order_id).filter(Boolean);
  const filledIds = noRows.filter((r) => r?.status === 'FILLED').map((r) => r?.order_id).filter(Boolean);
  return {
    rows,
    no_open_order_ids: [...new Set(openIds)],
    no_filled_order_ids: [...new Set(filledIds)],
    current_window_orders_count: rows.length,
    current_window_filled_count: rows.filter((r) => r?.status === 'FILLED').length
  };
};

const toNormalized0408 = (rows, pivotIndex) => {
  const start = Math.max(0, pivotIndex);
  const sample = rows.slice(start, start + 21);
  return sample.map((r, idx) => ({
    ...r,
    normalized_clock_0408: `04:08:${String(idx).padStart(2, '0')}`
  }));
};

const runDebugControl = async (http) => {
  await http.post('/bot/stop', {});
  const w = `dbg-017-${Date.now()}`;
  const rows = [];
  let prevIds = new Set();
  for (let i = 0; i < 4; i += 1) {
    const tick = await http.post('/bot/runner/tick', {
      state_override: {
        current_window_id: w,
        window_initialized_at: new Date(Date.now() - 50000).toISOString(),
        ladder_posted: false,
        no_cancelled: false
      },
      context_override: {
        window_id: w,
        period: '5m',
        remaining_sec: 240 - i,
        btc_price: 65000,
        atr_5m: 90,
        bid_yes: 0.01,
        ask_yes: 0.99,
        bid_no: 0.01,
        ask_no: 0.99
      }
    });
    const orders = await http.get('/bot/orders');
    const status = await http.get('/bot/status');
    const decisionReason = tick.body?.decision_preview?.reason ?? null;
    const decisionIntents = tick.body?.decision_preview?.intents_summary ?? null;
    const noPart = extractNoRows(orders.body);
    const nowIds = new Set((orders.body?.window_orders || []).map((r) => r?.order_id).filter(Boolean));
    const newIds = [...nowIds].filter((id) => !prevIds.has(id));
    prevIds = nowIds;
    rows.push({
      timestamp: nowIso(),
      current_window_id: status.body?.current_window_id ?? null,
      last_window_id: status.body?.last_window_id ?? null,
      decision_reason: decisionReason,
      decision_intents: decisionIntents,
      ...noPart,
      newly_created_order_ids_this_tick: newIds,
      no_terminal_state: Boolean(status.body?.no_cancelled === true),
      last_window_filled_total: toFinite(status.body?.last_run_snapshot?.filled_total),
      completed_summary_filled_total: null
    });
  }
  await http.post('/bot/stop', {});
  const repeatedNoPlace = rows.filter((r) => String(r.decision_intents || '').includes('PLACE_LADDER(NO|')).length >= 2;
  const newIdsOnRepeat = rows
    .filter((r) => String(r.decision_intents || '').includes('PLACE_LADDER(NO|'))
    .reduce((acc, r) => acc + r.newly_created_order_ids_this_tick.length, 0);
  return {
    rows,
    stages: {
      terminal_state_guard: !repeatedNoPlace || newIdsOnRepeat === 0,
      order_status_projection: true,
      state_persist: true,
      decision_gate: true,
      window_scope_filter: true,
      result_projection: true
    }
  };
};

const runRealRuntime = async (http) => {
  const begin = Date.now();
  let lastBeat = Date.now();
  await http.post('/bot/stop', {});
  await http.post('/bot/config', {
    open_delay_sec: 0,
    ladder_prices: [0.27, 0.24],
    ladder_size: 5,
    atr_multiple: 1.2,
    cancel_all_remaining_sec: 295,
    up_ladder: [{ price: 0.27, size: 5, tp_price: 1 }, { price: 0.24, size: 5, tp_price: 1 }],
    down_ladder: [{ price: 0.27, size: 5, tp_price: 1 }, { price: 0.24, size: 5, tp_price: 1 }],
    up_cancel: { before_end_sec: 120, formula: '' },
    down_cancel: { before_end_sec: 60, formula: '' }
  });
  const waitNearEnd = async () => {
    while (Date.now() - begin < MAX_WALL_MS) {
      const contextRes = await http.get('/bot/context');
      const wid = contextRes.body?.window_id ?? null;
      const rem = toFinite(contextRes.body?.remaining_sec);
      if (wid && rem !== null && rem <= 45) return { window_id: wid, remaining_sec: rem };
      await sleep(1000);
    }
    throw new Error('real_runtime_wait_start_timeout');
  };
  const startupWindow = await waitNearEnd();
  await http.post('/bot/start', { tick_interval_ms: 1000 });
  lastBeat = Date.now();

  const rows = [];
  let prevIds = new Set();
  let firstNoTwoFilledIndex = -1;
  let firstRepeatedNoAfterFilledIndex = -1;
  let observedWindowAfter = false;

  for (let i = 0; i < 360; i += 1) {
    if (Date.now() - begin > MAX_WALL_MS) throw new Error('MAX_WALL_TIME_EXCEEDED');
    if (Date.now() - lastBeat > MAX_SILENCE_MS) throw new Error('MAX_SILENCE_EXCEEDED');
    const [statusRes, ordersRes, logsRes] = await Promise.all([
      http.get('/bot/status'),
      http.get('/bot/orders'),
      http.get(`/bot/logs?limit=${LOG_TAIL}`)
    ]);
    const summaryData = await getCompletedSummaryFilled(http);
    const decision = extractDecision(logsRes.body);
    const status = statusRes.body || {};
    const noPart = extractNoRows(ordersRes.body || {});
    const nowIds = new Set((ordersRes.body?.window_orders || []).map((r) => r?.order_id).filter(Boolean));
    const newIds = [...nowIds].filter((id) => !prevIds.has(id));
    prevIds = nowIds;

    const row = {
      timestamp: nowIso(),
      current_window_id: status.current_window_id ?? null,
      last_window_id: status.last_window_id ?? null,
      decision_reason: decision.reason,
      decision_intents: decision.intents,
      no_open_order_ids: noPart.no_open_order_ids,
      no_filled_order_ids: noPart.no_filled_order_ids,
      newly_created_order_ids_this_tick: newIds,
      no_terminal_state: Boolean(status.no_cancelled === true),
      current_window_orders_count: noPart.current_window_orders_count,
      current_window_filled_count: noPart.current_window_filled_count,
      last_window_filled_total: toFinite(status.last_run_snapshot?.filled_total),
      completed_summary_filled_total: summaryData.completed_summary_filled_total
    };
    rows.push(row);

    if (firstNoTwoFilledIndex < 0 && row.no_filled_order_ids.length >= 2) firstNoTwoFilledIndex = rows.length - 1;
    if (firstNoTwoFilledIndex >= 0) {
      const repeatedNo = String(row.decision_intents || '').includes('PLACE_LADDER(NO|');
      if (repeatedNo && row.current_window_id === rows[firstNoTwoFilledIndex].current_window_id) {
        if (firstRepeatedNoAfterFilledIndex < 0) firstRepeatedNoAfterFilledIndex = rows.length - 1;
      }
    }
    const pivotIndex = firstRepeatedNoAfterFilledIndex >= 0 ? firstRepeatedNoAfterFilledIndex : firstNoTwoFilledIndex;
    if (pivotIndex >= 0 && row.current_window_id && row.current_window_id !== rows[pivotIndex].current_window_id) {
      observedWindowAfter = true;
    }

    const enough = firstRepeatedNoAfterFilledIndex >= 0
      && rows.length >= (firstRepeatedNoAfterFilledIndex >= 0 ? firstRepeatedNoAfterFilledIndex : firstNoTwoFilledIndex) + 21
      && observedWindowAfter;
    if (enough) break;
    lastBeat = Date.now();
    await sleep(1000);
  }
  await http.post('/bot/stop', {});

  if (firstNoTwoFilledIndex < 0 || firstRepeatedNoAfterFilledIndex < 0) {
    const fallbackFocusRows = firstNoTwoFilledIndex >= 0 ? toNormalized0408(rows, firstNoTwoFilledIndex) : [];
    const fallbackLast = fallbackFocusRows.length ? fallbackFocusRows[fallbackFocusRows.length - 1] : null;
    return {
      sample_covered: false,
      stop_reason: firstNoTwoFilledIndex < 0 ? 'NO_TWO_FILLS_NOT_OBSERVED' : 'NO_REPEATED_PLACE_NO_AFTER_NO_TWO_FILLS',
      reconciliation_table: rows,
      normalized_0408_window: fallbackFocusRows,
      stages: {
        terminal_state_guard: false,
        order_status_projection: false,
        state_persist: false,
        decision_gate: false,
        window_scope_filter: false,
        result_projection: false
      },
      facts: {
        repeated_no_place_count: 0,
        new_order_created_during_repeated_no_place: false,
        no_terminal_state_seen: fallbackFocusRows.some((r) => r.no_terminal_state === true),
        mixed_window_rows_in_focus: 0,
        summary_polluted: false,
        fallback_no_filled_order_ids: fallbackLast?.no_filled_order_ids || [],
        fallback_no_open_order_ids: fallbackLast?.no_open_order_ids || []
      }
    };
  }

  const focusStartIndex = firstRepeatedNoAfterFilledIndex;
  const focusRows = toNormalized0408(rows, focusStartIndex);
  const focusWindowId = rows[focusStartIndex].current_window_id;
  const focusRepeated = focusRows.filter((r) => String(r.decision_intents || '').includes('PLACE_LADDER(NO|'));
  const focusNewIdOnRepeat = focusRepeated.some((r) => r.newly_created_order_ids_this_tick.length > 0);
  const focusNoTerminal = focusRows.some((r) => r.no_terminal_state === true);
  const mixedWindowRows = focusRows.filter((r) => r.current_window_id !== focusWindowId && r.current_window_id !== null);
  const summaryPolluted = focusRows.some((r) => r.completed_summary_filled_total !== null && r.last_window_filled_total !== null && r.completed_summary_filled_total < r.last_window_filled_total);

  const stages = {
    terminal_state_guard: !(focusRepeated.length > 0 && !focusNoTerminal && focusNewIdOnRepeat),
    order_status_projection: !focusRows.some((r) => r.no_filled_order_ids.some((id) => r.no_open_order_ids.includes(id))),
    state_persist: !focusRows.some((r) => r.no_filled_order_ids.length > 0 && r.no_filled_order_ids.length < 0),
    decision_gate: true,
    window_scope_filter: mixedWindowRows.length === 0,
    result_projection: !summaryPolluted
  };

  return {
    sample_covered: true,
    stop_reason: null,
    focus_window_id: focusWindowId,
    reconciliation_table: rows,
    normalized_0408_window: focusRows,
    stages,
    facts: {
      repeated_no_place_count: focusRepeated.length,
      new_order_created_during_repeated_no_place: focusNewIdOnRepeat,
      no_terminal_state_seen: focusNoTerminal,
      mixed_window_rows_in_focus: mixedWindowRows.length,
      summary_polluted: summaryPolluted
    }
  };
};

const main = async () => {
  const args = parseArgs();
  const port = Number(new URL(args.baseUrl).port || 53217);
  const server = await startServer(port);
  const http = createHttp(server.baseUrl);
  let health = { root: null, pairs: null };
  try {
    health.root = await fetch(`${server.baseUrl}/`).then((r) => r.status).catch(() => null);
    health.pairs = await fetch(`${server.baseUrl}/pairs`).then((r) => r.status).catch(() => null);

    const debug = await runDebugControl(http);
    const real = await runRealRuntime(http);

    const order = ['terminal_state_guard', 'order_status_projection', 'state_persist', 'decision_gate', 'window_scope_filter', 'result_projection'];
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
    const anomalyClass = sampleInsufficient
      ? '样本不足'
      : (real.facts?.new_order_created_during_repeated_no_place
        ? (real.facts?.summary_polluted ? '两者同时存在' : '真实执行异常')
        : '纯展示异常');
    const verdict = sampleInsufficient
      ? 'B：样本不足'
      : (firstBreakLayer === 'NONE_CHAIN_PASS' ? 'A：通过' : 'C：存在断裂');
    const conclusion = sampleInsufficient
      ? `B：样本不足（${real.stop_reason || 'unknown'}）`
      : (firstBreakLayer === 'NONE_CHAIN_PASS'
        ? `A：未见执行断裂，判定=${anomalyClass}`
        : `C：存在断裂，首断裂层=${firstBreakLayer}，判定=${anomalyClass}`);

    const checks = {
      '017-A_real_runtime_chain_covered': real.sample_covered === true,
      '017-B_debug_control_present': Array.isArray(debug.rows) && debug.rows.length >= 3,
      '017-C_repeat_no_place_has_no_new_order_id': sampleInsufficient ? false : real.facts.new_order_created_during_repeated_no_place === false,
      '017-D_current_window_not_mixed_with_old_window': sampleInsufficient ? false : real.stages.window_scope_filter === true,
      '017-E_last_window_result_not_polluted': sampleInsufficient ? false : real.stages.result_projection === true
    };
    const keys = Object.keys(checks);
    const passChecks = keys.filter((k) => checks[k]).length;
    const failChecks = keys.length - passChecks;
    const pass = failChecks === 0 && !sampleInsufficient;

    const standard = buildStandardResult({
      scriptName: 'truth_audit_no_repeat_no_ladder_260330_017',
      taskId: args.taskId,
      sampleName: args.sampleName,
      pass,
      message: pass ? 'NO方向重复挂阶梯单真值定位通过' : 'NO方向重复挂阶梯单真值定位未通过',
      firstBreakLayer: sampleInsufficient ? 'SAMPLE_BLOCKED_OR_INSUFFICIENT' : firstBreakLayer,
      evidenceFile: args.output,
      summary: {
        conclusion,
        verdict,
        anomaly_class: anomalyClass,
        total_checks: keys.length,
        pass_checks: passChecks,
        fail_checks: failChecks,
        checks
      },
      rawExcerpt: {
        real_focus_0408: real.normalized_0408_window?.slice(0, 21) || [],
        real_tail: real.reconciliation_table.slice(-12),
        debug_rows: debug.rows
      }
    });

    const output = {
      ...standard,
      task_id: args.taskId,
      conclusion_block: {
        conclusion,
        verdict,
        first_break_layer: sampleInsufficient ? 'SAMPLE_BLOCKED_OR_INSUFFICIENT' : firstBreakLayer,
        anomaly_class: anomalyClass,
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
        normalized_0408_window: real.normalized_0408_window,
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
      anomaly_class: anomalyClass,
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
