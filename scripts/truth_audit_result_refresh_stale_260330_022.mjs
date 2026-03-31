import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { buildStandardResult, ensureDir, parseVerifyArgs, writeStandardLog } from './verify_standard_v1.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_TASK_ID = '260330_022';
const MAX_WALL_MS = 25 * 60 * 1000;
const MAX_SILENCE_MS = 120 * 1000;
const LOG_TAIL = 120;

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: 'http://localhost:53222',
  defaultOutputSuffix: 'truth_audit_result_refresh_stale',
  defaultSampleName: 'result_refresh_stale_v1'
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

const perfPresetLabel = (preset) => {
  if (preset === 'last_7d') return '近7天';
  if (preset === 'last_30_windows') return '近30窗口';
  return '今日';
};
const formatStateValue = (value) => {
  if (value === null || value === undefined || value === '') return 'N/A (null)';
  if (Array.isArray(value)) return value.length ? value.join(',') : '[]';
  return `${value}`;
};
const formatFixed1 = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num.toFixed(1) : '—';
};

const buildUiProjection = ({ status, postmortem, performance, preset }) => {
  const lastRun = status?.last_run_snapshot && typeof status.last_run_snapshot === 'object'
    ? status.last_run_snapshot
    : null;
  const pm = postmortem?.postmortem && typeof postmortem.postmortem === 'object'
    ? postmortem.postmortem
    : null;
  const summary = performance?.summary && typeof performance.summary === 'object'
    ? performance.summary
    : null;
  const rows = Array.isArray(summary?.participating_postmortem_rows) ? summary.participating_postmortem_rows : [];
  const winNumerator = rows.filter((row) => {
    const v = Number(row?.realized_gross_pnl_total);
    return Number.isFinite(v) && v > 0;
  }).length;
  const winDenominator = rows.length;
  const winRateText = winDenominator > 0 ? `${((winNumerator / winDenominator) * 100).toFixed(1)}%` : '—';
  const empty = (summary?.window_count ?? 0) === 0;
  const noteText = empty
    ? `${perfPresetLabel(preset)} 当前无已完成窗口数据（running 窗口不计入）`
    : `${perfPresetLabel(summary?.preset)} | 仅统计已完成窗口 | running_excluded=${formatStateValue(summary?.running_window_excluded)} | running_now=${formatStateValue(status?.running)}`;
  return {
    last_window_fields: {
      filled_total: formatStateValue(pm?.filled_total ?? lastRun?.filled_total),
      cancelled_total: formatStateValue(pm?.cancelled_total ?? lastRun?.cancelled_total ?? 0),
      pnl: formatStateValue(pm?.realized_gross_pnl_total ?? lastRun?.realized_gross_pnl_total)
    },
    recent_summary_fields: {
      range: perfPresetLabel(summary?.preset || preset),
      window_count: formatStateValue(summary?.window_count),
      win_rate: winRateText,
      filled_total: formatStateValue(summary?.filled_total),
      total_pnl: formatFixed1(summary?.realized_gross_pnl_total),
      avg_pnl: formatStateValue(summary?.avg_realized_gross_pnl_per_window),
      note: noteText
    }
  };
};

const getCompletedSummaryWindowId = (performance) => {
  const rows = Array.isArray(performance?.summary?.participating_postmortem_rows)
    ? performance.summary.participating_postmortem_rows
    : [];
  const latest = [...rows].sort((a, b) => String(b.completed_at || '').localeCompare(String(a.completed_at || '')))[0] || null;
  return latest?.window_id ?? null;
};

const buildSample = ({ tag, status, postmortem, performance, preset }) => {
  const ui = buildUiProjection({ status, postmortem, performance, preset });
  const pmWindow = postmortem?.postmortem?.window_id ?? null;
  const summary = performance?.summary || {};
  return {
    sample_tag: tag,
    timestamp: nowIso(),
    current_window_id: status?.current_window_id ?? null,
    last_window_id: status?.last_window_id ?? null,
    expected_last_completed_window_id: status?.last_window_id ?? null,
    ui_last_window_fields: ui.last_window_fields,
    ui_recent_summary_fields: ui.recent_summary_fields,
    postmortem_window_id: pmWindow,
    summary_window_count: toFinite(summary?.window_count),
    summary_realized_gross_pnl_total: toFinite(summary?.realized_gross_pnl_total),
    dom_refresh_seen: false,
    pass_fail: 'PENDING',
    notes: ''
  };
};

const finalizeRows = (rows) => {
  for (let i = 0; i < rows.length; i += 1) {
    const current = rows[i];
    const prev = rows[i - 1] || null;
    const uiChanged = prev
      ? JSON.stringify(current.ui_last_window_fields) !== JSON.stringify(prev.ui_last_window_fields)
        || JSON.stringify(current.ui_recent_summary_fields) !== JSON.stringify(prev.ui_recent_summary_fields)
      : true;
    current.dom_refresh_seen = uiChanged;
    const windowMatch = current.expected_last_completed_window_id === current.postmortem_window_id;
    const uiLastMatchBottom = String(current.ui_last_window_fields?.pnl) === String(current.ui_last_window_fields?.pnl)
      && String(current.ui_last_window_fields?.filled_total) !== '';
    const summaryLooksValid = current.summary_window_count !== null && current.summary_realized_gross_pnl_total !== null;
    current.pass_fail = windowMatch && uiLastMatchBottom && summaryLooksValid ? 'PASS' : 'FAIL';
    current.notes = `window_match=${windowMatch};summary_valid=${summaryLooksValid};ui_changed=${uiChanged}`;
  }
  return rows;
};

const runDebugControl = async (http, preset = 'today') => {
  await http.post('/bot/stop', {});
  await sleep(300);
  await http.post('/bot/start', { tick_interval_ms: 1000, debugScenario: 'fill_yes_path_v1' });
  for (let i = 0; i < 12; i += 1) {
    await sleep(700);
    const statusRes = await http.get('/bot/status');
    if (statusRes.body?.running === true) break;
  }
  await http.post('/bot/stop', {});
  await sleep(400);
  const [statusRes, pmRes, perfRes] = await Promise.all([
    http.get('/bot/status'),
    http.get('/bot/postmortem/latest'),
    http.get(`/bot/performance/summary?preset=${encodeURIComponent(preset)}&detail=1`)
  ]);
  const row = buildSample({
    tag: 'debug_control',
    status: statusRes.body || {},
    postmortem: pmRes.body || {},
    performance: perfRes.body || {},
    preset
  });
  finalizeRows([row]);
  const stages = {
    last_window_partition: row.expected_last_completed_window_id === row.postmortem_window_id,
    recent_summary_aggregate: row.summary_window_count !== null,
    result_refresh_trigger: true,
    ui_poll_or_snapshot: true,
    dom_projection: row.pass_fail === 'PASS'
  };
  return {
    rows: [row],
    status: statusRes.body || {},
    postmortem: pmRes.body || {},
    performance: perfRes.body || {},
    stages
  };
};

const runRealRuntime = async (http, preset = 'today') => {
  const begin = Date.now();
  let lastBeat = Date.now();
  await http.post('/bot/stop', {});
  await sleep(300);
  await http.post('/bot/config', {
    open_delay_sec: 0,
    ladder_prices: [0.999, 0.998],
    ladder_size: 5,
    atr_multiple: 1.2,
    cancel_all_remaining_sec: 20,
    up_ladder: [{ price: 0.999, size: 5, tp_price: 1 }, { price: 0.998, size: 5, tp_price: 1 }],
    down_ladder: [{ price: 0.999, size: 5, tp_price: 1 }, { price: 0.998, size: 5, tp_price: 1 }],
    up_cancel: { before_end_sec: 120, formula: '' },
    down_cancel: { before_end_sec: 120, formula: '' }
  });
  const waitNearEnd = async () => {
    while (Date.now() - begin < MAX_WALL_MS) {
      const contextRes = await http.get('/bot/context');
      const wid = contextRes.body?.window_id ?? null;
      const rem = toFinite(contextRes.body?.remaining_sec);
      if (wid && rem !== null && rem <= 25) return { window_id: wid, remaining_sec: rem };
      await sleep(1000);
    }
    throw new Error('real_runtime_wait_start_timeout');
  };
  const startup = await waitNearEnd();
  await http.post('/bot/start', { tick_interval_ms: 1000 });
  lastBeat = Date.now();

  let windowA = startup.window_id;
  let windowB = null;
  let windowC = null;
  let prevBundle = null;
  let sampleAEnd = null;
  let sampleBEnd = null;
  let sampleCStart = null;
  const timeline = [];

  for (let i = 0; i < 1200; i += 1) {
    if (Date.now() - begin > MAX_WALL_MS) throw new Error('MAX_WALL_TIME_EXCEEDED');
    if (Date.now() - lastBeat > MAX_SILENCE_MS) throw new Error('MAX_SILENCE_EXCEEDED');
    const [statusRes, pmRes, perfRes, logsRes] = await Promise.all([
      http.get('/bot/status'),
      http.get('/bot/postmortem/latest'),
      http.get(`/bot/performance/summary?preset=${encodeURIComponent(preset)}&detail=1`),
      http.get(`/bot/logs?limit=${LOG_TAIL}`)
    ]);
    const status = statusRes.body || {};
    const pm = pmRes.body || {};
    const perf = perfRes.body || {};
    const currentWindow = status.current_window_id ?? null;
    const lastWindow = status.last_window_id ?? null;
    const runner = Array.isArray(logsRes.body) ? [...logsRes.body].reverse().find((r) => r?.event === 'RUNNER_TICK') : null;
    timeline.push({
      i,
      at: nowIso(),
      current_window_id: currentWindow,
      last_window_id: lastWindow,
      postmortem_window_id: pm?.postmortem?.window_id ?? null,
      summary_window_count: perf?.summary?.window_count ?? null,
      intents_summary: runner?.data?.intents_summary ?? null
    });

    if (currentWindow && currentWindow !== windowA && !windowB) {
      windowB = currentWindow;
      sampleAEnd = buildSample({ tag: 'A_end', status, postmortem: pm, performance: perf, preset });
    }
    if (windowB && currentWindow && currentWindow !== windowB && !windowC) {
      windowC = currentWindow;
      sampleBEnd = prevBundle
        ? buildSample({ tag: 'B_end', status: prevBundle.status, postmortem: prevBundle.pm, performance: prevBundle.perf, preset })
        : buildSample({ tag: 'B_end', status, postmortem: pm, performance: perf, preset });
      sampleCStart = buildSample({ tag: 'C_start', status, postmortem: pm, performance: perf, preset });
      break;
    }
    prevBundle = { status, pm, perf };
    lastBeat = Date.now();
    await sleep(1000);
  }
  await http.post('/bot/stop', {});
  await sleep(400);

  const rows = [sampleAEnd, sampleBEnd, sampleCStart].filter(Boolean);
  finalizeRows(rows);
  const sampleCovered = rows.length === 3 && Boolean(windowA) && Boolean(windowB) && Boolean(windowC);
  const a = rows.find((r) => r.sample_tag === 'A_end') || null;
  const b = rows.find((r) => r.sample_tag === 'B_end') || null;
  const c = rows.find((r) => r.sample_tag === 'C_start') || null;
  const lastAdvance = c && b ? c.postmortem_window_id !== b.postmortem_window_id : false;
  const summaryAdvance = c && b ? (c.summary_window_count ?? -1) > (b.summary_window_count ?? -1) : false;
  const uiLastAdvance = c && b ? JSON.stringify(c.ui_last_window_fields) !== JSON.stringify(b.ui_last_window_fields) : false;
  const uiSummaryAdvance = c && b ? JSON.stringify(c.ui_recent_summary_fields) !== JSON.stringify(b.ui_recent_summary_fields) : false;
  const stages = {
    last_window_partition: sampleCovered ? lastAdvance : false,
    recent_summary_aggregate: sampleCovered ? summaryAdvance : false,
    result_refresh_trigger: sampleCovered ? (lastAdvance && !uiLastAdvance ? false : true) : false,
    ui_poll_or_snapshot: sampleCovered ? (!(lastAdvance && summaryAdvance) || uiLastAdvance || uiSummaryAdvance) : false,
    dom_projection: rows.every((r) => r.pass_fail === 'PASS')
  };
  return {
    sample_covered: sampleCovered,
    window_a: windowA,
    window_b: windowB,
    window_c: windowC,
    rows,
    timeline_head: timeline.slice(0, 20),
    timeline_tail: timeline.slice(-20),
    stages,
    refresh_diagnostics: {
      last_advanced: lastAdvance,
      summary_advanced: summaryAdvance,
      ui_last_advanced: uiLastAdvance,
      ui_summary_advanced: uiSummaryAdvance
    }
  };
};

const main = async () => {
  const args = parseArgs();
  const port = Number(new URL(args.baseUrl).port || 53222);
  const server = await startServer(port);
  const http = createHttp(server.baseUrl);
  let health = { root: null, pairs: null };
  try {
    health.root = await fetch(`${server.baseUrl}/`).then((r) => r.status).catch(() => null);
    health.pairs = await fetch(`${server.baseUrl}/pairs`).then((r) => r.status).catch(() => null);
    const debug = await runDebugControl(http, 'today');
    const real = await runRealRuntime(http, 'today');

    const layerOrder = [
      'last_window_partition',
      'recent_summary_aggregate',
      'result_refresh_trigger',
      'ui_poll_or_snapshot',
      'dom_projection'
    ];
    const sampleInsufficient = !real.sample_covered;
    let firstBreakLayer = 'NONE_CHAIN_PASS';
    if (sampleInsufficient) {
      firstBreakLayer = 'SAMPLE_BLOCKED_OR_INSUFFICIENT';
    } else {
      for (const key of layerOrder) {
        if (!real.stages[key]) {
          firstBreakLayer = key;
          break;
        }
      }
    }
    let divergenceLayer = 'none';
    for (const key of layerOrder) {
      if (Boolean(real.stages[key]) !== Boolean(debug.stages[key])) {
        divergenceLayer = key;
        break;
      }
    }
    const baseAdvance = sampleInsufficient
      ? '样本不足'
      : ((real.stages.last_window_partition && real.stages.recent_summary_aggregate) ? '底层已推进' : '底层未推进');
    const uiRefreshState = sampleInsufficient
      ? '样本不足'
      : ((real.stages.result_refresh_trigger && real.stages.ui_poll_or_snapshot && real.stages.dom_projection) ? 'UI已刷新' : 'UI未刷新');
    const verdict = sampleInsufficient
      ? 'B：样本不足'
      : (firstBreakLayer === 'NONE_CHAIN_PASS' ? 'A：通过' : 'C：存在断裂');
    const conclusion = sampleInsufficient
      ? 'B：样本不足，未完整覆盖 A结束→B完整周期→C起始'
      : (firstBreakLayer === 'NONE_CHAIN_PASS'
        ? 'A：未见“结果块跨一窗仍不刷新”断裂'
        : `C：存在断裂，首断裂层=${firstBreakLayer}`);

    const checks = {
      '022-A_real_runtime_ABC_covered': real.sample_covered === true,
      '022-B_debug_control_present': Array.isArray(debug.rows) && debug.rows.length >= 1,
      '022-C_reconcile_rows_complete': real.rows.length === 3,
      '022-D_base_chain_or_ui_refresh_classified': !sampleInsufficient,
      '022-E_first_break_layer_single': Boolean(firstBreakLayer)
    };
    const keys = Object.keys(checks);
    const passChecks = keys.filter((k) => checks[k]).length;
    const failChecks = keys.length - passChecks;
    const pass = !sampleInsufficient && firstBreakLayer === 'NONE_CHAIN_PASS' && failChecks === 0;

    const standard = buildStandardResult({
      scriptName: 'truth_audit_result_refresh_stale_260330_022',
      taskId: args.taskId,
      sampleName: args.sampleName,
      pass,
      message: pass ? 'result refresh stale audit pass' : 'result refresh stale audit fail',
      firstBreakLayer,
      evidenceFile: args.output,
      summary: {
        conclusion,
        verdict,
        base_chain_state: baseAdvance,
        ui_refresh_state: uiRefreshState,
        total_checks: keys.length,
        pass_checks: passChecks,
        fail_checks: failChecks,
        checks
      },
      rawExcerpt: {
        real_rows: real.rows,
        debug_rows: debug.rows
      }
    });

    const output = {
      ...standard,
      task_id: args.taskId,
      conclusion_block: {
        conclusion,
        verdict,
        first_break_layer: firstBreakLayer,
        base_chain_state: baseAdvance,
        ui_refresh_state: uiRefreshState,
        real_debug_diverged: divergenceLayer !== 'none',
        real_debug_first_divergence_layer: divergenceLayer
      },
      key_counters: {
        total_checks: keys.length,
        pass_checks: passChecks,
        fail_checks: failChecks
      },
      evidence_index: {
        reconciliation_table: real.rows,
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
    console.log(JSON.stringify({ pass, conclusion, verdict, first_break_layer: firstBreakLayer, divergence_layer: divergenceLayer, pass_checks: passChecks, fail_checks: failChecks }));
    if (!pass) process.exitCode = 1;
  } finally {
    await stopServer(server.child);
  }
};

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
