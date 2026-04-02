import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { buildStandardResult, ensureDir, parseVerifyArgs, writeStandardLog } from './verify_standard_v1.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_TASK_ID = '260330_044';
const MAX_WALL_MS = 20 * 60 * 1000;
const MAX_SILENCE_MS = 120 * 1000;
const LOG_TAIL = 120;
const HEARTBEAT_MS = 25 * 1000;
const ALLOWED_SAMPLES = ['prev_result_basis_fix_v1'];
const PRE_FAIL_EVIDENCE = path.join(REPO_ROOT, 'rules', 'task-reports', '2026-03', '260330_043_truth_audit_prev_result_summary_basis.json');

let heartbeatLogPath = null;
let lastHeartbeat = null;

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: 'http://localhost:53244',
  defaultOutputSuffix: 'truth_audit_prev_result_basis_fix_260330_044',
  defaultSampleName: ALLOWED_SAMPLES[0]
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const nowIso = () => new Date().toISOString();
const toJson = async (res) => { try { return await res.json(); } catch { return null; } };
const toNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const emit = (event, data = {}) => {
  const row = { ts: nowIso(), event, ...data };
  if (event === 'HEARTBEAT') lastHeartbeat = row;
  if (heartbeatLogPath) {
    ensureDir(heartbeatLogPath);
    fs.appendFileSync(heartbeatLogPath, `${JSON.stringify(row)}\n`, 'utf8');
  }
  console.log(JSON.stringify(row));
};

const ensureSampleAllowed = (sampleName) => {
  const normalized = String(sampleName || '').trim();
  if (ALLOWED_SAMPLES.includes(normalized)) return normalized;
  throw new Error(`ERR_INVALID_SAMPLE_NAME: sample=${normalized || '<empty>'}; allowed=${ALLOWED_SAMPLES.join(',')}`);
};

const createHttp = (baseUrl) => {
  const withRetry = async (fn) => {
    let last = null;
    for (let i = 0; i < 4; i += 1) {
      try { return await fn(); } catch (error) { last = error; await sleep(250); }
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
  emit('HEARTBEAT', { stage: 'start_server_begin', port });
  const child = spawn(process.execPath, ['strategies/crypto_binary/server.mjs', `--port=${port}`], {
    cwd: REPO_ROOT,
    stdio: 'ignore'
  });
  const baseUrl = `http://localhost:${port}`;
  if (!(await waitServerReady(baseUrl))) {
    child.kill();
    throw new Error('ERR_SERVER_START_TIMEOUT');
  }
  emit('HEARTBEAT', { stage: 'start_server_ready', port });
  return { child, baseUrl };
};

const stopServer = async (child) => {
  if (!child || child.killed) return;
  child.kill();
  await sleep(600);
};

const isAnomaly = (row = {}) => (
  toNum(row?.filled_total) === 0
  && toNum(row?.cancelled_total) === 0
  && Math.abs(toNum(row?.realized_gross_pnl_total)) > 0
);

const loadPreFail = () => {
  try {
    const raw = JSON.parse(fs.readFileSync(PRE_FAIL_EVIDENCE, 'utf8'));
    const rows = raw?.evidence_index?.performance_rollup_check?.historical_count_pnl_mismatch_rows || [];
    const first = rows[0] || null;
    const simulatedDom = first ? {
      filled_total: first.filled_total,
      cancelled_total: first.cancelled_total,
      pnl: first.realized_gross_pnl_total,
      dom_raw_text: `已成交总数=${first.filled_total}; 已撤单总数=${first.cancelled_total}; PNL=${first.realized_gross_pnl_total}`
    } : null;
    return {
      source_file: PRE_FAIL_EVIDENCE,
      pre_found_anomaly_rows: rows.length,
      sample_anomaly_row: first,
      simulated_dom_if_hit: simulatedDom,
      pre_fail_condition: Boolean(first && isAnomaly(first))
    };
  } catch {
    return {
      source_file: PRE_FAIL_EVIDENCE,
      pre_found_anomaly_rows: 0,
      sample_anomaly_row: null,
      simulated_dom_if_hit: null,
      pre_fail_condition: false
    };
  }
};

const buildDomProjection = (status, postmortemPayload, perfPayload) => {
  const lastRun = status?.last_run_snapshot || {};
  const postmortem = postmortemPayload?.postmortem || null;
  const perfSummary = perfPayload?.summary || null;
  const prevFilled = postmortem?.filled_total ?? lastRun?.filled_total;
  const prevCancelled = postmortem?.cancelled_total ?? lastRun?.cancelled_total ?? 0;
  const prevPnl = postmortem?.realized_gross_pnl_total ?? lastRun?.realized_gross_pnl_total;
  return {
    previous_result_dom: {
      filled_total: prevFilled,
      cancelled_total: prevCancelled,
      pnl: prevPnl,
      dom_raw_text: `已成交总数=${prevFilled}; 已撤单总数=${prevCancelled}; PNL=${prevPnl}`
    },
    recent_summary_dom: {
      window_count: perfSummary?.window_count ?? 0,
      filled_total: perfSummary?.filled_total ?? 0,
      realized_gross_pnl_total: perfSummary?.realized_gross_pnl_total ?? 0,
      dom_raw_text: `窗口数=${perfSummary?.window_count ?? 0}; 总成交单数=${perfSummary?.filled_total ?? 0}; 总计PNL=${perfSummary?.realized_gross_pnl_total ?? 0}`
    }
  };
};

const runAudit = async (http) => {
  const begin = Date.now();
  let lastBeatAt = Date.now();
  let lastHeartbeatAt = 0;

  const pre = loadPreFail();

  await http.post('/bot/stop', {});
  await sleep(250);
  await http.post('/bot/config', {
    open_delay_sec: 0,
    ladder_prices: [0.61, 0.62],
    ladder_size: 3,
    atr_multiple: 1.2,
    cancel_all_remaining_sec: 80,
    up_ladder: [{ price: 0.61, size: 3, tp_price: 0.81 }, { price: 0.62, size: 3, tp_price: 0.82 }],
    down_ladder: [{ price: 0.63, size: 3, tp_price: 0.83 }, { price: 0.64, size: 3, tp_price: 0.84 }],
    up_cancel: { before_end_sec: 100, formula: '' },
    down_cancel: { before_end_sec: 100, formula: '' }
  });
  await http.post('/bot/start', { tick_interval_ms: 1000, debugScenario: 'fill_yes_path_v1' });
  await sleep(3600);
  await http.post('/bot/stop', {});
  await sleep(250);

  const status = (await http.get('/bot/status'))?.body || {};
  const postmortemPayload = (await http.get('/bot/postmortem/latest'))?.body || {};
  const perfPayload = (await http.get('/bot/performance/summary?detail=1'))?.body || {};
  const logsPayload = (await http.get('/bot/logs?limit=5000'))?.body || [];
  const logs = Array.isArray(logsPayload) ? logsPayload : (Array.isArray(logsPayload?.logs) ? logsPayload.logs : []);

  const postmortem = postmortemPayload?.postmortem || {};
  const perfSummary = perfPayload?.summary || {};
  const perfRows = Array.isArray(perfSummary?.participating_postmortem_rows) ? perfSummary.participating_postmortem_rows : [];
  const normalRowSample = perfRows.find((row) => toNum(row?.filled_total) > 0) || null;
  const perfSum = perfRows.reduce((acc, row) => {
    acc.window_count += 1;
    acc.filled_total += toNum(row?.filled_total);
    acc.realized_gross_pnl_total += toNum(row?.realized_gross_pnl_total);
    return acc;
  }, { window_count: 0, filled_total: 0, realized_gross_pnl_total: 0 });

  const dom = buildDomProjection(status, postmortemPayload, perfPayload);
  const postAnomaly = isAnomaly(postmortem);
  const perfConsistent = (
    perfSum.window_count === toNum(perfSummary?.window_count)
    && Math.abs(perfSum.filled_total - toNum(perfSummary?.filled_total)) < 1e-9
    && Math.abs(perfSum.realized_gross_pnl_total - toNum(perfSummary?.realized_gross_pnl_total)) < 1e-9
  );
  const nonRegressionRecentSummary = perfConsistent;
  const nonRegressionNormalLatest = Boolean(
    normalRowSample
    && toNum(normalRowSample?.filled_total) > 0
    && !(toNum(normalRowSample?.filled_total) === 0 && toNum(normalRowSample?.cancelled_total) === 0 && Math.abs(toNum(normalRowSample?.realized_gross_pnl_total)) > 0)
  );
  const failToPass = pre.pre_fail_condition && !postAnomaly;

  const checks = {
    pre_fail_exists: pre.pre_fail_condition,
    post_latest_not_anomaly: !postAnomaly,
    fail_to_pass_main_proof: failToPass,
    non_regression_recent_summary: nonRegressionRecentSummary,
    non_regression_normal_latest: nonRegressionNormalLatest
  };

  if (Date.now() - begin > MAX_WALL_MS) throw new Error('ERR_MAX_WALL_TIME_EXCEEDED');
  if (Date.now() - lastBeatAt > MAX_SILENCE_MS) throw new Error('ERR_MAX_SILENCE_EXCEEDED');
  if (Date.now() - lastHeartbeatAt >= HEARTBEAT_MS) {
    lastHeartbeatAt = Date.now();
    emit('HEARTBEAT', { stage: 'audit_done', checks });
  }
  lastBeatAt = Date.now();

  const pass = Object.values(checks).every(Boolean);
  return {
    pass,
    first_break_layer: pass ? 'NONE_CHAIN_PASS' : 'pnl_count_basis',
    checks,
    fail_to_pass: {
      pre,
      post: {
        latest_postmortem: {
          window_id: postmortem?.window_id ?? null,
          filled_total: toNum(postmortem?.filled_total),
          cancelled_total: toNum(postmortem?.cancelled_total),
          realized_gross_pnl_total: toNum(postmortem?.realized_gross_pnl_total)
        },
        previous_result_dom: dom.previous_result_dom
      }
    },
    dom_api_reconcile: {
      dom,
      postmortem_latest: postmortemPayload,
      performance_summary_detail: perfPayload
    },
    non_regression: {
      recent_summary_totals: {
        summary: {
          window_count: toNum(perfSummary?.window_count),
          filled_total: toNum(perfSummary?.filled_total),
          realized_gross_pnl_total: toNum(perfSummary?.realized_gross_pnl_total)
        },
        participating_rows_sum: perfSum
      },
      normal_latest_row: dom.previous_result_dom
      ,
      normal_row_sample_from_performance: normalRowSample
    },
    logs_tail: logs.slice(-LOG_TAIL)
  };
};

const main = async () => {
  const args = parseArgs();
  const sampleName = ensureSampleAllowed(args.sampleName);
  heartbeatLogPath = String(args.output || '').replace(/\.json$/i, '.heartbeat.log');
  ensureDir(heartbeatLogPath);
  fs.writeFileSync(heartbeatLogPath, '', 'utf8');

  const port = Number(new URL(args.baseUrl).port || 53244);
  const server = await startServer(port);
  const http = createHttp(server.baseUrl);
  let health = { root: null, pairs: null };
  try {
    health.root = await fetch(`${server.baseUrl}/`).then((res) => res.status).catch(() => null);
    health.pairs = await fetch(`${server.baseUrl}/pairs`).then((res) => res.status).catch(() => null);
    const audit = await runAudit(http);
    const standard = buildStandardResult({
      scriptName: 'truth_audit_prev_result_basis_fix_260330_044',
      taskId: args.taskId,
      sampleName,
      pass: audit.pass,
      message: `first_break_layer=${audit.first_break_layer}`,
      firstBreakLayer: audit.first_break_layer,
      evidenceFile: args.output,
      summary: {
        first_break_layer: audit.first_break_layer,
        pass: audit.pass
      },
      rawExcerpt: {
        pre_fail_exists: audit.checks.pre_fail_exists,
        post_latest_not_anomaly: audit.checks.post_latest_not_anomaly
      }
    });
    const output = {
      ...standard,
      task_id: args.taskId,
      conclusion_block: {
        verdict: audit.pass ? 'A：通过' : 'C：存在断裂',
        first_break_layer: audit.first_break_layer
      },
      evidence_index: {
        checks: audit.checks,
        fail_to_pass: audit.fail_to_pass,
        dom_api_reconcile: audit.dom_api_reconcile,
        non_regression: audit.non_regression,
        logs_tail: audit.logs_tail,
        healthcheck: health,
        heartbeat_log: heartbeatLogPath,
        last_heartbeat: lastHeartbeat,
        guardrails: {
          max_wall_time_ms: MAX_WALL_MS,
          max_silence_ms: MAX_SILENCE_MS,
          log_tail: LOG_TAIL
        }
      }
    };
    ensureDir(args.output);
    fs.writeFileSync(args.output, JSON.stringify(output, null, 2));
    const logPath = writeStandardLog(args.output, standard);
    console.log(`VERIFY_OUTPUT=${args.output}`);
    console.log(`VERIFY_LOG=${logPath}`);
    console.log(JSON.stringify({
      pass: audit.pass,
      first_break_layer: audit.first_break_layer,
      checks: audit.checks,
      healthcheck: health
    }));
    if (!audit.pass) process.exitCode = 1;
  } finally {
    await stopServer(server.child);
  }
};

main().catch((error) => {
  console.error(JSON.stringify({
    event: 'AUDIT_FATAL',
    code: error?.message || 'ERR_UNHANDLED',
    allowed_samples: ALLOWED_SAMPLES
  }));
  process.exit(1);
});
