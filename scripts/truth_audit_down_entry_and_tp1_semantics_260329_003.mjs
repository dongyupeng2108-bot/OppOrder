import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn, spawnSync } from 'child_process';
import { buildStandardResult, ensureDir, parseVerifyArgs, writeStandardLog } from './verify_standard_v1.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_TASK_ID = '260329_003';

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: 'http://localhost:53151',
  defaultOutputSuffix: 'truth_audit_down_entry_and_tp1_semantics',
  defaultSampleName: 'down_entry_fix_and_tp1_semantics_v1'
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
      const status = await fetch(`${baseUrl}/bot/status`);
      if (status.status === 200) return true;
    } catch {}
    await sleep(300);
  }
  return false;
};

const startServerOnPort = async (port) => {
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

const waitFor = async (fn, timeoutMs = 120000, intervalMs = 400) => {
  const begin = Date.now();
  while (Date.now() - begin < timeoutMs) {
    const v = await fn();
    if (v?.done) return v;
    await sleep(intervalMs);
  }
  return null;
};

const runSingleFillCase = async (http, config, caseId, expectedTp) => {
  await http.post('/bot/stop', {});
  await http.post('/bot/config', config);
  await http.post('/bot/paper/apply-action', { action: 'CANCEL_ALL_OPEN' });
  const tick = await http.post('/bot/runner/tick', {
    state_override: {
      current_window_id: `audit-260329003-${caseId}`,
      window_initialized_at: new Date(Date.now() - 5000).toISOString(),
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
      window_id: `audit-260329003-${caseId}`,
      period: '5m',
      remaining_sec: 220,
      btc_price: 65000,
      atr_5m: 90,
      ask_yes: 0.27,
      bid_yes: 0.26,
      ask_no: 0.58,
      bid_no: 0.57,
      upper_bound: 70000,
      lower_bound: 60000
    }
  });
  const orders = await http.get('/bot/orders');
  const rows = Array.isArray(orders?.body?.all_orders)
    ? orders.body.all_orders
    : (Array.isArray(orders?.body?.orders) ? orders.body.orders : []);
  const filledEntry = rows
    .filter((r) => r?.kind === 'ENTRY' && r?.status === 'FILLED' && r?.side === 'YES')
    .filter((r) => expectedTp == null || Number(r?.tp_price) === Number(expectedTp))
    .sort((a, b) => String(b?.filled_at || b?.created_at || '').localeCompare(String(a?.filled_at || a?.created_at || '')))[0] || null;
  const linkedTp = filledEntry
    ? rows.find((r) => r?.kind === 'TAKE_PROFIT' && r?.parent_order_id === filledEntry.order_id)
    : null;
  return {
    tick_status: tick.status,
    tick_preview_reason: tick?.body?.decision_preview?.reason || null,
    filled_entry: filledEntry || null,
    linked_tp: linkedTp || null,
    summary: orders?.body?.summary || {}
  };
};

const readHeadPrevFile = (repoRelativePath) => {
  const out = spawnSync('git', ['show', `HEAD~1:${repoRelativePath}`], {
    cwd: REPO_ROOT,
    encoding: 'utf8'
  });
  return out.status === 0 ? out.stdout : '';
};

const main = async () => {
  const args = parseArgs();
  const server = await startServerOnPort(53151);
  if (!server) throw new Error('server boot failed for task 260329_003');
  const http = createHttp(server.baseUrl);
  try {
    const uiPrev = readHeadPrevFile('ui/js/strategy-editor.js');
    const serverPrev = readHeadPrevFile('strategies/crypto_binary/server.mjs');
    const ledgerPrev = readHeadPrevFile('strategies/crypto_binary/bot_order_ledger.mjs');
    const preFixFact = {
      unique_first_break_layer: '输入保存层',
      ui_tp_lt1_only: uiPrev.includes('tp_price <= 0 || item.tp_price >= 1'),
      server_tp_lt1_only: serverPrev.includes('tpPrice <= 0 || tpPrice >= 1'),
      ledger_tp_lt1_only: ledgerPrev.includes('tpPrice <= 0 || tpPrice >= 1')
    };

    const healthRoot = await fetch(`${server.baseUrl}/`).then((r) => r.status).catch(() => null);
    let healthPairs = null;
    try {
      healthPairs = await fetch(`${server.baseUrl}/pairs`).then((r) => r.status);
    } catch {
      healthPairs = 'ERR';
    }

    const cfgTp1 = {
      open_delay_sec: 0,
      ladder_prices: [0.27, 0.24],
      ladder_size: 5,
      atr_multiple: 1.2,
      cancel_all_remaining_sec: 0,
      up_ladder: [{ price: 0.31, size: 2, tp_price: 1 }],
      down_ladder: [{ price: 0.02, size: 3, tp_price: 1 }],
      up_cancel: { before_end_sec: 0, formula: 'false' },
      down_cancel: { before_end_sec: 0, formula: 'false' }
    };

    await http.post('/bot/stop', {});
    const saveTp1 = await http.post('/bot/config', cfgTp1);
    const savedCfg = await http.get('/bot/config');
    await http.post('/bot/start', { tick_interval_ms: 1000, debugScenario: 'main_path_v1' });
    const openBoth = await waitFor(async () => {
      const status = await http.get('/bot/status');
      const orders = await http.get('/bot/orders');
      const windowOpen = (orders?.body?.window_orders || []).filter((o) => o?.status === 'OPEN');
      const sides = Array.from(new Set(windowOpen.map((o) => o?.side).filter(Boolean)));
      return {
        done: sides.includes('YES') && sides.includes('NO'),
        status: status?.body || {},
        summary: orders?.body?.summary || {},
        window_open_sides: sides,
        window_open_rows: windowOpen.map((o) => ({ side: o.side, kind: o.kind, price: o.price, tp_price: o.tp_price }))
      };
    }, 30000, 400);
    await http.post('/bot/stop', {});

    const tp1NoPrehang = await runSingleFillCase(http, {
      ...cfgTp1,
      up_ladder: [{ price: 0.99, size: 2, tp_price: 1 }],
      down_ladder: [{ price: 0.01, size: 2, tp_price: 1 }]
    }, 'tp1', 1);
    const tpLt1Binding = await runSingleFillCase(http, {
      ...cfgTp1,
      up_ladder: [{ price: 0.99, size: 2, tp_price: 0.97 }],
      down_ladder: [{ price: 0.01, size: 2, tp_price: 0.02 }]
    }, 'tp097', 0.97);

    await http.post('/bot/config', cfgTp1);
    await http.post('/bot/start', { tick_interval_ms: 1000 });
    const runtimeRows = [];
    const begin = Date.now();
    while (Date.now() - begin < 18000) {
      await sleep(450);
      const status = await http.get('/bot/status');
      runtimeRows.push({
        i: runtimeRows.length,
        running: status?.body?.running === true,
        last_tick_at: status?.body?.last_tick_at || null,
        last_reason: status?.body?.last_reason || null
      });
    }
    await http.post('/bot/stop', {});
    const uniqueTicks = Array.from(new Set(runtimeRows.map((r) => r.last_tick_at).filter(Boolean)));
    const parsedTicks = uniqueTicks.map((t) => Date.parse(t)).filter((t) => Number.isFinite(t));
    let maxGapMs = null;
    for (let i = 1; i < parsedTicks.length; i += 1) {
      const gap = parsedTicks[i] - parsedTicks[i - 1];
      if (gap > 0) maxGapMs = maxGapMs == null ? gap : Math.max(maxGapMs, gap);
    }
    const runtimeFact = {
      runtime_sample: runtimeRows.slice(0, 12),
      unique_ticks: uniqueTicks.length,
      max_gap_ms: maxGapMs
    };

    const checks = {
      '003-A_fail_layer_identified_input_save': preFixFact.ui_tp_lt1_only && preFixFact.server_tp_lt1_only && preFixFact.ledger_tp_lt1_only,
      '003-B_tp1_save_and_default_accept': saveTp1.status === 200
        && saveTp1?.body?.ok === true
        && (savedCfg?.body?.current?.up_ladder || [])[0]?.tp_price === 1
        && (savedCfg?.body?.current?.down_ladder || [])[0]?.tp_price === 1,
      '003-C_up_down_entry_both_posted': Boolean(openBoth?.done)
        && Number(openBoth?.summary?.open_yes || 0) >= 1
        && Number(openBoth?.summary?.open_no || 0) >= 1,
      '003-D_tp1_no_take_profit_prehang': Boolean(tp1NoPrehang?.filled_entry)
        && tp1NoPrehang?.filled_entry?.tp_price === 1
        && tp1NoPrehang?.linked_tp == null,
      '003-E_tplt1_still_generates_tp': Boolean(tpLt1Binding?.filled_entry && tpLt1Binding?.linked_tp)
        && Number(tpLt1Binding?.filled_entry?.tp_price || 0) < 1
        && Number(tpLt1Binding?.linked_tp?.price || 0) < 1,
      '003-F_real_runtime_continuity': uniqueTicks.length >= 4 && (maxGapMs == null || maxGapMs <= 5000)
    };

    const checkKeys = Object.keys(checks);
    const passChecks = checkKeys.filter((k) => checks[k]).length;
    const failChecks = checkKeys.length - passChecks;
    const pass = failChecks === 0;
    const conclusion = pass ? 'A：DOWN挂单与tp=1语义均已收口' : 'C：存在业务语义断裂';
    const firstBreakLayer = pass ? null : '输入保存层';

    const standard = buildStandardResult({
      scriptName: 'truth_audit_down_entry_and_tp1_semantics_260329_003',
      taskId: args.taskId,
      sampleName: args.sampleName,
      pass,
      message: pass ? 'DOWN挂单与tp=1修复验收通过' : 'DOWN挂单与tp=1修复验收失败',
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
        first_break_layer: preFixFact.unique_first_break_layer,
        health_root: healthRoot,
        health_pairs: healthPairs,
        open_yes_after_fix: openBoth?.summary?.open_yes ?? null,
        open_no_after_fix: openBoth?.summary?.open_no ?? null,
        tp1_linked_tp: tp1NoPrehang?.linked_tp || null,
        tplt1_linked_tp: tpLt1Binding?.linked_tp || null,
        runtime_unique_ticks: runtimeFact.unique_ticks,
        runtime_max_gap_ms: runtimeFact.max_gap_ms
      }
    });

    const output = {
      ...standard,
      task_id: args.taskId,
      command: `node scripts/truth_audit_down_entry_and_tp1_semantics_260329_003.mjs --task_id=${args.taskId} --sample=${args.sampleName}`,
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
        pre_fix_fact: preFixFact,
        post_fix_both_entry: openBoth,
        post_fix_tp1_semantics: tp1NoPrehang,
        post_fix_tplt1_semantics: tpLt1Binding,
        post_fix_runtime: runtimeFact,
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
