import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildStandardResult, ensureDir, parseVerifyArgs, writeStandardLog } from './verify_standard_v1.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_TASK_ID = '260403_011';
const ALLOWED_SAMPLES = ['today_reset_baseline_real_runtime_v1'];
const BASE_URL = 'http://localhost:53131';
const MAX_WALL_MS = 12 * 60 * 1000;

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: BASE_URL,
  defaultOutputSuffix: 'truth_audit_today_reset_baseline_260403_011',
  defaultSampleName: ALLOWED_SAMPLES[0]
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const nowIso = () => new Date().toISOString();
const toNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const createHttp = (baseUrl) => {
  const request = async (method, route, body = undefined) => {
    const r = await fetch(`${baseUrl}${route}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return { ok: r.ok, status: r.status, text, body: json };
  };
  return {
    get: (route) => request('GET', route),
    post: (route, body) => request('POST', route, body)
  };
};

const fetchPerf = async (http, preset) => {
  const res = await http.get(`/bot/performance/summary?preset=${encodeURIComponent(preset)}&detail=1`);
  const summary = res.body?.summary || {};
  return { status: res.status, summary };
};

const metrics = (summary) => ({
  window_count: toNum(summary?.window_count),
  filled_total: toNum(summary?.filled_total),
  realized_gross_pnl_total: toNum(summary?.realized_gross_pnl_total),
  avg_realized_gross_pnl_per_window: toNum(summary?.avg_realized_gross_pnl_per_window)
});

const rowsWindowIds = (summary) => {
  const rows = Array.isArray(summary?.participating_postmortem_rows) ? summary.participating_postmortem_rows : [];
  return rows.map((r) => r?.window_id).filter(Boolean);
};

const ensureTodayNonZero = async (http, deadlineMs) => {
  while (Date.now() < deadlineMs) {
    const t = await fetchPerf(http, 'today');
    if (toNum(t.summary?.window_count) > 0) return t.summary;
    await http.post('/bot/start', { tick_interval_ms: 1000 });
    await sleep(2000);
    const status = (await http.get('/bot/status')).body || {};
    if (status.running !== true) {
      await sleep(1000);
      continue;
    }
    await http.post('/bot/stop', {});
    await sleep(1500);
  }
  throw new Error('ERR_PRE_TODAY_NONZERO_TIMEOUT');
};

const waitRunningWindow = async (http, deadlineMs) => {
  while (Date.now() < deadlineMs) {
    const status = (await http.get('/bot/status')).body || {};
    if (status.running === true && status.current_window_id) return status.current_window_id;
    await sleep(800);
  }
  throw new Error('ERR_RUNNING_WINDOW_TIMEOUT');
};

const waitCompletedInToday = async (http, deadlineMs, baselineTs, targetWindowId) => {
  while (Date.now() < deadlineMs) {
    const today = await fetchPerf(http, 'today');
    const rows = Array.isArray(today.summary?.participating_postmortem_rows) ? today.summary.participating_postmortem_rows : [];
    const row = rows.find((r) => r?.window_id === targetWindowId) || null;
    if (row) {
      const completedTs = Date.parse(row?.completed_at || '');
      if (!Number.isNaN(completedTs) && completedTs >= baselineTs) return row;
    }
    await sleep(1000);
  }
  throw new Error('ERR_POST_RESET_COMPLETED_NOT_FOUND');
};

const main = async () => {
  const args = parseArgs();
  if (!ALLOWED_SAMPLES.includes(String(args.sampleName || '').trim())) throw new Error('ERR_INVALID_SAMPLE_NAME');
  const http = createHttp(args.baseUrl);
  const startedAt = Date.now();
  const deadlineMs = startedAt + MAX_WALL_MS;

  await http.post('/bot/stop', {});

  const healthRoot = await http.get('/');
  const healthPairs = await http.get('/pairs');

  let todayBefore = (await fetchPerf(http, 'today')).summary;
  if (toNum(todayBefore?.window_count) === 0) {
    todayBefore = await ensureTodayNonZero(http, deadlineMs);
  }
  const perf7Before = (await fetchPerf(http, 'last_7d')).summary;
  const perf30Before = (await fetchPerf(http, 'last_30_windows')).summary;
  const historyBefore = {
    last_30_window_ids: rowsWindowIds(perf30Before),
    last_7d_window_count: toNum(perf7Before?.window_count)
  };

  const resetRes = await http.post('/bot/performance/today/reset', {});
  if (!resetRes.ok || resetRes.body?.ok === false) throw new Error(`ERR_RESET_FAILED:${resetRes.status}`);
  const baselineTs = Number(resetRes.body?.today_reset_baseline_ts);
  const baselineAt = resetRes.body?.today_reset_baseline_at || null;
  if (!Number.isFinite(baselineTs)) throw new Error('ERR_BASELINE_MISSING');

  const todayAfterReset = (await fetchPerf(http, 'today')).summary;
  const perf7AfterReset = (await fetchPerf(http, 'last_7d')).summary;
  const perf30AfterReset = (await fetchPerf(http, 'last_30_windows')).summary;
  const historyAfterReset = {
    last_30_window_ids: rowsWindowIds(perf30AfterReset),
    last_7d_window_count: toNum(perf7AfterReset?.window_count)
  };

  await http.post('/bot/start', { tick_interval_ms: 1000 });
  const runningWindowId = await waitRunningWindow(http, deadlineMs);
  const todayWhileRunning = (await fetchPerf(http, 'today')).summary;
  const runningPrematureIncluded = rowsWindowIds(todayWhileRunning).includes(runningWindowId);

  const stopRes = await http.post('/bot/stop', {});
  if (!stopRes.ok || stopRes.body?.ok === false) throw new Error(`ERR_STOP_FAILED:${stopRes.status}`);
  await sleep(1200);

  const completedRow = await waitCompletedInToday(http, deadlineMs, baselineTs, runningWindowId);
  const perf7AfterCompleted = (await fetchPerf(http, 'last_7d')).summary;
  const logRes = await http.get('/bot/logs?limit=200');
  const logs = Array.isArray(logRes.body) ? logRes.body : [];
  const stopSnapshot = [...logs].reverse().find((l) => l?.event === 'BOT_RUN_SNAPSHOT' && l?.window_id === runningWindowId) || null;

  const checks = {
    pre_today_nonzero: toNum(todayBefore?.window_count) > 0,
    reset_today_zero: toNum(todayAfterReset?.window_count) === 0
      && toNum(todayAfterReset?.filled_total) === 0
      && toNum(todayAfterReset?.realized_gross_pnl_total) === 0
      && toNum(todayAfterReset?.avg_realized_gross_pnl_per_window) === 0,
    reset_not_affect_7d: JSON.stringify(metrics(perf7Before)) === JSON.stringify(metrics(perf7AfterReset)),
    reset_not_affect_30: JSON.stringify(metrics(perf30Before)) === JSON.stringify(metrics(perf30AfterReset)),
    postmortem_history_not_deleted: JSON.stringify(historyBefore.last_30_window_ids) === JSON.stringify(historyAfterReset.last_30_window_ids)
      && historyBefore.last_7d_window_count === historyAfterReset.last_7d_window_count,
    running_not_premature_counted: runningPrematureIncluded === false,
    new_completed_after_reset_in_today: Boolean(completedRow?.window_id === runningWindowId),
    stop_semantics_kept: Boolean(stopSnapshot?.data?.stop_reason === 'MANUAL_STOP' && stopSnapshot?.data?.completed_at),
    healthcheck_root_ok: healthRoot.status === 200,
    healthcheck_pairs_reachable: Number.isInteger(healthPairs.status)
  };
  const pass = Object.values(checks).every(Boolean);
  const firstBreakLayer = pass ? 'NONE_CHAIN_PASS' : 'today_reset_baseline_fix';

  const failToPass = {
    preFail: {
      today: metrics(todayBefore),
      today_window_count_nonzero: toNum(todayBefore?.window_count) > 0
    },
    postPass: {
      baseline_at: baselineAt,
      today_after_reset: metrics(todayAfterReset),
      new_completed_window_id: completedRow?.window_id ?? null,
      new_completed_at: completedRow?.completed_at ?? null
    }
  };

  const standard = buildStandardResult({
    scriptName: 'truth_audit_today_reset_baseline_260403_011',
    taskId: args.taskId,
    sampleName: args.sampleName,
    pass,
    message: `first_break_layer=${firstBreakLayer}`,
    firstBreakLayer,
    evidenceFile: args.output,
    summary: { first_break_layer: firstBreakLayer, pass },
    rawExcerpt: { checks, fail_to_pass: failToPass }
  });

  const output = {
    ...standard,
    task_id: args.taskId,
    conclusion_block: { verdict: pass ? 'A：通过' : 'C：存在断裂', first_break_layer: firstBreakLayer },
    evidence_index: {
      checks,
      fail_to_pass: failToPass,
      before_after_table: {
        today_before: metrics(todayBefore),
        today_after_reset: metrics(todayAfterReset),
        last7_before: metrics(perf7Before),
        last7_after_reset: metrics(perf7AfterReset),
        last30_before: metrics(perf30Before),
        last30_after_reset: metrics(perf30AfterReset)
      },
      history_truth_proof: {
        before: historyBefore,
        after_reset: historyAfterReset
      },
      real_runtime_new_completed: {
        window_id: completedRow?.window_id ?? null,
        completed_at: completedRow?.completed_at ?? null,
        baseline_at: baselineAt
      },
      running_guard: {
        running_window_id: runningWindowId,
        included_in_today_while_running: runningPrematureIncluded
      },
      stop_guard: {
        stop_response: stopRes.body || null,
        snapshot_log: stopSnapshot || null
      },
      healthcheck: {
        root_status: healthRoot.status,
        root_excerpt: (healthRoot.text || '').slice(0, 240),
        pairs_status: healthPairs.status,
        pairs_excerpt: (healthPairs.text || '').slice(0, 240)
      },
      completed_row_post_reset: completedRow || null,
      sample_8700_non_regression: (Array.isArray(perf7AfterCompleted?.participating_postmortem_rows)
        ? perf7AfterCompleted.participating_postmortem_rows.find((r) => r?.window_id === 'btc-updown-5m-1775138700') || null
        : null),
      generated_at: nowIso()
    }
  };

  ensureDir(args.output);
  fs.writeFileSync(args.output, JSON.stringify(output, null, 2));
  const logPath = writeStandardLog(args.output, standard);
  console.log(`VERIFY_OUTPUT=${args.output}`);
  console.log(`VERIFY_LOG=${logPath}`);
  console.log(JSON.stringify({ pass, first_break_layer: firstBreakLayer, checks }));
  if (!pass) process.exit(1);
};

main().catch((error) => {
  console.error(JSON.stringify({ event: 'AUDIT_FATAL', code: error?.message || 'ERR_UNHANDLED', allowed_samples: ALLOWED_SAMPLES }));
  process.exit(1);
});
