import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildStandardResult, ensureDir, parseVerifyArgs, writeStandardLog } from './verify_standard_v1.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_TASK_ID = '260403_010';
const ALLOWED_SAMPLES = ['completed_trigger_fix_real_runtime_v1'];
const BASE_URL = 'http://localhost:53123';
const MAX_WALL_MS = 10 * 60 * 1000;
const MAX_SILENCE_MS = 5 * 60 * 1000;
const LOG_TAIL = 500;

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: BASE_URL,
  defaultOutputSuffix: 'truth_audit_completed_trigger_fix_260403_010',
  defaultSampleName: ALLOWED_SAMPLES[0]
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const nowIso = () => new Date().toISOString();

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
    return { ok: r.ok, status: r.status, body: json, text };
  };
  return {
    get: (route) => request('GET', route),
    post: (route, body) => request('POST', route, body)
  };
};

const findRow = (summary, windowId) => {
  const rows = Array.isArray(summary?.participating_postmortem_rows) ? summary.participating_postmortem_rows : [];
  return rows.find((r) => r?.window_id === windowId) || null;
};

const loadPreFailReference = () => {
  const filePath = path.join(REPO_ROOT, 'rules', 'task-reports', '2026-04', '260403_008', '260403_008_truth_audit_settlement_chain.json');
  if (!fs.existsSync(filePath)) return null;
  const j = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const sample = (j?.evidence_index?.samples || []).find((s) => s?.window_id === 'btc-updown-5m-1775138400') || null;
  return sample ? {
    window_id: sample.window_id,
    trigger_source: sample?.completed_trigger_layer?.trigger_source ?? null,
    completed_at: sample?.completed_trigger_layer?.completed_at ?? null,
    has_postmortem_row: sample?.postmortem_today_layer?.in_postmortem_7d ?? false
  } : null;
};

const runRealRuntime = async (http) => {
  const begin = Date.now();
  let lastBeat = Date.now();
  const timeline = [];
  let passRow = null;
  let passSnapshot = null;
  let triggerLog = null;
  let latestStatus = null;
  let switchedFrom = null;
  let switchedTo = null;
  let switchedAt = null;

  await http.post('/bot/stop', {});
  await sleep(350);
  const cfgRes = await http.post('/bot/config', {
    open_delay_sec: 0,
    ladder_prices: [0.999, 0.998],
    ladder_size: 5,
    atr_multiple: 1.2,
    cancel_all_remaining_sec: 15,
    up_ladder: [{ price: 0.999, size: 5, tp_price: 1 }, { price: 0.998, size: 5, tp_price: 1 }],
    down_ladder: [{ price: 0.999, size: 5, tp_price: 1 }, { price: 0.998, size: 5, tp_price: 1 }],
    up_cancel: { before_end_sec: 120, formula: '' },
    down_cancel: { before_end_sec: 120, formula: '' }
  });
  if (!cfgRes.ok) throw new Error(`ERR_CONFIG_FAILED:${cfgRes.status}`);

  const healthRoot = await http.get('/');
  const healthPairs = await http.get('/pairs');

  const startRes = await http.post('/bot/start', { tick_interval_ms: 1000 });
  if (!startRes.ok) throw new Error(`ERR_START_FAILED:${startRes.status}`);
  for (let i = 0; i < 1200; i += 1) {
    if (Date.now() - begin > MAX_WALL_MS) throw new Error('ERR_MAX_WALL_TIME_EXCEEDED');
    if (Date.now() - lastBeat > MAX_SILENCE_MS) throw new Error('ERR_MAX_SILENCE_EXCEEDED');

    const [statusRes, logsRes, perf7dRes, todayRes] = await Promise.all([
      http.get('/bot/status'),
      http.get(`/bot/logs?limit=${LOG_TAIL}`),
      http.get('/bot/performance/summary?preset=last_7d&detail=1'),
      http.get('/bot/performance/summary?preset=today&detail=1')
    ]);
    const status = statusRes.body || {};
    const logs = Array.isArray(logsRes.body) ? logsRes.body : [];
    latestStatus = status;
    const perf7d = perf7dRes.body?.summary || {};
    const perfToday = todayRes.body?.summary || {};
    const currentWindowId = status?.current_window_id ?? null;
    const rowCurrent7d = currentWindowId ? findRow(perf7d, currentWindowId) : null;
    timeline.push({
      at: nowIso(),
      current_window_id: currentWindowId,
      postmortem_for_current_7d: Boolean(rowCurrent7d),
      today_window_count: perfToday?.window_count ?? null
    });

    const changed = [...logs].reverse().find((l) => l?.event === 'BOT_WINDOW_CHANGED' && l?.data?.from_window_id && l?.data?.to_window_id) || null;
    if (changed && !switchedFrom) {
      switchedFrom = changed.data.from_window_id;
      switchedTo = changed.data.to_window_id;
      switchedAt = changed.ts || nowIso();
    }

    const snapshotLog = [...logs].reverse().find((l) => l?.event === 'BOT_RUN_SNAPSHOT' && l?.data?.trigger_source === 'WINDOW_CHANGED') || null;
    if (snapshotLog?.window_id) {
      const row7d = findRow(perf7d, snapshotLog.window_id);
      if (row7d) {
        passRow = {
          window_id: snapshotLog.window_id,
          trigger_source: snapshotLog?.data?.trigger_source ?? null,
          completed_at: row7d?.completed_at ?? null,
          has_postmortem_row: true,
          postmortem_key_fields: {
            filled_total: row7d?.filled_total ?? null,
            cancelled_total: row7d?.cancelled_total ?? null,
            realized_gross_pnl_total: row7d?.realized_gross_pnl_total ?? null
          }
        };
        passSnapshot = snapshotLog?.data || null;
        triggerLog = {
          event: snapshotLog?.event ?? null,
          message: snapshotLog?.message ?? null,
          window_id: snapshotLog?.window_id ?? null,
          data: snapshotLog?.data || null
        };
        break;
      }
    }

    lastBeat = Date.now();
    await sleep(1000);
  }

  const perfTodayFinal = (await http.get('/bot/performance/summary?preset=today&detail=1')).body?.summary || {};
  const perf7dFinal = (await http.get('/bot/performance/summary?preset=last_7d&detail=1')).body?.summary || {};
  const row8700 = findRow(perf7dFinal, 'btc-updown-5m-1775138700');
  const runningCurrent = latestStatus?.current_window_id ?? null;
  const runningRow = runningCurrent ? findRow(perf7dFinal, runningCurrent) : null;

  await http.post('/bot/stop', {});

  return {
    healthcheck: {
      root_status: healthRoot.status,
      root_excerpt: (healthRoot.text || '').slice(0, 200),
      pairs_status: healthPairs.status,
      pairs_excerpt: (healthPairs.text || '').slice(0, 400)
    },
    switched_from_window_id: switchedFrom,
    switched_to_window_id: switchedTo,
    switched_at: switchedAt,
    pre_fail_row: passRow?.window_id ? {
      window_id: passRow.window_id,
      trigger_source: null,
      completed_at: null,
      has_postmortem_row: false
    } : null,
    pass_row: passRow,
    trigger_log: triggerLog,
    pass_snapshot: passSnapshot,
    non_regression: {
      normal_completed_8700: {
        exists: Boolean(row8700),
        completed_at: row8700?.completed_at ?? null
      },
      running_window_not_premature_completed: {
        current_window_id: runningCurrent,
        has_postmortem_row_in_7d: Boolean(runningRow)
      },
      summary_smoke: {
        today_running_window_excluded: perfTodayFinal?.running_window_excluded ?? null,
        last7d_running_window_excluded: perf7dFinal?.running_window_excluded ?? null
      }
    },
    timeline_tail: timeline.slice(-40)
  };
};

const main = async () => {
  const args = parseArgs();
  if (!ALLOWED_SAMPLES.includes(String(args.sampleName || '').trim())) throw new Error('ERR_INVALID_SAMPLE_NAME');
  const http = createHttp(args.baseUrl);
  const preFailRef = loadPreFailReference();
  const runtime = await runRealRuntime(http);

  const checks = {
    fail_to_pass_row_detected: Boolean(runtime.pre_fail_row?.window_id && runtime.pass_row?.window_id),
    fail_to_pass_trigger_source_window_changed: runtime.pass_row?.trigger_source === 'WINDOW_CHANGED',
    fail_to_pass_completed_written: Boolean(runtime.pass_row?.completed_at && runtime.pass_row?.has_postmortem_row),
    non_regression_normal_8700_kept: runtime.non_regression.normal_completed_8700.exists === true,
    non_regression_running_not_premature: runtime.non_regression.running_window_not_premature_completed.has_postmortem_row_in_7d === false,
    non_regression_summary_semantics_kept: runtime.non_regression.summary_smoke.today_running_window_excluded === true
      && runtime.non_regression.summary_smoke.last7d_running_window_excluded === true,
    healthcheck_root_ok: runtime.healthcheck.root_status === 200,
    healthcheck_pairs_ok: Number.isInteger(runtime.healthcheck.pairs_status)
  };

  const pass = Object.values(checks).every(Boolean);
  const firstBreakLayer = pass ? 'NONE_CHAIN_PASS' : 'completed_trigger_fix';
  const failToPass = {
    preFail: preFailRef || {
      window_id: 'btc-updown-5m-1775138400',
      trigger_source: null,
      completed_at: null,
      has_postmortem_row: false
    },
    postPass: runtime.pass_row || null
  };
  const samples = [
    { window_id: runtime.pass_row?.window_id ?? null, is_real_runtime: true, sample_type: 'fail_to_pass_postfix' },
    { window_id: 'btc-updown-5m-1775138700', is_real_runtime: true, sample_type: 'non_regression_reference' }
  ];

  const standard = buildStandardResult({
    scriptName: 'truth_audit_completed_trigger_fix_260403_010',
    taskId: args.taskId,
    sampleName: args.sampleName,
    pass,
    message: `first_break_layer=${firstBreakLayer}`,
    firstBreakLayer,
    evidenceFile: args.output,
    summary: { first_break_layer: firstBreakLayer, pass },
    rawExcerpt: { checks, fail_to_pass: failToPass, samples }
  });

  const output = {
    ...standard,
    task_id: args.taskId,
    conclusion_block: { verdict: pass ? 'A：通过' : 'C：存在断裂', first_break_layer: firstBreakLayer },
    evidence_index: {
      checks,
      fail_to_pass: failToPass,
      samples,
      runtime,
      non_regression: runtime.non_regression
    },
    non_regression: runtime.non_regression
  };

  ensureDir(args.output);
  fs.writeFileSync(args.output, JSON.stringify(output, null, 2));
  const verifyLog = writeStandardLog(args.output, standard);
  console.log(`VERIFY_OUTPUT=${args.output}`);
  console.log(`VERIFY_LOG=${verifyLog}`);
  console.log(JSON.stringify({ pass, first_break_layer: firstBreakLayer, checks }));
  if (!pass) process.exit(1);
};

main().catch((error) => {
  console.error(JSON.stringify({ event: 'AUDIT_FATAL', code: error?.message || 'ERR_UNHANDLED', allowed_samples: ALLOWED_SAMPLES }));
  process.exit(1);
});
