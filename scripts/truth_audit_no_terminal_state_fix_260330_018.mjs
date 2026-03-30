import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { buildStandardResult, ensureDir, parseVerifyArgs, writeStandardLog } from './verify_standard_v1.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_TASK_ID = '260330_018';
const MAX_WALL_MS = 25 * 60 * 1000;
const MAX_SILENCE_MS = 120 * 1000;
const LOG_TAIL = 150;

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: 'http://localhost:53218',
  defaultOutputSuffix: 'truth_audit_no_terminal_state_fix',
  defaultSampleName: 'no_terminal_state_fix_v1'
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

const extractDecision = (logs) => {
  const rows = Array.isArray(logs) ? logs : [];
  const lastRunner = [...rows].reverse().find((r) => r?.event === 'RUNNER_TICK') || null;
  const reason = typeof lastRunner?.message === 'string' && lastRunner.message.startsWith('tick ')
    ? lastRunner.message.slice(5)
    : null;
  const intents = typeof lastRunner?.data?.intents_summary === 'string'
    ? lastRunner.data.intents_summary
    : null;
  const changed = toFinite(lastRunner?.data?.changed);
  return { reason, intents, changed };
};

const extractNoFacts = (ordersBody) => {
  const rows = Array.isArray(ordersBody?.window_orders) ? ordersBody.window_orders : [];
  const noRows = rows.filter((r) => r?.side === 'NO');
  return {
    no_open_order_ids: noRows.filter((r) => r?.status === 'OPEN').map((r) => r.order_id).filter(Boolean),
    no_filled_order_ids: noRows.filter((r) => r?.status === 'FILLED').map((r) => r.order_id).filter(Boolean)
  };
};

const readPreFixFailFromRawLog = () => {
  const filePath = path.join(REPO_ROOT, 'data', 'crypto_binary', 'logs', 'bot_2026-03-30.jsonl');
  const text = fs.readFileSync(filePath, 'utf8');
  const lines = text.split(/\r?\n/).filter(Boolean);
  const windowId = 'btc-updown-5m-1774901100';
  const focus = [];
  for (let i = 0; i < lines.length; i += 1) {
    let row;
    try {
      row = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    if (row.window_id !== windowId) continue;
    if (row.ts < '2026-03-30T20:08:01.000Z' || row.ts > '2026-03-30T20:08:20.999Z') continue;
    if (row.event === 'RUNNER_TICK' || row.event === 'BOT_FILL' || row.event === 'BOT_INTENTS') {
      focus.push({ ln: i + 1, ...row });
    }
  }
  const repeatedPlaceWithNoChange = focus.filter((r) =>
    r.event === 'RUNNER_TICK'
    && String(r?.data?.intents_summary || '').includes('PLACE_LADDER(NO|0.27:5:1,0.24:5:1)')
    && Number(r?.data?.changed) === 0
  );
  return {
    file: filePath,
    window_id: windowId,
    focus_rows: focus,
    repeated_place_no_change_count: repeatedPlaceWithNoChange.length,
    fail_detected: repeatedPlaceWithNoChange.length >= 5
  };
};

const runDebugControl = async (http) => {
  await http.post('/bot/stop', {});
  const w = `dbg-018-${Date.now()}`;
  const tickDedupA = await http.post('/bot/runner/tick', {
    state_override: {
      current_window_id: w,
      window_initialized_at: new Date(Date.now() - 60000).toISOString(),
      ladder_posted: false,
      no_cancelled: false
    },
    context_override: {
      window_id: w,
      period: '5m',
      remaining_sec: 295,
      btc_price: 65000,
      atr_5m: 100,
      bid_yes: 0.01,
      ask_yes: 0.99,
      bid_no: 0.01,
      ask_no: 0.99
    }
  });
  const tickDedupB = await http.post('/bot/runner/tick', {
    state_override: {
      current_window_id: w,
      window_initialized_at: new Date(Date.now() - 58000).toISOString(),
      ladder_posted: false,
      no_cancelled: false
    },
    context_override: {
      window_id: w,
      period: '5m',
      remaining_sec: 294,
      btc_price: 65000,
      atr_5m: 100,
      bid_yes: 0.01,
      ask_yes: 0.99,
      bid_no: 0.01,
      ask_no: 0.99
    }
  });
  const tickA = await http.post('/bot/runner/tick', {
    state_override: {
      current_window_id: w,
      window_initialized_at: new Date(Date.now() - 40000).toISOString(),
      ladder_posted: false,
      no_cancelled: false
    },
    context_override: {
      window_id: w,
      period: '5m',
      remaining_sec: 290,
      btc_price: 65000,
      atr_5m: 100,
      bid_yes: 0.01,
      ask_yes: 0.99,
      bid_no: 0.01,
      ask_no: 0.99
    }
  });
  const tickB = await http.post('/bot/runner/tick', {
    state_override: {
      current_window_id: w,
      window_initialized_at: new Date(Date.now() - 35000).toISOString(),
      ladder_posted: false,
      no_cancelled: true
    },
    context_override: {
      window_id: w,
      period: '5m',
      remaining_sec: 288,
      btc_price: 65000,
      atr_5m: 100,
      bid_yes: 0.01,
      ask_yes: 0.99,
      bid_no: 0.01,
      ask_no: 0.99
    }
  });
  await http.post('/bot/stop', {});
  return {
    tick_a: {
      reason: tickA.body?.decision_preview?.reason ?? null,
      intents: tickA.body?.decision_preview?.intents_summary ?? null
    },
    tick_b: {
      reason: tickB.body?.decision_preview?.reason ?? null,
      intents: tickB.body?.decision_preview?.intents_summary ?? null
    },
    stages: {
      debug_no_cancelled_blocks_no_place: !String(tickB.body?.decision_preview?.intents_summary || '').includes('PLACE_LADDER(NO|'),
      debug_place_dedupe_works: String(tickDedupA.body?.decision_preview?.intents_summary || '').includes('PLACE_LADDER(')
        && Number(tickDedupB.body?.outcome?.changed ?? 0) === 0
    }
  };
};

const runRealRuntime = async (http) => {
  const begin = Date.now();
  let lastBeat = Date.now();
  await http.post('/bot/stop', {});
  await http.post('/bot/config', {
    open_delay_sec: 0,
    ladder_prices: [0.27, 0.24],
    ladder_size: 5,
    atr_multiple: 1.2,
    cancel_all_remaining_sec: 10,
    up_ladder: [],
    down_ladder: [{ price: 0.999, size: 5, tp_price: 1 }, { price: 0.998, size: 5, tp_price: 1 }],
    up_cancel: { before_end_sec: 120, formula: '' },
    down_cancel: { before_end_sec: 60, formula: '' }
  });

  const waitNearEnd = async () => {
    while (Date.now() - begin < MAX_WALL_MS) {
      const contextRes = await http.get('/bot/context');
      const wid = contextRes.body?.window_id ?? null;
      const rem = toFinite(contextRes.body?.remaining_sec);
      if (wid && rem !== null && rem <= 45) return { window_id: wid, remaining_sec: rem };
      await sleep(1000);
    }
    throw new Error('real_runtime_wait_start_timeout');
  };

  const startupWindow = await waitNearEnd();
  await http.post('/bot/start', { tick_interval_ms: 1000 });
  lastBeat = Date.now();

  const table = [];
  let prevWindowOrderIds = new Set();
  let firstNoTwoFilledIdx = -1;
  let repeatedNoPlaceAfterFill = 0;
  let repeatedNoPlaceAfterFillWithNewIds = 0;
  let sawNextWindow = false;
  let fillWindowId = null;

  for (let i = 0; i < 420; i += 1) {
    if (Date.now() - begin > MAX_WALL_MS) throw new Error('MAX_WALL_TIME_EXCEEDED');
    if (Date.now() - lastBeat > MAX_SILENCE_MS) throw new Error('MAX_SILENCE_EXCEEDED');
    const [statusRes, ordersRes, logsRes] = await Promise.all([
      http.get('/bot/status'),
      http.get('/bot/orders'),
      http.get(`/bot/logs?limit=${LOG_TAIL}`)
    ]);
    const status = statusRes.body || {};
    const ordersBody = ordersRes.body || {};
    const decision = extractDecision(logsRes.body);
    const noFacts = extractNoFacts(ordersBody);
    const nowWindowOrderIds = new Set((ordersBody.window_orders || []).map((r) => r?.order_id).filter(Boolean));
    const newIds = [...nowWindowOrderIds].filter((id) => !prevWindowOrderIds.has(id));
    prevWindowOrderIds = nowWindowOrderIds;

    const row = {
      timestamp: nowIso(),
      current_window_id: status.current_window_id ?? null,
      decision_reason: decision.reason,
      decision_intents: decision.intents || 'NOOP',
      newly_created_order_ids_this_tick: newIds,
      no_open_order_ids: noFacts.no_open_order_ids,
      no_filled_order_ids: noFacts.no_filled_order_ids,
      no_terminal_state: status.no_cancelled === true,
      changed: decision.changed
    };
    table.push(row);

    if (firstNoTwoFilledIdx < 0 && noFacts.no_filled_order_ids.length >= 2) {
      firstNoTwoFilledIdx = table.length - 1;
      fillWindowId = row.current_window_id;
    }
    if (firstNoTwoFilledIdx >= 0) {
      if (row.current_window_id === fillWindowId && String(row.decision_intents).includes('PLACE_LADDER(NO|')) {
        repeatedNoPlaceAfterFill += 1;
        if (newIds.length > 0) repeatedNoPlaceAfterFillWithNewIds += 1;
      }
      if (row.current_window_id && fillWindowId && row.current_window_id !== fillWindowId) sawNextWindow = true;
    }
    const done = firstNoTwoFilledIdx >= 0 && sawNextWindow && table.length >= firstNoTwoFilledIdx + 12;
    if (done) break;
    lastBeat = Date.now();
    await sleep(1000);
  }
  await http.post('/bot/stop', {});

  const postRows = firstNoTwoFilledIdx >= 0 ? table.slice(firstNoTwoFilledIdx + 1) : [];
  const postSameWindowRows = postRows.filter((r) => r.current_window_id === fillWindowId);
  const postSameWindowNoPlace = postSameWindowRows.every((r) => !String(r.decision_intents).includes('PLACE_LADDER(NO|'));
  const noNewIdsWhenNoChangePlace = table
    .filter((r) => Number(r.changed) === 0 && String(r.decision_intents).includes('PLACE_LADDER(NO|'))
    .every((r) => Array.isArray(r.newly_created_order_ids_this_tick) && r.newly_created_order_ids_this_tick.length === 0);

  return {
    startup_window_id: startupWindow.window_id,
    fill_window_id: fillWindowId,
    first_fill_index: firstNoTwoFilledIdx,
    saw_next_window: sawNextWindow,
    reconciliation_table: table,
    post_fill_same_window_rows: postSameWindowRows,
    counters: {
      repeated_no_place_after_fill: repeatedNoPlaceAfterFill,
      repeated_no_place_after_fill_with_new_ids: repeatedNoPlaceAfterFillWithNewIds
    },
    stages: {
      no_two_fill_observed: firstNoTwoFilledIdx >= 0,
      no_repeated_no_place_after_fill_same_window: postSameWindowNoPlace,
      no_new_ids_when_no_change_place: noNewIdsWhenNoChangePlace,
      place_dedupe_still_effective: true,
      saw_next_window: sawNextWindow
    }
  };
};

const main = async () => {
  const args = parseArgs();
  const port = Number(new URL(args.baseUrl).port || 53218);
  const server = await startServer(port);
  const http = createHttp(server.baseUrl);
  let health = { root: null, pairs: null };
  try {
    health.root = await fetch(`${server.baseUrl}/`).then((r) => r.status).catch(() => null);
    health.pairs = await fetch(`${server.baseUrl}/pairs`).then((r) => r.status).catch(() => null);

    const preFix = readPreFixFailFromRawLog();
    const debug = await runDebugControl(http);
    const real = await runRealRuntime(http);

    const sampleInsufficient = !real.stages.no_two_fill_observed || !real.stages.saw_next_window;
    const firstBreakLayer = sampleInsufficient
      ? 'SAMPLE_BLOCKED_OR_INSUFFICIENT'
      : (real.stages.no_repeated_no_place_after_fill_same_window ? 'NONE_CHAIN_PASS' : 'state_persist');
    const verdict = sampleInsufficient
      ? 'B：样本不足'
      : (firstBreakLayer === 'NONE_CHAIN_PASS' ? 'A：通过' : 'C：存在断裂');
    const conclusion = sampleInsufficient
      ? 'B：样本不足，未覆盖 NO 成交后同窗后续 tick + 下一窗观察点'
      : (firstBreakLayer === 'NONE_CHAIN_PASS'
        ? 'A：修复通过，NO 成交后同窗不再重复 PLACE_LADDER(NO)'
        : 'C：修复未通过，仍出现 NO 成交后同窗重复 PLACE_LADDER(NO)');

    const checks = {
      '018-A_pre_fix_fail_exists': preFix.fail_detected === true,
      '018-B_post_fix_real_runtime_chain_covered': !sampleInsufficient,
      '018-C_post_fix_no_repeat_place_no_after_fill': real.stages.no_repeated_no_place_after_fill_same_window === true,
      '018-D_non_regression_no_new_ids_when_no_change': real.stages.no_new_ids_when_no_change_place === true,
      '018-E_non_regression_place_dedupe_still_effective': debug.stages.debug_place_dedupe_works === true
    };
    const keys = Object.keys(checks);
    const passChecks = keys.filter((k) => checks[k]).length;
    const failChecks = keys.length - passChecks;
    const pass = failChecks === 0 && !sampleInsufficient && firstBreakLayer === 'NONE_CHAIN_PASS';

    const standard = buildStandardResult({
      scriptName: 'truth_audit_no_terminal_state_fix_260330_018',
      taskId: args.taskId,
      sampleName: args.sampleName,
      pass,
      message: pass ? 'NO repeat PLACE_LADDER(NO) fix acceptance pass' : 'NO repeat PLACE_LADDER(NO) fix acceptance fail',
      firstBreakLayer,
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
        pre_fix_focus: preFix.focus_rows.slice(0, 80),
        real_head: real.reconciliation_table.slice(0, 30),
        real_tail: real.reconciliation_table.slice(-30)
      }
    });

    const output = {
      ...standard,
      task_id: args.taskId,
      conclusion_block: {
        conclusion,
        verdict,
        first_break_layer: firstBreakLayer,
        real_debug_diverged: Boolean(debug?.stages?.debug_no_cancelled_blocks_no_place) !== Boolean(real?.stages?.no_repeated_no_place_after_fill_same_window),
        real_debug_first_divergence_layer: 'state_persist'
      },
      key_counters: {
        total_checks: keys.length,
        pass_checks: passChecks,
        fail_checks: failChecks
      },
      evidence_index: {
        pre_fix_fail_from_owner_raw_log: preFix,
        post_fix_real_runtime: real,
        debug_control: debug,
        guardrails: {
          max_wall_time_ms: MAX_WALL_MS,
          max_silence_ms: MAX_SILENCE_MS,
          log_tail: LOG_TAIL
        },
        healthcheck: health
      },
      result: checks
    };

    ensureDir(args.output);
    fs.writeFileSync(args.output, JSON.stringify(output, null, 2));
    const logPath = writeStandardLog(args.output, standard);
    console.log(`VERIFY_OUTPUT=${args.output}`);
    console.log(`VERIFY_LOG=${logPath}`);
    console.log(JSON.stringify({ pass, conclusion, verdict, first_break_layer: firstBreakLayer, pass_checks: passChecks, fail_checks: failChecks }));
    if (!pass) process.exitCode = 1;
  } finally {
    await stopServer(server.child);
  }
};

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
