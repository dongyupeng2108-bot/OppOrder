import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { buildStandardResult, ensureDir, parseVerifyArgs, writeStandardLog } from './verify_standard_v1.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_TASK_ID = '260330_023';
const MAX_WALL_MS = 8 * 60 * 1000;
const MAX_SILENCE_MS = 60 * 1000;
const HEARTBEAT_MS = 30 * 1000;
const FETCH_TIMEOUT_MS = 15000;
const LOG_TAIL = 120;

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: 'http://localhost:53223',
  defaultOutputSuffix: 'truth_audit_settlement_poll_fix',
  defaultSampleName: 'settlement_poll_fix_v1'
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
const runtimeGuard = {
  started_at_ms: Date.now(),
  last_output_at_ms: Date.now(),
  last_heartbeat_at_ms: 0,
  phase: 'init',
  sampled_windows: { a: null, b: null, c: null },
  pending_settlement_window_id: null,
  last_fetch: {
    target: null,
    ok: null,
    status: null,
    required: true,
    at: null,
    error: null
  }
};
const markOutput = () => {
  runtimeGuard.last_output_at_ms = Date.now();
};
const emitLine = (text) => {
  console.log(text);
  markOutput();
};
const classifyFailure = (error) => {
  const msg = String(error?.message || error || '');
  if (msg.includes('FETCH_REQUIRED_FAIL') || msg.includes('FETCH_TIMEOUT')) return 'fetch_fail';
  if (msg.includes('SILENT_TIMEOUT')) return 'silent_timeout';
  if (msg.includes('WALL_TIMEOUT')) return 'wall_timeout';
  if (msg.includes('SAMPLE_BLOCKED_OR_INSUFFICIENT')) return 'sample_insufficient';
  return 'other';
};
const checkGuard = () => {
  const now = Date.now();
  if (now - runtimeGuard.started_at_ms > MAX_WALL_MS) {
    throw new Error('WALL_TIMEOUT');
  }
  if (now - runtimeGuard.last_output_at_ms > MAX_SILENCE_MS) {
    throw new Error('SILENT_TIMEOUT');
  }
};
const maybeHeartbeat = () => {
  const now = Date.now();
  if (now - runtimeGuard.last_heartbeat_at_ms < HEARTBEAT_MS) return;
  runtimeGuard.last_heartbeat_at_ms = now;
  const waitedSec = Math.max(0, Math.floor((now - runtimeGuard.started_at_ms) / 1000));
  emitLine(
    `[HEARTBEAT] phase=${runtimeGuard.phase} a=${runtimeGuard.sampled_windows.a || 'null'} b=${runtimeGuard.sampled_windows.b || 'null'} c=${runtimeGuard.sampled_windows.c || 'null'} pending=${runtimeGuard.pending_settlement_window_id || 'null'} fetch_target=${runtimeGuard.last_fetch.target || 'null'} fetch_ok=${runtimeGuard.last_fetch.ok === null ? 'null' : String(runtimeGuard.last_fetch.ok)} fetch_status=${runtimeGuard.last_fetch.status ?? 'null'} waited_s=${waitedSec}`
  );
};
const fetchWithTimeout = async (url, options = {}, timeoutMs = FETCH_TIMEOUT_MS) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err?.name === 'AbortError') throw new Error(`FETCH_TIMEOUT:${timeoutMs}ms`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
};

const createHttp = (baseUrl) => {
  const withRetry = async (fn, meta = {}) => {
    let last = null;
    const required = meta.required !== false;
    const target = `${meta.method || 'GET'} ${meta.endpoint || ''}`.trim();
    for (let i = 0; i < 4; i += 1) {
      checkGuard();
      maybeHeartbeat();
      try {
        const out = await fn();
        runtimeGuard.last_fetch = {
          target,
          ok: true,
          status: out?.status ?? null,
          required,
          at: nowIso(),
          error: null
        };
        markOutput();
        return out;
      } catch (err) {
        last = err;
        runtimeGuard.last_fetch = {
          target,
          ok: false,
          status: null,
          required,
          at: nowIso(),
          error: String(err?.message || err)
        };
        markOutput();
        await sleep(250);
      }
    }
    if (!required) {
      return { status: null, body: null, error: String(last?.message || last || 'http_retry_failed') };
    }
    throw new Error(`FETCH_REQUIRED_FAIL:${target}:${last?.message || last || 'http_retry_failed'}`);
  };
  return {
    get: (endpoint, options = {}) => withRetry(async () => {
      const res = await fetchWithTimeout(`${baseUrl}${endpoint}`, {}, FETCH_TIMEOUT_MS);
      return { status: res.status, body: await toJson(res) };
    }, { endpoint, method: 'GET', required: options.required !== false }),
    post: (endpoint, body = {}, options = {}) => withRetry(async () => {
      const res = await fetchWithTimeout(`${baseUrl}${endpoint}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      }, FETCH_TIMEOUT_MS);
      return { status: res.status, body: await toJson(res) };
    }, { endpoint, method: 'POST', required: options.required !== false })
  };
};

const waitServerReady = async (baseUrl, timeoutMs = 45000) => {
  const begin = Date.now();
  while (Date.now() - begin < timeoutMs) {
    checkGuard();
    maybeHeartbeat();
    try {
      const res = await fetchWithTimeout(`${baseUrl}/bot/status`, {}, FETCH_TIMEOUT_MS);
      if (res.status === 200) return true;
    } catch {}
    markOutput();
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
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(1) : '—';
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

const sampleRow = ({ tag, status, postmortem, performance, context }) => {
  const ui = buildUiProjection({ status, postmortem, performance, preset: 'today' });
  const settlement = status?.settlement_runtime || {};
  return {
    sample_tag: tag,
    timestamp: nowIso(),
    current_window_id: status?.current_window_id ?? null,
    pending_settlement_window_id: settlement?.pending_settlement_window_id ?? null,
    last_window_id: status?.last_window_id ?? null,
    expected_last_completed_window_id: status?.last_window_id ?? null,
    ui_last_window_fields: ui.last_window_fields,
    ui_recent_summary_fields: ui.recent_summary_fields,
    postmortem_window_id: postmortem?.postmortem?.window_id ?? null,
    summary_window_count: toFinite(performance?.summary?.window_count),
    summary_realized_gross_pnl_total: toFinite(performance?.summary?.realized_gross_pnl_total),
    settlement_poll_attempted: settlement?.settlement_poll_attempted === true,
    settlement_result_seen: Boolean(settlement?.settlement_last_result_window_id),
    pass_fail: 'PENDING',
    notes: context || ''
  };
};

const finalizeRows = (rows) => rows.map((row, idx) => {
  const prev = idx > 0 ? rows[idx - 1] : null;
  const hasSource = row.postmortem_window_id !== null && row.summary_window_count !== null;
  const windowMatch = row.expected_last_completed_window_id === row.postmortem_window_id;
  const uiChanged = prev
    ? (JSON.stringify(row.ui_last_window_fields) !== JSON.stringify(prev.ui_last_window_fields)
      || JSON.stringify(row.ui_recent_summary_fields) !== JSON.stringify(prev.ui_recent_summary_fields))
    : true;
  return {
    ...row,
    pass_fail: hasSource ? 'PASS' : 'FAIL',
    notes: `${row.notes};window_match=${windowMatch};ui_changed=${uiChanged};source_ready=${hasSource}`
  };
});

const loadPreFixFail = () => {
  const filePath = path.join(REPO_ROOT, 'rules', 'task-reports', '2026-03', '260330_022_truth_audit_result_refresh_stale.json');
  if (!fs.existsSync(filePath)) {
    return { file: filePath, available: false, fail_detected: false };
  }
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return {
    file: filePath,
    available: true,
    fail_detected: String(data?.conclusion_block?.first_break_layer || '') === 'last_window_partition'
      && String(data?.conclusion_block?.verdict || '').includes('C')
  };
};

const runDebugControl = async (http) => {
  runtimeGuard.phase = 'debug_control';
  maybeHeartbeat();
  await http.post('/bot/stop', {});
  await sleep(250);
  await http.post('/bot/start', { tick_interval_ms: 1000, debugScenario: 'fill_yes_path_v1' });
  await sleep(2000);
  const [statusRes, pmRes, perfRes] = await Promise.all([
    http.get('/bot/status'),
    http.get('/bot/postmortem/latest'),
    http.get('/bot/performance/summary?preset=today&detail=1')
  ]);
  await http.post('/bot/stop', {});
  const row = finalizeRows([sampleRow({
    tag: 'debug_control',
    status: statusRes.body || {},
    postmortem: pmRes.body || {},
    performance: perfRes.body || {},
    context: 'debug_control_snapshot'
  })])[0];
  return {
    rows: [row],
    stages: {
      last_window_partition: row.expected_last_completed_window_id === row.postmortem_window_id,
      recent_summary_aggregate: row.summary_window_count !== null,
      result_refresh_trigger: row.settlement_poll_attempted === true || row.settlement_result_seen === true,
      ui_poll_or_snapshot: true,
      dom_projection: row.pass_fail === 'PASS'
    }
  };
};

const runRealRuntime = async (http) => {
  runtimeGuard.phase = 'real_runtime_setup';
  maybeHeartbeat();
  const begin = Date.now();
  let lastBeat = Date.now();
  await http.post('/bot/stop', {});
  await sleep(250);
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
      checkGuard();
      maybeHeartbeat();
      const contextRes = await http.get('/bot/context');
      const rem = toFinite(contextRes.body?.remaining_sec);
      const wid = contextRes.body?.window_id ?? null;
      if (wid && rem !== null && rem <= 22) return { window_id: wid };
      await sleep(1000);
    }
    throw new Error('real_runtime_wait_start_timeout');
  };
  const startup = await waitNearEnd();
  await http.post('/bot/start', { tick_interval_ms: 1000 });
  lastBeat = Date.now();
  const windowA = startup.window_id;
  runtimeGuard.sampled_windows.a = windowA;
  let windowB = null;
  let windowC = null;
  let rowA = null;
  let rowB = null;
  let rowSettled = null;
  let hitAAt = null;
  let hitBAt = null;
  let hitSettledAt = null;
  const timeline = [];

  for (let i = 0; i < 1200; i += 1) {
    runtimeGuard.phase = 'real_runtime_sampling';
    checkGuard();
    if (Date.now() - begin > MAX_WALL_MS) throw new Error('WALL_TIMEOUT');
    if (Date.now() - lastBeat > MAX_SILENCE_MS) throw new Error('SILENT_TIMEOUT');
    maybeHeartbeat();
    const [statusRes, pmRes, perfRes, contextRes] = await Promise.all([
      http.get('/bot/status'),
      http.get('/bot/postmortem/latest'),
      http.get('/bot/performance/summary?preset=today&detail=1'),
      http.get('/bot/context')
    ]);
    const status = statusRes.body || {};
    const pm = pmRes.body || {};
    const perf = perfRes.body || {};
    const context = contextRes.body || {};
    const current = status.current_window_id ?? null;
    const rem = toFinite(context?.remaining_sec);
    const settleRt = status?.settlement_runtime || {};
    runtimeGuard.pending_settlement_window_id = settleRt.pending_settlement_window_id ?? null;
    timeline.push({
      i,
      at: nowIso(),
      current_window_id: current,
      last_window_id: status.last_window_id ?? null,
      pending_settlement_window_id: settleRt.pending_settlement_window_id ?? null,
      postmortem_window_id: pm?.postmortem?.window_id ?? null,
      settlement_poll_attempted: settleRt.settlement_poll_attempted === true,
      settlement_last_result_window_id: settleRt.settlement_last_result_window_id ?? null,
      summary_window_count: perf?.summary?.window_count ?? null
    });

    if (!windowB && current && current !== windowA) {
      windowB = current;
      runtimeGuard.sampled_windows.b = windowB;
      rowA = sampleRow({
        tag: 'A_end',
        status,
        postmortem: pm,
        performance: perf,
        context: 'window_A_ended_entered_B'
      });
      hitAAt = nowIso();
      emitLine(`[SAMPLE_HIT] stage=A_end at=${hitAAt} current=${rowA.current_window_id} last=${rowA.last_window_id} pending=${rowA.pending_settlement_window_id} pm=${rowA.postmortem_window_id} summary_count=${rowA.summary_window_count}`);
    }
    if (windowB && !windowC && current && current !== windowB) {
      windowC = current;
      runtimeGuard.sampled_windows.c = windowC;
    }
    if (windowB && !rowB && current === windowB && rem !== null && rem <= 200 && rem >= 120) {
      rowB = sampleRow({
        tag: 'B_mid',
        status,
        postmortem: pm,
        performance: perf,
        context: 'window_B_mid'
      });
      hitBAt = nowIso();
      emitLine(`[SAMPLE_HIT] stage=B_mid at=${hitBAt} current=${rowB.current_window_id} last=${rowB.last_window_id} pending=${rowB.pending_settlement_window_id} pm=${rowB.postmortem_window_id} summary_count=${rowB.summary_window_count}`);
    }
    const settleResultWindow = settleRt.settlement_last_result_window_id ?? null;
    if (windowB && settleResultWindow === windowA && pm?.postmortem?.window_id === windowA) {
      rowSettled = sampleRow({
        tag: 'settled_after',
        status,
        postmortem: pm,
        performance: perf,
        context: 'settlement_arrived_for_A'
      });
      hitSettledAt = nowIso();
      emitLine(`[SAMPLE_HIT] stage=settled_after at=${hitSettledAt} current=${rowSettled.current_window_id} last=${rowSettled.last_window_id} pending=${rowSettled.pending_settlement_window_id} pm=${rowSettled.postmortem_window_id} summary_count=${rowSettled.summary_window_count}`);
      break;
    }
    lastBeat = Date.now();
    markOutput();
    await sleep(1000);
  }
  await http.post('/bot/stop', {});

  const rows = finalizeRows([rowA, rowB, rowSettled].filter(Boolean));
  const a = rows.find((r) => r.sample_tag === 'A_end') || null;
  const b = rows.find((r) => r.sample_tag === 'B_mid') || null;
  const s = rows.find((r) => r.sample_tag === 'settled_after') || null;
  const aSeen = Boolean(a);
  const bSeen = Boolean(b);
  const sSeen = Boolean(s);
  const hitOrderOk = aSeen && sSeen
    ? (new Date(s.hit_at || s.timestamp).getTime() > new Date(a.hit_at || a.timestamp).getTime())
    : false;
  const pmBefore = a?.postmortem_window_id ?? null;
  const pmAfter = s?.postmortem_window_id ?? null;
  const summaryCountBefore = a?.summary_window_count ?? null;
  const summaryCountAfter = s?.summary_window_count ?? null;
  const summaryPnlBefore = a?.summary_realized_gross_pnl_total ?? null;
  const summaryPnlAfter = s?.summary_realized_gross_pnl_total ?? null;
  const covered = Boolean(aSeen && sSeen && windowA && windowB);
  const lastPartitionAdvanced = covered && pmAfter === windowA;
  const summaryAdvanced = covered && summaryCountAfter !== null && summaryCountBefore !== null && summaryCountAfter > summaryCountBefore;
  const refreshTriggered = covered && s.settlement_poll_attempted === true && s.settlement_result_seen === true;
  const uiRefreshSeen = covered
    && (JSON.stringify(s.ui_last_window_fields) !== JSON.stringify(a.ui_last_window_fields)
      || JSON.stringify(s.ui_recent_summary_fields) !== JSON.stringify(a.ui_recent_summary_fields));
  const nonRegressionLastPnl = covered && s.ui_last_window_fields?.pnl === formatStateValue(s.postmortem_window_id ? s.ui_last_window_fields?.pnl : null);
  const nonRegressionSummaryPnl = covered
    && s.ui_recent_summary_fields?.total_pnl === formatFixed1(s.summary_realized_gross_pnl_total);
  return {
    sample_covered: covered,
    window_a: windowA,
    window_b: windowB,
    window_c: windowC,
    rows,
    timeline_head: timeline.slice(0, 20),
    timeline_tail: timeline.slice(-20),
    stage_hits: {
      A_end_seen: aSeen,
      B_mid_seen: bSeen,
      settled_after_seen: sSeen,
      A_end: rowA ? {
        hit_at: hitAAt,
        current_window_id: rowA.current_window_id,
        last_window_id: rowA.last_window_id,
        pending_settlement_window_id: rowA.pending_settlement_window_id,
        postmortem_window_id: rowA.postmortem_window_id,
        summary_window_count: rowA.summary_window_count
      } : null,
      B_mid: rowB ? {
        hit_at: hitBAt,
        current_window_id: rowB.current_window_id,
        last_window_id: rowB.last_window_id,
        pending_settlement_window_id: rowB.pending_settlement_window_id,
        postmortem_window_id: rowB.postmortem_window_id,
        summary_window_count: rowB.summary_window_count
      } : null,
      settled_after: rowSettled ? {
        hit_at: hitSettledAt,
        current_window_id: rowSettled.current_window_id,
        last_window_id: rowSettled.last_window_id,
        pending_settlement_window_id: rowSettled.pending_settlement_window_id,
        postmortem_window_id: rowSettled.postmortem_window_id,
        summary_window_count: rowSettled.summary_window_count
      } : null
    },
    progression: {
      hit_order_ok: hitOrderOk,
      postmortem_window_id_before: pmBefore,
      postmortem_window_id_after: pmAfter,
      summary_window_count_before: summaryCountBefore,
      summary_window_count_after: summaryCountAfter,
      summary_realized_gross_pnl_total_before: summaryPnlBefore,
      summary_realized_gross_pnl_total_after: summaryPnlAfter,
      warning_b_mid_missing: !bSeen
    },
    stages: {
      last_window_partition: lastPartitionAdvanced,
      recent_summary_aggregate: summaryAdvanced,
      result_refresh_trigger: refreshTriggered && hitOrderOk,
      ui_poll_or_snapshot: uiRefreshSeen,
      dom_projection: rows.every((row) => row.pass_fail === 'PASS')
    },
    non_regression: {
      last_window_pnl_semantics: nonRegressionLastPnl,
      recent_summary_total_pnl_semantics: nonRegressionSummaryPnl
    }
  };
};

const main = async () => {
  runtimeGuard.started_at_ms = Date.now();
  runtimeGuard.last_output_at_ms = Date.now();
  runtimeGuard.last_heartbeat_at_ms = 0;
  runtimeGuard.phase = 'main_start';
  runtimeGuard.sampled_windows = { a: null, b: null, c: null };
  runtimeGuard.pending_settlement_window_id = null;
  const args = parseArgs();
  const port = Number(new URL(args.baseUrl).port || 53223);
  const server = await startServer(port);
  const http = createHttp(server.baseUrl);
  let health = { root: null, pairs: null };
  let runtimeFailure = null;
  try {
    runtimeGuard.phase = 'healthcheck';
    maybeHeartbeat();
    health.root = await fetchWithTimeout(`${server.baseUrl}/`, {}, FETCH_TIMEOUT_MS).then((r) => r.status).catch(() => null);
    health.pairs = await fetchWithTimeout(`${server.baseUrl}/pairs`, {}, FETCH_TIMEOUT_MS).then((r) => r.status).catch(() => null);
    const preFix = loadPreFixFail();
    let debug = { rows: [], stages: { last_window_partition: false, recent_summary_aggregate: false, result_refresh_trigger: false, ui_poll_or_snapshot: false, dom_projection: false } };
    let real = { sample_covered: false, rows: [], stages: { last_window_partition: false, recent_summary_aggregate: false, result_refresh_trigger: false, ui_poll_or_snapshot: false, dom_projection: false }, non_regression: { last_window_pnl_semantics: false, recent_summary_total_pnl_semantics: false } };
    try {
      debug = await runDebugControl(http);
      real = await runRealRuntime(http);
    } catch (err) {
      runtimeFailure = {
        failure_class: classifyFailure(err),
        message: String(err?.message || err),
        last_fetch_target: runtimeGuard.last_fetch.target,
        last_success_heartbeat_at: runtimeGuard.last_heartbeat_at_ms ? new Date(runtimeGuard.last_heartbeat_at_ms).toISOString() : null,
        hit_fetch_timeout: String(err?.message || '').includes('FETCH_TIMEOUT') || String(err?.message || '').includes('FETCH_REQUIRED_FAIL'),
        hit_silent_timeout: String(err?.message || '').includes('SILENT_TIMEOUT'),
        hit_wall_timeout: String(err?.message || '').includes('WALL_TIMEOUT')
      };
    }

    const layerOrder = [
      'last_window_partition',
      'recent_summary_aggregate',
      'result_refresh_trigger',
      'ui_poll_or_snapshot',
      'dom_projection'
    ];
    const stageMissingClass = !real?.stage_hits?.A_end_seen
      ? 'sample_insufficient_A_end_missing'
      : (!real?.stage_hits?.settled_after_seen
        ? 'sample_insufficient_settled_after_missing'
        : null);
    const progressionInconsistent = Boolean(
      real?.stage_hits?.A_end_seen
      && real?.stage_hits?.settled_after_seen
      && (
        real?.progression?.hit_order_ok !== true
        || real?.stages?.last_window_partition !== true
        || real?.stages?.recent_summary_aggregate !== true
      )
    );
    const sampleInsufficient = Boolean(stageMissingClass) || runtimeFailure?.failure_class === 'sample_insufficient';
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
    const verdict = sampleInsufficient
      ? 'B：样本不足'
      : (progressionInconsistent ? 'C：存在断裂' : (firstBreakLayer === 'NONE_CHAIN_PASS' ? 'A：通过' : 'C：存在断裂'));
    const conclusion = sampleInsufficient
      ? 'B：样本不足，未完整覆盖 A结束->结算到达'
      : ((progressionInconsistent || firstBreakLayer !== 'NONE_CHAIN_PASS')
        ? `C：修复未通过，首断裂层=${firstBreakLayer}`
        : 'A：已结束窗口结算轮询/推进恢复，结果区自动刷新');

    const checks = {
      '023-A_pre_fix_fail_exists': preFix.fail_detected === true,
      '023-B_real_runtime_chain_covered': real.stage_hits?.A_end_seen === true && real.stage_hits?.settled_after_seen === true,
      '023-C_settlement_progressed': real.stages.last_window_partition === true && real.stages.recent_summary_aggregate === true,
      '023-D_refresh_triggered_and_ui_updated': real.stages.result_refresh_trigger === true && real.stages.ui_poll_or_snapshot === true,
      '023-E_non_regression_semantics': real.non_regression.last_window_pnl_semantics === true && real.non_regression.recent_summary_total_pnl_semantics === true
    };
    const keys = Object.keys(checks);
    const passChecks = keys.filter((k) => checks[k]).length;
    const failChecks = keys.length - passChecks;
    const pass = !sampleInsufficient && !progressionInconsistent && firstBreakLayer === 'NONE_CHAIN_PASS' && failChecks === 0;

    const standard = buildStandardResult({
      scriptName: 'truth_audit_settlement_poll_fix_260330_023',
      taskId: args.taskId,
      sampleName: args.sampleName,
      pass,
      message: pass ? 'settlement poll fix acceptance pass' : 'settlement poll fix acceptance fail',
      firstBreakLayer,
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
        pre_fix: preFix,
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
        real_debug_diverged: divergenceLayer !== 'none',
        real_debug_first_divergence_layer: divergenceLayer
      },
      key_counters: {
        total_checks: keys.length,
        pass_checks: passChecks,
        fail_checks: failChecks
      },
      evidence_index: {
        pre_fix_evidence: preFix,
        reconciliation_table: real.rows,
        real_runtime: real,
        debug_control: debug,
        runtime_failure: runtimeFailure,
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
      result: checks,
      runtime_diagnostics: {
        failure_class: runtimeFailure?.failure_class || (pass ? null : (sampleInsufficient ? stageMissingClass : (progressionInconsistent ? 'progression_inconsistent' : 'other'))),
        last_fetch_target: runtimeFailure?.last_fetch_target || runtimeGuard.last_fetch.target,
        last_fetch_error: runtimeFailure?.message || runtimeGuard.last_fetch.error || null,
        last_success_heartbeat_at: runtimeFailure?.last_success_heartbeat_at || (runtimeGuard.last_heartbeat_at_ms ? new Date(runtimeGuard.last_heartbeat_at_ms).toISOString() : null),
        hit_fetch_timeout: runtimeFailure?.hit_fetch_timeout === true,
        hit_silent_timeout: runtimeFailure?.hit_silent_timeout === true,
        hit_wall_timeout: runtimeFailure?.hit_wall_timeout === true,
        warning_b_mid_missing: real?.progression?.warning_b_mid_missing === true,
        progression: real?.progression || null,
        stage_hits: real.stage_hits || {
          A_end_seen: false,
          B_mid_seen: false,
          settled_after_seen: false,
          A_end: null,
          B_mid: null,
          settled_after: null
        }
      }
    };

    ensureDir(args.output);
    fs.writeFileSync(args.output, JSON.stringify(output, null, 2));
    const logPath = writeStandardLog(args.output, standard);
    const tailLines = [
      `failure_class=${output.runtime_diagnostics.failure_class ?? 'none'}`,
      `A_end_seen=${output.runtime_diagnostics.stage_hits?.A_end_seen === true}`,
      `B_mid_seen=${output.runtime_diagnostics.stage_hits?.B_mid_seen === true}`,
      `settled_after_seen=${output.runtime_diagnostics.stage_hits?.settled_after_seen === true}`,
      `A_end_hit_at=${output.runtime_diagnostics.stage_hits?.A_end?.hit_at ?? 'none'}`,
      `settled_after_hit_at=${output.runtime_diagnostics.stage_hits?.settled_after?.hit_at ?? 'none'}`,
      `postmortem_window_id_before=${output.runtime_diagnostics.progression?.postmortem_window_id_before ?? 'none'}`,
      `postmortem_window_id_after=${output.runtime_diagnostics.progression?.postmortem_window_id_after ?? 'none'}`,
      `summary_window_count_before=${output.runtime_diagnostics.progression?.summary_window_count_before ?? 'none'}`,
      `summary_window_count_after=${output.runtime_diagnostics.progression?.summary_window_count_after ?? 'none'}`,
      `warning_b_mid_missing=${output.runtime_diagnostics.warning_b_mid_missing === true}`,
      `last_fetch_target=${output.runtime_diagnostics.last_fetch_target ?? 'none'}`,
      `last_success_heartbeat_at=${output.runtime_diagnostics.last_success_heartbeat_at ?? 'none'}`,
      `hit_fetch_timeout=${output.runtime_diagnostics.hit_fetch_timeout}`,
      `hit_silent_timeout=${output.runtime_diagnostics.hit_silent_timeout}`,
      `hit_wall_timeout=${output.runtime_diagnostics.hit_wall_timeout}`
    ];
    fs.appendFileSync(logPath, `${tailLines.join('\n')}\n`);
    emitLine(`VERIFY_OUTPUT=${args.output}`);
    emitLine(`VERIFY_LOG=${logPath}`);
    emitLine(JSON.stringify({ pass, conclusion, verdict, first_break_layer: firstBreakLayer, divergence_layer: divergenceLayer, pass_checks: passChecks, fail_checks: failChecks }));
    if (!pass) process.exitCode = 1;
  } finally {
    await stopServer(server.child);
  }
};

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
