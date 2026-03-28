import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { buildStandardResult, ensureDir, parseVerifyArgs, writeStandardLog } from './verify_standard_v1.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

const DEFAULT_PORT = 53124;
const DEFAULT_BASE_URL = `http://localhost:${DEFAULT_PORT}`;
const DEFAULT_TASK_ID = '260328_028';

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: DEFAULT_BASE_URL,
  defaultOutputSuffix: 'strategy_runtime_regression_guard',
  defaultSampleName: 'real_runtime_regression_guard_v1'
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

const ensureServer = async ({ baseUrl, spawnServer }) => {
  const http = createHttp(baseUrl);
  try {
    const status = await http.get('/bot/status');
    const config = await http.get('/bot/config');
    if (status.status === 200 && config.status === 200 && config?.body?.current) return { spawned: null };
  } catch {}
  if (!spawnServer) throw new Error(`server unreachable: ${baseUrl}`);
  const child = spawn('node', ['strategies/crypto_binary/server.mjs', `--port=${DEFAULT_PORT}`], {
    cwd: REPO_ROOT,
    stdio: 'ignore',
    detached: false
  });
  for (let i = 0; i < 40; i += 1) {
    await sleep(400);
    try {
      const status = await http.get('/bot/status');
      const config = await http.get('/bot/config');
      if (status.status === 200 && config.status === 200 && config?.body?.current) return { spawned: child };
    } catch {}
  }
  child.kill();
  throw new Error(`failed to boot server: ${baseUrl}`);
};

const numEq = (a, b, eps = 1e-9) => Math.abs(Number(a) - Number(b)) <= eps;

const normalizeLadderRows = (rows) => (Array.isArray(rows) ? rows : [])
  .map((item) => ({
    price: Number(item?.price),
    size: Number(item?.size),
    tp_price: Number(item?.tp_price)
  }))
  .filter((item) => Number.isFinite(item.price) && Number.isFinite(item.size) && Number.isFinite(item.tp_price));

const sameLadderRows = (actual, expected) => {
  const a = normalizeLadderRows(actual);
  const e = normalizeLadderRows(expected);
  if (a.length !== e.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (!numEq(a[i].price, e[i].price)) return false;
    if (!numEq(a[i].size, e[i].size)) return false;
    if (!numEq(a[i].tp_price, e[i].tp_price)) return false;
  }
  return true;
};

const normalizeCancel = (value) => ({
  before_end_sec: Number(value?.before_end_sec),
  formula: String(value?.formula || '')
});

const sameCancel = (a, b) => numEq(a?.before_end_sec, b?.before_end_sec) && String(a?.formula || '') === String(b?.formula || '');

const duplicateOpenStats = (orders = []) => {
  const map = new Map();
  for (const row of orders) {
    if (row?.status !== 'OPEN') continue;
    const key = `${row?.side}|${row?.price}`;
    map.set(key, (map.get(key) || 0) + 1);
  }
  const duplicates = [...map.entries()].filter(([, count]) => count > 1).map(([key, count]) => `${key}:${count}`);
  return { duplicate_count: duplicates.length, duplicate_keys: duplicates };
};

const waitFor = async (runner, timeoutMs = 90000, pollMs = 350) => {
  const begin = Date.now();
  let last = null;
  while (Date.now() - begin < timeoutMs) {
    last = await runner();
    if (last?.done) return last;
    await sleep(pollMs);
  }
  return last;
};

const pickUniqueByTick = (rows = []) => {
  const seen = new Set();
  const unique = [];
  for (const row of rows) {
    const key = row?.last_tick_at ? String(row.last_tick_at) : `idx:${row.i}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(row);
  }
  return unique;
};

const runTraceScenario = async ({ http, config, cancelReason, expectSideCleared, debugScenario = 'main_path_v1' }) => {
  await http.post('/bot/config', config);
  await http.post('/bot/stop', {});
  await sleep(250);
  await http.post('/bot/start', { tick_interval_ms: 1000, debugScenario });
  const trace = [];
  for (let i = 0; i < 26; i += 1) {
    await sleep(380);
    const status = await http.get('/bot/status');
    const orders = await http.get('/bot/orders');
    const summary = orders?.body?.summary || {};
    const dup = duplicateOpenStats(Array.isArray(orders?.body?.orders) ? orders.body.orders : []);
    trace.push({
      i,
      last_tick_at: status?.body?.last_tick_at || null,
      reason: status?.body?.last_reason || null,
      total: Number(summary?.total || 0),
      open_total: Number(summary?.open_total || 0),
      open_yes: Number(summary?.open_yes || 0),
      open_no: Number(summary?.open_no || 0),
      cancelled_total: Number(summary?.cancelled_total || 0),
      duplicate_count: dup.duplicate_count,
      duplicate_keys: dup.duplicate_keys
    });
  }
  await http.post('/bot/stop', {});
  const unique = pickUniqueByTick(trace);
  const cancelHits = unique.filter((row) => row.reason === cancelReason);
  const nonPlaceAddEvents = [];
  for (let i = 1; i < unique.length; i += 1) {
    if (unique[i].reason !== 'ladder_not_posted' && unique[i].total > unique[i - 1].total) {
      nonPlaceAddEvents.push({
        i: unique[i].i,
        reason: unique[i].reason,
        from_total: unique[i - 1].total,
        to_total: unique[i].total
      });
    }
  }
  let cancelTickNoNewOrders = null;
  if (cancelHits.length > 0) {
    const idx = unique.findIndex((row) => row.i === cancelHits[0].i);
    if (idx > 0) cancelTickNoNewOrders = unique[idx].total === unique[idx - 1].total;
  }
  const firstCancelIdx = cancelHits.length ? unique.findIndex((row) => row.i === cancelHits[0].i) : -1;
  const postCancelRows = firstCancelIdx >= 0 ? unique.slice(firstCancelIdx + 1) : [];
  const sideRegrow = expectSideCleared === 'YES'
    ? postCancelRows.some((row) => row.open_yes > 0)
    : postCancelRows.some((row) => row.open_no > 0);
  const sideIsolation = expectSideCleared === 'YES'
    ? unique.some((row) => row.open_yes === 0 && row.open_no >= 1)
    : unique.some((row) => row.open_no === 0 && row.open_yes >= 1);
  const duplicateMax = unique.reduce((acc, row) => Math.max(acc, Number(row.duplicate_count || 0)), 0);
  return {
    trace,
    unique,
    cancel_hits: cancelHits.length,
    non_place_add_events: nonPlaceAddEvents,
    cancel_tick_no_new_orders: cancelTickNoNewOrders,
    side_regrow_after_cancel: sideRegrow,
    side_isolation_pass: sideIsolation,
    duplicate_max: duplicateMax
  };
};

const main = async () => {
  const args = parseArgs();
  const http = createHttp(args.baseUrl);
  const boot = await ensureServer(args);
  let originalConfig = null;
  try {
    await http.post('/bot/stop', {});
    const currentCfg = await http.get('/bot/config');
    originalConfig = currentCfg?.body?.current || null;

    const contractConfig = {
      open_delay_sec: 0,
      ladder_prices: [0.27, 0.24, 0.21, 0.18],
      ladder_size: 5,
      atr_multiple: 1.2,
      cancel_all_remaining_sec: 0,
      up_ladder: [{ price: 0.31, size: 2, tp_price: 0.35 }, { price: 0.29, size: 1, tp_price: 0.33 }],
      down_ladder: [{ price: 0.02, size: 3, tp_price: 0.03 }, { price: 0.015, size: 1, tp_price: 0.025 }],
      up_cancel: { before_end_sec: 60, formula: 'false' },
      down_cancel: { before_end_sec: 70, formula: 'false' }
    };
    const saveContract = await http.post('/bot/config', contractConfig);
    const getContract = await http.get('/bot/config');
    const saved = getContract?.body?.current || {};
    const contractSaveReadPass = saveContract.status === 200
      && numEq(saved?.open_delay_sec, contractConfig.open_delay_sec)
      && sameLadderRows(saved?.up_ladder, contractConfig.up_ladder)
      && sameLadderRows(saved?.down_ladder, contractConfig.down_ladder)
      && sameCancel(normalizeCancel(saved?.up_cancel), normalizeCancel(contractConfig.up_cancel))
      && sameCancel(normalizeCancel(saved?.down_cancel), normalizeCancel(contractConfig.down_cancel));

    const preview = await http.get('/bot/decision-preview?fixture=OPEN_10S_LADDER_EMPTY');
    const previewIntents = Array.isArray(preview?.body?.intents) ? preview.body.intents : [];
    const yesIntent = previewIntents.find((item) => item?.kind === 'PLACE_LADDER' && item?.side === 'YES');
    const noIntent = previewIntents.find((item) => item?.kind === 'PLACE_LADDER' && item?.side === 'NO');
    const previewSplitPass = Boolean(yesIntent && noIntent)
      && sameLadderRows(yesIntent?.ladder, contractConfig.up_ladder)
      && sameLadderRows(noIntent?.ladder, contractConfig.down_ladder);

    await http.post('/bot/start', { tick_interval_ms: 1000, debugScenario: 'main_path_v1' });
    const ladderRuntime = await waitFor(async () => {
      const orders = await http.get('/bot/orders');
      const summary = orders?.body?.summary || {};
      const open = Array.isArray(orders?.body?.orders) ? orders.body.orders.filter((row) => row?.status === 'OPEN') : [];
      const openYes = Number(summary?.open_yes || 0);
      const openNo = Number(summary?.open_no || 0);
      const yesAny = open.some((row) => row?.side === 'YES');
      const noAny = open.some((row) => row?.side === 'NO');
      return {
        done: openYes >= 1 && openNo >= 1 && yesAny && noAny,
        summary,
        open_orders: open
      };
    }, 90000, 400);
    await http.post('/bot/stop', {});
    const independentLadderPass = ladderRuntime?.done === true;

    const tpConfig = {
      open_delay_sec: 0,
      ladder_prices: [0.27, 0.24, 0.21, 0.18],
      ladder_size: 5,
      atr_multiple: 1.2,
      cancel_all_remaining_sec: 0,
      up_ladder: [{ price: 0.99, size: 2, tp_price: 0.97 }],
      down_ladder: [{ price: 0.01, size: 2, tp_price: 0.02 }],
      up_cancel: { before_end_sec: 0, formula: 'false' },
      down_cancel: { before_end_sec: 0, formula: 'false' }
    };
    await http.post('/bot/config', tpConfig);
    await http.post('/bot/start', { tick_interval_ms: 1000, debugScenario: 'fill_yes_path_v1' });
    const tpRuntime = await waitFor(async () => {
      const orders = await http.get('/bot/orders');
      const rows = Array.isArray(orders?.body?.orders) ? orders.body.orders : [];
      const filledEntry = rows.find((row) => row?.kind === 'ENTRY' && row?.status === 'FILLED');
      const linkedTp = filledEntry
        ? rows.find((row) => row?.kind === 'TAKE_PROFIT' && row?.parent_order_id === filledEntry.order_id)
        : null;
      return {
        done: Boolean(filledEntry && linkedTp),
        filled_entry: filledEntry || null,
        linked_tp: linkedTp || null,
        summary: orders?.body?.summary || {}
      };
    }, 120000, 400);
    await http.post('/bot/stop', {});
    const tpBindingPass = Boolean(tpRuntime?.done)
      && tpRuntime?.filled_entry?.side === tpRuntime?.linked_tp?.side
      && numEq(tpRuntime?.filled_entry?.tp_price, tpRuntime?.linked_tp?.tp_price)
      && numEq(tpRuntime?.linked_tp?.price, tpRuntime?.filled_entry?.tp_price)
      && String(tpRuntime?.filled_entry?.ladder_key || '') === String(tpRuntime?.linked_tp?.ladder_key || '')
      && String(tpRuntime?.linked_tp?.parent_order_id || '') === String(tpRuntime?.filled_entry?.order_id || '');

    const upCancelConfig = {
      open_delay_sec: 0,
      ladder_prices: [0.271, 0.241, 0.211, 0.181],
      ladder_size: 5,
      atr_multiple: 1.2,
      cancel_all_remaining_sec: 0,
      up_ladder: [{ price: 0.312, size: 2, tp_price: 0.352 }, { price: 0.291, size: 1, tp_price: 0.331 }],
      down_ladder: [{ price: 0.021, size: 3, tp_price: 0.031 }, { price: 0.016, size: 1, tp_price: 0.026 }],
      up_cancel: { before_end_sec: 1000, formula: 'has_open_up_orders' },
      down_cancel: { before_end_sec: 0, formula: 'false' }
    };
    const downCancelConfig = {
      open_delay_sec: 0,
      ladder_prices: [0.272, 0.242, 0.212, 0.182],
      ladder_size: 5,
      atr_multiple: 1.2,
      cancel_all_remaining_sec: 0,
      up_ladder: [{ price: 0.313, size: 2, tp_price: 0.353 }, { price: 0.292, size: 1, tp_price: 0.332 }],
      down_ladder: [{ price: 0.022, size: 3, tp_price: 0.032 }, { price: 0.017, size: 1, tp_price: 0.027 }],
      up_cancel: { before_end_sec: 0, formula: 'false' },
      down_cancel: { before_end_sec: 1000, formula: 'has_open_down_orders' }
    };

    const upTrace = await runTraceScenario({
      http,
      config: upCancelConfig,
      cancelReason: 'up_cancel_formula',
      expectSideCleared: 'YES',
      debugScenario: 'main_path_v1'
    });
    const downTrace = await runTraceScenario({
      http,
      config: downCancelConfig,
      cancelReason: 'down_cancel_formula',
      expectSideCleared: 'NO',
      debugScenario: 'main_path_v1'
    });

    const directionalCancelIsolationPass = upTrace.side_isolation_pass && downTrace.side_isolation_pass;
    const cancelBeforePlacePass = upTrace.cancel_tick_no_new_orders === true && downTrace.cancel_tick_no_new_orders === true;
    const nonPlaceNoNewOrdersPass = upTrace.non_place_add_events.length === 0 && downTrace.non_place_add_events.length === 0;
    const singleFormulaTriggerPass = upTrace.cancel_hits === 1 && downTrace.cancel_hits === 1;
    const noDuplicateOpenPass = upTrace.duplicate_max === 0 && downTrace.duplicate_max === 0;

    const checks = {
      contract_save_read_consistency: contractSaveReadPass,
      independent_yes_no_ladder_placement: independentLadderPass,
      tp_binding_by_ladder_parent: tpBindingPass,
      directional_cancel_isolation: directionalCancelIsolationPass,
      cancel_before_place_priority: cancelBeforePlacePass,
      non_place_tick_no_new_orders: nonPlaceNoNewOrdersPass,
      single_formula_cancel_per_direction_per_window: singleFormulaTriggerPass,
      no_same_side_same_price_duplicate_open: noDuplicateOpenPass
    };

    const checkOrder = Object.keys(checks);
    const firstBreakLayer = checkOrder.find((key) => checks[key] !== true) || null;
    const pass = checkOrder.every((key) => checks[key] === true);
    const conclusionBlock = pass
      ? 'A: regression guard pass (8/8 checks)'
      : 'C: regression guard fail';

    const standard = buildStandardResult({
      scriptName: 'verify_strategy_runtime_regression_guard',
      taskId: args.taskId,
      sampleName: args.sampleName,
      pass,
      message: pass ? 'strategy/runtime regression guard 通过' : 'strategy/runtime regression guard 失败',
      firstBreakLayer,
      evidenceFile: args.output,
      summary: {
        conclusion: conclusionBlock,
        total_checks: checkOrder.length,
        pass_checks: checkOrder.filter((key) => checks[key]).length,
        fail_checks: checkOrder.filter((key) => !checks[key]).length,
        checks
      },
      rawExcerpt: {
        up_cancel_hits_unique_tick: upTrace.cancel_hits,
        down_cancel_hits_unique_tick: downTrace.cancel_hits,
        up_non_place_add_events: upTrace.non_place_add_events.length,
        down_non_place_add_events: downTrace.non_place_add_events.length,
        up_duplicate_max: upTrace.duplicate_max,
        down_duplicate_max: downTrace.duplicate_max,
        up_cancel_tick_no_new_orders: upTrace.cancel_tick_no_new_orders,
        down_cancel_tick_no_new_orders: downTrace.cancel_tick_no_new_orders
      }
    });

    const output = {
      ...standard,
      task_id: args.taskId,
      command: `node scripts/verify_strategy_runtime_regression_guard.mjs --task_id=${args.taskId} --sample=${args.sampleName}`,
      conclusion_block: {
        verdict: conclusionBlock,
        first_break_layer: firstBreakLayer
      },
      key_counters: {
        up_cancel_hits_unique_tick: upTrace.cancel_hits,
        down_cancel_hits_unique_tick: downTrace.cancel_hits,
        up_non_place_add_events: upTrace.non_place_add_events,
        down_non_place_add_events: downTrace.non_place_add_events,
        up_duplicate_max: upTrace.duplicate_max,
        down_duplicate_max: downTrace.duplicate_max,
        up_cancel_tick_no_new_orders: upTrace.cancel_tick_no_new_orders,
        down_cancel_tick_no_new_orders: downTrace.cancel_tick_no_new_orders
      },
      evidence_index: {
        contract_save_read: {
          save_response_status: saveContract.status,
          config_current: getContract?.body?.current || null
        },
        decision_preview_split: {
          reason: preview?.body?.reason || null,
          intents: previewIntents
        },
        runtime_independent_ladder: ladderRuntime,
        runtime_tp_binding: tpRuntime,
        runtime_up_cancel_trace_unique: upTrace.unique,
        runtime_down_cancel_trace_unique: downTrace.unique
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
      conclusion: conclusionBlock,
      first_break_layer: firstBreakLayer,
      pass_checks: standard.summary.pass_checks,
      fail_checks: standard.summary.fail_checks
    }));
    if (!pass) process.exitCode = 1;
  } finally {
    await http.post('/bot/stop', {}).catch(() => null);
    if (originalConfig) await http.post('/bot/config', originalConfig).catch(() => null);
    if (boot.spawned && !boot.spawned.killed) boot.spawned.kill();
  }
};

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
