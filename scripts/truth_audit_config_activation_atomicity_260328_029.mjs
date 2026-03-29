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
const DEFAULT_TASK_ID = '260328_029';

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: DEFAULT_BASE_URL,
  defaultOutputSuffix: 'truth_audit_config_activation_atomicity',
  defaultSampleName: 'real_runtime+debug_controlled'
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
    if (status.status === 200 && config.status === 200) return { spawned: null };
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
      if (status.status === 200 && config.status === 200) return { spawned: child };
    } catch {}
  }
  child.kill();
  throw new Error(`failed to boot server: ${baseUrl}`);
};

const n = (v) => Number(v);
const isEq = (a, b, eps = 1e-9) => Math.abs(n(a) - n(b)) <= eps;

const normRows = (rows) => (Array.isArray(rows) ? rows : []).map((item) => ({
  price: n(item?.price),
  size: n(item?.size),
  tp_price: n(item?.tp_price)
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

const configEqual = (a, b) => (
  isEq(a?.open_delay_sec, b?.open_delay_sec)
  && rowsEqual(a?.up_ladder, b?.up_ladder)
  && rowsEqual(a?.down_ladder, b?.down_ladder)
  && cancelEqual(a?.up_cancel, b?.up_cancel)
  && cancelEqual(a?.down_cancel, b?.down_cancel)
);

const pickContract = (cfg = {}) => ({
  open_delay_sec: n(cfg?.open_delay_sec),
  up_ladder: normRows(cfg?.up_ladder),
  down_ladder: normRows(cfg?.down_ladder),
  up_cancel: {
    before_end_sec: n(cfg?.up_cancel?.before_end_sec),
    formula: String(cfg?.up_cancel?.formula || '')
  },
  down_cancel: {
    before_end_sec: n(cfg?.down_cancel?.before_end_sec),
    formula: String(cfg?.down_cancel?.formula || '')
  }
});

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

const waitActiveRuntime = async (http, timeoutMs = 90000) => {
  const begin = Date.now();
  let last = null;
  while (Date.now() - begin < timeoutMs) {
    last = await http.get('/bot/status');
    if (last?.status === 200 && last?.body?.active_runtime_snapshot?.config) return last;
    await sleep(400);
  }
  return last;
};

const uniqueTickRows = (rows = []) => {
  const seen = new Set();
  const unique = [];
  for (const row of rows) {
    const key = row?.last_tick_at ? String(row.last_tick_at) : `${row?.i}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(row);
  }
  return unique;
};

const main = async () => {
  const args = parseArgs();
  const http = createHttp(args.baseUrl);
  const boot = await ensureServer(args);
  let originalConfig = null;
  try {
    const healthRoot = await fetch(`${args.baseUrl}/`).then((r) => r.status).catch(() => null);
    let healthPairs = null;
    try {
      healthPairs = await fetch(`${args.baseUrl}/pairs`).then((r) => r.status);
    } catch {
      healthPairs = 'ERR';
    }

    await http.post('/bot/stop', {});
    const initCfg = await http.get('/bot/config');
    originalConfig = initCfg?.body?.current || null;

    const cfgA = withLegacy({
      open_delay_sec: 3,
      up_ladder: [{ price: 0.31, size: 2, tp_price: 0.36 }, { price: 0.29, size: 1, tp_price: 0.34 }],
      down_ladder: [{ price: 0.02, size: 3, tp_price: 0.03 }, { price: 0.015, size: 1, tp_price: 0.025 }],
      up_cancel: { before_end_sec: 41, formula: 'false' },
      down_cancel: { before_end_sec: 42, formula: 'false' }
    });
    const cfgB = withLegacy({
      open_delay_sec: 8,
      up_ladder: [{ price: 0.41, size: 6, tp_price: 0.43 }, { price: 0.39, size: 4, tp_price: 0.42 }],
      down_ladder: [{ price: 0.61, size: 7, tp_price: 0.59 }, { price: 0.63, size: 5, tp_price: 0.6 }],
      up_cancel: { before_end_sec: 81, formula: 'spread > 0.02' },
      down_cancel: { before_end_sec: 82, formula: 'spread > 0.03' }
    });
    const cfgC = withLegacy({
      open_delay_sec: 12,
      up_ladder: [{ price: 0.51, size: 8, tp_price: 0.53 }, { price: 0.49, size: 6, tp_price: 0.52 }],
      down_ladder: [{ price: 0.71, size: 9, tp_price: 0.69 }, { price: 0.73, size: 7, tp_price: 0.7 }],
      up_cancel: { before_end_sec: 91, formula: 'volatility_ratio > 0.001' },
      down_cancel: { before_end_sec: 92, formula: 'volatility_ratio > 0.002' }
    });

    const aSave = await http.post('/bot/config', cfgA);
    const aGet = await http.get('/bot/config');
    const aPreview = await http.get('/bot/decision-preview');
    const caseA = {
      save_status: aSave.status,
      config_current: pickContract(aGet?.body?.current || {}),
      preview_config: pickContract(aPreview?.body?.config || {}),
      pass: aSave.status === 200
        && configEqual(pickContract(aGet?.body?.current || {}), pickContract(cfgA))
        && configEqual(pickContract(aPreview?.body?.config || {}), pickContract(cfgA))
    };

    await http.post('/bot/start', { tick_interval_ms: 1000, debugScenario: 'main_path_v1' });
    const bBefore = await waitActiveRuntime(http, 90000);
    const bBeforeRuntime = pickContract(bBefore?.body?.active_runtime_snapshot?.config || {});
    const bSave = await http.post('/bot/config', cfgB);
    const bStatusAfter = await http.get('/bot/status');
    const bPreviewAfter = await http.get('/bot/decision-preview');
    const bSaved = pickContract(bStatusAfter?.body?.saved_config || {});
    const bRuntime = pickContract(bStatusAfter?.body?.active_runtime_snapshot?.config || {});
    const bPreviewConfig = pickContract(bPreviewAfter?.body?.config || {});
    const caseB = {
      save_status: bSave.status,
      saved_config: bSaved,
      active_runtime_snapshot: bRuntime,
      preview_config: bPreviewConfig,
      pass: bSave.status === 200
        && configEqual(bSaved, pickContract(cfgB))
        && configEqual(bRuntime, bBeforeRuntime)
        && configEqual(bPreviewConfig, pickContract(cfgB))
    };

    await http.post('/bot/stop', {});
    await sleep(600);
    await http.post('/bot/start', { tick_interval_ms: 1000, debugScenario: 'main_path_v1' });
    const cAfterRestart = await waitActiveRuntime(http, 90000);
    const cRuntime = pickContract(cAfterRestart?.body?.active_runtime_snapshot?.config || {});
    const cSaved = pickContract(cAfterRestart?.body?.saved_config || {});
    const cPreview = await http.get('/bot/decision-preview');
    const cPreviewCfg = pickContract(cPreview?.body?.config || {});
    const caseC = {
      active_runtime_snapshot: cRuntime,
      saved_config: cSaved,
      preview_config: cPreviewCfg,
      pass: configEqual(cRuntime, pickContract(cfgB))
        && configEqual(cSaved, pickContract(cfgB))
        && configEqual(cPreviewCfg, pickContract(cfgB))
    };

    await http.post('/bot/stop', {});
    await sleep(400);
    const dR1 = await http.post('/bot/config', cfgA);
    const dR2 = await http.post('/bot/config', cfgB);
    const dR3 = await http.post('/bot/config', cfgC);
    const dGet = await http.get('/bot/config');
    const dFinal = pickContract(dGet?.body?.current || {});
    const dPassFinalDeterministic = configEqual(dFinal, pickContract(cfgC));
    const dMixed = !dPassFinalDeterministic && (
      (rowsEqual(dFinal.up_ladder, cfgA.up_ladder) || rowsEqual(dFinal.up_ladder, cfgB.up_ladder) || rowsEqual(dFinal.up_ladder, cfgC.up_ladder))
      && (rowsEqual(dFinal.down_ladder, cfgA.down_ladder) || rowsEqual(dFinal.down_ladder, cfgB.down_ladder) || rowsEqual(dFinal.down_ladder, cfgC.down_ladder))
      && (
        !configEqual(dFinal, pickContract(cfgA))
        && !configEqual(dFinal, pickContract(cfgB))
        && !configEqual(dFinal, pickContract(cfgC))
      )
    );
    const caseD = {
      post_statuses: [dR1.status, dR2.status, dR3.status],
      final_config: dFinal,
      pass: dR1.status === 200 && dR2.status === 200 && dR3.status === 200 && dPassFinalDeterministic && !dMixed,
      mixed_detected: dMixed
    };

    await http.post('/bot/start', { tick_interval_ms: 1000 });
    const runtimeRows = [];
    const startAt = Date.now();
    while (Date.now() - startAt < 90000) {
      await sleep(500);
      const s = await http.get('/bot/status');
      runtimeRows.push({
        i: runtimeRows.length,
        last_tick_at: s?.body?.last_tick_at || null,
        last_reason: s?.body?.last_reason || null,
        saved_config: pickContract(s?.body?.saved_config || {}),
        active_runtime_snapshot: pickContract(s?.body?.active_runtime_snapshot?.config || {})
      });
      const uniq = uniqueTickRows(runtimeRows).filter((row) => row.last_tick_at);
      if (uniq.length >= 4) break;
    }
    const runtimeUnique = uniqueTickRows(runtimeRows);
    const latestStatus = await http.get('/bot/status');
    const eSaved = pickContract(latestStatus?.body?.saved_config || {});
    const eRuntime = pickContract(latestStatus?.body?.active_runtime_snapshot?.config || {});
    const ePreview = await http.get('/bot/decision-preview');
    const ePreviewCfg = pickContract(ePreview?.body?.config || {});
    const caseE = {
      saved_config: eSaved,
      preview_config: ePreviewCfg,
      active_runtime_snapshot: eRuntime,
      runtime_unique_sample: runtimeUnique.slice(-6),
      pass: configEqual(eSaved, pickContract(cfgC))
        && configEqual(ePreviewCfg, pickContract(cfgC))
        && configEqual(eRuntime, pickContract(cfgC))
    };

    await http.post('/bot/stop', {});

    const checks = {
      '029-A_stop_save_read_consistency': caseA.pass,
      '029-B_running_save_without_restart': caseB.pass,
      '029-C_running_save_then_restart_switch': caseC.pass,
      '029-D_high_freq_post_atomicity': caseD.pass,
      '029-E_saved_preview_runtime_reconciliation': caseE.pass
    };
    const checkKeys = Object.keys(checks);
    const passCount = checkKeys.filter((k) => checks[k]).length;
    const failCount = checkKeys.length - passCount;

    const firstBreakLayer = !caseA.pass
      ? 'A 保存/读取层'
      : (!caseB.pass
        ? 'B 运行中保存语义层'
        : (!caseC.pass
          ? 'C 重启生效层'
          : (!caseD.pass
            ? 'D 保存原子性层'
            : (!caseE.pass ? 'E 三方对账层' : null))));

    const conclusion = failCount === 0 ? 'A：配置生效语义清楚且一致' : 'C：存在业务语义断裂';
    const pass = failCount === 0;

    const standard = buildStandardResult({
      scriptName: 'truth_audit_config_activation_atomicity_260328_029',
      taskId: args.taskId,
      sampleName: args.sampleName,
      pass,
      message: pass ? '配置生效语义与保存原子性审计通过' : '配置生效语义与保存原子性审计失败',
      firstBreakLayer,
      evidenceFile: args.output,
      summary: {
        conclusion,
        total_checks: checkKeys.length,
        pass_checks: passCount,
        fail_checks: failCount,
        checks
      },
      rawExcerpt: {
        health_root: healthRoot,
        health_pairs: healthPairs,
        caseA_save_status: caseA.save_status,
        caseB_save_status: caseB.save_status,
        caseD_post_statuses: caseD.post_statuses,
        caseD_mixed_detected: caseD.mixed_detected
      }
    });

    const output = {
      ...standard,
      task_id: args.taskId,
      command: `node scripts/truth_audit_config_activation_atomicity_260328_029.mjs --task_id=${args.taskId} --sample=${args.sampleName}`,
      conclusion_block: {
        verdict: conclusion,
        first_break_layer: firstBreakLayer
      },
      key_counters: {
        total_checks: checkKeys.length,
        pass_checks: passCount,
        fail_checks: failCount
      },
      evidence_index: {
        healthcheck: { root: healthRoot, pairs: healthPairs },
        case_029A: caseA,
        case_029B: caseB,
        case_029C: caseC,
        case_029D: caseD,
        case_029E: caseE
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
      pass_checks: passCount,
      fail_checks: failCount
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
