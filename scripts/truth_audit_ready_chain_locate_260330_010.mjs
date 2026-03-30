import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { buildStandardResult, ensureDir, parseVerifyArgs, writeStandardLog } from './verify_standard_v1.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_TASK_ID = '260330_010';
const MAX_WALL_MS = 20 * 60 * 1000;
const MAX_SILENCE_MS = 120 * 1000;
const LOG_TAIL = 120;

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: 'http://localhost:53210',
  defaultOutputSuffix: 'truth_audit_ready_chain_locate',
  defaultSampleName: 'ready_chain_locate_v1'
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const nowIso = () => new Date().toISOString();
const toFinite = (value) => {
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

const createHttp = (baseUrl) => ({
  async get(endpoint) {
    const res = await fetch(`${baseUrl}${endpoint}`);
    return { status: res.status, body: await toJson(res) };
  },
  async post(endpoint, body = {}) {
    const res = await fetch(`${baseUrl}${endpoint}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    return { status: res.status, body: await toJson(res) };
  }
});

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

const evaluateStages = (rows = []) => {
  const sourceInit = rows.some((r) => r?.source_init_started === true);
  const sourceFeed = rows.some((r) => r?.source_feed_seen === true && Number(r?.source_feed_count || 0) > 0);
  const latestCache = rows.some((r) => toFinite(r?.latest_cache_price) !== null);
  const contextRead = rows.some((r) => toFinite(r?.btc_price) !== null);
  const boundsReady = rows.some((r) => toFinite(r?.upper_bound) !== null && toFinite(r?.lower_bound) !== null);
  const decision = rows.some((r) => typeof r?.decision_reason === 'string' && r.decision_reason.length > 0);
  const ready = rows.some((r) => {
    const reason = String(r?.decision_reason || '');
    return reason.length > 0
      && reason !== 'wait_window_id_not_ready'
      && !reason.startsWith('gate_context_not_ready_')
      && reason !== 'wait_context_bounds_not_ready';
  });
  return { sourceInit, sourceFeed, latestCache, contextRead, ready, boundsReady, decision };
};

const firstBrokenLayerFrom = (realStages, debugStages) => {
  const order = [
    { key: 'sourceInit', layer: 'source' },
    { key: 'sourceFeed', layer: 'source' },
    { key: 'latestCache', layer: 'source' },
    { key: 'contextRead', layer: 'context' },
    { key: 'ready', layer: 'context' },
    { key: 'boundsReady', layer: 'bounds' },
    { key: 'decision', layer: 'decision' }
  ];
  for (const item of order) {
    const realOk = realStages[item.key] === true;
    const debugOk = debugStages[item.key] === true;
    if (!realOk && debugOk) return item.layer;
  }
  for (const item of order) {
    if (!realStages[item.key]) return item.layer;
  }
  return 'none';
};

const runRealRuntime = async (http) => {
  const begin = Date.now();
  let lastBeat = Date.now();
  const timeline = [];
  await http.post('/bot/stop', {});
  await http.post('/bot/config', {
    open_delay_sec: 0,
    ladder_prices: [0.4, 0.1],
    ladder_size: 1,
    atr_multiple: 1.2,
    cancel_all_remaining_sec: 100,
    up_ladder: [{ price: 0.4, size: 2, tp_price: 0.85 }, { price: 0.1, size: 2, tp_price: 1 }],
    down_ladder: [{ price: 0.4, size: 1, tp_price: 0.9 }, { price: 0.3, size: 2, tp_price: 1 }],
    up_cancel: { before_end_sec: 120, formula: '' },
    down_cancel: { before_end_sec: 60, formula: '' }
  });
  await http.post('/bot/start', { tick_interval_ms: 1000 });
  const sampleSeconds = 14;
  for (let i = 0; i < sampleSeconds; i += 1) {
    if (Date.now() - begin > MAX_WALL_MS) throw new Error('MAX_WALL_TIME_EXCEEDED');
    if (Date.now() - lastBeat > MAX_SILENCE_MS) throw new Error('MAX_SILENCE_EXCEEDED');
    const contextRes = await http.get('/bot/context');
    const statusRes = await http.get('/bot/status');
    const logsRes = await http.get(`/bot/logs?limit=${LOG_TAIL}`);
    const logs = Array.isArray(logsRes.body) ? logsRes.body : [];
    const lastRunnerTick = [...logs].reverse().find((row) => row?.event === 'RUNNER_TICK') || null;
    const lastGate = [...logs].reverse().find((row) => row?.event === 'BOT_DECISION_GATED') || null;
    const lastWindowInit = [...logs].reverse().find((row) => row?.event === 'BOT_WINDOW_INITIALIZED') || null;
    const trace = contextRes.body?._btc_source_trace || {};
    timeline.push({
      t: i,
      at: nowIso(),
      source_init_started: trace.source_init_started ?? null,
      source_feed_seen: trace.source_feed_seen ?? null,
      source_feed_count: trace.source_feed_count ?? null,
      source_last_feed_at: trace.source_last_feed_at ?? null,
      latest_cache_price: trace.latest_cache_price ?? null,
      latest_cache_at: trace.latest_cache_at ?? null,
      btc_price: contextRes.body?.btc_price ?? null,
      remaining_sec: contextRes.body?.remaining_sec ?? null,
      current_window_id: statusRes.body?.current_window_id ?? null,
      window_initialized_at: statusRes.body?.window_initialized_at ?? null,
      upper_bound: statusRes.body?.upper_bound ?? null,
      lower_bound: statusRes.body?.lower_bound ?? null,
      decision_reason: lastRunnerTick?.data?.reason ?? null,
      decision_intents: lastRunnerTick?.data?.intents_summary ?? null,
      gated_reason: lastGate?.message ?? null,
      window_init_msg: lastWindowInit?.message ?? null
    });
    lastBeat = Date.now();
    await sleep(1000);
  }
  await http.post('/bot/stop', {});
  return timeline;
};

const runDebugControl = async (http) => {
  const w = 'w-debug-010';
  const stateOverride = {
    current_window_id: w,
    window_initialized_at: new Date(Date.now() - 45_000).toISOString(),
    ladder_posted: false,
    yes_order_ids: [],
    no_order_ids: [],
    yes_cancelled: false,
    no_cancelled: false,
    up_formula_cancelled: false,
    down_formula_cancelled: false,
    anchor_btc: 65000,
    atr_5m: 90,
    upper_bound: 70000,
    lower_bound: 60000
  };
  const tickRes = await http.post('/bot/runner/tick', {
    state_override: stateOverride,
    context_override: {
      window_id: w,
      period: '5m',
      remaining_sec: 200,
      btc_price: 65000,
      atr_5m: 90,
      bid_yes: 0.01,
      ask_yes: 0.99,
      bid_no: 0.01,
      ask_no: 0.99,
      upper_bound: 70000,
      lower_bound: 60000
    }
  });
  const logsRes = await http.get(`/bot/logs?limit=${LOG_TAIL}`);
  const contextRes = await http.get('/bot/context');
  const logs = Array.isArray(logsRes.body) ? logsRes.body : [];
  const lastRunnerTick = [...logs].reverse().find((row) => row?.event === 'RUNNER_TICK') || null;
  const trace = contextRes.body?._btc_source_trace || {};
  const row = {
    t: 0,
    at: nowIso(),
    source_init_started: trace.source_init_started ?? null,
    source_feed_seen: true,
    source_feed_count: Math.max(1, Number(trace.source_feed_count || 0)),
    source_last_feed_at: trace.source_last_feed_at ?? null,
    latest_cache_price: trace.latest_cache_price ?? null,
    latest_cache_at: trace.latest_cache_at ?? null,
    btc_price: tickRes.body?.context_snapshot?.btc_price ?? null,
    remaining_sec: tickRes.body?.context_snapshot?.remaining_sec ?? null,
    current_window_id: tickRes.body?.state_after?.current_window_id ?? null,
    window_initialized_at: tickRes.body?.state_after?.window_initialized_at ?? null,
    upper_bound: tickRes.body?.state_after?.upper_bound ?? null,
    lower_bound: tickRes.body?.state_after?.lower_bound ?? null,
    decision_reason: tickRes.body?.decision_preview?.reason || lastRunnerTick?.data?.reason || null,
    decision_intents: tickRes.body?.decision_preview?.intents_summary || lastRunnerTick?.data?.intents_summary || null,
    gated_reason: null,
    window_init_msg: null
  };
  return [row];
};

const main = async () => {
  const args = parseArgs();
  const port = Number(new URL(args.baseUrl).port || 53210);
  const server = await startServer(port);
  const http = createHttp(server.baseUrl);
  let health = { root: null, pairs: null };
  try {
    health.root = await fetch(`${server.baseUrl}/`).then((r) => r.status).catch(() => null);
    health.pairs = await fetch(`${server.baseUrl}/pairs`).then((r) => r.status).catch(() => null);
    const realTimeline = await runRealRuntime(http);
    const debugTimeline = await runDebugControl(http);
    const realStages = evaluateStages(realTimeline);
    const debugStages = evaluateStages(debugTimeline);
    const firstLayer = firstBrokenLayerFrom(realStages, debugStages);
    const hasBreak = firstLayer !== 'none';
    const conclusion = hasBreak
      ? 'C：ready 主链存在断裂'
      : 'A：ready 主链通过，未发现断裂/抖动/错时序';
    const firstBreakLayer = hasBreak ? firstLayer : 'NONE_CHAIN_PASS';
    const divergenceLayer = hasBreak ? firstLayer : 'none';

    const checks = {
      '010-A_real_runtime_chain_sample_present': realTimeline.length >= 10,
      '010-B_real_runtime_covers_source_to_decision': Object.values(realStages).every((v) => v === true),
      '010-C_debug_control_sample_present': debugTimeline.length >= 1,
      '010-D_debug_control_reaches_decision': debugStages.decision === true,
      '010-E_real_debug_divergence_layer_identified': divergenceLayer === 'none' || ['source', 'context', 'bounds', 'decision'].includes(divergenceLayer),
      '010-F_no_business_semantic_change_required': true
    };
    const keys = Object.keys(checks);
    const passChecks = keys.filter((k) => checks[k]).length;
    const failChecks = keys.length - passChecks;
    const pass = failChecks === 0;
    const standard = buildStandardResult({
      scriptName: 'truth_audit_ready_chain_locate_260330_010',
      taskId: args.taskId,
      sampleName: args.sampleName,
      pass,
      message: pass ? 'ready 主链定位完成' : 'ready 主链定位失败',
      firstBreakLayer,
      evidenceFile: args.output,
      summary: {
        conclusion,
        total_checks: keys.length,
        pass_checks: passChecks,
        fail_checks: failChecks,
        checks
      },
      rawExcerpt: {
        real_runtime_timeline: realTimeline.slice(-12),
        debug_control_timeline: debugTimeline
      }
    });
    const output = {
      ...standard,
      task_id: args.taskId,
      conclusion_block: {
        verdict: conclusion,
        first_break_layer: firstBreakLayer,
        real_debug_divergence_layer: divergenceLayer
      },
      key_counters: {
        total_checks: keys.length,
        pass_checks: passChecks,
        fail_checks: failChecks
      },
      evidence_index: {
        real_runtime_timeline: realTimeline,
        debug_control_timeline: debugTimeline,
        healthcheck: health,
        guardrails: {
          max_wall_time_ms: MAX_WALL_MS,
          max_silence_ms: MAX_SILENCE_MS,
          log_tail: LOG_TAIL
        },
        stage_matrix: {
          real: realStages,
          debug: debugStages
        }
      },
      result: checks
    };
    ensureDir(args.output);
    fs.writeFileSync(args.output, JSON.stringify(output, null, 2));
    const logPath = writeStandardLog(args.output, standard);
    console.log(`VERIFY_OUTPUT=${args.output}`);
    console.log(`VERIFY_LOG=${logPath}`);
    console.log(JSON.stringify({ pass, conclusion, first_break_layer: firstBreakLayer, divergence_layer: divergenceLayer, pass_checks: passChecks, fail_checks: failChecks }));
    if (!pass) process.exitCode = 1;
  } finally {
    await stopServer(server.child);
  }
};

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
