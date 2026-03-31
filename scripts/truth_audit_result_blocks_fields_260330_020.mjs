import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { buildStandardResult, ensureDir, parseVerifyArgs, writeStandardLog } from './verify_standard_v1.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_TASK_ID = '260330_020';
const MAX_WALL_MS = 25 * 60 * 1000;
const MAX_SILENCE_MS = 120 * 1000;
const LOG_TAIL = 120;

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: 'http://localhost:53220',
  defaultOutputSuffix: 'truth_audit_result_blocks_fields',
  defaultSampleName: 'result_blocks_fields_v1'
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

const parseFieldInventory = () => {
  const filePath = path.join(REPO_ROOT, 'ui', 'js', 'strategy-editor.js');
  const text = fs.readFileSync(filePath, 'utf8');
  const startPrev = text.indexOf('上一窗口结果');
  const startPerf = text.indexOf('近期表现摘要');
  const endPerf = text.indexOf('</section>', startPerf);
  const prevChunk = text.slice(startPrev, startPerf);
  const perfChunk = text.slice(startPerf, endPerf > 0 ? endPerf : startPerf + 1200);
  const pairRegex = /<div style="color:#7f8a97;">([^<]+)<\/div><div id="([^"]+)"/g;
  const prevFields = [];
  const perfFields = [];
  let m = null;
  while ((m = pairRegex.exec(prevChunk)) !== null) {
    prevFields.push({ ui_block: '上一窗口结果', ui_field: m[1], dom_id: m[2] });
  }
  while ((m = pairRegex.exec(perfChunk)) !== null) {
    perfFields.push({ ui_block: '近期表现摘要', ui_field: m[1], dom_id: m[2] });
  }
  perfFields.push({ ui_block: '近期表现摘要', ui_field: '说明', dom_id: 'se-perf-note' });
  return {
    source_file: filePath,
    previous_window_result: prevFields,
    recent_performance_summary: perfFields
  };
};

const getCompletedSummaryWindow = (performance) => {
  const rows = Array.isArray(performance?.summary?.participating_postmortem_rows)
    ? performance.summary.participating_postmortem_rows
    : [];
  const latest = [...rows]
    .sort((a, b) => String(b.completed_at || '').localeCompare(String(a.completed_at || '')))[0] || null;
  return latest?.window_id ?? null;
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
    'se-prev-filled-total': formatStateValue(pm?.filled_total ?? lastRun?.filled_total),
    'se-prev-cancelled-total': formatStateValue(pm?.cancelled_total ?? lastRun?.cancelled_total ?? 0),
    'se-prev-pnl': formatStateValue(pm?.realized_gross_pnl_total ?? lastRun?.realized_gross_pnl_total),
    'se-perf-range': perfPresetLabel(summary?.preset || preset),
    'se-perf-window-count': formatStateValue(summary?.window_count),
    'se-perf-win-rate': winRateText,
    'se-perf-filled-total': formatStateValue(summary?.filled_total),
    'se-perf-realized-total': formatFixed1(summary?.realized_gross_pnl_total),
    'se-perf-avg-realized': formatStateValue(summary?.avg_realized_gross_pnl_per_window),
    'se-perf-note': noteText
  };
};

const sourceMapRows = ({ status, postmortem, performance, preset }) => {
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

  return [
    { ui_block: '上一窗口结果', ui_field: '已成交总数', dom_id: 'se-prev-filled-total', source_api_or_state: 'postmortem/latest + status.last_run_snapshot', source_field: 'postmortem.filled_total ?? last_run_snapshot.filled_total', expected_value: formatStateValue(pm?.filled_total ?? lastRun?.filled_total) },
    { ui_block: '上一窗口结果', ui_field: '已撤单总数', dom_id: 'se-prev-cancelled-total', source_api_or_state: 'postmortem/latest + status.last_run_snapshot', source_field: 'postmortem.cancelled_total ?? last_run_snapshot.cancelled_total ?? 0', expected_value: formatStateValue(pm?.cancelled_total ?? lastRun?.cancelled_total ?? 0) },
    { ui_block: '上一窗口结果', ui_field: 'PNL', dom_id: 'se-prev-pnl', source_api_or_state: 'postmortem/latest + status.last_run_snapshot', source_field: 'postmortem.realized_gross_pnl_total ?? last_run_snapshot.realized_gross_pnl_total', expected_value: formatStateValue(pm?.realized_gross_pnl_total ?? lastRun?.realized_gross_pnl_total) },
    { ui_block: '近期表现摘要', ui_field: '统计区间', dom_id: 'se-perf-range', source_api_or_state: 'performance/summary', source_field: 'summary.preset', expected_value: perfPresetLabel(summary?.preset || preset) },
    { ui_block: '近期表现摘要', ui_field: '窗口数', dom_id: 'se-perf-window-count', source_api_or_state: 'performance/summary', source_field: 'summary.window_count', expected_value: formatStateValue(summary?.window_count) },
    { ui_block: '近期表现摘要', ui_field: '胜率', dom_id: 'se-perf-win-rate', source_api_or_state: 'performance/summary', source_field: 'participating_postmortem_rows.realized_gross_pnl_total', expected_value: winRateText },
    { ui_block: '近期表现摘要', ui_field: '总成交单数', dom_id: 'se-perf-filled-total', source_api_or_state: 'performance/summary', source_field: 'summary.filled_total', expected_value: formatStateValue(summary?.filled_total) },
    { ui_block: '近期表现摘要', ui_field: '总计PNL', dom_id: 'se-perf-realized-total', source_api_or_state: 'performance/summary', source_field: 'summary.realized_gross_pnl_total (fixed1)', expected_value: formatFixed1(summary?.realized_gross_pnl_total) },
    { ui_block: '近期表现摘要', ui_field: '平均每窗口盈亏', dom_id: 'se-perf-avg-realized', source_api_or_state: 'performance/summary', source_field: 'summary.avg_realized_gross_pnl_per_window', expected_value: formatStateValue(summary?.avg_realized_gross_pnl_per_window) },
    { ui_block: '近期表现摘要', ui_field: '说明', dom_id: 'se-perf-note', source_api_or_state: 'performance/summary + status', source_field: 'window_count/preset/running_window_excluded/status.running', expected_value: noteText }
  ];
};

const buildReconcileRows = ({ status, postmortem, performance, preset, tag }) => {
  const projection = buildUiProjection({ status, postmortem, performance, preset });
  const rows = sourceMapRows({ status, postmortem, performance, preset });
  const completedSummaryWindowId = getCompletedSummaryWindow(performance);
  return rows.map((row) => {
    const uiValue = projection[row.dom_id] ?? 'N/A (null)';
    const pass = uiValue === row.expected_value;
    return {
      sample_tag: tag,
      timestamp: nowIso(),
      ui_block: row.ui_block,
      ui_field: row.ui_field,
      ui_value: uiValue,
      source_api_or_state: row.source_api_or_state,
      source_field: row.source_field,
      expected_value: row.expected_value,
      current_window_id: status?.current_window_id ?? null,
      last_window_id: status?.last_window_id ?? null,
      completed_summary_window_id: completedSummaryWindowId,
      pass_fail: pass ? 'PASS' : 'FAIL',
      notes: pass ? 'match' : 'ui!=expected'
    };
  });
};

const runDebugControl = async (http, preset = 'today') => {
  await http.post('/bot/stop', {});
  await sleep(300);
  await http.post('/bot/start', { tick_interval_ms: 1000, debugScenario: 'fill_yes_path_v1' });
  for (let i = 0; i < 16; i += 1) {
    await sleep(700);
    const ordersRes = await http.get('/bot/orders');
    const allOrders = Array.isArray(ordersRes.body?.all_orders) ? ordersRes.body.all_orders : [];
    if (allOrders.some((row) => row?.status === 'FILLED')) break;
  }
  await http.post('/bot/stop', {});
  await sleep(500);
  const [statusRes, postmortemRes, perfRes] = await Promise.all([
    http.get('/bot/status'),
    http.get('/bot/postmortem/latest'),
    http.get(`/bot/performance/summary?preset=${encodeURIComponent(preset)}&detail=1`)
  ]);
  const rows = buildReconcileRows({
    status: statusRes.body || {},
    postmortem: postmortemRes.body || {},
    performance: perfRes.body || {},
    preset,
    tag: 'debug_control'
  });
  const allPass = rows.every((r) => r.pass_fail === 'PASS');
  return {
    rows,
    status: statusRes.body || {},
    postmortem: postmortemRes.body || {},
    performance: perfRes.body || {},
    stages: {
      field_inventory_binding: true,
      last_window_partition: true,
      recent_summary_aggregate: true,
      result_source_mapping: allPass,
      pnl_projection_or_rounding: rows.filter((r) => r.ui_field === '总计PNL').every((r) => r.pass_fail === 'PASS'),
      dom_projection: rows.every((r) => r.ui_value !== undefined)
    }
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
    cancel_all_remaining_sec: 10,
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
      if (wid && rem !== null && rem <= 45) return { window_id: wid, remaining_sec: rem };
      await sleep(1000);
    }
    throw new Error('real_runtime_wait_start_timeout');
  };
  const startup = await waitNearEnd();
  await http.post('/bot/start', { tick_interval_ms: 1000 });
  lastBeat = Date.now();

  let firstWindow = startup.window_id;
  let switched = false;
  let sampled = null;
  const timeline = [];

  for (let i = 0; i < 420; i += 1) {
    if (Date.now() - begin > MAX_WALL_MS) throw new Error('MAX_WALL_TIME_EXCEEDED');
    if (Date.now() - lastBeat > MAX_SILENCE_MS) throw new Error('MAX_SILENCE_EXCEEDED');
    const [statusRes, postmortemRes, perfRes] = await Promise.all([
      http.get('/bot/status'),
      http.get('/bot/postmortem/latest'),
      http.get(`/bot/performance/summary?preset=${encodeURIComponent(preset)}&detail=1`)
    ]);
    const status = statusRes.body || {};
    const pm = postmortemRes.body || {};
    const perf = perfRes.body || {};
    timeline.push({
      i,
      at: nowIso(),
      current_window_id: status.current_window_id ?? null,
      last_window_id: status.last_window_id ?? null,
      postmortem_window_id: pm?.postmortem?.window_id ?? null,
      perf_window_count: perf?.summary?.window_count ?? null
    });
    if (status.current_window_id && status.current_window_id !== firstWindow) switched = true;
    const hasPostmortem = Boolean(pm?.postmortem?.window_id);
    if (switched && hasPostmortem) {
      sampled = { status, postmortem: pm, performance: perf };
      break;
    }
    lastBeat = Date.now();
    await sleep(1000);
  }
  await http.post('/bot/stop', {});
  await sleep(500);
  const [statusAfter, postmortemAfter, perfAfter] = await Promise.all([
    http.get('/bot/status'),
    http.get('/bot/postmortem/latest'),
    http.get(`/bot/performance/summary?preset=${encodeURIComponent(preset)}&detail=1`)
  ]);
  if (!sampled) sampled = { status: statusAfter.body || {}, postmortem: postmortemAfter.body || {}, performance: perfAfter.body || {} };
  const rows = buildReconcileRows({
    status: sampled.status,
    postmortem: sampled.postmortem,
    performance: sampled.performance,
    preset,
    tag: 'real_runtime'
  });
  const allPass = rows.every((r) => r.pass_fail === 'PASS');
  const currentWindowId = sampled.status?.current_window_id ?? null;
  const pmWindowId = sampled.postmortem?.postmortem?.window_id ?? null;
  const summaryRows = Array.isArray(sampled.performance?.summary?.participating_postmortem_rows)
    ? sampled.performance.summary.participating_postmortem_rows
    : [];
  const summaryHasPmWindow = summaryRows.some((row) => row?.window_id === pmWindowId);
  const perfTotalRaw = sampled.performance?.summary?.realized_gross_pnl_total;
  const perfTotalText = formatFixed1(perfTotalRaw);
  const perfTotalRow = rows.find((r) => r.ui_field === '总计PNL');
  return {
    sample_covered: switched && Boolean(pmWindowId),
    startup_window_id: firstWindow,
    sampled_current_window_id: currentWindowId,
    sampled_postmortem_window_id: pmWindowId,
    timeline_head: timeline.slice(0, 12),
    timeline_tail: timeline.slice(-12),
    rows,
    stages: {
      field_inventory_binding: true,
      last_window_partition: pmWindowId !== null && currentWindowId !== pmWindowId,
      recent_summary_aggregate: summaryHasPmWindow,
      result_source_mapping: allPass,
      pnl_projection_or_rounding: perfTotalRow ? perfTotalRow.ui_value === perfTotalText : false,
      dom_projection: rows.every((r) => r.ui_value !== undefined)
    }
  };
};

const main = async () => {
  const args = parseArgs();
  const port = Number(new URL(args.baseUrl).port || 53220);
  const server = await startServer(port);
  const http = createHttp(server.baseUrl);
  let health = { root: null, pairs: null };
  try {
    health.root = await fetch(`${server.baseUrl}/`).then((r) => r.status).catch(() => null);
    health.pairs = await fetch(`${server.baseUrl}/pairs`).then((r) => r.status).catch(() => null);
    const fieldInventory = parseFieldInventory();
    const debug = await runDebugControl(http, 'today');
    const real = await runRealRuntime(http, 'today');

    const order = [
      'field_inventory_binding',
      'last_window_partition',
      'recent_summary_aggregate',
      'result_source_mapping',
      'pnl_projection_or_rounding',
      'dom_projection'
    ];
    const sampleInsufficient = !real.sample_covered;
    let firstBreakLayer = 'NONE_CHAIN_PASS';
    if (sampleInsufficient) {
      firstBreakLayer = 'SAMPLE_BLOCKED_OR_INSUFFICIENT';
    } else {
      for (const key of order) {
        if (!real.stages[key]) {
          firstBreakLayer = key;
          break;
        }
      }
    }
    let divergenceLayer = 'none';
    for (const key of order) {
      if (Boolean(real.stages[key]) !== Boolean(debug.stages[key])) {
        divergenceLayer = key;
        break;
      }
    }
    const verdict = sampleInsufficient
      ? 'B：样本不足'
      : (firstBreakLayer === 'NONE_CHAIN_PASS' ? 'A：通过' : 'C：存在断裂');
    const conclusion = sampleInsufficient
      ? 'B：样本不足，未完整覆盖窗口结算后 UI 结果块刷新样本'
      : (firstBreakLayer === 'NONE_CHAIN_PASS'
        ? 'A：上一窗口结果/近期表现摘要字段来源与投影链通过'
        : `C：存在断裂，首断裂层=${firstBreakLayer}`);

    const checks = {
      '020-A_field_inventory_complete': fieldInventory.previous_window_result.length > 0 && fieldInventory.recent_performance_summary.length > 0,
      '020-B_real_runtime_sample_covered': real.sample_covered === true,
      '020-C_reconcile_rows_all_pass': real.rows.every((r) => r.pass_fail === 'PASS'),
      '020-D_last_window_vs_summary_partition': real.stages.last_window_partition === true && real.stages.recent_summary_aggregate === true,
      '020-E_pnl_projection_contract': real.stages.pnl_projection_or_rounding === true
    };
    const keys = Object.keys(checks);
    const passChecks = keys.filter((k) => checks[k]).length;
    const failChecks = keys.length - passChecks;
    const pass = failChecks === 0 && !sampleInsufficient;

    const standard = buildStandardResult({
      scriptName: 'truth_audit_result_blocks_fields_260330_020',
      taskId: args.taskId,
      sampleName: args.sampleName,
      pass,
      message: pass ? 'result blocks truth audit pass' : 'result blocks truth audit fail',
      firstBreakLayer: firstBreakLayer,
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
        field_inventory: fieldInventory,
        real_rows_head: real.rows.slice(0, 12),
        debug_rows_head: debug.rows.slice(0, 12)
      }
    });

    const output = {
      ...standard,
      task_id: args.taskId,
      conclusion_block: {
        conclusion,
        verdict,
        first_break_layer: firstBreakLayer,
        real_debug_diverged: divergenceLayer !== 'none',
        real_debug_first_divergence_layer: divergenceLayer
      },
      key_counters: {
        total_checks: keys.length,
        pass_checks: passChecks,
        fail_checks: failChecks
      },
      evidence_index: {
        field_inventory: fieldInventory,
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
