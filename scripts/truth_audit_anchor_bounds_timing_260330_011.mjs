import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { buildStandardResult, ensureDir, parseVerifyArgs, writeStandardLog } from './verify_standard_v1.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_TASK_ID = '260330_011';
const MAX_WALL_MS = 25 * 60 * 1000;
const MAX_SILENCE_MS = 120 * 1000;
const LOG_TAIL = 120;

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: 'http://localhost:53211',
  defaultOutputSuffix: 'truth_audit_anchor_bounds_timing',
  defaultSampleName: 'anchor_bounds_timing_v1'
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const nowIso = () => new Date().toISOString();
const toFinite = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
const approxEqual = (a, b, eps = 1e-6) => Math.abs(Number(a) - Number(b)) <= eps;
const toJson = async (res) => {
  try {
    return await res.json();
  } catch {
    return null;
  }
};

const createHttp = (baseUrl) => {
  const retry = async (fn) => {
    let err = null;
    for (let i = 0; i < 4; i += 1) {
      try {
        return await fn();
      } catch (error) {
        err = error;
        await sleep(250);
      }
    }
    throw err || new Error('http_failed');
  };
  return {
    get: (endpoint) => retry(async () => {
      const res = await fetch(`${baseUrl}${endpoint}`);
      return { status: res.status, body: await toJson(res) };
    }),
    post: (endpoint, body = {}) => retry(async () => {
      const res = await fetch(`${baseUrl}${endpoint}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });
      return { status: res.status, body: await toJson(res) };
    })
  };
};

const waitServerReady = async (baseUrl, timeoutMs = 45_000) => {
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

const summarizeDebugIntents = (summary) => {
  if (typeof summary === 'string') return summary;
  return 'NOOP';
};

const runDebugControl = async (http) => {
  await http.post('/bot/stop', {});
  const reset = {
    current_window_id: null,
    window_initialized_at: null,
    ladder_posted: false,
    yes_order_ids: [],
    no_order_ids: [],
    yes_cancelled: false,
    no_cancelled: false,
    anchor_btc: null,
    atr_5m: null,
    upper_bound: null,
    lower_bound: null
  };
  const tickA = await http.post('/bot/runner/tick', {
    state_override: reset,
    context_override: {
      window_id: 'dbg-011-w1',
      period: '5m',
      remaining_sec: 250,
      btc_price: 65000,
      atr_5m: null,
      bid_yes: 0.01,
      ask_yes: 0.99,
      bid_no: 0.01,
      ask_no: 0.99
    }
  });
  const tickB = await http.post('/bot/runner/tick', {
    context_override: {
      window_id: 'dbg-011-w1',
      period: '5m',
      remaining_sec: 240,
      btc_price: 65000,
      atr_5m: 80,
      bid_yes: 0.01,
      ask_yes: 0.99,
      bid_no: 0.01,
      ask_no: 0.99
    }
  });
  const tickC = await http.post('/bot/runner/tick', {
    context_override: {
      window_id: 'dbg-011-w1',
      period: '5m',
      remaining_sec: 230,
      btc_price: 65123,
      atr_5m: 80,
      bid_yes: 0.01,
      ask_yes: 0.99,
      bid_no: 0.01,
      ask_no: 0.99
    }
  });
  const rows = [tickA.body, tickB.body, tickC.body].map((r, idx) => ({
    step: idx + 1,
    timestamp: nowIso(),
    current_window_id: r?.state_after?.current_window_id ?? null,
    anchor_btc: r?.state_after?.anchor_btc ?? null,
    atr_5m: r?.state_after?.atr_5m ?? null,
    atr_multiple: 1.2,
    upper: r?.state_after?.upper_bound ?? null,
    lower: r?.state_after?.lower_bound ?? null,
    bounds_ready: toFinite(r?.state_after?.anchor_btc) !== null
      && toFinite(r?.state_after?.upper_bound) !== null
      && toFinite(r?.state_after?.lower_bound) !== null,
    decision_reason: r?.decision_preview?.reason ?? null,
    decision_intents: summarizeDebugIntents(r?.decision_preview?.intents_summary)
  }));
  return {
    rows,
    raw: { tickA: tickA.body, tickB: tickB.body, tickC: tickC.body }
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
      const w = contextRes.body?.window_id ?? null;
      const rem = toFinite(contextRes.body?.remaining_sec);
      if (w && rem !== null && rem <= 45) return { window_id: w, remaining_sec: rem };
      await sleep(1000);
    }
  };
  const startupWindow = await waitNearEnd();
  await http.post('/bot/start', { tick_interval_ms: 1000 });
  lastBeat = Date.now();
  const rows = [];
  let seenNextWindow = false;
  let seenBoundsReady = false;
  let seenDecisionConsumeBounds = false;
  let blockedByStartupWaitOnly = true;

  for (let i = 0; i < 260; i += 1) {
    if (Date.now() - begin > MAX_WALL_MS) throw new Error('MAX_WALL_TIME_EXCEEDED');
    if (Date.now() - lastBeat > MAX_SILENCE_MS) throw new Error('MAX_SILENCE_EXCEEDED');
    const statusRes = await http.get('/bot/status');
    const contextRes = await http.get('/bot/context');
    const logsRes = await http.get(`/bot/logs?limit=${LOG_TAIL}`);
    const logs = Array.isArray(logsRes.body) ? logsRes.body : [];
    const lastRunner = [...logs].reverse().find((l) => l?.event === 'RUNNER_TICK') || null;
    const lastIntents = [...logs].reverse().find((l) => l?.event === 'BOT_INTENTS')?.message ?? null;
    const lastGate = [...logs].reverse().find((l) => l?.event === 'BOT_DECISION_GATED')?.message ?? null;
    const state = statusRes.body || {};
    const activeCfg = state?.active_runtime_snapshot?.config || {};
    const currentWindow = state.current_window_id ?? contextRes.body?.window_id ?? null;
    const anchor = toFinite(state.anchor_btc);
    const atr = toFinite(state.atr_5m ?? contextRes.body?.atr_5m);
    const atrMultiple = toFinite(activeCfg.atr_multiple) ?? 1.2;
    const upper = toFinite(state.upper_bound);
    const lower = toFinite(state.lower_bound);
    const boundsReady = anchor !== null && upper !== null && lower !== null;
    const decisionReason = typeof lastRunner?.message === 'string' && lastRunner.message.startsWith('tick ')
      ? lastRunner.message.slice(5)
      : (typeof state.last_reason === 'string' ? state.last_reason : null);
    const decisionIntents = (typeof lastRunner?.data?.intents_summary === 'string' && lastRunner.data.intents_summary.length > 0)
      ? lastRunner.data.intents_summary
      : lastIntents;
    const row = {
      timestamp: nowIso(),
      current_window_id: currentWindow,
      anchor_btc: anchor,
      atr_5m: atr,
      atr_multiple: atrMultiple,
      upper,
      lower,
      bounds_ready: boundsReady,
      decision_reason: decisionReason,
      decision_intents: decisionIntents,
      gated_reason: lastGate,
      remaining_sec: toFinite(contextRes.body?.remaining_sec)
    };
    rows.push(row);
    if (currentWindow && currentWindow !== startupWindow.window_id) seenNextWindow = true;
    if (boundsReady) seenBoundsReady = true;
    if (boundsReady && typeof lastIntents === 'string' && lastIntents.includes('PLACE_LADDER(')) {
      seenDecisionConsumeBounds = true;
    }
    if (decisionReason !== 'wait_next_window_after_start') blockedByStartupWaitOnly = false;
    const enough = seenNextWindow && seenBoundsReady && seenDecisionConsumeBounds;
    if (enough) break;
    lastBeat = Date.now();
    await sleep(1000);
  }
  await http.post('/bot/stop', {});
  return { startupWindow, rows, seenNextWindow, seenBoundsReady, seenDecisionConsumeBounds, blockedByStartupWaitOnly };
};

const checkAnchorFreeze = (rows) => {
  const winMap = new Map();
  for (const row of rows) {
    const w = row.current_window_id;
    const a = toFinite(row.anchor_btc);
    if (!w || a === null) continue;
    if (!winMap.has(w)) {
      winMap.set(w, a);
      continue;
    }
    if (!approxEqual(winMap.get(w), a)) return false;
  }
  return winMap.size > 0;
};

const checkBoundsCompute = (rows) => rows.some((row) => {
  const a = toFinite(row.anchor_btc);
  const atr = toFinite(row.atr_5m);
  const m = toFinite(row.atr_multiple);
  const u = toFinite(row.upper);
  const l = toFinite(row.lower);
  if (a === null || atr === null || m === null || u === null || l === null) return false;
  return approxEqual(u, a + (atr * m), 1e-3) && approxEqual(l, a - (atr * m), 1e-3);
});

const checkBoundsReadyGate = (rows) => rows.some((row) => row.bounds_ready === true && row.decision_reason !== 'gate_context_not_ready_bounds');
const checkDecisionConsumeBounds = (rows) => rows.some((row) => row.bounds_ready === true && typeof row.decision_intents === 'string' && row.decision_intents.includes('PLACE_LADDER('));

const main = async () => {
  const args = parseArgs();
  const port = Number(new URL(args.baseUrl).port || 53211);
  const server = await startServer(port);
  const http = createHttp(server.baseUrl);
  let health = { root: null, pairs: null };
  try {
    health.root = await fetch(`${server.baseUrl}/`).then((r) => r.status).catch(() => null);
    health.pairs = await fetch(`${server.baseUrl}/pairs`).then((r) => r.status).catch(() => null);
    const debug = await runDebugControl(http);
    const real = await runRealRuntime(http);

    const realRows = real.rows;
    const debugRows = debug.rows;
    const realStages = {
      anchor_freeze: checkAnchorFreeze(realRows),
      atr_input: realRows.some((row) => toFinite(row.atr_5m) !== null),
      bounds_compute: checkBoundsCompute(realRows),
      bounds_ready_gate: checkBoundsReadyGate(realRows),
      decision_consume_bounds: checkDecisionConsumeBounds(realRows)
    };
    const debugStages = {
      anchor_freeze: checkAnchorFreeze(debugRows),
      atr_input: debugRows.some((row) => toFinite(row.atr_5m) !== null) && debugRows.some((row) => row.atr_5m === null),
      bounds_compute: checkBoundsCompute(debugRows),
      bounds_ready_gate: checkBoundsReadyGate(debugRows),
      decision_consume_bounds: checkDecisionConsumeBounds(debugRows)
    };
    const order = ['anchor_freeze', 'atr_input', 'bounds_compute', 'bounds_ready_gate', 'decision_consume_bounds'];
    let firstBreakLayer = 'NONE_CHAIN_PASS';
    let divergenceLayer = 'none';
    for (const key of order) {
      if (!realStages[key]) {
        firstBreakLayer = key;
        break;
      }
    }
    for (const key of order) {
      if (Boolean(realStages[key]) !== Boolean(debugStages[key])) {
        divergenceLayer = key;
        break;
      }
    }

    const blockedByContextGate = real.blockedByStartupWaitOnly && !real.seenNextWindow;
    const sampleInsufficient = realRows.length < 8 || blockedByContextGate;
    const verdict = sampleInsufficient
      ? 'B：样本不足'
      : (firstBreakLayer === 'NONE_CHAIN_PASS' ? 'A：通过' : 'C：存在断裂');
    const conclusion = sampleInsufficient
      ? 'B：真实样本不足或被 context->ready 门控持续阻断'
      : (firstBreakLayer === 'NONE_CHAIN_PASS'
        ? 'A：anchor/bounds/bounds_ready 链路通过'
        : `C：bounds readiness 链路存在断裂，首断裂层=${firstBreakLayer}`);
    const checks = {
      '011-A_real_runtime_sample_covers_required_chain': !sampleInsufficient && real.seenNextWindow && real.seenBoundsReady,
      '011-B_debug_control_sample_present': debugRows.length >= 3,
      '011-C_timing_reconcile_table_present': realRows.length > 0,
      '011-D_anchor_freeze_within_window': realStages.anchor_freeze === true,
      '011-E_bounds_ready_independent_and_decision_consumed': realStages.bounds_ready_gate === true && realStages.decision_consume_bounds === true
    };
    const keys = Object.keys(checks);
    const passChecks = keys.filter((k) => checks[k]).length;
    const failChecks = keys.length - passChecks;
    const pass = failChecks === 0 && !sampleInsufficient;

    const standard = buildStandardResult({
      scriptName: 'truth_audit_anchor_bounds_timing_260330_011',
      taskId: args.taskId,
      sampleName: args.sampleName,
      pass,
      message: pass ? 'anchor/bounds/bounds_ready 真值定位通过' : 'anchor/bounds/bounds_ready 真值定位未通过',
      firstBreakLayer: sampleInsufficient ? 'SAMPLE_BLOCKED_OR_INSUFFICIENT' : firstBreakLayer,
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
        real_runtime_head: realRows.slice(0, 12),
        real_runtime_tail: realRows.slice(-12),
        debug_control_rows: debugRows
      }
    });

    const output = {
      ...standard,
      task_id: args.taskId,
      conclusion_block: {
        conclusion,
        verdict,
        first_break_layer: sampleInsufficient ? 'SAMPLE_BLOCKED_OR_INSUFFICIENT' : firstBreakLayer,
        real_debug_diverged: divergenceLayer !== 'none',
        real_debug_first_divergence_layer: divergenceLayer
      },
      key_counters: {
        total_checks: keys.length,
        pass_checks: passChecks,
        fail_checks: failChecks
      },
      evidence_index: {
        timing_reconcile_table: realRows,
        real_runtime: real,
        debug_control: debug,
        stage_matrix: { real: realStages, debug: debugStages },
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
    console.log(JSON.stringify({
      pass,
      conclusion,
      verdict,
      first_break_layer: sampleInsufficient ? 'SAMPLE_BLOCKED_OR_INSUFFICIENT' : firstBreakLayer,
      divergence_layer: divergenceLayer,
      pass_checks: passChecks,
      fail_checks: failChecks
    }));
    if (!pass) process.exitCode = 1;
  } finally {
    await stopServer(server.child);
  }
};

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
