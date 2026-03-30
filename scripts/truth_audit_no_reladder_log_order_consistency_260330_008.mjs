import fs from 'fs';
import path from 'path';
import { execSync, spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { createBotRunner } from '../strategies/crypto_binary/bot_runner.mjs';
import { summarizeIntents } from '../strategies/crypto_binary/bot_strategy_contract.mjs';
import { decideBotAction } from '../strategies/crypto_binary/bot_strategy.mjs';
import { buildStandardResult, ensureDir, parseVerifyArgs, writeStandardLog } from './verify_standard_v1.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_TASK_ID = '260330_008';

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: 'http://localhost:53218',
  defaultOutputSuffix: 'truth_audit_no_reladder_log_order_consistency',
  defaultSampleName: 'no_reladder_log_order_consistency_v1'
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const importOldDecide = async () => {
  const oldSource = execSync('git show HEAD~1:strategies/crypto_binary/bot_strategy.mjs', { cwd: REPO_ROOT, encoding: 'utf8' });
  const contractAbs = path.join(REPO_ROOT, 'strategies', 'crypto_binary', 'bot_strategy_contract.mjs').replace(/\\/g, '/');
  const rewritten = oldSource.replace("from './bot_strategy_contract.mjs';", `from 'file:///${contractAbs}';`);
  const mod = await import(`data:text/javascript,${encodeURIComponent(rewritten)}`);
  return { decide: mod.decideBotAction, source: oldSource };
};

const createHarness = (decideFn) => {
  let state = {
    current_window_id: null,
    last_window_id: null,
    window_initialized_at: null,
    ladder_posted: false,
    yes_order_ids: [],
    no_order_ids: [],
    yes_cancelled: false,
    no_cancelled: false,
    up_formula_cancelled: false,
    down_formula_cancelled: false
  };
  let orderSeq = 1;
  let orders = [];
  const logs = [];
  const nowIso = () => new Date().toISOString();
  const createOrder = (payload) => ({
    order_id: `h_${orderSeq++}`,
    kind: payload.kind || 'ENTRY',
    side: payload.side,
    price: payload.price,
    size: payload.size,
    tp_price: payload.tp_price ?? null,
    parent_order_id: payload.parent_order_id ?? null,
    status: 'OPEN',
    fill_price: null,
    filled_at: null,
    created_at: nowIso(),
    window_id: payload.window_id ?? null
  });
  const getState = () => ({ ...state });
  const patchState = (patch = {}) => {
    state = { ...state, ...patch, updated_at: nowIso() };
    return { ...state };
  };
  const getContext = async () => ({});
  const log = (entry) => {
    logs.push({ ...entry, ts: nowIso() });
  };
  const getSummary = () => {
    const openOrders = orders.filter((o) => o.status === 'OPEN');
    return {
      open_total: openOrders.length,
      cancelled_total: orders.filter((o) => o.status === 'CANCELLED').length,
      filled_total: orders.filter((o) => o.status === 'FILLED').length
    };
  };
  const getOrders = () => orders.map((o) => ({ ...o }));
  const cancelOpenBySide = (side) => {
    let changed = 0;
    orders = orders.map((o) => {
      if (o.status !== 'OPEN') return o;
      if (side !== 'ALL' && o.side !== side) return o;
      changed += 1;
      return { ...o, status: 'CANCELLED' };
    });
    return changed;
  };
  const applyIntents = (intents, options = {}) => {
    const applied = [];
    let changed = 0;
    intents.forEach((intent) => {
      if (!intent || typeof intent !== 'object') return;
      if (intent.kind === 'PLACE_LADDER') {
        const side = intent.side === 'NO' ? 'NO' : (intent.side === 'YES' ? 'YES' : null);
        const ladder = Array.isArray(intent.ladder) ? intent.ladder : [];
        if (!side) return;
        ladder.forEach((item) => {
          orders.push(createOrder({
            kind: 'ENTRY',
            side,
            price: Number(item.price),
            size: Number(item.size),
            tp_price: Number(item.tp_price),
            window_id: String(options?.source || '').split('window=')[1] || null
          }));
          changed += 1;
        });
        applied.push({ action: `PLACE_${side}`, changed: ladder.length });
        return;
      }
      if (intent.kind === 'CANCEL_OPEN') {
        const side = intent.side === 'YES' || intent.side === 'NO' ? intent.side : 'ALL';
        const c = cancelOpenBySide(side);
        changed += c;
        applied.push({ action: `CANCEL_${side}`, changed: c });
      }
    });
    return { changed, applied, summary: getSummary(), orders: getOrders() };
  };
  const applyFills = (context = {}) => {
    const askYes = Number.isFinite(Number(context.ask_yes)) ? Number(context.ask_yes) : null;
    const askNo = Number.isFinite(Number(context.ask_no)) ? Number(context.ask_no) : null;
    const bidYes = Number.isFinite(Number(context.bid_yes)) ? Number(context.bid_yes) : null;
    const bidNo = Number.isFinite(Number(context.bid_no)) ? Number(context.bid_no) : null;
    const filled = [];
    const tpCreate = [];
    orders = orders.map((o) => {
      if (o.status !== 'OPEN') return o;
      if (o.kind === 'ENTRY' && o.side === 'YES' && askYes != null && o.price >= askYes) {
        const next = { ...o, status: 'FILLED', fill_price: askYes, filled_at: nowIso() };
        filled.push(next);
        if (Number.isFinite(o.tp_price) && Number(o.tp_price) < 1) {
          tpCreate.push(createOrder({
            kind: 'TAKE_PROFIT',
            side: 'YES',
            price: Number(o.tp_price),
            size: Number(o.size),
            tp_price: Number(o.tp_price),
            parent_order_id: o.order_id,
            window_id: o.window_id ?? null
          }));
        }
        return next;
      }
      if (o.kind === 'ENTRY' && o.side === 'NO' && askNo != null && o.price >= askNo) {
        const next = { ...o, status: 'FILLED', fill_price: askNo, filled_at: nowIso() };
        filled.push(next);
        if (Number.isFinite(o.tp_price) && Number(o.tp_price) < 1) {
          tpCreate.push(createOrder({
            kind: 'TAKE_PROFIT',
            side: 'NO',
            price: Number(o.tp_price),
            size: Number(o.size),
            tp_price: Number(o.tp_price),
            parent_order_id: o.order_id,
            window_id: o.window_id ?? null
          }));
        }
        return next;
      }
      if (o.kind === 'TAKE_PROFIT' && o.side === 'YES' && bidYes != null && bidYes >= o.price) {
        const next = { ...o, status: 'FILLED', fill_price: o.price, filled_at: nowIso() };
        filled.push(next);
        return next;
      }
      if (o.kind === 'TAKE_PROFIT' && o.side === 'NO' && bidNo != null && bidNo >= o.price) {
        const next = { ...o, status: 'FILLED', fill_price: o.price, filled_at: nowIso() };
        filled.push(next);
        return next;
      }
      return o;
    });
    if (tpCreate.length > 0) orders = [...orders, ...tpCreate];
    return { changed: filled.length + tpCreate.length, filled_orders: filled, summary: getSummary(), orders: getOrders() };
  };
  const runner = createBotRunner({
    getContext,
    getState,
    patchState,
    decide: ({ config, context, state }) => decideFn({ config, context, state }),
    applyIntents,
    applyFills,
    getOrders,
    getSummary,
    log,
    config: {
      open_delay_sec: 0,
      cancel_all_remaining_sec: 100,
      up_ladder: [{ price: 0.4, size: 2, tp_price: 0.85 }, { price: 0.1, size: 2, tp_price: 1 }],
      down_ladder: [{ price: 0.4, size: 1, tp_price: 0.9 }, { price: 0.3, size: 2, tp_price: 1 }],
      up_cancel: { before_end_sec: 120, formula: '' },
      down_cancel: { before_end_sec: 60, formula: '' }
    }
  });
  const runTick = async ({ label, remaining, contextPatch = {}, stateOverride = {} }) => {
    const w = 'w-harness-008';
    const result = await runner.runSingleTick({
      state_override: stateOverride,
      context_override: {
        window_id: w,
        period: '5m',
        remaining_sec: remaining,
        btc_price: 65000,
        atr_5m: 90,
        bid_yes: 0.01,
        ask_yes: 0.99,
        bid_no: 0.01,
        ask_no: 0.99,
        upper_bound: 70000,
        lower_bound: 60000,
        ...contextPatch
      }
    });
    const openYes = orders.filter((o) => o.kind === 'ENTRY' && o.side === 'YES' && o.status === 'OPEN').length;
    const openNo = orders.filter((o) => o.kind === 'ENTRY' && o.side === 'NO' && o.status === 'OPEN').length;
    const lastIntentLog = [...logs].reverse().find((l) => l.event === 'BOT_INTENTS')?.message || null;
    return {
      label,
      remaining,
      reason: result.decision_preview?.reason || null,
      intents: result.decision_preview?.intents_summary || summarizeIntents(result.decision_preview?.intents || []),
      open_yes: openYes,
      open_no: openNo,
      last_intent_log: lastIntentLog
    };
  };
  return { runTick };
};

const runHarnessTimeline = async (decideFn) => {
  const harness = createHarness(decideFn);
  const initState = {
    current_window_id: 'w-harness-008',
    window_initialized_at: new Date(Date.now() - 45000).toISOString(),
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
  const timeline = [];
  timeline.push(await harness.runTick({ label: 'place', remaining: 250, stateOverride: initState }));
  timeline.push(await harness.runTick({ label: 'yes_fill', remaining: 240, contextPatch: { ask_yes: 0.39, ask_no: 0.99, bid_yes: 0.2 } }));
  timeline.push(await harness.runTick({ label: 'up_cancel_120', remaining: 120 }));
  timeline.push(await harness.runTick({ label: 'down_cancel_60', remaining: 60 }));
  timeline.push(await harness.runTick({ label: 'observe_55', remaining: 55 }));
  timeline.push(await harness.runTick({ label: 'observe_50', remaining: 50 }));
  return timeline;
};

const startServer = async (port) => {
  const child = spawn(process.execPath, ['strategies/crypto_binary/server.mjs', `--port=${port}`], {
    cwd: REPO_ROOT,
    stdio: 'ignore'
  });
  const baseUrl = `http://localhost:${port}`;
  const waitReady = async () => {
    const start = Date.now();
    while (Date.now() - start < 45000) {
      try {
        const r = await fetch(`${baseUrl}/bot/status`);
        if (r.status === 200) return true;
      } catch {}
      await sleep(250);
    }
    return false;
  };
  const ok = await waitReady();
  if (!ok) {
    child.kill();
    throw new Error('real runtime server start failed');
  }
  return { child, baseUrl };
};

const stopServer = async (child) => {
  if (!child || child.killed) return;
  child.kill();
  await sleep(600);
};

const createHttp = (baseUrl) => ({
  get: (endpoint) => fetch(`${baseUrl}${endpoint}`).then(async (r) => ({ status: r.status, body: await r.json() })),
  post: (endpoint, body = {}) => fetch(`${baseUrl}${endpoint}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  }).then(async (r) => ({ status: r.status, body: await r.json() }))
});

const runRealRuntimeTimeline = async (baseUrl) => {
  const http = createHttp(baseUrl);
  const w = 'w-real-008';
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
  const initState = {
    current_window_id: w,
    window_initialized_at: new Date(Date.now() - 45000).toISOString(),
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
  const runTick = async ({ label, remaining, contextPatch = {}, stateOverride = {} }) => {
    const tickRes = await http.post('/bot/runner/tick', {
      state_override: stateOverride,
      context_override: {
        window_id: w,
        period: '5m',
        remaining_sec: remaining,
        btc_price: 65000,
        atr_5m: 90,
        bid_yes: 0.01,
        ask_yes: 0.99,
        bid_no: 0.01,
        ask_no: 0.99,
        upper_bound: 70000,
        lower_bound: 60000,
        ...contextPatch
      }
    });
    const ordersRes = await http.get('/bot/orders');
    const logsRes = await http.get('/bot/logs?limit=40');
    const windowOrders = (ordersRes.body?.all_orders || []).filter((o) => (o.resolved_window_id || o.window_id || o.inferred_window_id) === w);
    const openYes = windowOrders.filter((o) => o.kind === 'ENTRY' && o.side === 'YES' && o.status === 'OPEN').length;
    const openNo = windowOrders.filter((o) => o.kind === 'ENTRY' && o.side === 'NO' && o.status === 'OPEN').length;
    const lastIntentLog = (logsRes.body || []).filter((l) => l.event === 'BOT_INTENTS').slice(-1)[0]?.message || null;
    return {
      label,
      remaining,
      reason: tickRes.body?.decision_preview?.reason || null,
      intents: tickRes.body?.decision_preview?.intents_summary || null,
      open_yes: openYes,
      open_no: openNo,
      last_intent_log: lastIntentLog
    };
  };
  const timeline = [];
  timeline.push(await runTick({ label: 'place', remaining: 250, stateOverride: initState }));
  timeline.push(await runTick({ label: 'yes_fill', remaining: 240, contextPatch: { ask_yes: 0.39, ask_no: 0.99, bid_yes: 0.2 } }));
  timeline.push(await runTick({ label: 'up_cancel_120', remaining: 120 }));
  timeline.push(await runTick({ label: 'down_cancel_60', remaining: 60 }));
  await sleep(11000);
  timeline.push(await runTick({ label: 'observe_after_10s', remaining: 50 }));
  return timeline;
};

const main = async () => {
  const args = parseArgs();
  const { decide: oldDecide, source: oldStrategySource } = await importOldDecide();
  const preTimeline = await runHarnessTimeline(oldDecide);
  const postHarnessTimeline = await runHarnessTimeline(decideBotAction);
  const server = await startServer(53218);
  let runtimeTimeline = [];
  let health = { root: null, pairs: null };
  try {
    health.root = await fetch(`${server.baseUrl}/`).then((r) => r.status).catch(() => null);
    health.pairs = await fetch(`${server.baseUrl}/pairs`).then((r) => r.status).catch(() => null);
    runtimeTimeline = await runRealRuntimeTimeline(server.baseUrl);
  } finally {
    await stopServer(server.child);
  }

  const checks = {
    '008-A_pre_fix_reladder_after_120_60_and_log_misreport': preTimeline[4].reason === 'ladder_not_posted'
      && String(preTimeline[4].intents || '').includes('PLACE_LADDER')
      && preTimeline[4].open_yes === 0
      && preTimeline[4].open_no === 0,
    '008-B_pre_fix_unique_first_break_layer_terminal_guard_missing': oldStrategySource.includes('if (!ladderPosted) {')
      && !oldStrategySource.includes('window_cancel_terminal_after_directional_before_end'),
    '008-C_post_fix_no_reladder_and_no_false_place_after_120_60': postHarnessTimeline[4].reason === 'window_cancel_terminal_after_directional_before_end'
      && postHarnessTimeline[4].intents === 'NOOP'
      && postHarnessTimeline[4].open_yes === 0
      && postHarnessTimeline[4].open_no === 0,
    '008-D_post_fix_log_order_table_consistent': runtimeTimeline[4]?.intents === 'NOOP'
      && runtimeTimeline[4]?.last_intent_log === 'NOOP'
      && runtimeTimeline[4]?.open_yes === 0
      && runtimeTimeline[4]?.open_no === 0,
    '008-E_non_regression_260329_004_wait_next_window_still_exists': fs.readFileSync(path.join(REPO_ROOT, 'strategies', 'crypto_binary', 'bot_runner.mjs'), 'utf8').includes('wait_next_window_after_start'),
    '008-F_non_regression_260329_007_window_scope_chain_untouched': fs.readFileSync(path.join(REPO_ROOT, 'ui', 'js', 'strategy-editor.js'), 'utf8').includes('resolved_window_id ?? item?.inferred_window_id'),
    '008-G_non_regression_260329_008_260330_006_directional_before_end_kept': runtimeTimeline[2]?.reason === 'up_cancel_before_end' && runtimeTimeline[3]?.reason === 'down_cancel_before_end',
    '008-H_non_regression_260330_005_key_log_place_kept': runtimeTimeline[0]?.last_intent_log?.includes('PLACE_LADDER(') === true
  };

  const keys = Object.keys(checks);
  const passChecks = keys.filter((k) => checks[k]).length;
  const failChecks = keys.length - passChecks;
  const pass = failChecks === 0;
  const conclusion = pass ? 'A：同窗撤单后重挂/误报链路已修复，日志与订单状态表一致' : 'C：同窗撤单后重挂/误报链路未完全修复';
  const firstBreakLayer = pass ? '1）同窗口撤单后终态/防重挂判定层' : '1）同窗口撤单后终态/防重挂判定层';

  const standard = buildStandardResult({
    scriptName: 'truth_audit_no_reladder_log_order_consistency_260330_008',
    taskId: args.taskId,
    sampleName: args.sampleName,
    pass,
    message: pass ? '同窗撤单后重挂/误报修复通过' : '同窗撤单后重挂/误报修复失败',
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
      pre_timeline: preTimeline,
      post_harness_timeline: postHarnessTimeline,
      real_runtime_timeline: runtimeTimeline
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
      pre_fix_timeline: preTimeline,
      post_fix_harness_timeline: postHarnessTimeline,
      real_runtime_timeline: runtimeTimeline,
      healthcheck: health
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
    first_break_layer: firstBreakLayer,
    pass_checks: passChecks,
    fail_checks: failChecks
  }));
  if (!pass) process.exitCode = 1;
};

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
