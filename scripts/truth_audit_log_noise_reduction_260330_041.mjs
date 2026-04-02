import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { buildStandardResult, ensureDir, parseVerifyArgs, writeStandardLog } from './verify_standard_v1.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_TASK_ID = '260330_041';
const MAX_WALL_MS = 15 * 60 * 1000;
const MAX_SILENCE_MS = 120 * 1000;
const LOG_TAIL = 100;
const HEARTBEAT_MS = 25 * 1000;
const ALLOWED_SAMPLES = ['log_noise_reduction_v1'];
const NOISE_EVENTS = ['RUNNER_TICK', 'BOT_TICK_OK', 'BOT_DECISION_GATED'];
const KEY_EVENTS = ['BOT_INTENTS', 'BOT_FILL', 'BOT_WINDOW_CHANGED'];

let heartbeatLogPath = null;
let lastHeartbeat = null;

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: 'http://localhost:53241',
  defaultOutputSuffix: 'truth_audit_log_noise_reduction_260330_041',
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

const summarizeLogs = (logs = []) => {
  const byEvent = {};
  let placeCount = 0;
  let cancelCount = 0;
  for (const row of logs) {
    const evt = row?.event || 'UNKNOWN';
    byEvent[evt] = (byEvent[evt] || 0) + 1;
    const msg = String(row?.message || '');
    if (msg.includes('PLACE_LADDER')) placeCount += 1;
    if (msg.includes('CANCEL_OPEN')) cancelCount += 1;
  }
  const noiseCount = NOISE_EVENTS.reduce((acc, evt) => acc + (byEvent[evt] || 0), 0);
  const keyCounts = Object.fromEntries(KEY_EVENTS.map((evt) => [evt, byEvent[evt] || 0]));
  return {
    total_logs: logs.length,
    noise_events: NOISE_EVENTS.map((evt) => ({ event: evt, count: byEvent[evt] || 0 })),
    noise_total: noiseCount,
    key_event_counts: keyCounts,
    place_ladder_count: placeCount,
    cancel_open_count: cancelCount,
    by_event_top: Object.entries(byEvent).sort((a, b) => b[1] - a[1]).slice(0, 30).map(([event, count]) => ({ event, count }))
  };
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
    const w = `audit-041-${i}`;
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
  const logsRes = await http.get('/bot/logs?limit=20000');
  await http.post('/bot/stop', {});
  const logs = (Array.isArray(logsRes?.body) ? logsRes.body : []).filter((row) => {
    const t = parseIsoMs(row?.ts || row?.time || row?.timestamp);
    return t == null || t >= startAt;
  });
  return logs;
};

const main = async () => {
  const args = parseArgs();
  const extra = parseExtraArgs();
  const sampleName = ensureSampleAllowed(args.sampleName);
  heartbeatLogPath = String(args.output || '').replace(/\.json$/i, '.heartbeat.log');
  ensureDir(heartbeatLogPath);
  fs.writeFileSync(heartbeatLogPath, '', 'utf8');

  const port = Number(new URL(args.baseUrl).port || 53241);
  const begin = Date.now();
  let lastBeatAt = Date.now();
  let lastHeartbeatAt = 0;
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
      compare = {
        total_delta: currentSummary.total_logs - baselineSummary.total_logs,
        noise_delta: currentSummary.noise_total - baselineSummary.noise_total,
        place_ladder_before: baselineSummary.place_ladder_count ?? 0,
        place_ladder_after: currentSummary.place_ladder_count,
        key_event_before: baselineSummary.key_event_counts || {},
        key_event_after: currentSummary.key_event_counts
      };
      const keyRetained = KEY_EVENTS.every((evt) => {
        const beforeCount = Number((baselineSummary.key_event_counts || {})[evt] || 0);
        const afterCount = Number((currentSummary.key_event_counts || {})[evt] || 0);
        if (beforeCount === 0) return true;
        return afterCount > 0;
      });
      pass = compare.total_delta < 0 && compare.noise_delta < 0 && keyRetained && currentSummary.place_ladder_count > 0;
    }

    const firstBreakLayer = pass ? 'NONE_CHAIN_PASS' : 'log_noise_reduction_not_pass';
    const standard = buildStandardResult({
      scriptName: 'truth_audit_log_noise_reduction_260330_041',
      taskId: args.taskId,
      sampleName,
      pass,
      message: compare
        ? `total_delta=${compare.total_delta},noise_delta=${compare.noise_delta}`
        : 'baseline captured',
      firstBreakLayer,
      evidenceFile: args.output,
      summary: {
        mode: extra.mode,
        pass,
        first_break_layer: firstBreakLayer
      },
      rawExcerpt: {
        total_logs: currentSummary.total_logs,
        noise_total: currentSummary.noise_total,
        place_ladder_count: currentSummary.place_ladder_count
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
        current_summary: currentSummary,
        compare,
        sampled_log_tail: logs.slice(-LOG_TAIL),
        heartbeat_log: heartbeatLogPath,
        last_heartbeat: lastHeartbeat,
        healthcheck: health,
        noise_event_allowlist: NOISE_EVENTS,
        key_event_allowlist: KEY_EVENTS,
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
      total_logs: currentSummary.total_logs,
      noise_total: currentSummary.noise_total,
      place_ladder_count: currentSummary.place_ladder_count,
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
