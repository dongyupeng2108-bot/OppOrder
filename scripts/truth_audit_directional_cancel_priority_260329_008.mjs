import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath, pathToFileURL } from 'url';
import { buildStandardResult, ensureDir, parseVerifyArgs, writeStandardLog } from './verify_standard_v1.mjs';
import { decideBotAction as decideCurrent } from '../strategies/crypto_binary/bot_strategy.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_TASK_ID = '260329_008';

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: 'http://localhost:53164',
  defaultOutputSuffix: 'truth_audit_directional_cancel_priority',
  defaultSampleName: 'directional_cancel_priority_v1'
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const toJson = async (response) => {
  try {
    return await response.json();
  } catch {
    return null;
  }
};

const createHttp = (baseUrl) => ({
  async get(endpoint) {
    const response = await fetch(`${baseUrl}${endpoint}`);
    return { status: response.status, body: await toJson(response) };
  },
  async post(endpoint, body = {}) {
    const response = await fetch(`${baseUrl}${endpoint}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    return { status: response.status, body: await toJson(response) };
  }
});

const waitServerReady = async (baseUrl, timeoutMs = 45000) => {
  const begin = Date.now();
  while (Date.now() - begin < timeoutMs) {
    try {
      const r = await fetch(`${baseUrl}/bot/status`);
      if (r.status === 200) return true;
    } catch {}
    await sleep(300);
  }
  return false;
};

const startServer = async ({ port }) => {
  const baseUrl = `http://localhost:${port}`;
  const child = spawn('node', ['strategies/crypto_binary/server.mjs', `--port=${port}`], {
    cwd: REPO_ROOT,
    stdio: 'ignore',
    detached: false
  });
  const ready = await waitServerReady(baseUrl);
  if (!ready) {
    child.kill();
    return null;
  }
  return { child, baseUrl };
};

const stopServer = async (child) => {
  if (!child || child.killed) return;
  child.kill();
  await sleep(700);
};

const extractRows = (ordersBody, targetWindowId) => {
  const all = Array.isArray(ordersBody?.all_orders) ? ordersBody.all_orders : [];
  return all
    .filter((row) => {
      const resolved = row?.resolved_window_id ?? row?.window_id ?? row?.inferred_window_id ?? null;
      return resolved === targetWindowId;
    })
    .map((row) => ({
      order_id: row.order_id,
      kind: row.kind,
      side: row.side,
      status: row.status,
      price: row.price,
      tp_price: row.tp_price,
      resolved_window_id: row?.resolved_window_id ?? row?.window_id ?? row?.inferred_window_id ?? null
    }));
};

const countOpenEntry = (rows, side) => rows.filter((r) => r.kind === 'ENTRY' && r.side === side && r.status === 'OPEN').length;
const openIdsBySide = (rows, side) => rows
  .filter((r) => r.kind === 'ENTRY' && r.side === side && r.status === 'OPEN')
  .map((r) => r.order_id);

const loadOldStrategyDecision = async () => {
  const targetFile = path.join(REPO_ROOT, 'strategies', 'crypto_binary', 'bot_strategy.mjs');
  const tmpFile = path.join(REPO_ROOT, 'strategies', 'crypto_binary', '__tmp_old_bot_strategy_260329_008.mjs');
  const { spawnSync } = await import('child_process');
  const show = spawnSync('git', ['show', 'HEAD~1:strategies/crypto_binary/bot_strategy.mjs'], {
    cwd: REPO_ROOT,
    encoding: 'utf8'
  });
  if (show.status !== 0 || !show.stdout) throw new Error('failed to read previous bot_strategy.mjs');
  fs.writeFileSync(tmpFile, show.stdout, 'utf8');
  try {
    const oldModule = await import(pathToFileURL(tmpFile).href);
    if (typeof oldModule.decideBotAction !== 'function') throw new Error('previous decideBotAction missing');
    return oldModule.decideBotAction;
  } finally {
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    if (!fs.existsSync(targetFile)) throw new Error('target strategy file missing');
  }
};

const fixedConfig = {
  open_delay_sec: 10,
  ladder_prices: [0.1, 0.2],
  ladder_size: 1,
  atr_multiple: 1.2,
  cancel_all_remaining_sec: 100,
  up_ladder: [
    { price: 0.1, size: 1, tp_price: 1 },
    { price: 0.2, size: 2, tp_price: 1 }
  ],
  down_ladder: [
    { price: 0.1, size: 11, tp_price: 1 },
    { price: 0.2, size: 22, tp_price: 1 }
  ],
  up_cancel: { before_end_sec: 120, formula: '' },
  down_cancel: { before_end_sec: 60, formula: '' }
};

const buildDecisionInput = (remainingSec) => ({
  config: fixedConfig,
  context: {
    window_id: 'w-cancel',
    period: '5m',
    remaining_sec: remainingSec,
    btc_price: 65000,
    atr_5m: 90,
    bid_yes: 0.01,
    ask_yes: 0.02,
    bid_no: 0.01,
    ask_no: 0.02,
    upper_bound: 70000,
    lower_bound: 60000
  },
  state: {
    current_window_id: 'w-cancel',
    ladder_posted: true,
    yes_order_ids: [],
    no_order_ids: ['no-1', 'no-2'],
    yes_cancelled: true,
    no_cancelled: false,
    up_formula_cancelled: false,
    down_formula_cancelled: false
  }
});

const runRuntimeScenario = async ({ port }) => {
  const server = await startServer({ port });
  if (!server) throw new Error('runtime server boot failed');
  const http = createHttp(server.baseUrl);
  try {
    const healthRoot = await fetch(`${server.baseUrl}/`).then((r) => r.status).catch(() => null);
    let healthPairs = null;
    try {
      healthPairs = await fetch(`${server.baseUrl}/pairs`).then((r) => r.status);
    } catch {
      healthPairs = 'ERR';
    }

    await http.post('/bot/stop', {});
    await http.post('/bot/config', fixedConfig);
    await http.post('/bot/start', { tick_interval_ms: 2000, debugScenario: 'main_path_v1' });
    await sleep(2500);
    const statusAfterStart = await http.get('/bot/status');
    const waitReasonSeen = statusAfterStart?.body?.last_reason === 'wait_next_window_after_start';
    await http.post('/bot/stop', {});

    await http.post('/bot/runner/tick', {
      state_override: {
        current_window_id: 'w-cancel',
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
      },
      context_override: {
        window_id: 'w-cancel',
        period: '5m',
        remaining_sec: 250,
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
    const afterPlaceStatus = await http.get('/bot/status');
    const afterPlaceOrders = await http.get('/bot/orders');
    const rowsAtPlace = extractRows(afterPlaceOrders.body, 'w-cancel');

    const yesOpenAtPlace = openIdsBySide(rowsAtPlace, 'YES');
    const noOpenAtPlace = openIdsBySide(rowsAtPlace, 'NO');

    await http.post('/bot/runner/tick', {
      state_override: {
        current_window_id: 'w-cancel',
        window_initialized_at: new Date(Date.now() - 45000).toISOString(),
        ladder_posted: true,
        yes_order_ids: yesOpenAtPlace,
        no_order_ids: noOpenAtPlace,
        yes_cancelled: false,
        no_cancelled: false,
        up_formula_cancelled: false,
        down_formula_cancelled: false,
        anchor_btc: 65000,
        atr_5m: 90,
        upper_bound: 70000,
        lower_bound: 60000
      },
      context_override: {
        window_id: 'w-cancel',
        period: '5m',
        remaining_sec: 120,
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
    const after120Status = await http.get('/bot/status');
    const after120Orders = await http.get('/bot/orders');
    const rowsAt120 = extractRows(after120Orders.body, 'w-cancel');

    const yesOpenAt120 = openIdsBySide(rowsAt120, 'YES');
    const noOpenAt120 = openIdsBySide(rowsAt120, 'NO');

    await http.post('/bot/runner/tick', {
      state_override: {
        current_window_id: 'w-cancel',
        window_initialized_at: new Date(Date.now() - 45000).toISOString(),
        ladder_posted: true,
        yes_order_ids: yesOpenAt120,
        no_order_ids: noOpenAt120,
        yes_cancelled: yesOpenAt120.length === 0,
        no_cancelled: false,
        up_formula_cancelled: false,
        down_formula_cancelled: false,
        anchor_btc: 65000,
        atr_5m: 90,
        upper_bound: 70000,
        lower_bound: 60000
      },
      context_override: {
        window_id: 'w-cancel',
        period: '5m',
        remaining_sec: 100,
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
    const after100Status = await http.get('/bot/status');
    const after100Orders = await http.get('/bot/orders');
    const rowsAt100 = extractRows(after100Orders.body, 'w-cancel');

    const yesOpenAt100 = openIdsBySide(rowsAt100, 'YES');
    const noOpenAt100 = openIdsBySide(rowsAt100, 'NO');

    await http.post('/bot/runner/tick', {
      state_override: {
        current_window_id: 'w-cancel',
        window_initialized_at: new Date(Date.now() - 45000).toISOString(),
        ladder_posted: true,
        yes_order_ids: yesOpenAt100,
        no_order_ids: noOpenAt100,
        yes_cancelled: yesOpenAt100.length === 0,
        no_cancelled: false,
        up_formula_cancelled: false,
        down_formula_cancelled: false,
        anchor_btc: 65000,
        atr_5m: 90,
        upper_bound: 70000,
        lower_bound: 60000
      },
      context_override: {
        window_id: 'w-cancel',
        period: '5m',
        remaining_sec: 60,
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
    const after60Status = await http.get('/bot/status');
    const after60Orders = await http.get('/bot/orders');
    const rowsAt60 = extractRows(after60Orders.body, 'w-cancel');

    return {
      health_root: healthRoot,
      health_pairs: healthPairs,
      wait_next_window_reason_seen: waitReasonSeen,
      timeline: [
        {
          stage: 'after_place_250',
          remaining_sec: 250,
          reason: afterPlaceStatus?.body?.last_reason ?? null,
          open_yes: countOpenEntry(rowsAtPlace, 'YES'),
          open_no: countOpenEntry(rowsAtPlace, 'NO')
        },
        {
          stage: 'after_cancel_120',
          remaining_sec: 120,
          reason: after120Status?.body?.last_reason ?? null,
          open_yes: countOpenEntry(rowsAt120, 'YES'),
          open_no: countOpenEntry(rowsAt120, 'NO')
        },
        {
          stage: 'after_global_100_boundary',
          remaining_sec: 100,
          reason: after100Status?.body?.last_reason ?? null,
          open_yes: countOpenEntry(rowsAt100, 'YES'),
          open_no: countOpenEntry(rowsAt100, 'NO')
        },
        {
          stage: 'after_cancel_60',
          remaining_sec: 60,
          reason: after60Status?.body?.last_reason ?? null,
          open_yes: countOpenEntry(rowsAt60, 'YES'),
          open_no: countOpenEntry(rowsAt60, 'NO')
        }
      ],
      rows_after_place: rowsAtPlace,
      rows_after_120: rowsAt120,
      rows_after_100: rowsAt100,
      rows_after_60: rowsAt60
    };
  } finally {
    await stopServer(server.child);
  }
};

const main = async () => {
  const args = parseArgs();
  const decideOld = await loadOldStrategyDecision();
  const oldAt100 = decideOld(buildDecisionInput(100));
  const oldAt60 = decideOld(buildDecisionInput(60));
  const newAt100 = decideCurrent(buildDecisionInput(100));
  const newAt60 = decideCurrent(buildDecisionInput(60));
  const runtime = await runRuntimeScenario({ port: 53164 });

  const preNoNot60 = oldAt100?.reason === 'remaining_sec<=cancel_all_remaining_sec'
    && Array.isArray(oldAt100?.intents)
    && oldAt100.intents.some((item) => item?.kind === 'CANCEL_OPEN' && item?.side === 'ALL');
  const preGlobalReason = oldAt100?.reason === 'remaining_sec<=cancel_all_remaining_sec';
  const postDirectional = newAt100?.reason !== 'remaining_sec<=cancel_all_remaining_sec'
    && newAt60?.reason === 'down_cancel_before_end';

  const timeline = runtime?.timeline || [];
  const at120 = timeline.find((item) => item.stage === 'after_cancel_120') || null;
  const at100 = timeline.find((item) => item.stage === 'after_global_100_boundary') || null;
  const at60 = timeline.find((item) => item.stage === 'after_cancel_60') || null;
  const runtimeDirectional = Boolean(at120 && at100 && at60)
    && at120.reason === 'up_cancel_before_end'
    && Number(at120.open_yes) === 0
    && Number(at120.open_no) > 0
    && Number(at100.open_no) > 0
    && at60.reason === 'down_cancel_before_end'
    && Number(at60.open_no) === 0;
  const reasonSeparated = timeline.some((item) => item.reason === 'up_cancel_before_end')
    && timeline.some((item) => item.reason === 'down_cancel_before_end')
    && !timeline.some((item) => item.reason === 'remaining_sec<=cancel_all_remaining_sec');
  const noCrossWindowMix = [...(runtime.rows_after_place || []), ...(runtime.rows_after_120 || []), ...(runtime.rows_after_100 || []), ...(runtime.rows_after_60 || [])]
    .every((row) => row.resolved_window_id === 'w-cancel');

  const checks = {
    '008-A_pre_fix_no_side_not_cancelled_at_60_but_global_100_path': preNoNot60,
    '008-B_pre_fix_reason_falls_to_global_cancel_path': preGlobalReason,
    '008-C_post_fix_runtime_no60_yes120_directional_cancel': runtimeDirectional && postDirectional,
    '008-D_post_fix_reason_intent_separates_up_down_cancel': reasonSeparated,
    '008-E_non_regression_260329_004_wait_next_window': runtime.wait_next_window_reason_seen === true,
    '008-F_non_regression_260329_007_window_scope_clean': noCrossWindowMix
  };

  const checkKeys = Object.keys(checks);
  const passChecks = checkKeys.filter((k) => checks[k]).length;
  const failChecks = checkKeys.length - passChecks;
  const pass = failChecks === 0;
  const conclusion = pass ? 'A：分方向撤单优先级已收口（NO=60, YES=120）' : 'C：分方向撤单仍存在断裂';
  const firstBreakLayer = pass ? null : '2. 旧全局 cancel_all_remaining_sec 优先级层';

  const standard = buildStandardResult({
    scriptName: 'truth_audit_directional_cancel_priority_260329_008',
    taskId: args.taskId,
    sampleName: args.sampleName,
    pass,
    message: pass ? '分方向 before_end_sec 撤单优先级验收通过' : '分方向 before_end_sec 撤单优先级验收失败',
    firstBreakLayer,
    evidenceFile: args.output,
    summary: {
      conclusion,
      total_checks: checkKeys.length,
      pass_checks: passChecks,
      fail_checks: failChecks,
      checks
    },
    rawExcerpt: {
      unique_first_break_layer: '2. 旧全局 cancel_all_remaining_sec 优先级层',
      old_reason_at_100: oldAt100?.reason ?? null,
      old_reason_at_60: oldAt60?.reason ?? null,
      new_reason_at_100: newAt100?.reason ?? null,
      new_reason_at_60: newAt60?.reason ?? null,
      runtime_timeline: timeline
    }
  });

  const output = {
    ...standard,
    task_id: args.taskId,
    command: `node scripts/truth_audit_directional_cancel_priority_260329_008.mjs --task_id=${args.taskId} --sample=${args.sampleName}`,
    conclusion_block: {
      verdict: conclusion,
      first_break_layer: firstBreakLayer
    },
    key_counters: {
      total_checks: checkKeys.length,
      pass_checks: passChecks,
      fail_checks: failChecks
    },
    evidence_index: {
      pre_fix_old_strategy_fact: { at_100: oldAt100, at_60: oldAt60 },
      post_fix_strategy_fact: { at_100: newAt100, at_60: newAt60 },
      real_runtime_fact: runtime
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
  console.error(error.message);
  process.exit(1);
});
