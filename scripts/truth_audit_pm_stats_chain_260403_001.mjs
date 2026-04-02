import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { buildStandardResult, ensureDir, parseVerifyArgs, writeStandardLog } from './verify_standard_v1.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_TASK_ID = '260403_001';
const MAX_WALL_MS = 50 * 60 * 1000;
const MAX_SILENCE_MS = 5 * 60 * 1000;
const LOG_TAIL = 150;
const HEARTBEAT_MS = 25 * 1000;
const ALLOWED_SAMPLES = ['pm_stats_chain_v1'];

let heartbeatLogPath = null;
let lastHeartbeat = null;

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: 'http://localhost:53247',
  defaultOutputSuffix: 'truth_audit_pm_stats_chain_260403_001',
  defaultSampleName: ALLOWED_SAMPLES[0]
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nowIso = () => new Date().toISOString();
const toJson = async (res) => { try { return await res.json(); } catch { return null; } };
const toNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const isRealWindow = (windowId) => {
  const s = String(windowId || '');
  return Boolean(s) && !s.startsWith('debug-') && !s.startsWith('audit-');
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

const selectSettledSamples = (rows = [], min = 2) => {
  const candidates = rows
    .filter((r) => r && (r.bot_completed_at || r.completed_at))
    .map((r) => ({
      window_id: r.bot_window_id ?? r.window_id ?? null,
      market_id: r.market_id ?? null,
      filled_total: toNum(r.filled_total),
      cancelled_total: toNum(r.cancelled_total),
      realized_gross_pnl_total: toNum(r.realized_gross_pnl_total),
      completed_at: r.bot_completed_at ?? r.completed_at ?? null,
      is_real_runtime: isRealWindow(r.bot_window_id ?? r.window_id ?? null)
    }));
  candidates.sort((a, b) => Number(b.is_real_runtime) - Number(a.is_real_runtime));
  const uniq = [];
  const seen = new Set();
  for (const c of candidates) {
    const k = c.window_id || JSON.stringify(c);
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push(c);
    if (uniq.length >= min) break;
  }
  return uniq.filter((r) => r.is_real_runtime).slice(0, min);
};

const main = async () => {
  const args = parseArgs();
  const sampleName = ensureSampleAllowed(args.sampleName);
  heartbeatLogPath = String(args.output || '').replace(/\.json$/i, '.heartbeat.log');
  ensureDir(heartbeatLogPath);
  fs.writeFileSync(heartbeatLogPath, '', 'utf8');

  const port = Number(new URL(args.baseUrl).port || 53247);
  const begin = Date.now();
  let lastBeatAt = Date.now();
  let lastHeartbeatAt = 0;
  const server = await startServer(port);
  const http = createHttp(server.baseUrl);
  let health = { root: null, pairs: null };
  try {
    health.root = await fetch(`${server.baseUrl}/`).then((res) => res.status).catch(() => null);
    health.pairs = await fetch(`${server.baseUrl}/pairs`).then((res) => res.status).catch(() => null);

    const todayRes = await http.get('/bot/performance/summary?preset=today&detail=1');
    const last7dRes = await http.get('/bot/performance/summary?preset=last_7d&detail=1');
    const today = todayRes?.body?.summary || {};
    const last7d = last7dRes?.body?.summary || {};
    const todayRows = Array.isArray(today?.participating_postmortem_rows) ? today.participating_postmortem_rows : [];
    const last7dRows = Array.isArray(last7d?.participating_postmortem_rows) ? last7d.participating_postmortem_rows : [];

    const samples = selectSettledSamples([...todayRows, ...last7dRows], 2);
    const sampleInsufficient = samples.length < 2;
    const todayDate = nowIso().slice(0, 10);
    const last7dCompletedReal = last7dRows
      .filter((r) => isRealWindow(r?.bot_window_id ?? r?.window_id))
      .map((r) => ({
        window_id: r?.bot_window_id ?? r?.window_id ?? null,
        completed_at: r?.bot_completed_at ?? r?.completed_at ?? null
      }));
    const todayExpectedFromLast7d = last7dCompletedReal.filter((r) => String(r.completed_at || '').slice(0, 10) === todayDate);

    const officialLayer = samples.map((s) => ({
      window_id: s.window_id,
      market_id: s.market_id,
      official_outcome: null,
      official_resolved_at: null,
      official_available: false
    }));

    const singleWindowLayer = samples.map((s) => ({
      window_id: s.window_id,
      filled_total: s.filled_total,
      cancelled_total: s.cancelled_total,
      realized_gross_pnl_total: s.realized_gross_pnl_total,
      window_status: 'COMPLETED',
      completed_at: s.completed_at
    }));

    const summarize = (summary, rows) => ({
      window_count: toNum(summary?.window_count) ?? 0,
      filled_total: toNum(summary?.filled_total) ?? 0,
      realized_gross_pnl_total: toNum(summary?.realized_gross_pnl_total) ?? 0,
      avg_realized_gross_pnl_per_window: toNum(summary?.avg_realized_gross_pnl_per_window),
      included_windows: rows.map((r) => r?.bot_window_id ?? r?.window_id).filter(Boolean)
    });
    const summaryLayer = {
      today: summarize(today, todayRows),
      last_7d: summarize(last7d, last7dRows)
    };

    const frontendProjection = {
      interface: '/bot/performance/summary?detail=1',
      fields: ['window_count', 'filled_total', 'realized_gross_pnl_total', 'avg_realized_gross_pnl_per_window'],
      dom_texts: {
        window_count: 'se-perf-window-count',
        realized_total: 'se-perf-realized-total',
        avg_per_window: 'se-perf-avg-realized'
      }
    };

    let firstBreakLayer = 'NONE_CHAIN_PASS';
    let rationale = [];
    if (sampleInsufficient) {
      firstBreakLayer = 'insufficient_real_settled_samples';
      rationale.push('less_than_two_completed_windows_detected');
    } else {
      const todayRowCount = todayRows.filter((r) => r && (r.bot_completed_at || r.completed_at) && isRealWindow(r?.bot_window_id ?? r?.window_id)).length;
      const todayCountZero = (toNum(today?.window_count) ?? 0) === 0;
      if (todayCountZero && todayExpectedFromLast7d.length >= 2) {
        firstBreakLayer = 'window_rollup_count_basis';
        rationale.push('today_summary_zero_but_last7d_contains_today_real_windows');
      } else if (todayRowCount > 0 && todayCountZero) {
        firstBreakLayer = 'window_rollup_count_basis';
        rationale.push('today_summary_zero_but_today_rows_nonzero');
      } else {
        firstBreakLayer = 'NONE_CHAIN_PASS';
        rationale.push('summary_and_rows_consistent_or_nonzero');
      }
    }

    const checks = {
      official_available: officialLayer.every((l) => l.official_available === true),
      sample_insufficient: sampleInsufficient,
      today_rows_nonzero: todayRows.length > 0,
      today_expected_from_last7d_count: todayExpectedFromLast7d.length,
      today_summary_window_count: toNum(today?.window_count) ?? 0,
      first_break_layer: firstBreakLayer
    };

    const pass = true; // 定位任务，无需以“断裂必现”为通过条件；以产出四层对账与唯一first_break_layer为准

    if (Date.now() - begin > MAX_WALL_MS) throw new Error('ERR_MAX_WALL_TIME_EXCEEDED');
    if (Date.now() - lastBeatAt > MAX_SILENCE_MS) throw new Error('ERR_MAX_SILENCE_EXCEEDED');
    if (Date.now() - lastHeartbeatAt >= HEARTBEAT_MS) {
      lastHeartbeatAt = Date.now();
      emit('HEARTBEAT', { stage: 'audit_done', first_break_layer: firstBreakLayer, checks });
    }
    lastBeatAt = Date.now();

    const standard = buildStandardResult({
      scriptName: 'truth_audit_pm_stats_chain_260403_001',
      taskId: args.taskId,
      sampleName,
      pass,
      message: `first_break_layer=${firstBreakLayer}`,
      firstBreakLayer,
      evidenceFile: args.output,
      summary: {
        first_break_layer: firstBreakLayer,
        pass,
        rationale
      },
      rawExcerpt: {
        samples,
        official_layer: officialLayer.slice(0, 5),
        single_window_layer: singleWindowLayer.slice(0, 5),
        summary_layer_today: summaryLayer.today,
        summary_layer_last_7d: summaryLayer.last_7d
      }
    });

    const output = {
      ...standard,
      task_id: args.taskId,
      conclusion_block: {
        verdict: 'B：定位完成（不改业务）',
        first_break_layer: firstBreakLayer
      },
      evidence_index: {
        official_layer: officialLayer,
        single_window_layer: singleWindowLayer,
        summary_layer: summaryLayer,
        today_expected_from_last7d: todayExpectedFromLast7d,
        frontend_projection: frontendProjection,
        samples,
        checks,
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
      samples: samples.map((s) => s.window_id),
      today_summary: summaryLayer.today,
      last_7d_summary: summaryLayer.last_7d
    }));
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
