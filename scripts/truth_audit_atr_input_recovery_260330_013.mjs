import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { buildStandardResult, ensureDir, parseVerifyArgs, writeStandardLog } from './verify_standard_v1.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_TASK_ID = '260330_013';
const MAX_WALL_MS = 25 * 60 * 1000;
const MAX_SILENCE_MS = 120 * 1000;
const LOG_TAIL = 120;

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: 'http://localhost:53213',
  defaultOutputSuffix: 'truth_audit_atr_input_recovery',
  defaultSampleName: 'atr_input_recovery_v1'
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

const readPreFixEvidence = () => {
  const prePath = path.join(REPO_ROOT, 'rules', 'task-reports', '2026-03', '260330_011_truth_audit_anchor_bounds_timing.json');
  const raw = fs.readFileSync(prePath, 'utf8');
  const j = JSON.parse(raw);
  const rows = Array.isArray(j?.evidence_index?.timing_reconcile_table) ? j.evidence_index.timing_reconcile_table : [];
  const crossRows = rows.filter((r) => String(r.current_window_id || '').includes('1774887600'));
  const failRow = crossRows.find((r) => toFinite(r.atr_5m) === null && toFinite(r.upper) === null && toFinite(r.lower) === null && String(r.decision_reason || '') === 'price_or_bounds_null');
  return {
    source_file: prePath,
    found_fail_row: Boolean(failRow),
    fail_row: failRow || null
  };
};

const runDebugControl = async (http) => {
  await http.post('/bot/stop', {});
  const w = `dbg-013-${Date.now()}`;
  const tick1 = await http.post('/bot/runner/tick', {
    state_override: {
      current_window_id: w,
      window_initialized_at: new Date(Date.now() - 45000).toISOString(),
      anchor_btc: 65000,
      atr_5m: null,
      upper_bound: null,
      lower_bound: null
    },
    context_override: {
      window_id: w,
      period: '5m',
      remaining_sec: 240,
      btc_price: 65000,
      atr_5m: null
    }
  });
  const tick2 = await http.post('/bot/runner/tick', {
    context_override: {
      window_id: w,
      period: '5m',
      remaining_sec: 230,
      btc_price: 65000,
      atr_5m: 80
    }
  });
  const s1 = tick1.body?.state_after || {};
  const s2 = tick2.body?.state_after || {};
  return {
    tick1: {
      atr_5m: s1.atr_5m ?? null,
      upper: s1.upper_bound ?? null,
      lower: s1.lower_bound ?? null,
      decision_reason: tick1.body?.decision_preview?.reason ?? null,
      decision_intents: tick1.body?.decision_preview?.intents_summary ?? null,
      changed: Number(tick1.body?.outcome?.changed ?? 0)
    },
    tick2: {
      atr_5m: s2.atr_5m ?? null,
      upper: s2.upper_bound ?? null,
      lower: s2.lower_bound ?? null,
      decision_reason: tick2.body?.decision_preview?.reason ?? null,
      decision_intents: tick2.body?.decision_preview?.intents_summary ?? null,
      changed: Number(tick2.body?.outcome?.changed ?? 0)
    }
  };
};

const runRealRuntime = async (http) => {
  const begin = Date.now();
  let lastBeat = Date.now();
  await http.post('/bot/stop', {});
  await http.post('/bot/config', {
    open_delay_sec: 0,
    ladder_prices: [0.01],
    ladder_size: 1,
    atr_multiple: 1.2,
    cancel_all_remaining_sec: 100,
    up_ladder: [{ price: 0.01, size: 1, tp_price: 0.5 }],
    down_ladder: [{ price: 0.01, size: 1, tp_price: 0.5 }],
    up_cancel: { before_end_sec: 120, formula: '' },
    down_cancel: { before_end_sec: 60, formula: '' }
  });
  const waitNearEnd = async () => {
    while (true) {
      if (Date.now() - begin > MAX_WALL_MS) throw new Error('MAX_WALL_TIME_WAIT_START');
      const contextRes = await http.get('/bot/context');
      const windowId = contextRes.body?.window_id ?? null;
      const rem = toFinite(contextRes.body?.remaining_sec);
      if (windowId && rem !== null && rem <= 45) return { window_id: windowId, remaining_sec: rem };
      await sleep(1000);
    }
  };
  const startupWindow = await waitNearEnd();
  await http.post('/bot/start', { tick_interval_ms: 1000 });
  lastBeat = Date.now();
  const timeline = [];
  let seenNextWindow = false;
  let seenAtrReady = false;
  let seenBoundsReady = false;
  let seenDecisionConsumeBounds = false;
  let seenStartupNoPlace = false;
  let lastAnchorByWindow = new Map();
  let anchorFrozenPass = true;

  for (let i = 0; i < 260; i += 1) {
    if (Date.now() - begin > MAX_WALL_MS) throw new Error('MAX_WALL_TIME_EXCEEDED');
    if (Date.now() - lastBeat > MAX_SILENCE_MS) throw new Error('MAX_SILENCE_EXCEEDED');
    const statusRes = await http.get('/bot/status');
    const contextRes = await http.get('/bot/context');
    const ordersRes = await http.get('/bot/orders');
    const logsRes = await http.get(`/bot/logs?limit=${LOG_TAIL}`);
    const logs = Array.isArray(logsRes.body) ? logsRes.body : [];
    const lastRunner = [...logs].reverse().find((l) => l?.event === 'RUNNER_TICK') || null;
    const lastIntents = [...logs].reverse().find((l) => l?.event === 'BOT_INTENTS')?.message ?? null;
    const state = statusRes.body || {};
    const currentWindow = state.current_window_id ?? contextRes.body?.window_id ?? null;
    const anchor = toFinite(state.anchor_btc);
    const atr = toFinite(state.atr_5m);
    const upper = toFinite(state.upper_bound);
    const lower = toFinite(state.lower_bound);
    const boundsReady = anchor !== null && upper !== null && lower !== null;
    const decisionReason = typeof lastRunner?.message === 'string' && lastRunner.message.startsWith('tick ')
      ? lastRunner.message.slice(5)
      : null;
    const decisionIntents = typeof lastRunner?.data?.intents_summary === 'string'
      ? lastRunner.data.intents_summary
      : lastIntents;
    const orderCount = Array.isArray(ordersRes.body?.window_orders) ? ordersRes.body.window_orders.length : 0;
    const row = {
      timestamp: nowIso(),
      current_window_id: currentWindow,
      anchor_btc: anchor,
      atr_5m: atr,
      upper,
      lower,
      bounds_ready: boundsReady,
      decision_reason: decisionReason,
      decision_intents: decisionIntents,
      order_count: orderCount,
      remaining_sec: toFinite(contextRes.body?.remaining_sec)
    };
    timeline.push(row);

    if (currentWindow && currentWindow !== startupWindow.window_id) seenNextWindow = true;
    if (atr !== null && seenNextWindow) seenAtrReady = true;
    if (boundsReady && seenNextWindow) seenBoundsReady = true;
    if (boundsReady && typeof decisionIntents === 'string' && decisionIntents.includes('PLACE_LADDER(')) {
      seenDecisionConsumeBounds = true;
    }
    if (currentWindow === startupWindow.window_id) {
      if (!String(decisionIntents || '').includes('PLACE_LADDER(')) seenStartupNoPlace = true;
      if (anchor !== null) {
        const prev = lastAnchorByWindow.get(currentWindow);
        if (prev === undefined) lastAnchorByWindow.set(currentWindow, anchor);
        else if (Math.abs(prev - anchor) > 1e-6) anchorFrozenPass = false;
      }
    } else if (currentWindow && anchor !== null) {
      const prev = lastAnchorByWindow.get(currentWindow);
      if (prev === undefined) lastAnchorByWindow.set(currentWindow, anchor);
      else if (Math.abs(prev - anchor) > 1e-6) anchorFrozenPass = false;
    }

    const done = seenNextWindow && seenAtrReady && seenBoundsReady && seenDecisionConsumeBounds;
    if (done) break;
    lastBeat = Date.now();
    await sleep(1000);
  }
  await http.post('/bot/stop', {});
  const startupRows = timeline.filter((r) => r.current_window_id === startupWindow.window_id);
  const startupNoPlacePass = startupRows.length > 0 && startupRows.every((r) => !String(r.decision_intents || '').includes('PLACE_LADDER('));
  return {
    startupWindow,
    timeline,
    seenNextWindow,
    seenAtrReady,
    seenBoundsReady,
    seenDecisionConsumeBounds,
    anchorFrozenPass,
    startupNoPlacePass: startupNoPlacePass && seenStartupNoPlace
  };
};

const main = async () => {
  const args = parseArgs();
  const preFix = readPreFixEvidence();
  const port = Number(new URL(args.baseUrl).port || 53213);
  const server = await startServer(port);
  const http = createHttp(server.baseUrl);
  let health = { root: null, pairs: null };
  try {
    health.root = await fetch(`${server.baseUrl}/`).then((r) => r.status).catch(() => null);
    health.pairs = await fetch(`${server.baseUrl}/pairs`).then((r) => r.status).catch(() => null);
    const debug = await runDebugControl(http);
    const real = await runRealRuntime(http);
    const postRows = real.timeline;
    const postCrossRows = postRows.filter((r) => r.current_window_id && r.current_window_id !== real.startupWindow.window_id);
    const postReadyRow = postCrossRows.find((r) => r.atr_5m !== null && r.upper !== null && r.lower !== null && r.bounds_ready === true);
    const checks = {
      '013-A_pre_fix_real_runtime_fail_exists': preFix.found_fail_row === true,
      '013-B_post_fix_real_runtime_atr_bounds_ready': Boolean(postReadyRow),
      '013-C_post_fix_real_runtime_decision_consumes_bounds': real.seenDecisionConsumeBounds === true,
      '013-D_non_regression_anchor_frozen_once_per_window': real.anchorFrozenPass === true,
      '013-E_non_regression_startup_window_no_place': real.startupNoPlacePass === true,
      '013-F_debug_control_only_as_contrast': debug.tick1.atr_5m === null && toFinite(debug.tick2.atr_5m) !== null
    };
    const keys = Object.keys(checks);
    const passChecks = keys.filter((k) => checks[k]).length;
    const failChecks = keys.length - passChecks;
    const pass = failChecks === 0;
    const firstBreakLayer = pass ? 'NONE_CHAIN_PASS' : 'atr_input';
    const conclusion = pass
      ? 'A：real runtime 下 atr_input 已恢复，atr_5m -> bounds -> bounds_ready 时序成立'
      : 'C：atr_input 链仍未修复';
    const standard = buildStandardResult({
      scriptName: 'truth_audit_atr_input_recovery_260330_013',
      taskId: args.taskId,
      sampleName: args.sampleName,
      pass,
      message: pass ? 'atr_input 修复验收通过' : 'atr_input 修复验收失败',
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
        pre_fix_fail_row: preFix.fail_row,
        post_fix_runtime_head: postRows.slice(0, 12),
        post_fix_runtime_tail: postRows.slice(-12),
        debug_control: debug
      }
    });

    const output = {
      ...standard,
      task_id: args.taskId,
      conclusion_block: {
        verdict: conclusion,
        first_break_layer: firstBreakLayer
      },
      key_counters: {
        total_checks: keys.length,
        pass_checks: passChecks,
        fail_checks: failChecks
      },
      evidence_index: {
        pre_fix_real_runtime: preFix,
        post_fix_real_runtime: real,
        debug_control: debug,
        timing_reconcile_table: postRows,
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
    console.log(JSON.stringify({ pass, conclusion, first_break_layer: firstBreakLayer, pass_checks: passChecks, fail_checks: failChecks }));
    if (!pass) process.exitCode = 1;
  } finally {
    await stopServer(server.child);
  }
};

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
