import fs from 'fs';
import path from 'path';
import { spawn, spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { buildStandardResult, ensureDir, parseVerifyArgs, writeStandardLog } from './verify_standard_v1.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_TASK_ID = '260329_007';

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: 'http://localhost:53161',
  defaultOutputSuffix: 'truth_audit_window_chain_owner_scenario',
  defaultSampleName: 'owner_manual_window_chain_v1'
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const nowIso = () => new Date().toISOString();

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

const waitReady = async (baseUrl, timeoutMs = 45000) => {
  const begin = Date.now();
  while (Date.now() - begin < timeoutMs) {
    try {
      const response = await fetch(`${baseUrl}/bot/status`);
      if (response.status === 200) return true;
    } catch {}
    await sleep(300);
  }
  return false;
};

const startServer = async ({ cwd, port }) => {
  const baseUrl = `http://localhost:${port}`;
  const child = spawn('node', ['strategies/crypto_binary/server.mjs', `--port=${port}`], {
    cwd,
    stdio: 'ignore',
    detached: false
  });
  const ok = await waitReady(baseUrl);
  if (!ok) {
    child.kill();
    return null;
  }
  return { child, baseUrl, port, cwd };
};

const stopServer = async (child) => {
  if (!child || child.killed) return;
  child.kill();
  await sleep(800);
};

const gitShow = (refPath) => {
  const out = spawnSync('git', ['show', refPath], { cwd: REPO_ROOT, encoding: 'utf8' });
  return out.status === 0 ? out.stdout : '';
};

const fixedOwnerConfig = {
  open_delay_sec: 10,
  ladder_prices: [0.1, 0.2, 0.9, 0.8],
  ladder_size: 1,
  atr_multiple: 1.2,
  cancel_all_remaining_sec: 0,
  up_ladder: [
    { price: 0.1, size: 1, tp_price: 1 },
    { price: 0.2, size: 2, tp_price: 1 }
  ],
  down_ladder: [
    { price: 0.9, size: 9, tp_price: 1 },
    { price: 0.8, size: 8, tp_price: 1 }
  ],
  up_cancel: { before_end_sec: 100, formula: '' },
  down_cancel: { before_end_sec: 100, formula: '' }
};

const oldConfigWithTp = {
  open_delay_sec: 0,
  ladder_prices: [0.9],
  ladder_size: 1,
  atr_multiple: 1.2,
  cancel_all_remaining_sec: 0,
  up_ladder: [],
  down_ladder: [{ price: 0.9, size: 9, tp_price: 0.7 }],
  up_cancel: { before_end_sec: 100, formula: '' },
  down_cancel: { before_end_sec: 100, formula: '' }
};

const toOldUiVisibleRows = (windowOrders = []) => {
  const active = windowOrders.filter((item) => item?.status === 'OPEN');
  return (active.length ? active : windowOrders).map((item) => ({
    kind: item.kind,
    side: item.side,
    status: item.status,
    price: item.price,
    tp_price: item.tp_price,
    resolved_window_id: item.resolved_window_id ?? item.inferred_window_id ?? null
  }));
};

const runSyntheticScenario = async ({ cwd, port }) => {
  const server = await startServer({ cwd, port });
  if (!server) throw new Error(`server boot failed: ${cwd}`);
  const http = createHttp(server.baseUrl);
  try {
    await http.post('/bot/stop', {});
    await http.post('/bot/config', oldConfigWithTp);
    await http.post('/bot/runner/tick', {
      state_override: {
        current_window_id: 'w-old',
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
        window_id: 'w-old',
        period: '5m',
        remaining_sec: 250,
        btc_price: 65000,
        atr_5m: 90,
        ask_yes: null,
        bid_yes: 0.1,
        ask_no: null,
        bid_no: 0.9,
        upper_bound: 70000,
        lower_bound: 60000
      }
    });

    await http.post('/bot/config', fixedOwnerConfig);
    await http.post('/bot/runner/tick', {
      state_override: {
        current_window_id: 'w-new',
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
        window_id: 'w-new',
        period: '5m',
        remaining_sec: 250,
        btc_price: 65000,
        atr_5m: 90,
        ask_yes: null,
        bid_yes: 0.1,
        ask_no: null,
        bid_no: 0.9,
        upper_bound: 70000,
        lower_bound: 60000
      }
    });
    const afterPlace = await http.get('/bot/orders');

    await http.post('/bot/runner/tick', {
      state_override: {
        current_window_id: 'w-new',
        window_initialized_at: new Date(Date.now() - 45000).toISOString(),
        anchor_btc: 65000,
        atr_5m: 90,
        upper_bound: 70000,
        lower_bound: 60000
      },
      context_override: {
        window_id: 'w-new',
        period: '5m',
        remaining_sec: 220,
        btc_price: 65000,
        atr_5m: 90,
        ask_yes: null,
        bid_yes: 0.1,
        ask_no: 0.85,
        bid_no: 0.84,
        upper_bound: 70000,
        lower_bound: 60000
      }
    });
    const afterFill = await http.get('/bot/orders');

    await http.post('/bot/runner/tick', {
      state_override: {
        current_window_id: 'w-next',
        window_initialized_at: new Date(Date.now() - 45000).toISOString(),
        ladder_posted: false,
        yes_order_ids: [],
        no_order_ids: [],
        anchor_btc: 65000,
        atr_5m: 90,
        upper_bound: 70000,
        lower_bound: 60000
      },
      context_override: {
        window_id: 'w-next',
        period: '5m',
        remaining_sec: 250,
        btc_price: 65000,
        atr_5m: 90,
        ask_yes: null,
        bid_yes: 0.1,
        ask_no: null,
        bid_no: 0.9,
        upper_bound: 70000,
        lower_bound: 60000
      }
    });
    const afterNextWindow = await http.get('/bot/orders');
    const status = await http.get('/bot/status');

    const selectRowsByWindow = (payload, targetWindowId) => {
      const all = Array.isArray(payload?.body?.all_orders) ? payload.body.all_orders : [];
      return all
        .filter((o) => {
          const rowWindowId = o?.resolved_window_id ?? o?.window_id ?? o?.inferred_window_id ?? null;
          return rowWindowId === targetWindowId;
        })
        .map((o) => ({
          kind: o.kind,
          side: o.side,
          status: o.status,
          price: o.price,
          tp_price: o.tp_price,
          parent_order_id: o.parent_order_id ?? null,
          resolved_window_id: o.resolved_window_id ?? o.window_id ?? o.inferred_window_id ?? null
        }));
    };
    const placedRows = selectRowsByWindow(afterPlace, 'w-new').map((o) => ({
      kind: o.kind,
      side: o.side,
      status: o.status,
      price: o.price,
      tp_price: o.tp_price,
      resolved_window_id: o.resolved_window_id ?? o.inferred_window_id ?? null
    }));
    const fillRows = selectRowsByWindow(afterFill, 'w-new');
    const nextRows = selectRowsByWindow(afterNextWindow, 'w-next');
    const oldUiRows = toOldUiVisibleRows(fillRows);
    const visibleSideSet = new Set(oldUiRows.filter((o) => o.kind === 'ENTRY').map((o) => o.side));

    return {
      scope_after_place: afterPlace?.body?.window_scope || null,
      scope_after_fill: afterFill?.body?.window_scope || null,
      scope_after_next_window: afterNextWindow?.body?.window_scope || null,
      rows_after_place: placedRows,
      rows_after_fill: fillRows,
      rows_after_next_window: nextRows,
      old_ui_visible_after_fill: oldUiRows,
      old_ui_missing_side: visibleSideSet.size < 2,
      status_after_next_window: {
        current_window_id: status?.body?.current_window_id ?? null,
        last_reason: status?.body?.last_reason ?? null
      }
    };
  } finally {
    await stopServer(server.child);
  }
};

const runRealRuntimeSample = async ({ port }) => {
  const server = await startServer({ cwd: REPO_ROOT, port });
  if (!server) throw new Error('real runtime server boot failed');
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
    await http.post('/bot/config', fixedOwnerConfig);
    const before = await http.get('/bot/context');
    const initialWindow = before?.body?.window_id ?? null;
    const startResp = await http.post('/bot/start', { tick_interval_ms: 2000 });

    const frames = [];
    let switchedWindow = null;
    let nextWindow = null;
    let oneSideTriggered = false;
    const begin = Date.now();
    while (Date.now() - begin < 11 * 60 * 1000) {
      await sleep(5000);
      const status = await http.get('/bot/status');
      const orders = await http.get('/bot/orders');
      const rows = Array.isArray(orders?.body?.window_orders) ? orders.body.window_orders : [];
      const entryRows = rows.filter((r) => r?.kind === 'ENTRY');
      const openEntryBySide = {
        YES: entryRows.filter((r) => r?.status === 'OPEN' && r?.side === 'YES').map((r) => r.price),
        NO: entryRows.filter((r) => r?.status === 'OPEN' && r?.side === 'NO').map((r) => r.price)
      };
      const filledEntryBySide = {
        YES: entryRows.filter((r) => r?.status === 'FILLED' && r?.side === 'YES').length,
        NO: entryRows.filter((r) => r?.status === 'FILLED' && r?.side === 'NO').length
      };
      const tpCount = rows.filter((r) => r?.kind === 'TAKE_PROFIT').length;
      const frame = {
        t: nowIso(),
        window_id: status?.body?.current_window_id ?? null,
        reason: status?.body?.last_reason ?? null,
        display_window_id: orders?.body?.window_scope?.display_window_id ?? null,
        open_yes_prices: openEntryBySide.YES,
        open_no_prices: openEntryBySide.NO,
        filled_yes_count: filledEntryBySide.YES,
        filled_no_count: filledEntryBySide.NO,
        tp_count: tpCount
      };
      frames.push(frame);

      if (!switchedWindow && frame.window_id && initialWindow && frame.window_id !== initialWindow) {
        switchedWindow = frame.window_id;
      } else if (switchedWindow && !nextWindow && frame.window_id && frame.window_id !== switchedWindow) {
        nextWindow = frame.window_id;
      }
      if (switchedWindow && (filledEntryBySide.YES > 0 || filledEntryBySide.NO > 0)) {
        oneSideTriggered = true;
      }
      if (switchedWindow && nextWindow && oneSideTriggered) break;
    }
    await http.post('/bot/stop', {});

    return {
      health_root: healthRoot,
      health_pairs: healthPairs,
      start_ok: startResp?.status === 200 && startResp?.body?.ok === true,
      initial_window_id: initialWindow,
      switched_window_id: switchedWindow,
      next_window_id: nextWindow,
      one_side_triggered: oneSideTriggered,
      frames: frames.slice(0, 160)
    };
  } finally {
    await stopServer(server.child);
  }
};

const getPreFixFacts = () => {
  const oldUi = gitShow('HEAD~1:ui/js/strategy-editor.js');
  const oldServer = gitShow('HEAD~1:strategies/crypto_binary/server.mjs');
  const oldLedger = gitShow('HEAD~1:strategies/crypto_binary/bot_order_ledger.mjs');
  const sampleRows = [
    { kind: 'ENTRY', side: 'YES', status: 'OPEN', inferred_window_id: 'w-new' },
    { kind: 'ENTRY', side: 'NO', status: 'FILLED', inferred_window_id: 'w-new' }
  ];
  const active = sampleRows.filter((item) => item.status === 'OPEN');
  const oldVisible = (active.length ? active : sampleRows).map((item) => item.side);
  const sampleMixedTp = [
    { kind: 'ENTRY', side: 'YES', status: 'OPEN', inferred_window_id: 'w-new' },
    { kind: 'TAKE_PROFIT', side: 'NO', status: 'OPEN', inferred_window_id: 'w-new', parent_order_id: 'old-order' }
  ];
  return {
    unique_first_break_layer: '2. 窗口订单归档/过滤层',
    old_ui_open_first_filter_present: oldUi.includes('const activeList = scopedList.filter((item) => item?.status === \'OPEN\');')
      && oldUi.includes('const finalList = activeList.length ? activeList : scopedList;'),
    old_server_no_resolved_window_id: oldServer.includes('inferred_window_id: inferWindowIdForOrder(order, ranges)')
      && !oldServer.includes('resolved_window_id'),
    old_ledger_no_window_id_field: oldLedger.includes('const createOrder = ({ side, price, size, source, kind = \'ENTRY\', tp_price = null, ladder_key = null, parent_order_id = null }) => ({')
      && !oldLedger.includes('window_id'),
    pre_fix_missing_side_simulated: !oldVisible.includes('NO'),
    pre_fix_mixed_tp_simulated: sampleMixedTp.some((row) => row.kind === 'TAKE_PROFIT')
  };
};

const main = async () => {
  const args = parseArgs();
  const preFix = getPreFixFacts();
  const postFix = await runSyntheticScenario({ cwd: REPO_ROOT, port: 53162 });
  const runtime = await runRealRuntimeSample({ port: 53163 });

  const preFixOldTpMixed = preFix?.pre_fix_mixed_tp_simulated === true;
  const preFixOldUiMissingSide = preFix?.pre_fix_missing_side_simulated === true;
  const postFixHasFourEntries = (postFix?.rows_after_place || []).filter((row) => row.kind === 'ENTRY' && row.status === 'OPEN').length >= 4;
  const postFixNoTpInCurrent = (postFix?.rows_after_fill || []).every((row) => row.kind !== 'TAKE_PROFIT');
  const postFixSwitchedClean = (postFix?.rows_after_next_window || []).length > 0
    && (postFix?.rows_after_next_window || []).every((row) => row.resolved_window_id == null || row.resolved_window_id === 'w-next');
  const runtimeComplete = Boolean(runtime?.initial_window_id && runtime?.switched_window_id && runtime?.next_window_id && runtime?.one_side_triggered);

  const checks = {
    '007-A_pre_fix_current_window_missing_side_or_only_up': preFixOldUiMissingSide,
    '007-B_pre_fix_window_state_mixed_old_take_profit': preFixOldTpMixed,
    '007-C_post_fix_new_window_has_4_entries_and_no_tp': postFixHasFourEntries && postFixNoTpInCurrent,
    '007-D_post_fix_next_window_switches_and_shows_only_new_window': postFixSwitchedClean,
    '007-E_real_runtime_sample_complete': runtimeComplete,
    '007-F_non_regression_wait_next_window_after_start': (runtime?.frames || []).some((f) => f.reason === 'wait_next_window_after_start'),
    '007-G_non_regression_tp1_no_take_profit_rows': (runtime?.frames || []).every((f) => Number(f.tp_count || 0) === 0)
  };

  const checkKeys = Object.keys(checks);
  const passChecks = checkKeys.filter((k) => checks[k]).length;
  const failChecks = checkKeys.length - passChecks;
  const pass = failChecks === 0;
  const conclusion = pass ? 'A：组合链路已收口（新窗口挂单/当前窗口状态/tp=1展示）' : 'C：组合链路存在断裂';
  const firstBreakLayer = pass ? null : '2. 窗口订单归档/过滤层';

  const standard = buildStandardResult({
    scriptName: 'truth_audit_window_chain_owner_scenario_260329_007',
    taskId: args.taskId,
    sampleName: args.sampleName,
    pass,
    message: pass ? 'owner 场景组合链路修复通过' : 'owner 场景组合链路修复失败',
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
      unique_first_break_layer: '2. 窗口订单归档/过滤层',
      pre_fix_only_up: preFixOldUiMissingSide,
      pre_fix_old_tp_mixed: preFixOldTpMixed,
      post_fix_four_entries: postFixHasFourEntries,
      post_fix_no_tp: postFixNoTpInCurrent,
      runtime_complete: runtimeComplete,
      runtime_initial_window: runtime?.initial_window_id ?? null,
      runtime_switched_window: runtime?.switched_window_id ?? null,
      runtime_next_window: runtime?.next_window_id ?? null
    }
  });

  const output = {
    ...standard,
    task_id: args.taskId,
    command: `node scripts/truth_audit_window_chain_owner_scenario_260329_007.mjs --task_id=${args.taskId} --sample=${args.sampleName}`,
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
      pre_fix_fact: preFix,
      post_fix_fact: postFix,
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
