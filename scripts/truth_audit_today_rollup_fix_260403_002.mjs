import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { buildStandardResult, ensureDir, parseVerifyArgs, writeStandardLog } from './verify_standard_v1.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_TASK_ID = '260403_002';
const MAX_WALL_MS = 50 * 60 * 1000;
const MAX_SILENCE_MS = 5 * 60 * 1000;
const LOG_TAIL = 150;
const HEARTBEAT_MS = 25 * 1000;
const ALLOWED_SAMPLES = ['today_rollup_fix_v1'];
const PRE_EVIDENCE_FILE = path.join(REPO_ROOT, 'rules', 'task-reports', '2026-04', '260403_001', '260403_001_truth_audit_pm_stats_chain.json');
const REQUIRED_WINDOWS = ['btc-updown-5m-1775138700', 'btc-updown-5m-1775134200'];

let heartbeatLogPath = null;
let lastHeartbeat = null;

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: 'http://localhost:53248',
  defaultOutputSuffix: 'truth_audit_today_rollup_fix_260403_002',
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

const loadPre = () => {
  const pre = JSON.parse(fs.readFileSync(PRE_EVIDENCE_FILE, 'utf8'));
  const summaryToday = pre?.raw_excerpt?.summary_layer_today || {};
  const summary7d = pre?.raw_excerpt?.summary_layer_last_7d || {};
  const included7d = Array.isArray(summary7d?.included_windows) ? summary7d.included_windows : [];
  return {
    summary_today: {
      window_count: toNum(summaryToday?.window_count),
      filled_total: toNum(summaryToday?.filled_total),
      realized_gross_pnl_total: toNum(summaryToday?.realized_gross_pnl_total),
      included_windows: Array.isArray(summaryToday?.included_windows) ? summaryToday.included_windows : []
    },
    summary_last_7d: {
      window_count: toNum(summary7d?.window_count),
      filled_total: toNum(summary7d?.filled_total),
      realized_gross_pnl_total: toNum(summary7d?.realized_gross_pnl_total),
      included_windows: included7d
    },
    required_windows_in_7d: REQUIRED_WINDOWS.map((w) => included7d.includes(w))
  };
};

const extractRows = (summary) => Array.isArray(summary?.participating_postmortem_rows) ? summary.participating_postmortem_rows : [];

const main = async () => {
  const args = parseArgs();
  const sampleName = ensureSampleAllowed(args.sampleName);
  heartbeatLogPath = String(args.output || '').replace(/\.json$/i, '.heartbeat.log');
  ensureDir(heartbeatLogPath);
  fs.writeFileSync(heartbeatLogPath, '', 'utf8');

  const pre = loadPre();
  const preFail = (
    pre.summary_today.window_count === 0
    && pre.summary_today.filled_total === 0
    && pre.summary_today.realized_gross_pnl_total === 0
    && pre.required_windows_in_7d.every(Boolean)
  );

  const begin = Date.now();
  let lastBeatAt = Date.now();
  let lastHeartbeatAt = 0;

  const port = Number(new URL(args.baseUrl).port || 53248);
  const server = await startServer(port);
  const http = createHttp(server.baseUrl);
  let health = { root: null, pairs: null };
  try {
    health.root = await fetch(`${server.baseUrl}/`).then((res) => res.status).catch(() => null);
    health.pairs = await fetch(`${server.baseUrl}/pairs`).then((res) => res.status).catch(() => null);

    const todayRes = await http.get('/bot/performance/summary?preset=today&detail=1');
    const last7Res = await http.get('/bot/performance/summary?preset=last_7d&detail=1');
    const today = todayRes?.body?.summary || {};
    const last7d = last7Res?.body?.summary || {};
    const todayRows = extractRows(today);
    const last7Rows = extractRows(last7d);

    const todayIncluded = new Set(todayRows.map((r) => r?.window_id).filter(Boolean));
    const last7Included = new Set(last7Rows.map((r) => r?.window_id).filter(Boolean));
    const sampleRows = REQUIRED_WINDOWS.map((window_id) => {
      const row = [...todayRows, ...last7Rows].find((r) => r?.window_id === window_id) || null;
      return {
        window_id,
        completed_at: row?.completed_at || null,
        should_include_today: true,
        pre_today_included: false,
        post_today_included: todayIncluded.has(window_id),
        in_last_7d_after: last7Included.has(window_id)
      };
    });

    const post = {
      today: {
        window_count: toNum(today?.window_count),
        filled_total: toNum(today?.filled_total),
        realized_gross_pnl_total: toNum(today?.realized_gross_pnl_total),
        included_windows: [...todayIncluded]
      },
      last_7d: {
        window_count: toNum(last7d?.window_count),
        filled_total: toNum(last7d?.filled_total),
        realized_gross_pnl_total: toNum(last7d?.realized_gross_pnl_total),
        included_windows: [...last7Included]
      }
    };

    const postPass = (
      sampleRows.every((r) => r.post_today_included)
      && post.today.window_count > 0
      && post.today.realized_gross_pnl_total !== 0
      && sampleRows.every((r) => r.in_last_7d_after)
    );
    const nonRegression = {
      last_7d_not_zeroed: post.last_7d.window_count > 0 && post.last_7d.realized_gross_pnl_total !== 0,
      running_not_mixed: todayRows.every((r) => Boolean(r?.completed_at))
    };
    const pass = preFail && postPass && Object.values(nonRegression).every(Boolean);
    const firstBreakLayer = pass ? 'NONE_CHAIN_PASS' : 'window_rollup_count_basis';

    if (Date.now() - begin > MAX_WALL_MS) throw new Error('ERR_MAX_WALL_TIME_EXCEEDED');
    if (Date.now() - lastBeatAt > MAX_SILENCE_MS) throw new Error('ERR_MAX_SILENCE_EXCEEDED');
    if (Date.now() - lastHeartbeatAt >= HEARTBEAT_MS) {
      lastHeartbeatAt = Date.now();
      emit('HEARTBEAT', { stage: 'audit_done', first_break_layer: firstBreakLayer, preFail, postPass, nonRegression });
    }
    lastBeatAt = Date.now();

    const standard = buildStandardResult({
      scriptName: 'truth_audit_today_rollup_fix_260403_002',
      taskId: args.taskId,
      sampleName,
      pass,
      message: `first_break_layer=${firstBreakLayer}`,
      firstBreakLayer,
      evidenceFile: args.output,
      summary: { first_break_layer: firstBreakLayer, pass },
      rawExcerpt: {
        pre_fail: pre.summary_today,
        post_today: post.today,
        sample_rows: sampleRows
      }
    });

    const output = {
      ...standard,
      task_id: args.taskId,
      conclusion_block: {
        verdict: pass ? 'A：通过' : 'C：存在断裂',
        first_break_layer: firstBreakLayer
      },
      evidence_index: {
        pre,
        post,
        sample_reconcile_rows: sampleRows,
        checks: { preFail, postPass, ...nonRegression },
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
      pass,
      first_break_layer: firstBreakLayer,
      pre_today: pre.summary_today,
      post_today: post.today,
      sample_reconcile_rows: sampleRows,
      non_regression: nonRegression
    }));
    if (!pass) process.exitCode = 1;
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
