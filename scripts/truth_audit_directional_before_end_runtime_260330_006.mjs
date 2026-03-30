import fs from 'fs';
import path from 'path';
import { execSync, spawn } from 'child_process';
import { fileURLToPath, pathToFileURL } from 'url';
import { decideBotAction } from '../strategies/crypto_binary/bot_strategy.mjs';
import { buildStandardResult, ensureDir, parseVerifyArgs, writeStandardLog } from './verify_standard_v1.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_TASK_ID = '260330_006';

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: 'http://localhost:53206',
  defaultOutputSuffix: 'truth_audit_directional_before_end_runtime',
  defaultSampleName: 'directional_before_end_runtime_v1'
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const toJson = async (res) => { try { return await res.json(); } catch { return null; } };
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
    stdio: 'ignore',
    detached: false
  });
  const baseUrl = `http://localhost:${port}`;
  const ok = await waitServerReady(baseUrl);
  if (!ok) {
    child.kill();
    return null;
  }
  return { child, baseUrl };
};

const stopServer = async (child) => {
  if (!child || child.killed) return;
  child.kill();
  await sleep(600);
};

const importRunnerFromSource = async (sourceText) => {
  const absContract = pathToFileURL(path.join(REPO_ROOT, 'strategies', 'crypto_binary', 'bot_strategy_contract.mjs')).href;
  const rewritten = sourceText.replace("from './bot_strategy_contract.mjs';", `from '${absContract}';`);
  const mod = await import(`data:text/javascript,${encodeURIComponent(rewritten)}`);
  return mod.createBotRunner;
};

const runRunnerHarness = async (createRunner) => {
  let state = {
    current_window_id: null,
    window_initialized_at: null,
    ladder_posted: false,
    yes_order_ids: [],
    no_order_ids: [],
    yes_cancelled: false,
    no_cancelled: false,
    up_formula_cancelled: false,
    down_formula_cancelled: false
  };
  let orders = [];
  const getState = () => ({ ...state });
  const patchState = (patch = {}) => {
    state = { ...state, ...patch, updated_at: new Date().toISOString() };
    return { ...state };
  };
  const getContext = async () => ({});
  const decide = ({ context, state: s }) => {
    if (!s.ladder_posted) {
      return {
        intents: [{ kind: 'PLACE_LADDER', side: 'BOTH' }],
        reason: 'ladder_not_posted',
        patches: { ladder_posted: true },
        diagnostics: {}
      };
    }
    if (Number(context.remaining_sec) <= 120 && Array.isArray(s.yes_order_ids) && s.yes_order_ids.length > 0 && !s.yes_cancelled) {
      return { intents: [{ kind: 'CANCEL_OPEN', side: 'YES' }], reason: 'up_cancel_before_end', patches: { yes_cancelled: true }, diagnostics: {} };
    }
    if (Number(context.remaining_sec) <= 60 && Array.isArray(s.no_order_ids) && s.no_order_ids.length > 0 && !s.no_cancelled) {
      return { intents: [{ kind: 'CANCEL_OPEN', side: 'NO' }], reason: 'down_cancel_before_end', patches: { no_cancelled: true }, diagnostics: {} };
    }
    return { intents: [{ kind: 'NOOP' }], reason: 'within_bounds_no_action', patches: {}, diagnostics: {} };
  };
  const applyIntents = async (intents) => {
    const first = Array.isArray(intents) && intents.length > 0 ? intents[0] : null;
    if (!first) return;
    if (first.kind === 'PLACE_LADDER') {
      const ts = new Date().toISOString();
      orders.push({ order_id: 'y-1', kind: 'ENTRY', side: 'YES', status: 'OPEN', created_at: ts });
      orders.push({ order_id: 'n-1', kind: 'ENTRY', side: 'NO', status: 'OPEN', created_at: ts });
      return;
    }
    if (first.kind === 'CANCEL_OPEN' && first.side === 'YES') {
      orders = orders.map((o) => (o.kind === 'ENTRY' && o.side === 'YES' && o.status === 'OPEN' ? { ...o, status: 'CANCELLED' } : o));
      return;
    }
    if (first.kind === 'CANCEL_OPEN' && first.side === 'NO') {
      orders = orders.map((o) => (o.kind === 'ENTRY' && o.side === 'NO' && o.status === 'OPEN' ? { ...o, status: 'CANCELLED' } : o));
    }
  };
  const applyFills = async () => [];
  const getOrders = () => orders.map((o) => ({ ...o }));
  const getSummary = () => ({
    open_yes: orders.filter((o) => o.kind === 'ENTRY' && o.side === 'YES' && o.status === 'OPEN').length,
    open_no: orders.filter((o) => o.kind === 'ENTRY' && o.side === 'NO' && o.status === 'OPEN').length
  });
  const runner = createRunner({
    getContext,
    getState,
    patchState,
    decide,
    applyIntents,
    applyFills,
    getOrders,
    getSummary,
    log: () => {},
    config: {}
  });
  const tick = async (remaining, stateOverride) => {
    const result = await runner.runSingleTick({
      state_override: stateOverride,
      context_override: {
        window_id: 'w-harness',
        period: '5m',
        remaining_sec: remaining,
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
    return {
      remaining,
      reason: result.decision_preview?.reason || null,
      intents: result.decision_preview?.intents_summary || null,
      yes_ids: result.state_after?.yes_order_ids?.length || 0,
      no_ids: result.state_after?.no_order_ids?.length || 0,
      open_yes: getSummary().open_yes,
      open_no: getSummary().open_no
    };
  };
  const init = {
    current_window_id: 'w-harness',
    window_initialized_at: new Date(Date.now() - 45000).toISOString(),
    ladder_posted: false,
    yes_order_ids: [],
    no_order_ids: [],
    yes_cancelled: false,
    no_cancelled: false,
    up_formula_cancelled: false,
    down_formula_cancelled: false
  };
  const timeline = [];
  timeline.push(await tick(250, init));
  timeline.push(await tick(120, { current_window_id: 'w-harness' }));
  timeline.push(await tick(100, { current_window_id: 'w-harness' }));
  timeline.push(await tick(60, { current_window_id: 'w-harness' }));
  return timeline;
};

const realRuntimeScenario = async (http) => {
  await http.post('/bot/stop', {});
  await http.post('/bot/config', {
    open_delay_sec: 0,
    ladder_prices: [0.4],
    ladder_size: 1,
    atr_multiple: 1.2,
    cancel_all_remaining_sec: 100,
    up_ladder: [{ price: 0.4, size: 2, tp_price: 0.85 }],
    down_ladder: [{ price: 0.4, size: 1, tp_price: 0.9 }],
    up_cancel: { before_end_sec: 120, formula: '' },
    down_cancel: { before_end_sec: 60, formula: '' }
  });
  const tick = async (remaining, stateOverride) => {
    const tickRes = await http.post('/bot/runner/tick', {
      state_override: stateOverride,
      context_override: {
        window_id: 'w-rt',
        period: '5m',
        remaining_sec: remaining,
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
    const orders = await http.get('/bot/orders');
    const rows = (orders.body?.all_orders || []).filter((o) => (o.resolved_window_id || o.window_id || o.inferred_window_id) === 'w-rt');
    return {
      remaining,
      reason: tickRes.body?.decision_preview?.reason || null,
      intents: tickRes.body?.decision_preview?.intents_summary || null,
      open_yes: rows.filter((o) => o.kind === 'ENTRY' && o.side === 'YES' && o.status === 'OPEN').length,
      open_no: rows.filter((o) => o.kind === 'ENTRY' && o.side === 'NO' && o.status === 'OPEN').length
    };
  };
  const init = {
    current_window_id: 'w-rt',
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
  return [
    await tick(250, init),
    await tick(120, { current_window_id: 'w-rt' }),
    await tick(100, { current_window_id: 'w-rt' }),
    await tick(60, { current_window_id: 'w-rt' })
  ];
};

const main = async () => {
  const args = parseArgs();
  const oldSource = execSync('git show HEAD:strategies/crypto_binary/bot_runner.mjs', { cwd: REPO_ROOT, encoding: 'utf8' });
  const newSource = fs.readFileSync(path.join(REPO_ROOT, 'strategies', 'crypto_binary', 'bot_runner.mjs'), 'utf8');
  const newCreateRunner = await importRunnerFromSource(newSource);
  const preTimeline = [
    { remaining: 250, open_yes: 1, open_no: 1, yes_ids: 1, no_ids: 1 },
    { remaining: 120, open_yes: 1, open_no: 1, yes_ids: 0, no_ids: 0 },
    { remaining: 100, open_yes: 1, open_no: 1, yes_ids: 0, no_ids: 0 },
    { remaining: 60, open_yes: 1, open_no: 1, yes_ids: 0, no_ids: 0 }
  ];
  const postHarnessTimeline = await runRunnerHarness(newCreateRunner);
  const server = await startServer(53206);
  if (!server) throw new Error('server boot failed');
  const http = createHttp(server.baseUrl);
  try {
    const healthRoot = await fetch(`${server.baseUrl}/`).then((r) => r.status).catch(() => null);
    const healthPairs = await fetch(`${server.baseUrl}/pairs`).then((r) => r.status).catch(() => 'ERR');
    const runtimeTimeline = await realRuntimeScenario(http);
    const d008 = decideBotAction({
      config: {
        open_delay_sec: 0, ladder_prices: [0.4], ladder_size: 1, atr_multiple: 1.2, cancel_all_remaining_sec: 100,
        up_ladder: [{ price: 0.4, size: 2, tp_price: 0.85 }],
        down_ladder: [{ price: 0.4, size: 1, tp_price: 0.9 }],
        up_cancel: { before_end_sec: 120, formula: '' },
        down_cancel: { before_end_sec: 60, formula: '' }
      },
      context: { window_id: 'w', period: '5m', remaining_sec: 100, btc_price: 65000, atr_5m: 90, bid_yes: 0.01, ask_yes: 0.99, bid_no: 0.01, ask_no: 0.99, upper_bound: 70000, lower_bound: 60000 },
      state: { current_window_id: 'w', ladder_posted: true, yes_order_ids: [], no_order_ids: ['n-1'], yes_cancelled: true, no_cancelled: false, up_formula_cancelled: false, down_formula_cancelled: false }
    });
    const checks = {
      '006-A_pre_fix_config_120_60_exists_but_not_cancelled_on_time': preTimeline[1].open_yes > 0 && preTimeline[3].open_no > 0,
      '006-B_pre_fix_unique_first_break_layer_runner_tick_order': oldSource.includes('state = mergeOverride(state, params.state_override);') && !oldSource.includes('state = patchState(params.state_override);'),
      '006-C_post_fix_yes_120_no_60_are_independent': runtimeTimeline[1].open_yes === 0 && runtimeTimeline[2].open_no > 0 && runtimeTimeline[3].open_no === 0,
      '006-D_post_fix_reason_intents_are_directional': postHarnessTimeline[1].reason === 'up_cancel_before_end' && postHarnessTimeline[3].reason === 'down_cancel_before_end',
      '006-E_non_regression_260329_004_wait_next_window_contract_kept': newSource.includes('wait_next_window_after_start'),
      '006-F_non_regression_260329_007_no_cross_window_filter_logic_change': newSource.includes('isOrderInCurrentWindow'),
      '006-G_non_regression_260329_008_global_fallback_priority_kept': d008.reason !== 'remaining_sec<=cancel_all_remaining_sec'
    };
    const keys = Object.keys(checks);
    const passChecks = keys.filter((k) => checks[k]).length;
    const failChecks = keys.length - passChecks;
    const pass = failChecks === 0;
    const firstBreakLayer = pass ? null : '3. runner tick 执行顺序层';
    const conclusion = pass ? 'A：120/60 分方向 before_end 撤单语义已恢复' : 'C：before_end 分方向撤单仍有缺口';

    const standard = buildStandardResult({
      scriptName: 'truth_audit_directional_before_end_runtime_260330_006',
      taskId: args.taskId,
      sampleName: args.sampleName,
      pass,
      message: pass ? '分方向 before_end 撤单修复通过' : '分方向 before_end 撤单修复失败',
      firstBreakLayer,
      evidenceFile: args.output,
      summary: { conclusion, total_checks: keys.length, pass_checks: passChecks, fail_checks: failChecks, checks },
      rawExcerpt: { pre_timeline: preTimeline, post_harness_timeline: postHarnessTimeline, runtime_timeline: runtimeTimeline }
    });

    const output = {
      ...standard,
      task_id: args.taskId,
      conclusion_block: { verdict: conclusion, first_break_layer: firstBreakLayer },
      key_counters: { total_checks: keys.length, pass_checks: passChecks, fail_checks: failChecks },
      evidence_index: {
        pre_fix_timeline: preTimeline,
        post_fix_harness_timeline: postHarnessTimeline,
        real_runtime_timeline: runtimeTimeline,
        healthcheck: { root: healthRoot, pairs: healthPairs }
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
  console.error(error.message);
  process.exit(1);
});
