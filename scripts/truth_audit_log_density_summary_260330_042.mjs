import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { buildStandardResult, ensureDir, parseVerifyArgs, writeStandardLog } from './verify_standard_v1.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_TASK_ID = '260330_042';
const MAX_WALL_MS = 15 * 60 * 1000;
const MAX_SILENCE_MS = 120 * 1000;
const LOG_TAIL = 100;
const HEARTBEAT_MS = 25 * 1000;
const SUMMARY_PERIOD_MS = 5000;
const ALLOWED_SAMPLES = ['log_density_summary_v1'];
const LOW_EVENTS = ['RUNNER_TICK', 'BOT_TICK_OK', 'BOT_DECISION_GATED'];
const KEY_EVENTS = ['BOT_INTENTS', 'BOT_FILL', 'BOT_WINDOW_CHANGED'];

let heartbeatLogPath = null;
let lastHeartbeat = null;

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: 'http://localhost:53242',
  defaultOutputSuffix: 'truth_audit_log_density_summary_260330_042',
  defaultSampleName: ALLOWED_SAMPLES[0]
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const nowIso = () => new Date().toISOString();
const toJson = async (res) => { try { return await res.json(); } catch { return null; } };

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

const parseExtraArgs = () => {
  const raw = process.argv.slice(2);
  const out = {};
  for (const item of raw) {
    if (!item.startsWith('--')) continue;
    const [k, v] = item.slice(2).split('=');
    if (!k) continue;
    out[k] = v == null ? true : v;
  }
  return {
    mode: String(out.mode || 'after'),
    baselineFile: typeof out.baseline_file === 'string' ? out.baseline_file : null
  };
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

const parseIsoMs = (v) => {
  const t = Date.parse(String(v || ''));
  return Number.isFinite(t) ? t : null;
};

const runScenario = async (http) => {
  await http.post('/bot/stop', {});
  await sleep(250);
  await http.post('/bot/config', {
    open_delay_sec: 0,
    ladder_prices: [0.31, 0.32],
    ladder_size: 4,
    atr_multiple: 1.2,
    cancel_all_remaining_sec: 80,
    up_ladder: [{ price: 0.31, size: 4, tp_price: 0.71 }, { price: 0.32, size: 4, tp_price: 0.72 }],
    down_ladder: [{ price: 0.33, size: 4, tp_price: 0.73 }, { price: 0.34, size: 4, tp_price: 0.74 }],
    up_cancel: { before_end_sec: 100, formula: '' },
    down_cancel: { before_end_sec: 100, formula: '' }
  });
  const startAt = Date.now();
  const startRes = await http.post('/bot/start', { tick_interval_ms: 1000, debugScenario: 'main_path_v1' });
  if (startRes?.status !== 200) throw new Error('ERR_START_FAILED');
  for (let i = 0; i < 20; i += 1) {
    const w = `audit-042-${i}`;
    await http.post('/bot/runner/tick', {
      state_override: {
        current_window_id: w,
        window_initialized_at: new Date(Date.now() - 5000).toISOString(),
        ladder_posted: false,
        yes_order_ids: [],
        no_order_ids: [],
        yes_cancelled: false,
        no_cancelled: false,
        up_formula_cancelled: false,
        down_formula_cancelled: false,
        anchor_btc: 65000,
        atr_5m: 100,
        upper_bound: 70000,
        lower_bound: 60000
      },
      context_override: {
        window_id: w,
        period: '5m',
        remaining_sec: 240,
        btc_price: 65000,
        atr_5m: 100,
        bid_yes: 0.11,
        ask_yes: 0.12,
        bid_no: 0.11,
        ask_no: 0.12,
        upper_bound: 70000,
        lower_bound: 60000
      }
    });
    await sleep(120);
  }
  await sleep(1200);
  await http.post('/bot/stop', {});
  await sleep(250);
  const logsRes = await http.get('/bot/logs?limit=20000');
  return (Array.isArray(logsRes?.body) ? logsRes.body : []).filter((row) => {
    const t = parseIsoMs(row?.ts || row?.time || row?.timestamp);
    return t == null || t >= startAt;
  });
};

const summarizeLogs = (logs = []) => {
  const byEvent = {};
  let placeLadderCount = 0;
  let cancelOpenCount = 0;
  let orderStateChangeCount = 0;
  for (const row of logs) {
    const evt = row?.event || 'UNKNOWN';
    byEvent[evt] = (byEvent[evt] || 0) + 1;
    const msg = String(row?.message || '');
    if (msg.includes('PLACE_LADDER')) placeLadderCount += 1;
    if (msg.includes('CANCEL_OPEN')) cancelOpenCount += 1;
    if (msg.includes('ORDER_STATUS') || msg.includes('filled') || msg.includes('cancelled')) orderStateChangeCount += 1;
  }
  const tsValues = logs.map((row) => parseIsoMs(row?.ts || row?.time || row?.timestamp)).filter((v) => Number.isFinite(v));
  const minTs = tsValues.length > 0 ? Math.min(...tsValues) : null;
  const maxTs = tsValues.length > 0 ? Math.max(...tsValues) : null;
  const durationSec = minTs != null && maxTs != null ? Math.max(1, Math.round((maxTs - minTs) / 1000)) : 1;
  const densityPerSec = Number((logs.length / durationSec).toFixed(3));
  const lowRaw = LOW_EVENTS.reduce((acc, evt) => acc + (byEvent[evt] || 0), 0);
  const summaryCount = byEvent.BOT_TICK_SUMMARY || 0;
  const summaryTs = logs.filter((r) => r?.event === 'BOT_TICK_SUMMARY').map((r) => parseIsoMs(r?.ts)).filter((v) => Number.isFinite(v));
  const summaryIntervals = [];
  for (let i = 1; i < summaryTs.length; i += 1) {
    summaryIntervals.push(summaryTs[i] - summaryTs[i - 1]);
  }
  const avgSummaryIntervalMs = summaryIntervals.length > 0
    ? Math.round(summaryIntervals.reduce((a, b) => a + b, 0) / summaryIntervals.length)
    : null;
  const lowStreamDensityPerSec = Number((((lowRaw + summaryCount) / durationSec)).toFixed(3));
  return {
    total_logs: logs.length,
    duration_sec: durationSec,
    density_per_sec: densityPerSec,
    low_value_raw_total: lowRaw,
    low_value_raw_by_event: LOW_EVENTS.map((evt) => ({ event: evt, count: byEvent[evt] || 0 })),
    summary_event_count: summaryCount,
    summary_avg_interval_ms: avgSummaryIntervalMs,
    low_stream_density_per_sec: lowStreamDensityPerSec,
    key_event_counts: Object.fromEntries(KEY_EVENTS.map((evt) => [evt, byEvent[evt] || 0])),
    place_ladder_count: placeLadderCount,
    cancel_open_count: cancelOpenCount,
    order_state_change_count: orderStateChangeCount,
    by_event_top: Object.entries(byEvent).sort((a, b) => b[1] - a[1]).slice(0, 30).map(([event, count]) => ({ event, count }))
  };
};

const main = async () => {
  const args = parseArgs();
  const extra = parseExtraArgs();
  const sampleName = ensureSampleAllowed(args.sampleName);
  heartbeatLogPath = String(args.output || '').replace(/\.json$/i, '.heartbeat.log');
  ensureDir(heartbeatLogPath);
  fs.writeFileSync(heartbeatLogPath, '', 'utf8');

  const port = Number(new URL(args.baseUrl).port || 53242);
  const begin = Date.now();
  let lastHeartbeatAt = 0;
  let lastBeatAt = Date.now();
  const server = await startServer(port);
  const http = createHttp(server.baseUrl);
  let health = { root: null, pairs: null };
  try {
    health.root = await fetch(`${server.baseUrl}/`).then((res) => res.status).catch(() => null);
    health.pairs = await fetch(`${server.baseUrl}/pairs`).then((res) => res.status).catch(() => null);
    const logs = await runScenario(http);
    if (Date.now() - lastHeartbeatAt >= HEARTBEAT_MS) {
      lastHeartbeatAt = Date.now();
      emit('HEARTBEAT', { stage: 'scenario_done', sampled_logs: logs.length });
    }
    if (Date.now() - begin > MAX_WALL_MS) throw new Error('ERR_MAX_WALL_TIME_EXCEEDED');
    if (Date.now() - lastBeatAt > MAX_SILENCE_MS) throw new Error('ERR_MAX_SILENCE_EXCEEDED');
    lastBeatAt = Date.now();

    const currentSummary = summarizeLogs(logs);
    const baseline = extra.baselineFile ? (() => {
      try { return JSON.parse(fs.readFileSync(extra.baselineFile, 'utf8')); } catch { return null; }
    })() : null;
    const baselineSummary = baseline?.evidence_index?.current_summary || baseline?.current_summary || null;

    let compare = null;
    let pass = true;
    if (baselineSummary) {
      const baselineLowStreamDensity = Number(
        baselineSummary.low_stream_density_per_sec
        ?? (((baselineSummary.low_value_raw_total || 0) + (baselineSummary.summary_event_count || 0)) / Math.max(1, baselineSummary.duration_sec || 1))
      );
      compare = {
        density_before: baselineSummary.density_per_sec ?? null,
        density_after: currentSummary.density_per_sec,
        density_delta: Number(((currentSummary.density_per_sec || 0) - (baselineSummary.density_per_sec || 0)).toFixed(3)),
        low_stream_density_before: baselineLowStreamDensity,
        low_stream_density_after: currentSummary.low_stream_density_per_sec,
        total_before: baselineSummary.total_logs ?? null,
        total_after: currentSummary.total_logs,
        low_raw_before: baselineSummary.low_value_raw_total ?? null,
        low_raw_after: currentSummary.low_value_raw_total,
        summary_count_after: currentSummary.summary_event_count,
        summary_avg_interval_ms_after: currentSummary.summary_avg_interval_ms
      };
      const densityReduced = (currentSummary.low_stream_density_per_sec || 0) <= (baselineLowStreamDensity * 0.35);
      const lowRawReduced = (currentSummary.low_value_raw_total || 0) < (baselineSummary.low_value_raw_total || 999);
      const summaryActive = (currentSummary.summary_event_count || 0) > 0
        && (currentSummary.summary_avg_interval_ms == null || currentSummary.summary_avg_interval_ms >= 4500);
      const keyRealtimeKept = KEY_EVENTS.every((evt) => {
        const beforeCount = Number((baselineSummary.key_event_counts || {})[evt] || 0);
        const afterCount = Number((currentSummary.key_event_counts || {})[evt] || 0);
        if (beforeCount === 0) return afterCount > 0;
        return afterCount > 0;
      });
      const placeKept = currentSummary.place_ladder_count > 0;
      pass = densityReduced && lowRawReduced && summaryActive && keyRealtimeKept && placeKept;
    }

    const firstBreakLayer = pass ? 'NONE_CHAIN_PASS' : 'log_density_reduction_not_pass';
    const standard = buildStandardResult({
      scriptName: 'truth_audit_log_density_summary_260330_042',
      taskId: args.taskId,
      sampleName,
      pass,
      message: compare ? `low_stream_density_after=${currentSummary.low_stream_density_per_sec}` : 'baseline captured',
      firstBreakLayer,
      evidenceFile: args.output,
      summary: {
        mode: extra.mode,
        pass,
        summary_period_ms: SUMMARY_PERIOD_MS,
        first_break_layer: firstBreakLayer
      },
      rawExcerpt: {
        density_per_sec: currentSummary.density_per_sec,
        low_stream_density_per_sec: currentSummary.low_stream_density_per_sec,
        low_value_raw_total: currentSummary.low_value_raw_total,
        summary_event_count: currentSummary.summary_event_count
      }
    });

    const output = {
      ...standard,
      task_id: args.taskId,
      conclusion_block: {
        verdict: pass ? 'A：通过' : (extra.mode === 'baseline' ? 'B：基线采集完成' : 'C：存在断裂'),
        first_break_layer: firstBreakLayer
      },
      evidence_index: {
        mode: extra.mode,
        baseline_file: extra.baselineFile,
        summary_period_ms: SUMMARY_PERIOD_MS,
        current_summary: currentSummary,
        compare,
        sampled_log_tail: logs.slice(-LOG_TAIL),
        healthcheck: health,
        heartbeat_log: heartbeatLogPath,
        last_heartbeat: lastHeartbeat,
        low_value_events: LOW_EVENTS,
        key_events: KEY_EVENTS,
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
      mode: extra.mode,
      pass,
      summary_period_ms: SUMMARY_PERIOD_MS,
      density_per_sec: currentSummary.density_per_sec,
      low_stream_density_per_sec: currentSummary.low_stream_density_per_sec,
      low_value_raw_total: currentSummary.low_value_raw_total,
      summary_event_count: currentSummary.summary_event_count,
      compare
    }));
    if (!pass && extra.mode !== 'baseline') process.exitCode = 1;
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
