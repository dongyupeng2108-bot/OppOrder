import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { buildStandardResult, ensureDir, parseVerifyArgs, writeStandardLog } from './verify_standard_v1.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_TASK_ID = '260328_033';

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: 'http://localhost:53131',
  defaultOutputSuffix: 'truth_audit_formula_engine_robustness',
  defaultSampleName: 'syntax+undefined+dangerous+isolation+runtime_perf'
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

const waitServerReady = async (baseUrl, timeoutMs = 35000) => {
  const http = createHttp(baseUrl);
  const begin = Date.now();
  while (Date.now() - begin < timeoutMs) {
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
  return { child, baseUrl, port };
};

const acquireServer = async () => {
  const ports = [53131, 53132, 53133, 53134];
  for (const port of ports) {
    const server = await startServerOnPort(port);
    if (server) return server;
  }
  throw new Error('unable to boot dedicated audit server on candidate ports');
};

const stopServer = async (child) => {
  if (!child || child.killed) return;
  child.kill();
  await sleep(800);
};

const withLegacy = (cfg) => ({
  open_delay_sec: cfg.open_delay_sec,
  ladder_prices: [0.27, 0.24, 0.21, 0.18],
  ladder_size: 5,
  atr_multiple: 1.2,
  cancel_all_remaining_sec: 0,
  up_ladder: cfg.up_ladder,
  down_ladder: cfg.down_ladder,
  up_cancel: cfg.up_cancel,
  down_cancel: cfg.down_cancel
});

const makeContext = (windowId) => ({
  window_id: windowId,
  period: '5m',
  remaining_sec: 200,
  btc_price: 65000,
  atr_5m: 80,
  ask_yes: 0.42,
  bid_yes: 0.41,
  ask_no: 0.59,
  bid_no: 0.58,
  upper_bound: 70000,
  lower_bound: 60000
});

const makeState = (windowId) => ({
  current_window_id: windowId,
  window_initialized_at: new Date(Date.now() - 5000).toISOString(),
  ladder_posted: true,
  yes_order_ids: ['yes_open_1'],
  no_order_ids: ['no_open_1'],
  yes_cancelled: false,
  no_cancelled: false,
  up_formula_cancelled: false,
  down_formula_cancelled: false,
  anchor_btc: 65000,
  atr_5m: 80,
  upper_bound: 70000,
  lower_bound: 60000
});

const prepareOrdersForManualTick = async (http) => {
  await http.post('/bot/paper/apply-action', { action: 'CANCEL_ALL_OPEN' });
  await http.post('/bot/paper/apply-action', { action: 'PLACE_BOTH_LADDERS' });
};

const runSingleFormulaCase = async ({ http, caseId, config, statePatch = {}, contextPatch = {} }) => {
  await http.post('/bot/stop', {});
  await sleep(180);
  const configResp = await http.post('/bot/config', config);
  await prepareOrdersForManualTick(http);
  const windowId = `audit-033-${caseId}`;
  const stateOverride = { ...makeState(windowId), ...statePatch };
  const contextOverride = { ...makeContext(windowId), ...contextPatch };
  const tick = await http.post('/bot/runner/tick', {
    state_override: stateOverride,
    context_override: contextOverride
  });
  const status = await http.get('/bot/status');
  const orders = await http.get('/bot/orders');
  const preview = await http.get('/bot/decision-preview');
  return {
    config_status: configResp.status,
    config_body: configResp.body,
    tick_status: tick.status,
    tick_body: tick.body,
    status_after: status.body,
    summary_after: orders?.body?.summary || null,
    preview: preview?.body || null
  };
};

const uniqueByTick = (rows = []) => {
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const key = row?.last_tick_at ? String(row.last_tick_at) : `i:${row.i}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
};

const runFormulaTrace = async ({
  http,
  config,
  debugScenario = 'main_path_v1',
  loops = 28,
  tickIntervalMs = 1000
}) => {
  await http.post('/bot/stop', {});
  await sleep(250);
  const configResp = await http.post('/bot/config', config);
  const startResp = await http.post('/bot/start', { tick_interval_ms: tickIntervalMs, debugScenario });
  const trace = [];
  for (let i = 0; i < loops; i += 1) {
    await sleep(340);
    const status = await http.get('/bot/status');
    const orders = await http.get('/bot/orders');
    trace.push({
      i,
      running: status?.body?.running === true,
      last_tick_at: status?.body?.last_tick_at || null,
      last_reason: status?.body?.last_reason || null,
      yes_cancelled: status?.body?.yes_cancelled === true,
      no_cancelled: status?.body?.no_cancelled === true,
      up_formula_cancelled: status?.body?.up_formula_cancelled === true,
      down_formula_cancelled: status?.body?.down_formula_cancelled === true,
      open_yes: Number(orders?.body?.summary?.open_yes || 0),
      open_no: Number(orders?.body?.summary?.open_no || 0),
      total: Number(orders?.body?.summary?.total || 0)
    });
  }
  const preview = await http.get('/bot/decision-preview');
  await http.post('/bot/stop', {});
  const unique = uniqueByTick(trace);
  const reasons = unique.map((r) => r.last_reason).filter(Boolean);
  return {
    config_status: configResp.status,
    config_body: configResp.body,
    start_status: startResp.status,
    unique,
    unique_count: unique.length,
    reason_counts: {
      up_cancel_formula: reasons.filter((r) => r === 'up_cancel_formula').length,
      down_cancel_formula: reasons.filter((r) => r === 'down_cancel_formula').length,
      both: reasons.filter((r) => r === 'directional_cancel_both_triggered').length
    },
    running_ticks: unique.filter((r) => r.running && r.last_tick_at).length,
    service_alive: unique.some((r) => r.running === true),
    down_open_observed: unique.some((r) => r.open_no > 0),
    up_open_observed: unique.some((r) => r.open_yes > 0),
    preview: preview?.body || null
  };
};

const computeTickPerf = (rows = []) => {
  const ticks = rows
    .map((r) => r?.last_tick_at)
    .filter(Boolean)
    .map((t) => Date.parse(t))
    .filter((t) => Number.isFinite(t));
  if (ticks.length <= 1) {
    return { unique_ticks: ticks.length, max_gap_ms: null, min_gap_ms: null };
  }
  const gaps = [];
  for (let i = 1; i < ticks.length; i += 1) {
    if (ticks[i] > ticks[i - 1]) gaps.push(ticks[i] - ticks[i - 1]);
  }
  if (gaps.length === 0) return { unique_ticks: ticks.length, max_gap_ms: null, min_gap_ms: null };
  return {
    unique_ticks: ticks.length,
    max_gap_ms: Math.max(...gaps),
    min_gap_ms: Math.min(...gaps)
  };
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
    const cfg = await http.get('/bot/config');
    originalConfig = cfg?.body?.current || null;

    const baseLadder = {
      open_delay_sec: 0,
      up_ladder: [{ price: 0.31, size: 2, tp_price: 0.35 }, { price: 0.29, size: 1, tp_price: 0.33 }],
      down_ladder: [{ price: 0.02, size: 3, tp_price: 0.03 }, { price: 0.015, size: 1, tp_price: 0.025 }]
    };

    const caseA_syntax = await runSingleFormulaCase({
      http,
      caseId: 'A-syntax',
      config: withLegacy({
        ...baseLadder,
        up_cancel: { before_end_sec: 0, formula: 'has_open_up_orders && (' },
        down_cancel: { before_end_sec: 0, formula: 'false' }
      })
    });
    await http.post('/bot/stop', {});
    const caseA_non_string_resp = await http.post('/bot/config', withLegacy({
      ...baseLadder,
      up_cancel: { before_end_sec: 0, formula: 12345 },
      down_cancel: { before_end_sec: 0, formula: 'false' }
    }));
    const caseA_non_string_after = await http.get('/bot/config');
    const caseA_blank = await runSingleFormulaCase({
      http,
      caseId: 'A-blank',
      config: withLegacy({
        ...baseLadder,
        up_cancel: { before_end_sec: 0, formula: '   ' },
        down_cancel: { before_end_sec: 0, formula: 'false' }
      })
    });
    const caseA_syntax_reason = caseA_syntax?.tick_body?.decision_preview?.reason || null;
    const caseA_blank_reason = caseA_blank?.tick_body?.decision_preview?.reason || null;
    const caseA_syntax_trigger_up = caseA_syntax?.tick_body?.decision_preview?.diagnostics?.trigger_up_formula === true;
    const caseA_blank_trigger_up = caseA_blank?.tick_body?.decision_preview?.diagnostics?.trigger_up_formula === true;
    const caseA = {
      syntax: caseA_syntax,
      non_string: {
        config_status: caseA_non_string_resp.status,
        body: caseA_non_string_resp.body,
        saved_up_formula_after_attempt: caseA_non_string_after?.body?.current?.up_cancel?.formula
      },
      blank: caseA_blank,
      pass: caseA_syntax.tick_status === 200
        && caseA_blank.tick_status === 200
        && caseA_syntax.status_after?.running !== true
        && caseA_syntax_reason !== 'up_cancel_formula'
        && caseA_blank_reason !== 'up_cancel_formula'
        && caseA_syntax_trigger_up === false
        && caseA_blank_trigger_up === false
        && (caseA_non_string_resp.status === 400 || caseA_non_string_after?.body?.current?.up_cancel?.formula === '')
    };

    const caseB = await runSingleFormulaCase({
      http,
      caseId: 'B-undefined',
      config: withLegacy({
        ...baseLadder,
        up_cancel: { before_end_sec: 0, formula: 'undefined_symbol > 0' },
        down_cancel: { before_end_sec: 0, formula: 'false' }
      })
    });
    const caseB_pass = caseB.tick_status === 200
      && caseB?.tick_body?.decision_preview?.reason !== 'up_cancel_formula'
      && caseB?.tick_body?.decision_preview?.diagnostics?.trigger_up_formula !== true;

    const caseC = await runSingleFormulaCase({
      http,
      caseId: 'C-dangerous',
      config: withLegacy({
        ...baseLadder,
        up_cancel: { before_end_sec: 0, formula: 'globalThis.process.pid > 0' },
        down_cancel: { before_end_sec: 0, formula: 'false' }
      })
    });
    const caseC_pass = caseC.tick_status === 200
      && caseC?.tick_body?.decision_preview?.diagnostics?.trigger_up_formula !== true
      && caseC?.tick_body?.decision_preview?.reason !== 'up_cancel_formula';

    const caseD = await runSingleFormulaCase({
      http,
      caseId: 'D-up-fail-down-ok',
      config: withLegacy({
        ...baseLadder,
        up_cancel: { before_end_sec: 0, formula: 'has_open_up_orders && (' },
        down_cancel: { before_end_sec: 1000, formula: 'has_open_down_orders' }
      })
    });
    const caseD_reason = caseD?.tick_body?.decision_preview?.reason || null;
    const caseD_diag = caseD?.tick_body?.decision_preview?.diagnostics || {};
    const caseD_pass = caseD.tick_status === 200
      && caseD_reason === 'down_cancel_formula'
      && caseD_diag.trigger_down_formula === true
      && caseD_diag.trigger_up_formula !== true;

    const caseE = await runSingleFormulaCase({
      http,
      caseId: 'E-down-fail-up-ok',
      config: withLegacy({
        ...baseLadder,
        up_cancel: { before_end_sec: 1000, formula: 'has_open_up_orders' },
        down_cancel: { before_end_sec: 0, formula: 'has_open_down_orders && (' }
      })
    });
    const caseE_reason = caseE?.tick_body?.decision_preview?.reason || null;
    const caseE_diag = caseE?.tick_body?.decision_preview?.diagnostics || {};
    const caseE_pass = caseE.tick_status === 200
      && caseE_reason === 'up_cancel_formula'
      && caseE_diag.trigger_up_formula === true
      && caseE_diag.trigger_down_formula !== true;

    const longFormula = [
      '(secs_left>=-1&&spread>=-1&&volatility_ratio>=-1&&has_open_up_orders)',
      '(btc_price>=-1&&upper_bound>=-1&&lower_bound>=-1)',
      '(has_open_up_orders||has_open_down_orders)'
    ].join('&&');
    await http.post('/bot/stop', {});
    const caseF_cfg = await http.post('/bot/config', withLegacy({
      ...baseLadder,
      up_cancel: { before_end_sec: 0, formula: longFormula },
      down_cancel: { before_end_sec: 0, formula: 'false' }
    }));
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
    const runtimeUnique = uniqueByTick(runtimeRows).filter((r) => r.last_tick_at);
    const perf = computeTickPerf(runtimeUnique);
    const caseF = {
      config_status: caseF_cfg.status,
      formula_length: longFormula.length,
      runtime_sample: runtimeUnique.slice(0, 12),
      perf,
      pass: caseF_cfg.status === 200
        && runtimeUnique.length >= 4
        && runtimeUnique.some((r) => r.running === true)
        && (perf.max_gap_ms === null || perf.max_gap_ms <= 5000)
    };

    const checks = {
      '033-A_illegal_formula_tolerance': caseA.pass,
      '033-B_undefined_var_safe_fail': caseB_pass,
      '033-C_dangerous_expr_whitelist_isolation': caseC_pass,
      '033-D_up_fail_down_isolation': caseD_pass,
      '033-E_down_fail_up_isolation': caseE_pass,
      '033-F_long_formula_tick_continuity': caseF.pass
    };
    const checkKeys = Object.keys(checks);
    const passChecks = checkKeys.filter((k) => checks[k]).length;
    const failChecks = checkKeys.length - passChecks;
    const pass = failChecks === 0;
    let conclusion = 'A：公式引擎健壮且边界可靠';
    let firstBreakLayer = null;
    if (!caseA.pass) firstBreakLayer = 'A 非法公式容错层';
    else if (!caseB_pass) firstBreakLayer = 'B 未定义变量隔离层';
    else if (!caseC_pass) firstBreakLayer = 'C 变量白名单与危险表达式边界层';
    else if (!caseD_pass) firstBreakLayer = 'D UP失败与DOWN隔离层';
    else if (!caseE_pass) firstBreakLayer = 'E DOWN失败与UP隔离层';
    else if (!caseF.pass) firstBreakLayer = 'F 公式性能边界层';
    if (firstBreakLayer) conclusion = 'C：存在业务语义断裂';

    const standard = buildStandardResult({
      scriptName: 'truth_audit_formula_engine_robustness_260328_033',
      taskId: args.taskId,
      sampleName: args.sampleName,
      pass,
      message: pass ? '公式引擎健壮性审计通过' : '公式引擎健壮性审计失败',
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
        caseA_syntax_reason: caseA_syntax_reason,
        caseB_reason: caseB?.tick_body?.decision_preview?.reason || null,
        caseC_reason: caseC?.tick_body?.decision_preview?.reason || null,
        caseD_reason: caseD_reason,
        caseE_reason: caseE_reason,
        caseF_unique_ticks: caseF.perf.unique_ticks,
        caseF_max_gap_ms: caseF.perf.max_gap_ms
      }
    });

    const output = {
      ...standard,
      task_id: args.taskId,
      command: `node scripts/truth_audit_formula_engine_robustness_260328_033.mjs --task_id=${args.taskId} --sample=${args.sampleName}`,
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
        healthcheck: { root: healthRoot, pairs: healthPairs },
        case_033A: caseA,
        case_033B: caseB,
        case_033C: caseC,
        case_033D: caseD,
        case_033E: caseE,
        case_033F: caseF
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
