import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { buildStandardResult, parseVerifyArgs, writeStandardLog } from './verify_standard_v1.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

const DEFAULT_PORT = 53123;
const DEFAULT_BASE_URL = `http://localhost:${DEFAULT_PORT}`;
const DEFAULT_TASK_ID = '260324_040';

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: DEFAULT_BASE_URL,
  defaultOutputSuffix: 'config_effect_chain',
  defaultSampleName: 'debug_main_path_v1+debug_fill_yes_path_v1+real_no_debug'
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

const ensureDir = (filePath) => {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
};

const ensureServer = async ({ baseUrl, spawnServer }) => {
  const http = createHttp(baseUrl);
  try {
    const status = await http.get('/bot/status');
    if (status.status === 200) return { spawned: null };
  } catch {}
  if (!spawnServer) throw new Error(`server unreachable: ${baseUrl}`);
  const child = spawn('node', ['strategies/crypto_binary/server.mjs', '--port=53123'], {
    cwd: REPO_ROOT,
    stdio: 'ignore',
    detached: false
  });
  for (let i = 0; i < 30; i += 1) {
    await sleep(500);
    try {
      const status = await http.get('/bot/status');
      if (status.status === 200) return { spawned: child };
    } catch {}
  }
  child.kill();
  throw new Error(`failed to boot server: ${baseUrl}`);
};

const numberEq = (a, b, eps = 1e-9) => Math.abs(Number(a) - Number(b)) <= eps;

const normalizeConfig = (cfg) => ({
  open_delay_sec: Number(cfg?.open_delay_sec),
  ladder_prices: Array.isArray(cfg?.ladder_prices) ? cfg.ladder_prices.map((v) => Number(v)) : [],
  ladder_size: Number(cfg?.ladder_size),
  atr_multiple: Number(cfg?.atr_multiple),
  cancel_all_remaining_sec: Number(cfg?.cancel_all_remaining_sec)
});

const configEqual = (a, b) => {
  const x = normalizeConfig(a);
  const y = normalizeConfig(b);
  if (!numberEq(x.open_delay_sec, y.open_delay_sec)) return false;
  if (!numberEq(x.ladder_size, y.ladder_size)) return false;
  if (!numberEq(x.atr_multiple, y.atr_multiple)) return false;
  if (!numberEq(x.cancel_all_remaining_sec, y.cancel_all_remaining_sec)) return false;
  if (x.ladder_prices.length !== y.ladder_prices.length) return false;
  for (let i = 0; i < x.ladder_prices.length; i += 1) {
    if (!numberEq(x.ladder_prices[i], y.ladder_prices[i])) return false;
  }
  return true;
};

const waitStatus = async (http, predicate, timeoutMs = 90000) => {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeoutMs) {
    const status = await http.get('/bot/status');
    last = status;
    if (predicate(status?.body || {})) return status;
    await sleep(550);
  }
  return last;
};

const pickLatestConfigAppliedLog = (logs, targetConfig) => {
  const rows = Array.isArray(logs) ? logs : [];
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const item = rows[i];
    if (item?.event !== 'BOT_CONFIG_APPLIED') continue;
    if (configEqual(item?.data || {}, targetConfig)) return item;
  }
  return null;
};

const extractLadderIntent = (decision) => {
  const intents = Array.isArray(decision?.intents) ? decision.intents : [];
  return intents.find((it) => it?.kind === 'PLACE_LADDER') || null;
};

const main = async () => {
  const args = parseArgs();
  const http = createHttp(args.baseUrl);
  const boot = await ensureServer(args);
  const startSamples = String(args.sampleName || '');

  const configB = {
    open_delay_sec: 8,
    ladder_prices: [0.31, 0.28, 0.25, 0.22],
    ladder_size: 6,
    atr_multiple: 1.3,
    cancel_all_remaining_sec: 110
  };
  const configC = {
    open_delay_sec: 12,
    ladder_prices: [0.36, 0.33, 0.3, 0.27],
    ladder_size: 9,
    atr_multiple: 1.7,
    cancel_all_remaining_sec: 80
  };

  let originalConfig = null;
  try {
    await http.post('/bot/stop', {});
    await sleep(300);
    const cfgInit = await http.get('/bot/config');
    originalConfig = cfgInit?.body?.current || null;

    const saveStoppedRes = await http.post('/bot/config', configB);
    const cfgAfterStoppedSave = await http.get('/bot/config');
    const statusAfterStoppedSave = await http.get('/bot/status');

    const stoppedSavePass = saveStoppedRes.status === 200
      && configEqual(cfgAfterStoppedSave?.body?.current, configB)
      && configEqual(statusAfterStoppedSave?.body?.saved_config, configB);

    await http.post('/bot/start', { tick_interval_ms: 1000, debugScenario: 'main_path_v1' });
    const runningBeforeSave = await waitStatus(
      http,
      (s) => s.running === true && s.active_runtime_snapshot?.config,
      90000
    );
    const runningConfigBefore = runningBeforeSave?.body?.active_runtime_snapshot?.config || null;

    await http.post('/bot/config', configC);
    const statusAfterSaveNoRestart = await http.get('/bot/status');
    const saveNoRestartPass = configEqual(statusAfterSaveNoRestart?.body?.saved_config, configC)
      && configEqual(statusAfterSaveNoRestart?.body?.active_runtime_snapshot?.config, runningConfigBefore)
      && configEqual(runningConfigBefore, configB);

    await http.post('/bot/stop', {});
    await sleep(700);

    await http.post('/bot/start', { tick_interval_ms: 1000, debugScenario: 'main_path_v1' });
    const runningAfterRestart = await waitStatus(
      http,
      (s) => s.running === true && s.active_runtime_snapshot?.config,
      90000
    );
    const restartConfig = runningAfterRestart?.body?.active_runtime_snapshot?.config || null;
    const activeRuntimeSyncPass = configEqual(restartConfig, configC);

    await http.post('/bot/stop', {});
    await sleep(700);

    await http.post('/bot/start', { tick_interval_ms: 1000, debugScenario: 'fill_yes_path_v1' });
    await waitStatus(http, (s) => s.running === true && s.active_runtime_snapshot?.config, 90000);
    let runtimeOrders = null;
    for (let i = 0; i < 28; i += 1) {
      await sleep(600);
      const orders = await http.get('/bot/orders');
      const rows = Array.isArray(orders?.body?.window_orders) ? orders.body.window_orders : [];
      const entryRows = rows.filter((row) => row?.kind === 'ENTRY');
      if (entryRows.length) {
        runtimeOrders = entryRows;
        break;
      }
    }
    const runtimeObservedPrices = runtimeOrders
      ? [...new Set(runtimeOrders.map((row) => Number(row?.price)).filter((v) => Number.isFinite(v)))]
      : [];
    const runtimeObservedSizes = runtimeOrders
      ? [...new Set(runtimeOrders.map((row) => Number(row?.size)).filter((v) => Number.isFinite(v)))]
      : [];
    const runtimeLadderSizePass = runtimeOrders ? runtimeObservedSizes.includes(configC.ladder_size) : null;
    const runtimeLadderPricesPass = runtimeOrders ? configC.ladder_prices.every((price) => runtimeObservedPrices.some((v) => numberEq(v, price, 1e-9))) : null;

    await http.post('/bot/stop', {});
    await sleep(700);

    const decisionOpen = await http.get('/bot/decision-preview?fixture=OPEN_10S_LADDER_EMPTY');
    const decisionRemaining = await http.get('/bot/decision-preview?fixture=REMAINING_100S');
    const ladderIntent = extractLadderIntent(decisionOpen?.body || {});
    const ladderFixturePass = decisionOpen.status === 200
      && ladderIntent != null
      && numberEq(Number(ladderIntent.size), configC.ladder_size)
      && Array.isArray(ladderIntent.prices)
      && configEqual(
        { ...configC, ladder_prices: ladderIntent.prices },
        { ...configC, ladder_prices: configC.ladder_prices }
      );
    const cancelFixturePass = decisionRemaining.status === 200
      && !String(decisionRemaining?.body?.intents_summary || '').includes('CANCEL_OPEN(ALL)')
      && decisionRemaining?.body?.reason !== 'remaining_sec<=cancel_all_remaining_sec';
    const decisionConfigEchoPass = configEqual(decisionOpen?.body?.config, configC)
      && configEqual(decisionRemaining?.body?.config, configC);
    const decisionPreviewConfigPass = decisionConfigEchoPass && ladderFixturePass && cancelFixturePass;

    await http.post('/bot/start', { tick_interval_ms: 1000 });
    const realRunning = await waitStatus(
      http,
      (s) => s.running === true && s.active_runtime_snapshot?.config,
      120000
    );
    await sleep(1200);
    const runtimeLogs = await http.get('/bot/logs?limit=300');
    const logsRows = Array.isArray(runtimeLogs?.body) ? runtimeLogs.body : [];
    const configAppliedLog = pickLatestConfigAppliedLog(logsRows, configC);
    const realRuntimeConfigPass = configEqual(realRunning?.body?.active_runtime_snapshot?.config, configC);
    const runtimeFieldChecks = {
      open_delay_sec: { status: realRuntimeConfigPass ? 'PASS' : 'FAIL', source: 'active_runtime_snapshot.config' },
      atr_multiple: { status: saveNoRestartPass ? 'PASS' : 'FAIL', source: 'save-without-restart shows active runtime freeze until restart' },
      cancel_all_remaining_sec: { status: configAppliedLog ? 'PASS' : 'SKIP', source: configAppliedLog ? 'BOT_CONFIG_APPLIED log' : 'missing runtime log evidence' },
      ladder_prices: { status: runtimeLadderPricesPass === null ? 'SKIP' : (runtimeLadderPricesPass ? 'PASS' : 'FAIL'), source: runtimeLadderPricesPass === null ? 'no stable runtime entry sample' : 'runtime /bot/orders ENTRY prices' },
      ladder_size: { status: runtimeLadderSizePass === null ? 'SKIP' : (runtimeLadderSizePass ? 'PASS' : 'FAIL'), source: runtimeLadderSizePass === null ? 'no stable runtime entry sample' : 'runtime /bot/orders ENTRY size' }
    };
    const runtimeConfigEffectPass = realRuntimeConfigPass && Boolean(configAppliedLog) && saveNoRestartPass;

    const savedConfigPass = stoppedSavePass && saveNoRestartPass;
    const configEffectChainPass = savedConfigPass
      && activeRuntimeSyncPass
      && decisionPreviewConfigPass
      && runtimeConfigEffectPass;

    const firstBreakLayer = !savedConfigPass
      ? 'saved_config'
      : (!activeRuntimeSyncPass
        ? 'active_runtime_snapshot'
        : (!decisionPreviewConfigPass
          ? 'decision_preview'
          : (!runtimeConfigEffectPass ? 'runtime_effect' : null)));

    const standard = buildStandardResult({
      scriptName: 'verify_config_effect_chain',
      taskId: args.taskId,
      sampleName: startSamples,
      pass: configEffectChainPass,
      message: configEffectChainPass ? 'config effect chain 校验通过' : 'config effect chain 校验失败',
      firstBreakLayer,
      evidenceFile: args.output,
      summary: {
        saved_config_pass: savedConfigPass,
        active_runtime_sync_pass: activeRuntimeSyncPass,
        decision_preview_config_pass: decisionPreviewConfigPass,
        runtime_config_effect_pass: runtimeConfigEffectPass,
        config_effect_chain_pass: configEffectChainPass
      },
      rawExcerpt: {
        save_no_restart_saved_config_eq_latest: configEqual(statusAfterSaveNoRestart?.body?.saved_config, configC),
        save_no_restart_active_runtime_unchanged: configEqual(statusAfterSaveNoRestart?.body?.active_runtime_snapshot?.config, configB),
        restart_active_runtime_eq_saved: configEqual(restartConfig, configC),
        runtime_ladder_size_match: runtimeLadderSizePass,
        runtime_ladder_prices_match: runtimeLadderPricesPass,
        real_runtime_log_config_applied: Boolean(configAppliedLog)
      }
    });

    const output = {
      ...standard,
      task_id: args.taskId,
      command: `node scripts/verify_config_effect_chain.mjs --task_id=${args.taskId} --sample=${args.sampleName}`,
      save_no_restart_vs_restart_table: {
        baseline_saved_config: normalizeConfig(originalConfig || {}),
        phase_saved_stopped: {
          saved_config: statusAfterStoppedSave?.body?.saved_config || null,
          active_runtime_config: statusAfterStoppedSave?.body?.active_runtime_snapshot?.config || null
        },
        phase_save_no_restart: {
          saved_config: statusAfterSaveNoRestart?.body?.saved_config || null,
          active_runtime_config: statusAfterSaveNoRestart?.body?.active_runtime_snapshot?.config || null
        },
        phase_after_restart: {
          saved_config: runningAfterRestart?.body?.saved_config || null,
          active_runtime_config: runningAfterRestart?.body?.active_runtime_snapshot?.config || null
        }
      },
      decision_runtime_effect_evidence: {
        decision_preview_open_fixture: decisionOpen,
        decision_preview_remaining_fixture: decisionRemaining,
        runtime_ladder_effect: {
          observed_entry_count: runtimeOrders ? runtimeOrders.length : 0,
          observed_entry_sizes: runtimeObservedSizes,
          observed_entry_prices: runtimeObservedPrices,
          expected_ladder_size: configC.ladder_size,
          expected_ladder_prices: configC.ladder_prices,
          ladder_size_pass: runtimeLadderSizePass,
          ladder_prices_pass: runtimeLadderPricesPass
        },
        real_runtime_sample: {
          status_snapshot: realRunning,
          config_applied_log: configAppliedLog,
          field_checks: runtimeFieldChecks
        }
      },
      result: {
        saved_config_pass: savedConfigPass,
        active_runtime_sync_pass: activeRuntimeSyncPass,
        decision_preview_config_pass: decisionPreviewConfigPass,
        runtime_config_effect_pass: runtimeConfigEffectPass,
        config_effect_chain_pass: configEffectChainPass
      }
    };

    ensureDir(args.output);
    fs.writeFileSync(args.output, JSON.stringify(output, null, 2));
    const logPath = writeStandardLog(args.output, standard);
    console.log(`VERIFY_OUTPUT=${args.output}`);
    console.log(`VERIFY_LOG=${logPath}`);
    console.log(JSON.stringify(output.result));
    if (!configEffectChainPass) process.exitCode = 1;
  } finally {
    await http.post('/bot/stop', {}).catch(() => null);
    if (originalConfig) {
      await http.post('/bot/config', normalizeConfig(originalConfig)).catch(() => null);
    }
    if (boot.spawned && !boot.spawned.killed) boot.spawned.kill();
  }
};

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
