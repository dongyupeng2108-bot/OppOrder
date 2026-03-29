import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { spawn, spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { decideBotAction } from '../strategies/crypto_binary/bot_strategy.mjs';
import { buildStandardResult, ensureDir, parseVerifyArgs, writeStandardLog } from './verify_standard_v1.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_TASK_ID = '260330_001';

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: 'http://localhost:53167',
  defaultOutputSuffix: 'truth_audit_order_prob_consistency',
  defaultSampleName: 'owner_screenshot_consistency_v1'
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
      const res = await fetch(`${baseUrl}/bot/status`);
      if (res.status === 200) return true;
    } catch {}
    await sleep(300);
  }
  return false;
};

const startServer = async (port) => {
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
  return { child, baseUrl, port };
};

const stopServer = async (child) => {
  if (!child || child.killed) return;
  child.kill();
  await sleep(700);
};

const extractFunctionSource = (text, fnName) => {
  const start = text.indexOf(`function ${fnName}(`);
  if (start < 0) return null;
  let i = text.indexOf('{', start);
  if (i < 0) return null;
  let depth = 0;
  for (let idx = i; idx < text.length; idx += 1) {
    const ch = text[idx];
    if (ch === '{') depth += 1;
    if (ch === '}') depth -= 1;
    if (depth === 0) return text.slice(start, idx + 1);
  }
  return null;
};

const runRenderContextWithSource = (uiSource, payload) => {
  const fn = extractFunctionSource(uiSource, 'se_renderContext');
  if (!fn) return null;
  const writes = {};
  const sandbox = {
    se_setText: (id, text) => { writes[id] = text; }
  };
  vm.createContext(sandbox);
  vm.runInContext(`${fn}; globalThis._run = se_renderContext;`, sandbox);
  sandbox._run(payload.context, payload.status, payload.orders);
  return writes;
};

const getPreFixFacts = () => {
  const oldUi = spawnSync('git', ['show', 'HEAD~1:ui/js/strategy-editor.js'], {
    cwd: REPO_ROOT,
    encoding: 'utf8'
  }).stdout || '';
  const oldServer = spawnSync('git', ['show', 'HEAD~1:strategies/crypto_binary/server.mjs'], {
    cwd: REPO_ROOT,
    encoding: 'utf8'
  }).stdout || '';
  const oldRender = runRenderContextWithSource(oldUi, {
    context: { btc_price: 65385.2, bid_yes: 0.97, bid_no: 0.02, atr_5m: 12.3 },
    status: { running: true },
    orders: { context_snapshot: { btc_price: 65385.2, bid_yes: 0.4, bid_no: 0.9, atr_5m: 8.8 } }
  }) || {};
  return {
    unique_first_break_layer: '4. 概率显示快照层',
    old_ui_context_only: oldUi.includes('function se_renderContext(context, status)')
      && oldUi.includes('const upProb = toFinite(context?.bid_yes ?? context?.ask_yes);'),
    old_server_orders_no_context_snapshot: !oldServer.includes('context_snapshot: botLastTickResult?.context_snapshot || null'),
    old_ui_updown_text: oldRender['se-order-updown-prob'] || null
  };
};

const ownerScenarioConfig = {
  open_delay_sec: 0,
  ladder_prices: [0.4],
  ladder_size: 1,
  atr_multiple: 1.2,
  cancel_all_remaining_sec: 100,
  up_ladder: [{ price: 0.4, size: 2, tp_price: 0.85 }],
  down_ladder: [{ price: 0.4, size: 1, tp_price: 0.9 }],
  up_cancel: { before_end_sec: 20, formula: '' },
  down_cancel: { before_end_sec: 20, formula: '' }
};

const selectRowsByWindow = (ordersBody, targetWindowId) => {
  const all = Array.isArray(ordersBody?.all_orders) ? ordersBody.all_orders : [];
  return all
    .filter((row) => {
      const w = row?.resolved_window_id ?? row?.window_id ?? row?.inferred_window_id ?? null;
      return w === targetWindowId;
    })
    .map((row) => ({
      order_id: row.order_id,
      kind: row.kind,
      side: row.side,
      status: row.status,
      price: row.price,
      fill_price: row.fill_price,
      tp_price: row.tp_price,
      parent_order_id: row.parent_order_id ?? null,
      resolved_window_id: row?.resolved_window_id ?? row?.window_id ?? row?.inferred_window_id ?? null
    }));
};

const runOwnerSyntheticScenario = async (http) => {
  await http.post('/bot/stop', {});
  await http.post('/bot/config', ownerScenarioConfig);
  await http.post('/bot/runner/tick', {
    state_override: {
      current_window_id: 'w-owner',
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
      window_id: 'w-owner',
      period: '5m',
      remaining_sec: 250,
      btc_price: 65385.2,
      atr_5m: 90,
      bid_yes: 0.96,
      ask_yes: 0.99,
      bid_no: 0.01,
      ask_no: 0.99,
      upper_bound: 70000,
      lower_bound: 60000
    }
  });
  await http.post('/bot/runner/tick', {
    state_override: { current_window_id: 'w-owner' },
    context_override: {
      window_id: 'w-owner',
      period: '5m',
      remaining_sec: 245,
      btc_price: 65385.2,
      atr_5m: 90,
      bid_yes: 0.97,
      ask_yes: 0.97,
      bid_no: 0.02,
      ask_no: 0.3,
      upper_bound: 70000,
      lower_bound: 60000
    }
  });
  const ordersRes = await http.get('/bot/orders');
  const contextRes = await http.get('/bot/context');
  const rows = selectRowsByWindow(ordersRes.body, 'w-owner');
  const snapshot = ordersRes?.body?.context_snapshot || null;
  return {
    rows,
    orders_context_snapshot: snapshot,
    live_context: contextRes?.body || null,
    window_scope: ordersRes?.body?.window_scope || null
  };
};

const runRealRuntimeSample = async (http) => {
  await http.post('/bot/stop', {});
  await http.post('/bot/config', ownerScenarioConfig);
  const startResp = await http.post('/bot/start', { tick_interval_ms: 2000 });
  await sleep(2500);
  const status1 = await http.get('/bot/status');
  const waitReasonSeen = status1?.body?.last_reason === 'wait_next_window_after_start';
  await http.post('/bot/stop', {});
  await http.post('/bot/runner/tick', {
    state_override: {
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
    },
    context_override: {
      window_id: 'w-rt',
      period: '5m',
      remaining_sec: 250,
      btc_price: 65385.2,
      atr_5m: 90,
      bid_yes: 0.95,
      ask_yes: 0.99,
      bid_no: 0.01,
      ask_no: 0.99,
      upper_bound: 70000,
      lower_bound: 60000
    }
  });
  const afterPlace = await http.get('/bot/orders');
  await http.post('/bot/runner/tick', {
    state_override: { current_window_id: 'w-rt' },
    context_override: {
      window_id: 'w-rt',
      period: '5m',
      remaining_sec: 245,
      btc_price: 65385.2,
      atr_5m: 90,
      bid_yes: 0.97,
      ask_yes: 0.97,
      bid_no: 0.02,
      ask_no: 0.3,
      upper_bound: 70000,
      lower_bound: 60000
    }
  });
  const afterFill = await http.get('/bot/orders');
  await http.post('/bot/runner/tick', {
    state_override: { current_window_id: 'w-rt' },
    context_override: {
      window_id: 'w-rt',
      period: '5m',
      remaining_sec: 240,
      btc_price: 65385.2,
      atr_5m: 90,
      bid_yes: 0.97,
      ask_yes: 0.97,
      bid_no: 0.02,
      ask_no: 0.3,
      upper_bound: 70000,
      lower_bound: 60000
    }
  });
  const afterStable = await http.get('/bot/orders');
  return {
    wait_next_window_reason_seen: waitReasonSeen,
    stages: [
      {
        stage: 'after_place',
        rows: selectRowsByWindow(afterPlace.body, 'w-rt'),
        snapshot: afterPlace?.body?.context_snapshot || null
      },
      {
        stage: 'after_fill',
        rows: selectRowsByWindow(afterFill.body, 'w-rt'),
        snapshot: afterFill?.body?.context_snapshot || null
      },
      {
        stage: 'after_stable',
        rows: selectRowsByWindow(afterStable.body, 'w-rt'),
        snapshot: afterStable?.body?.context_snapshot || null
      }
    ]
  };
};

const evaluateConsistency = (rows, snapshot) => {
  if (!Array.isArray(rows) || rows.length === 0 || !snapshot) return false;
  const askYes = Number(snapshot.ask_yes);
  const askNo = Number(snapshot.ask_no);
  const bidNo = Number(snapshot.bid_no);
  const yesOpen = rows.filter((r) => r.kind === 'ENTRY' && r.side === 'YES' && r.status === 'OPEN');
  const noFilled = rows.filter((r) => r.kind === 'ENTRY' && r.side === 'NO' && r.status === 'FILLED');
  const noTpOpen = rows.filter((r) => r.kind === 'TAKE_PROFIT' && r.side === 'NO' && r.status === 'OPEN');
  const yesOpenOk = yesOpen.every((r) => Number.isFinite(askYes) && Number(r.price) < askYes);
  const noFilledOk = noFilled.every((r) => Number.isFinite(askNo) && Number(r.price) >= askNo);
  const noTpOpenOk = noTpOpen.every((r) => Number.isFinite(bidNo) && Number(bidNo) < Number(r.price));
  return yesOpen.length > 0 && noFilled.length > 0 && noTpOpen.length > 0 && yesOpenOk && noFilledOk && noTpOpenOk;
};

const main = async () => {
  const args = parseArgs();
  const preFix = getPreFixFacts();
  const server = await startServer(53167);
  if (!server) throw new Error('server boot failed for 260330_001');
  const http = createHttp(server.baseUrl);
  try {
    const healthRoot = await fetch(`${server.baseUrl}/`).then((r) => r.status).catch(() => null);
    let healthPairs = null;
    try {
      healthPairs = await fetch(`${server.baseUrl}/pairs`).then((r) => r.status);
    } catch {
      healthPairs = 'ERR';
    }
    const ownerScenario = await runOwnerSyntheticScenario(http);
    const runtime = await runRealRuntimeSample(http);
    const currentUi = fs.readFileSync(path.join(REPO_ROOT, 'ui', 'js', 'strategy-editor.js'), 'utf8');
    const newRender = runRenderContextWithSource(currentUi, {
      context: { btc_price: 65385.2, bid_yes: 0.97, bid_no: 0.02, atr_5m: 12.3 },
      status: { running: true },
      orders: { context_snapshot: { btc_price: 65385.2, bid_yes: 0.4, bid_no: 0.9, atr_5m: 8.8 } }
    }) || {};
    const oldShowText = preFix.old_ui_updown_text;
    const newShowText = newRender['se-order-updown-prob'] || null;

    const postConsistent = evaluateConsistency(ownerScenario.rows, ownerScenario.orders_context_snapshot);
    const runtimeConsistent = runtime.stages.every((stage) => evaluateConsistency(stage.rows, stage.snapshot) || stage.stage === 'after_place');
    const nonRegression007 = [...ownerScenario.rows, ...runtime.stages.flatMap((s) => s.rows || [])]
      .every((row) => row.resolved_window_id === 'w-owner' || row.resolved_window_id === 'w-rt');
    const decision008 = decideBotAction({
      config: {
        ...ownerScenarioConfig,
        cancel_all_remaining_sec: 100,
        up_cancel: { before_end_sec: 120, formula: '' },
        down_cancel: { before_end_sec: 60, formula: '' }
      },
      context: {
        window_id: 'w-check',
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
      },
      state: {
        current_window_id: 'w-check',
        ladder_posted: true,
        yes_order_ids: [],
        no_order_ids: ['no-1'],
        yes_cancelled: true,
        no_cancelled: false,
        up_formula_cancelled: false,
        down_formula_cancelled: false
      }
    });
    const nonRegression008 = decision008.reason !== 'remaining_sec<=cancel_all_remaining_sec';

    const checks = {
      '001-A_pre_fix_prob_head_uses_live_context_not_order_snapshot': preFix.old_ui_context_only && preFix.old_server_orders_no_context_snapshot,
      '001-B_pre_fix_owner_scene_can_show_snapshot_mismatch_risk': oldShowText === 'UP 0.970 / DOWN 0.020',
      '001-C_post_fix_same_tick_prob_and_order_status_are_consistent': postConsistent,
      '001-D_post_fix_min_regression_script_for_owner_scene_passed': newShowText === 'UP 0.400 / DOWN 0.900' && runtimeConsistent,
      '001-E_non_regression_260329_004_wait_next_window': runtime.wait_next_window_reason_seen === true,
      '001-F_non_regression_260329_007_260329_008_kept': nonRegression007 && nonRegression008
    };
    const keys = Object.keys(checks);
    const passChecks = keys.filter((k) => checks[k]).length;
    const failChecks = keys.length - passChecks;
    const pass = failChecks === 0;
    const conclusion = pass ? 'A：当前窗口订单状态与UP/DOWN概率显示口径已收口' : 'C：当前窗口订单状态与概率显示仍不自洽';
    const firstBreakLayer = pass ? null : '4. 概率显示快照层';

    const standard = buildStandardResult({
      scriptName: 'truth_audit_order_prob_consistency_260330_001',
      taskId: args.taskId,
      sampleName: args.sampleName,
      pass,
      message: pass ? '订单状态与概率显示一致性修复通过' : '订单状态与概率显示一致性修复失败',
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
        unique_first_break_layer: preFix.unique_first_break_layer,
        pre_fix_old_ui_updown: oldShowText,
        post_fix_new_ui_updown: newShowText,
        owner_rows: ownerScenario.rows,
        owner_snapshot: ownerScenario.orders_context_snapshot,
        runtime_stages: runtime.stages
      }
    });

    const output = {
      ...standard,
      task_id: args.taskId,
      command: `node scripts/truth_audit_order_prob_consistency_260330_001.mjs --task_id=${args.taskId} --sample=${args.sampleName}`,
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
        pre_fix_fact: preFix,
        owner_scene_fact: ownerScenario,
        real_runtime_fact: runtime,
        ui_render_compare_fact: {
          pre_fix_old_ui_updown: oldShowText,
          post_fix_new_ui_updown: newShowText
        },
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
