import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { buildStandardResult, ensureDir, parseVerifyArgs, writeStandardLog } from './verify_standard_v1.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_TASK_ID = '260328_034';

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: 'http://localhost:53135',
  defaultOutputSuffix: 'truth_audit_formula_engine_fix',
  defaultSampleName: 'dangerous_expr_fix+isolation+runtime_perf'
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
  const ports = [53135, 53136, 53137, 53138];
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
  remaining_sec: 220,
  btc_price: 65000,
  atr_5m: 90,
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
  atr_5m: 90,
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
  const windowId = `audit-034-${caseId}`;
  const stateOverride = { ...makeState(windowId), ...statePatch };
  const contextOverride = { ...makeContext(windowId), ...contextPatch };
  const tick = await http.post('/bot/runner/tick', {
    state_override: stateOverride,
    context_override: contextOverride
  });
  const status = await http.get('/bot/status');
  const preview = await http.get('/bot/decision-preview');
  return {
    config_status: configResp.status,
    tick_status: tick.status,
    tick_body: tick.body,
    status_after: status.body,
    preview: preview.body || null
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

const computeTickPerf = (rows = []) => {
  const ticks = rows
    .map((r) => r?.last_tick_at)
    .filter(Boolean)
    .map((t) => Date.parse(t))
    .filter((t) => Number.isFinite(t));
  if (ticks.length <= 1) return { unique_ticks: ticks.length, max_gap_ms: null, min_gap_ms: null };
  const gaps = [];
  for (let i = 1; i < ticks.length; i += 1) {
    if (ticks[i] > ticks[i - 1]) gaps.push(ticks[i] - ticks[i - 1]);
  }
  if (gaps.length === 0) return { unique_ticks: ticks.length, max_gap_ms: null, min_gap_ms: null };
  return { unique_ticks: ticks.length, max_gap_ms: Math.max(...gaps), min_gap_ms: Math.min(...gaps) };
};

const read033FailFact = () => {
  const p = path.resolve(REPO_ROOT, 'rules', 'task-reports', '2026-03', '260328_033_truth_audit_formula_engine_robustness.json');
  try {
    const obj = JSON.parse(fs.readFileSync(p, 'utf8'));
    return {
      file: p,
      fail_caseC_reason: obj?.raw_excerpt?.caseC_reason || null,
      fail_caseC_check: obj?.summary?.checks?.['033-C_dangerous_expr_whitelist_isolation'] ?? null
    };
  } catch {
    return {
      file: p,
      fail_caseC_reason: null,
      fail_caseC_check: null
    };
  }
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

    const caseA = await runSingleFormulaCase({
      http,
      caseId: 'A-dangerous',
      config: withLegacy({
        ...baseLadder,
        up_cancel: { before_end_sec: 0, formula: 'globalThis.process.pid > 0' },
        down_cancel: { before_end_sec: 0, formula: 'false' }
      })
    });
    const caseAReason = caseA?.tick_body?.decision_preview?.reason || null;
    const caseAUpEval = caseA?.tick_body?.decision_preview?.diagnostics?.up_formula_eval || null;
    const caseAPass = caseA.tick_status === 200
      && caseAReason !== 'up_cancel_formula'
      && caseA?.tick_body?.decision_preview?.diagnostics?.trigger_up_formula !== true
      && caseAUpEval?.ok === false
      && ['INVALID_CHARACTER', 'IDENTIFIER_NOT_ALLOWED'].includes(caseAUpEval?.code);

    const caseB = await runSingleFormulaCase({
      http,
      caseId: 'B-undefined',
      config: withLegacy({
        ...baseLadder,
        up_cancel: { before_end_sec: 0, formula: 'undefined_symbol > 0' },
        down_cancel: { before_end_sec: 0, formula: 'false' }
      })
    });
    const caseBUpEval = caseB?.tick_body?.decision_preview?.diagnostics?.up_formula_eval || null;
    const caseBPass = caseB.tick_status === 200
      && caseB?.tick_body?.decision_preview?.reason !== 'up_cancel_formula'
      && caseBUpEval?.ok === false
      && caseBUpEval?.code === 'IDENTIFIER_NOT_ALLOWED';

    const caseC = await runSingleFormulaCase({
      http,
      caseId: 'C-valid-up',
      config: withLegacy({
        ...baseLadder,
        up_cancel: { before_end_sec: 0, formula: 'has_open_up_orders && secs_left > 0' },
        down_cancel: { before_end_sec: 0, formula: 'false' }
      })
    });
    const caseCPass = caseC.tick_status === 200
      && caseC?.tick_body?.decision_preview?.reason === 'up_cancel_formula'
      && caseC?.tick_body?.decision_preview?.diagnostics?.up_formula_eval?.ok === true
      && caseC?.tick_body?.decision_preview?.diagnostics?.trigger_up_formula === true;

    const caseD = await runSingleFormulaCase({
      http,
      caseId: 'D-isolation-up-fail',
      config: withLegacy({
        ...baseLadder,
        up_cancel: { before_end_sec: 0, formula: 'process.pid > 0' },
        down_cancel: { before_end_sec: 0, formula: 'has_open_down_orders' }
      })
    });
    const caseDPass = caseD.tick_status === 200
      && caseD?.tick_body?.decision_preview?.reason === 'down_cancel_formula'
      && caseD?.tick_body?.decision_preview?.diagnostics?.trigger_down_formula === true
      && caseD?.tick_body?.decision_preview?.diagnostics?.trigger_up_formula !== true;

    const caseE = await runSingleFormulaCase({
      http,
      caseId: 'E-isolation-down-fail',
      config: withLegacy({
        ...baseLadder,
        up_cancel: { before_end_sec: 0, formula: 'has_open_up_orders' },
        down_cancel: { before_end_sec: 0, formula: 'constructor.constructor("return process")()' }
      })
    });
    const caseEPass = caseE.tick_status === 200
      && caseE?.tick_body?.decision_preview?.reason === 'up_cancel_formula'
      && caseE?.tick_body?.decision_preview?.diagnostics?.trigger_up_formula === true
      && caseE?.tick_body?.decision_preview?.diagnostics?.trigger_down_formula !== true;

    const longFormula = [
      '(secs_left>=0&&spread>=0&&volatility_ratio>=-1&&has_open_up_orders)',
      '(btc_price>0&&upper_bound>0&&lower_bound>0)',
      '(has_open_up_orders||has_open_down_orders)'
    ].join('&&');
    await http.post('/bot/stop', {});
    await http.post('/bot/config', withLegacy({
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
      formula_length: longFormula.length,
      runtime_sample: runtimeUnique.slice(0, 12),
      perf
    };
    const caseFPass = runtimeUnique.length >= 4
      && runtimeUnique.some((r) => r.running === true)
      && (perf.max_gap_ms === null || perf.max_gap_ms <= 5000);

    const checks = {
      '034-A_dangerous_expression_safe_fail': caseAPass,
      '034-B_undefined_var_safe_fail': caseBPass,
      '034-C_formula_capability_not_disabled': caseCPass,
      '034-D_up_fail_down_isolation': caseDPass,
      '034-E_down_fail_up_isolation': caseEPass,
      '034-F_long_formula_runtime_continuity': caseFPass
    };
    const checkKeys = Object.keys(checks);
    const passChecks = checkKeys.filter((k) => checks[k]).length;
    const failChecks = checkKeys.length - passChecks;
    const pass = failChecks === 0;
    let conclusion = 'A：公式引擎健壮且边界可靠';
    let firstBreakLayer = null;
    if (!caseAPass) firstBreakLayer = 'A 危险表达式隔离层';
    else if (!caseBPass) firstBreakLayer = 'B 白名单外变量隔离层';
    else if (!caseCPass) firstBreakLayer = 'C 公式能力保持层';
    else if (!caseDPass) firstBreakLayer = 'D UP失败与DOWN隔离层';
    else if (!caseEPass) firstBreakLayer = 'E DOWN失败与UP隔离层';
    else if (!caseFPass) firstBreakLayer = 'F 公式性能边界层';
    if (firstBreakLayer) conclusion = 'C：存在业务语义断裂';

    const fail033 = read033FailFact();
    const finalWhitelist = caseC?.tick_body?.decision_preview?.diagnostics?.formula_allowed_identifiers || [];

    const standard = buildStandardResult({
      scriptName: 'truth_audit_formula_engine_fix_260328_034',
      taskId: args.taskId,
      sampleName: args.sampleName,
      pass,
      message: pass ? '公式边界修复验收通过' : '公式边界修复验收失败',
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
        fail_033_caseC_reason: fail033.fail_caseC_reason,
        pass_034_caseA_reason: caseAReason,
        pass_034_caseA_up_eval_code: caseAUpEval?.code || null,
        final_whitelist: finalWhitelist,
        runtime_unique_ticks: perf.unique_ticks,
        runtime_max_gap_ms: perf.max_gap_ms
      }
    });

    const output = {
      ...standard,
      task_id: args.taskId,
      command: `node scripts/truth_audit_formula_engine_fix_260328_034.mjs --task_id=${args.taskId} --sample=${args.sampleName}`,
      conclusion_block: {
        verdict: conclusion,
        first_break_layer: firstBreakLayer
      },
      key_counters: {
        total_checks: checkKeys.length,
        pass_checks: passChecks,
        fail_checks: failChecks
      },
      fail_to_pass: {
        from_033: fail033,
        to_034: {
          dangerous_expression_reason: caseAReason,
          dangerous_expression_eval: caseAUpEval,
          dangerous_expression_safe_fail: caseAPass
        }
      },
      final_formula_whitelist: finalWhitelist,
      evidence_index: {
        healthcheck: { root: healthRoot, pairs: healthPairs },
        case_034A: caseA,
        case_034B: caseB,
        case_034C: caseC,
        case_034D: caseD,
        case_034E: caseE,
        case_034F: caseF
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
