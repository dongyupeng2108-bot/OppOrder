import fs from 'fs';
import path from 'path';
import { execSync, spawn } from 'child_process';
import { fileURLToPath, pathToFileURL } from 'url';
import { buildStandardResult, ensureDir, parseVerifyArgs, writeStandardLog } from './verify_standard_v1.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_TASK_ID = '260330_012';
const MAX_WALL_MS = 25 * 60 * 1000;
const MAX_SILENCE_MS = 120 * 1000;
const LOG_TAIL = 120;

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: 'http://localhost:53212',
  defaultOutputSuffix: 'truth_audit_startup_wait_release',
  defaultSampleName: 'startup_wait_release_v1'
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
    async get(endpoint) {
      return withRetry(async () => {
        const res = await fetch(`${baseUrl}${endpoint}`);
        return { status: res.status, body: await toJson(res) };
      });
    },
    async post(endpoint, body = {}) {
      return withRetry(async () => {
        const res = await fetch(`${baseUrl}${endpoint}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body)
        });
        return { status: res.status, body: await toJson(res) };
      });
    }
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

const importRunnerFactory = async (sourceText) => {
  const absContract = pathToFileURL(path.join(REPO_ROOT, 'strategies', 'crypto_binary', 'bot_strategy_contract.mjs')).href;
  const rewritten = sourceText.replace("from './bot_strategy_contract.mjs';", `from '${absContract}';`);
  const mod = await import(`data:text/javascript,${encodeURIComponent(rewritten)}`);
  return mod.createBotRunner;
};

const runControlledDiff = async () => {
  const oldRunnerSrc = execSync('git show HEAD~1:strategies/crypto_binary/bot_runner.mjs', { cwd: REPO_ROOT, encoding: 'utf8' });
  const newRunnerSrc = fs.readFileSync(path.join(REPO_ROOT, 'strategies', 'crypto_binary', 'bot_runner.mjs'), 'utf8');
  const oldCreateRunner = await importRunnerFactory(oldRunnerSrc);
  const newCreateRunner = await importRunnerFactory(newRunnerSrc);
  const execute = async (createRunner, label) => {
    let state = {
      current_window_id: null,
      window_initialized_at: null,
      ladder_posted: false,
      yes_order_ids: [],
      no_order_ids: [],
      yes_cancelled: false,
      no_cancelled: false
    };
    const logs = [];
    const getState = () => ({ ...state });
    const patchState = (patch = {}) => {
      state = { ...state, ...patch, updated_at: nowIso() };
      return { ...state };
    };
    const runner = createRunner({
      getContext: async () => ({}),
      getState,
      patchState,
      decide: () => ({ intents: [{ kind: 'PLACE_LADDER', side: 'YES', ladder: [{ price: 0.4, size: 1, tp_price: 0.8 }] }], reason: 'ladder_not_posted', patches: {}, diagnostics: {} }),
      applyIntents: (intents = []) => ({ changed: intents.some((i) => i.kind === 'PLACE_LADDER') ? 1 : 0, applied: intents, summary: { open_total: 1, cancelled_total: 0, filled_total: 0 }, orders: [] }),
      applyFills: () => ({ changed: 0, filled_orders: [], summary: { open_total: 1, cancelled_total: 0, filled_total: 0 }, orders: [] }),
      getOrders: () => [],
      getSummary: () => ({ open_total: 1, cancelled_total: 0, filled_total: 0 }),
      log: (entry) => logs.push({ ...entry }),
      config: {}
    });
    runner.start(999999);
    await runner.runSingleTick({
      context_override: { window_id: 'w-stuck', remaining_sec: 10, btc_price: 65000, atr_5m: 90 }
    });
    const second = await runner.runSingleTick({
      context_override: { window_id: 'w-stuck', remaining_sec: 300, btc_price: 65010, atr_5m: 90 }
    });
    const third = await runner.runSingleTick({
      context_override: { window_id: 'w-stuck', remaining_sec: 299, btc_price: 65010, atr_5m: 90 }
    });
    runner.stop();
    const gated = logs.filter((l) => l.event === 'BOT_DECISION_GATED').map((l) => l.message);
    return {
      label,
      second_reason: second?.decision_preview?.reason || null,
      second_intents: second?.decision_preview?.intents_summary || null,
      third_reason: third?.decision_preview?.reason || null,
      third_intents: third?.decision_preview?.intents_summary || null,
      gated_messages: gated
    };
  };
  const oldResult = await execute(oldCreateRunner, 'pre_fix_controlled');
  const newResult = await execute(newCreateRunner, 'post_fix_controlled');
  return { oldResult, newResult };
};

const runRealRuntime = async (http) => {
  const begin = Date.now();
  let lastBeat = Date.now();
  const timeline = [];
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
  const waitStartWindow = async () => {
    while (true) {
      if (Date.now() - begin > MAX_WALL_MS) throw new Error('MAX_WALL_TIME_EXCEEDED_BEFORE_START');
      const contextRes = await http.get('/bot/context');
      const windowId = contextRes.body?.window_id ?? null;
      const rem = toFinite(contextRes.body?.remaining_sec);
      if (windowId && rem !== null && rem <= 90) return { window_id: windowId, remaining_sec: rem };
      await sleep(1000);
    }
  };
  const startWindow = await waitStartWindow();
  await http.post('/bot/start', { tick_interval_ms: 1000 });
  lastBeat = Date.now();
  let observedRelease = false;
  let observedNewWindow = false;
  for (let i = 0; i < 400; i += 1) {
    if (Date.now() - begin > MAX_WALL_MS) throw new Error('MAX_WALL_TIME_EXCEEDED');
    if (Date.now() - lastBeat > MAX_SILENCE_MS) throw new Error('MAX_SILENCE_EXCEEDED');
    const statusRes = await http.get('/bot/status');
    const contextRes = await http.get('/bot/context');
    const ordersRes = await http.get('/bot/orders');
    const logsRes = await http.get(`/bot/logs?limit=${LOG_TAIL}`);
    const logs = Array.isArray(logsRes.body) ? logsRes.body : [];
    const lastIntent = [...logs].reverse().find((row) => row?.event === 'BOT_INTENTS') || null;
    const recentIntents = logs.filter((row) => row?.event === 'BOT_INTENTS').slice(-3).map((row) => row?.message || '');
    const lastGate = [...logs].reverse().find((row) => row?.event === 'BOT_DECISION_GATED') || null;
    const released = [...logs].reverse().find((row) => row?.event === 'BOT_STARTUP_WAIT_RELEASED') || null;
    const currentWindow = statusRes.body?.current_window_id ?? contextRes.body?.window_id ?? null;
    const orderCount = Array.isArray(ordersRes.body?.all_orders) ? ordersRes.body.all_orders.length : 0;
    const row = {
      t: i,
      at: nowIso(),
      startup_window_id: startWindow.window_id,
      current_window_id: currentWindow,
      remaining_sec: contextRes.body?.remaining_sec ?? null,
      gated_reason: lastGate?.message ?? null,
      intents_summary: lastIntent?.message ?? null,
      recent_intents: recentIntents,
      order_count: orderCount
    };
    timeline.push(row);
    if (released) observedRelease = true;
    if (currentWindow && currentWindow !== startWindow.window_id) observedNewWindow = true;
    const postStartInStartupWindow = currentWindow === startWindow.window_id && i > 1;
    const gotPlaceAfterRelease = observedRelease && typeof lastIntent?.message === 'string' && lastIntent.message.includes('PLACE_LADDER(');
    if (postStartInStartupWindow && row.intents_summary && row.intents_summary.includes('PLACE_LADDER(')) {
      throw new Error('REGRESSION_CURRENT_WINDOW_PLACED');
    }
    if (observedNewWindow && gotPlaceAfterRelease) {
      await http.post('/bot/stop', {});
      return { startWindow, timeline, observedRelease, observedNewWindow };
    }
    lastBeat = Date.now();
    await sleep(1000);
  }
  await http.post('/bot/stop', {});
  return { startWindow, timeline, observedRelease, observedNewWindow };
};

const main = async () => {
  const args = parseArgs();
  const port = Number(new URL(args.baseUrl).port || 53212);
  const controlled = await runControlledDiff();
  const server = await startServer(port);
  const http = createHttp(server.baseUrl);
  let runtime = null;
  let health = { root: null, pairs: null };
  try {
    health.root = await fetch(`${server.baseUrl}/`).then((r) => r.status).catch(() => null);
    health.pairs = await fetch(`${server.baseUrl}/pairs`).then((r) => r.status).catch(() => null);
    runtime = await runRealRuntime(http);
  } finally {
    await stopServer(server.child);
  }

  const tail = runtime.timeline.slice(-20);
  const firstPart = runtime.timeline.slice(0, 10);
  const hasPersistentPreGate = firstPart.every((r) => r.gated_reason === 'wait_next_window_after_start');
  const hasLegalPlaceAfterRelease = runtime.timeline.some((r) => r.current_window_id !== runtime.startWindow.window_id && String(r.intents_summary || '').includes('PLACE_LADDER('));
  const noPlaceInStartupWindow = runtime.timeline.filter((r) => r.current_window_id === runtime.startWindow.window_id).every((r) => !String(r.intents_summary || '').includes('PLACE_LADDER('));
  const noOrderGrowthOnNoop = runtime.timeline.every((r, idx, arr) => {
    if (idx === 0) return true;
    const prev = arr[idx - 1];
    if (Number(r.order_count) <= Number(prev.order_count)) return true;
    const single = String(r.intents_summary || '');
    const recent = Array.isArray(r.recent_intents) ? r.recent_intents.join(' | ') : '';
    return single.includes('PLACE_LADDER(') || recent.includes('PLACE_LADDER(');
  });

  const checks = {
    '012-A_pre_fix_controlled_fail_wait_not_released': controlled.oldResult.second_reason === 'wait_next_window_after_start'
      && String(controlled.oldResult.second_intents || '').trim() === 'NOOP',
    '012-B_post_fix_controlled_pass_wait_released': controlled.newResult.second_reason === 'gate_context_not_ready_window_init'
      && controlled.newResult.gated_messages.includes('wait_next_window_after_start')
      && controlled.newResult.gated_messages.includes('gate_context_not_ready_window_init'),
    '012-C_real_runtime_start_window_still_blocked': hasPersistentPreGate && noPlaceInStartupWindow,
    '012-D_real_runtime_cross_window_release_and_decision': runtime.observedNewWindow && runtime.observedRelease && hasLegalPlaceAfterRelease,
    '012-E_non_regression_no_order_growth_on_non_place_tick': noOrderGrowthOnNoop
  };
  const keys = Object.keys(checks);
  const passChecks = keys.filter((k) => checks[k]).length;
  const failChecks = keys.length - passChecks;
  const pass = failChecks === 0;
  const firstBreakLayer = 'context';
  const conclusion = pass
    ? 'A：wait_next_window_after_start 已收口为仅阻断启动窗口，跨新窗口后放行'
    : 'C：context->ready 门控仍存在卡死或放行异常';

  const standard = buildStandardResult({
    scriptName: 'truth_audit_startup_wait_release_260330_012',
    taskId: args.taskId,
    sampleName: args.sampleName,
    pass,
    message: pass ? 'startup wait 跨窗放行修复通过' : 'startup wait 跨窗放行修复失败',
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
      pre_fix_controlled: controlled.oldResult,
      post_fix_controlled: controlled.newResult,
      real_runtime_head: firstPart,
      real_runtime_tail: tail
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
      controlled,
      real_runtime: runtime,
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
};

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
