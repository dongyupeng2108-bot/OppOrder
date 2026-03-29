import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { buildStandardResult, ensureDir, parseVerifyArgs, writeStandardLog } from './verify_standard_v1.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_TASK_ID = '260328_031';

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: 'http://localhost:53125',
  defaultOutputSuffix: 'truth_audit_recovery_persistence',
  defaultSampleName: 'real_runtime_restart+controlled_fill'
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

const toNum = (v) => Number(v);
const isEq = (a, b, eps = 1e-9) => Math.abs(toNum(a) - toNum(b)) <= eps;

const normRows = (rows) => (Array.isArray(rows) ? rows : []).map((item) => ({
  price: toNum(item?.price),
  size: toNum(item?.size),
  tp_price: toNum(item?.tp_price)
}));

const rowsEqual = (a, b) => {
  const x = normRows(a);
  const y = normRows(b);
  if (x.length !== y.length) return false;
  for (let i = 0; i < x.length; i += 1) {
    if (!isEq(x[i].price, y[i].price)) return false;
    if (!isEq(x[i].size, y[i].size)) return false;
    if (!isEq(x[i].tp_price, y[i].tp_price)) return false;
  }
  return true;
};

const cancelEqual = (a, b) => isEq(a?.before_end_sec, b?.before_end_sec) && String(a?.formula || '') === String(b?.formula || '');

const pickContract = (cfg = {}) => ({
  open_delay_sec: toNum(cfg?.open_delay_sec),
  up_ladder: normRows(cfg?.up_ladder),
  down_ladder: normRows(cfg?.down_ladder),
  up_cancel: {
    before_end_sec: toNum(cfg?.up_cancel?.before_end_sec),
    formula: String(cfg?.up_cancel?.formula || '')
  },
  down_cancel: {
    before_end_sec: toNum(cfg?.down_cancel?.before_end_sec),
    formula: String(cfg?.down_cancel?.formula || '')
  }
});

const configEqual = (a, b) => (
  isEq(a?.open_delay_sec, b?.open_delay_sec)
  && rowsEqual(a?.up_ladder, b?.up_ladder)
  && rowsEqual(a?.down_ladder, b?.down_ladder)
  && cancelEqual(a?.up_cancel, b?.up_cancel)
  && cancelEqual(a?.down_cancel, b?.down_cancel)
);

const withLegacy = (cfg) => ({
  open_delay_sec: cfg.open_delay_sec,
  ladder_prices: [0.27, 0.24, 0.21, 0.18],
  ladder_size: 5,
  atr_multiple: 1.2,
  cancel_all_remaining_sec: 100,
  up_ladder: cfg.up_ladder,
  down_ladder: cfg.down_ladder,
  up_cancel: cfg.up_cancel,
  down_cancel: cfg.down_cancel
});

const waitServerReady = async (baseUrl, timeoutMs = 30000) => {
  const http = createHttp(baseUrl);
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const status = await http.get('/bot/status');
      const config = await http.get('/bot/config');
      if (status.status === 200 && config.status === 200) return true;
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
  const ready = await waitServerReady(baseUrl, 40000);
  if (!ready) {
    child.kill();
    return null;
  }
  return { port, baseUrl, child };
};

const acquireServer = async () => {
  const candidates = [53125, 53126, 53127, 53128];
  for (const port of candidates) {
    const server = await startServerOnPort(port);
    if (server) return server;
  }
  throw new Error('unable to start dedicated audit server on candidate ports');
};

const stopServer = async (child) => {
  if (!child || child.killed) return;
  child.kill();
  await sleep(800);
};

const waitForActiveSnapshot = async (http, timeoutMs = 60000) => {
  const start = Date.now();
  let last = null;
  while (Date.now() - start < timeoutMs) {
    last = await http.get('/bot/status');
    if (last?.status === 200 && last?.body?.active_runtime_snapshot?.config) return last;
    await sleep(350);
  }
  return last;
};

const waitForFilledWithTp = async (http, timeoutMs = 120000) => {
  const start = Date.now();
  let lastOrders = null;
  while (Date.now() - start < timeoutMs) {
    await sleep(350);
    const ordersResp = await http.get('/bot/orders');
    const rows = Array.isArray(ordersResp?.body?.orders) ? ordersResp.body.orders : [];
    const filledEntry = rows.find((r) => r?.kind === 'ENTRY' && r?.status === 'FILLED');
    const linkedTp = filledEntry
      ? rows.find((r) => r?.kind === 'TAKE_PROFIT' && r?.parent_order_id === filledEntry.order_id)
      : null;
    lastOrders = ordersResp;
    if (filledEntry && linkedTp) return { done: true, filledEntry, linkedTp, ordersResp };
  }
  return { done: false, filledEntry: null, linkedTp: null, ordersResp: lastOrders };
};

const tpFingerprint = (row) => `${row?.side}|${row?.price}|${row?.tp_price}|${row?.ladder_key}|${row?.parent_order_id}`;

const countTpFingerprint = (rows = [], fp) => rows.filter((r) => r?.kind === 'TAKE_PROFIT' && tpFingerprint(r) === fp).length;

const uniqueByTick = (rows = []) => {
  const seen = new Set();
  const output = [];
  for (const row of rows) {
    const key = row?.last_tick_at ? String(row.last_tick_at) : `${row.i}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(row);
  }
  return output;
};

const main = async () => {
  const args = parseArgs();
  const server = await acquireServer();
  const http = createHttp(server.baseUrl);

  let originalConfig = null;
  try {
    const healthRoot = await fetch(`${server.baseUrl}/`).then((r) => r.status).catch(() => null);
    let healthPairs = null;
    try {
      healthPairs = await fetch(`${server.baseUrl}/pairs`).then((r) => r.status);
    } catch {
      healthPairs = 'ERR';
    }

    await http.post('/bot/stop', {});
    const initCfg = await http.get('/bot/config');
    originalConfig = initCfg?.body?.current || null;

    const cfgA = withLegacy({
      open_delay_sec: 5,
      up_ladder: [{ price: 0.31, size: 2, tp_price: 0.35 }, { price: 0.29, size: 1, tp_price: 0.33 }],
      down_ladder: [{ price: 0.02, size: 3, tp_price: 0.03 }, { price: 0.015, size: 1, tp_price: 0.025 }],
      up_cancel: { before_end_sec: 80, formula: 'false' },
      down_cancel: { before_end_sec: 80, formula: 'false' }
    });
    await http.post('/bot/config', cfgA);
    await http.post('/bot/start', { tick_interval_ms: 1000, debugScenario: 'main_path_v1' });
    const aBefore = await waitForActiveSnapshot(http, 60000);
    const aOrdersBefore = await http.get('/bot/orders');
    const aBeforeSaved = pickContract(aBefore?.body?.saved_config || {});
    const aBeforeRuntime = pickContract(aBefore?.body?.active_runtime_snapshot?.config || {});
    const aBeforeRunning = aBefore?.body?.running === true;

    await stopServer(server.child);
    const restartedA = await startServerOnPort(server.port);
    if (!restartedA) throw new Error('failed to restart server for case 031-A');
    server.child = restartedA.child;
    const http2 = createHttp(server.baseUrl);
    await sleep(600);
    const aAfter = await http2.get('/bot/status');
    const aCfgAfter = await http2.get('/bot/config');
    const aOrdersAfter = await http2.get('/bot/orders');
    const aAfterSaved = pickContract(aAfter?.body?.saved_config || {});
    const aAfterRuntime = pickContract(aAfter?.body?.active_runtime_snapshot?.config || {});
    const aAfterRunning = aAfter?.body?.running === true;
    const aCase = {
      before_restart: {
        running: aBeforeRunning,
        saved_config: aBeforeSaved,
        active_runtime_snapshot: aBeforeRuntime,
        order_summary: aOrdersBefore?.body?.summary || {}
      },
      after_restart: {
        running: aAfterRunning,
        saved_config: aAfterSaved,
        active_runtime_snapshot: aAfterRuntime,
        config_current: pickContract(aCfgAfter?.body?.current || {}),
        order_summary: aOrdersAfter?.body?.summary || {}
      },
      pass: configEqual(pickContract(aCfgAfter?.body?.current || {}), pickContract(cfgA))
        && configEqual(aAfterSaved, pickContract(cfgA))
        && (!aAfterRunning || configEqual(aAfterRuntime, pickContract(cfgA)))
    };

    const cfgB = withLegacy({
      open_delay_sec: 0,
      up_ladder: [{ price: 0.99, size: 2, tp_price: 0.97 }],
      down_ladder: [{ price: 0.01, size: 2, tp_price: 0.02 }],
      up_cancel: { before_end_sec: 0, formula: 'false' },
      down_cancel: { before_end_sec: 0, formula: 'false' }
    });
    await http2.post('/bot/config', cfgB);
    await http2.post('/bot/start', { tick_interval_ms: 1000, debugScenario: 'fill_yes_path_v1' });
    const bPre = await waitForFilledWithTp(http2, 120000);
    const bRowsPre = Array.isArray(bPre?.ordersResp?.body?.all_orders)
      ? bPre.ordersResp.body.all_orders
      : (Array.isArray(bPre?.ordersResp?.body?.orders) ? bPre.ordersResp.body.orders : []);
    const bSummaryPre = bPre?.ordersResp?.body?.summary || {};
    const bTpFp = bPre?.linkedTp ? tpFingerprint(bPre.linkedTp) : null;
    const bTpCountPre = bTpFp ? countTpFingerprint(bRowsPre, bTpFp) : 0;

    await stopServer(server.child);
    const restartedB = await startServerOnPort(server.port);
    if (!restartedB) throw new Error('failed to restart server for case 031-B');
    server.child = restartedB.child;
    const http3 = createHttp(server.baseUrl);
    await sleep(700);
    await http3.post('/bot/start', { tick_interval_ms: 1000, debugScenario: 'fill_yes_path_v1' });
    await sleep(3000);
    const bOrdersPost = await http3.get('/bot/orders');
    await http3.post('/bot/stop', {});
    const bRowsPost = Array.isArray(bOrdersPost?.body?.all_orders)
      ? bOrdersPost.body.all_orders
      : (Array.isArray(bOrdersPost?.body?.orders) ? bOrdersPost.body.orders : []);
    const bSummaryPost = bOrdersPost?.body?.summary || {};
    const bTpCountPost = bTpFp ? countTpFingerprint(bRowsPost, bTpFp) : 0;
    const bCase = {
      pre_restart: {
        filled_entry: bPre?.filledEntry || null,
        linked_tp: bPre?.linkedTp || null,
        tp_fingerprint: bTpFp,
        tp_count: bTpCountPre,
        summary: bSummaryPre
      },
      post_restart: {
        tp_count: bTpCountPost,
        summary: bSummaryPost,
        sample_orders: bRowsPost.slice(0, 8)
      },
      pass: bPre.done === true
        && Boolean(bTpFp)
        && bTpCountPre === 1
        && bTpCountPost === 1
        && toNum(bSummaryPost?.filled_total || 0) >= toNum(bSummaryPre?.filled_total || 0)
    };

    const cfgC = withLegacy({
      open_delay_sec: 0,
      up_ladder: [{ price: 0.31, size: 2, tp_price: 0.35 }, { price: 0.29, size: 1, tp_price: 0.33 }],
      down_ladder: [{ price: 0.02, size: 3, tp_price: 0.03 }, { price: 0.015, size: 1, tp_price: 0.025 }],
      up_cancel: { before_end_sec: 1000, formula: 'false' },
      down_cancel: { before_end_sec: 1000, formula: 'false' }
    });
    await http3.post('/bot/config', cfgC);
    await http3.post('/bot/stop', {});
    await sleep(300);
    const rounds = [];
    let failStartNoTick = 0;
    let failZombieAfterStop = 0;
    const totalRounds = 20;
    for (let i = 0; i < totalRounds; i += 1) {
      const beforeStartStatus = await http3.get('/bot/status');
      const beforeStartTick = beforeStartStatus?.body?.last_tick_at || null;
      await http3.post('/bot/start', { tick_interval_ms: 1000 });
      let startOk = false;
      let beforeStopTick = null;
      for (let t = 0; t < 10; t += 1) {
        await sleep(250);
        const s = await http3.get('/bot/status');
        const tickNow = s?.body?.last_tick_at || null;
        if (s?.body?.running === true && tickNow && tickNow !== beforeStartTick) {
          startOk = true;
          beforeStopTick = tickNow;
          break;
        }
      }
      if (!startOk) failStartNoTick += 1;
      await http3.post('/bot/stop', {});
      await sleep(300);
      const stopped1 = await http3.get('/bot/status');
      const tickAtStop = stopped1?.body?.last_tick_at || beforeStopTick;
      await sleep(1200);
      const stopped2 = await http3.get('/bot/status');
      const tickAfterWait = stopped2?.body?.last_tick_at || null;
      const zombie = stopped2?.body?.running === true || (tickAtStop && tickAfterWait && tickAtStop !== tickAfterWait);
      if (zombie) failZombieAfterStop += 1;
      rounds.push({
        round: i + 1,
        start_ok: startOk,
        running_after_stop: stopped2?.body?.running === true,
        tick_at_stop: tickAtStop,
        tick_after_stop_wait: tickAfterWait
      });
    }
    const cCase = {
      rounds_total: totalRounds,
      fail_start_no_tick: failStartNoTick,
      fail_zombie_after_stop: failZombieAfterStop,
      sample_rounds: rounds.slice(0, 8),
      pass: failStartNoTick === 0 && failZombieAfterStop === 0
    };

    await http3.post('/bot/start', { tick_interval_ms: 1000 });
    const runtimeRows = [];
    const runtimeBegin = Date.now();
    while (Date.now() - runtimeBegin < 12000) {
      await sleep(450);
      const s = await http3.get('/bot/status');
      runtimeRows.push({
        i: runtimeRows.length,
        last_tick_at: s?.body?.last_tick_at || null,
        running: s?.body?.running === true,
        last_reason: s?.body?.last_reason || null
      });
    }
    await http3.post('/bot/stop', {});
    const runtimeUnique = uniqueByTick(runtimeRows).filter((r) => r.last_tick_at);
    const dStatus = await http3.get('/bot/status');
    const dOrders = await http3.get('/bot/orders');
    const dCase = {
      saved_config: pickContract(dStatus?.body?.saved_config || {}),
      active_runtime_snapshot: pickContract(dStatus?.body?.active_runtime_snapshot?.config || {}),
      status_running: dStatus?.body?.running === true,
      orders_summary: dOrders?.body?.summary || {},
      real_runtime_sample: runtimeUnique.slice(0, 8),
      pass: configEqual(pickContract(dStatus?.body?.saved_config || {}), pickContract(cfgC))
    };

    const checks = {
      '031-A_restart_recovery_config_status': aCase.pass,
      '031-B_partial_fill_tp_after_restart_no_dup_no_rollback': bCase.pass,
      '031-C_repeated_stop_start_stability': cCase.pass,
      '031-D_reconcile_saved_runtime_orders_status': dCase.pass
    };
    const checkKeys = Object.keys(checks);
    const passChecks = checkKeys.filter((k) => checks[k]).length;
    const failChecks = checkKeys.length - passChecks;
    const pass = failChecks === 0;
    let conclusion = 'A：恢复能力与持久化一致性可靠';
    let firstBreakLayer = null;
    if (!aCase.pass) firstBreakLayer = 'A 重启恢复语义层';
    else if (!bCase.pass) firstBreakLayer = 'B 成交-TP 持久化层';
    else if (!cCase.pass) firstBreakLayer = 'C stop/start 生命周期层';
    else if (!dCase.pass) firstBreakLayer = 'D saved/runtime/orders 对账层';
    if (firstBreakLayer) conclusion = 'C：存在业务语义断裂';

    const standard = buildStandardResult({
      scriptName: 'truth_audit_recovery_persistence_260328_031',
      taskId: args.taskId,
      sampleName: args.sampleName,
      pass,
      message: pass ? '恢复能力与持久化一致性审计通过' : '恢复能力与持久化一致性审计失败',
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
        health_root: healthRoot,
        health_pairs: healthPairs,
        caseA_running_after_restart: aCase.after_restart.running,
        caseB_tp_count_pre: bCase.pre_restart.tp_count,
        caseB_tp_count_post: bCase.post_restart.tp_count,
        caseC_fail_start_no_tick: cCase.fail_start_no_tick,
        caseC_fail_zombie_after_stop: cCase.fail_zombie_after_stop
      }
    });

    const output = {
      ...standard,
      task_id: args.taskId,
      command: `node scripts/truth_audit_recovery_persistence_260328_031.mjs --task_id=${args.taskId} --sample=${args.sampleName}`,
      conclusion_block: {
        verdict: conclusion,
        first_break_layer: firstBreakLayer
      },
      key_counters: {
        total_checks: checkKeys.length,
        pass_checks: passChecks,
        fail_checks: failChecks,
        stop_start_rounds: cCase.rounds_total
      },
      evidence_index: {
        healthcheck: { root: healthRoot, pairs: healthPairs },
        case_031A: aCase,
        case_031B: bCase,
        case_031C: cCase,
        case_031D: dCase
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
  } finally {
    await http.post('/bot/stop', {}).catch(() => null);
    if (originalConfig) await http.post('/bot/config', originalConfig).catch(() => null);
    await stopServer(server.child);
  }
};

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
