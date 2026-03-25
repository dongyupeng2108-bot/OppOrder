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
const DEFAULT_TASK_ID = '260324_041';

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: DEFAULT_BASE_URL,
  defaultOutputSuffix: 'runtime_to_business_result',
  defaultSampleName: 'debug_fill_yes_path_v1+debug_main_path_v1+debug_exit_yes_path_v1'
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

const toFinite = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const splitSamples = (sampleNameRaw) => String(sampleNameRaw || '')
  .split('+')
  .map((v) => v.trim())
  .filter(Boolean);

const normalizeScenario = (sampleName) => {
  const lower = String(sampleName || '').toLowerCase();
  if (lower.includes('debug_fill_yes_path_v1')) return 'fill_yes_path_v1';
  if (lower.includes('debug_exit_yes_path_v1')) return 'exit_yes_path_v1';
  if (lower.includes('debug_main_path_v1')) return 'main_path_v1';
  return null;
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

const stageNames = [
  'running_started',
  'current_window_present',
  'context_ready',
  'valid_action_seen',
  'orders_created',
  'result_materialized'
];

const highestStage = (hits) => {
  for (let i = stageNames.length - 1; i >= 0; i -= 1) {
    if (hits[stageNames[i]] === true) return stageNames[i];
  }
  return 'none';
};

const runSampleChain = async (http, sampleName) => {
  await http.post('/bot/stop', {});
  await sleep(500);
  const scenario = normalizeScenario(sampleName);
  const startBody = { tick_interval_ms: 1000 };
  if (scenario) startBody.debugScenario = scenario;
  const startRes = await http.post('/bot/start', startBody);

  const hits = Object.fromEntries(stageNames.map((s) => [s, false]));
  const firstSeq = Object.fromEntries(stageNames.map((s) => [s, null]));
  const stageTable = [];
  let resultBasis = null;
  let finalSnapshot = null;

  for (let i = 0; i < 80; i += 1) {
    await sleep(600);
    const [status, context, decision, orders, summary] = await Promise.all([
      http.get('/bot/status'),
      http.get('/bot/context'),
      http.get('/bot/decision-preview'),
      http.get('/bot/orders'),
      http.get('/bot/paper/summary')
    ]);
    const st = status?.body || {};
    const ctx = context?.body || {};
    const dec = decision?.body || {};
    const ord = orders?.body || {};
    const sum = summary?.body || {};
    const currentWindowId = st?.current_window_id || ctx?.window_id || null;
    const running = st?.running === true;
    const btcPrice = toFinite(ctx?.btc_price);
    const remainingSec = toFinite(ctx?.remaining_sec ?? st?.remaining_sec);
    const intentsSummary = dec?.intents_summary || 'NOOP';
    const ordersOpen = toFinite(sum?.orders_open) ?? 0;
    const ordersFilled = toFinite(sum?.orders_filled) ?? 0;
    const filledTotal = toFinite(sum?.filled_total) ?? 0;
    const realizedPnl = toFinite(sum?.realized_gross_pnl_total) ?? 0;
    const phase = st?.reason || dec?.reason || null;
    const list = Array.isArray(ord?.window_orders) ? ord.window_orders : (Array.isArray(ord?.orders) ? ord.orders : []);
    const hasOrderRows = list.length > 0;
    const hasValidAction = intentsSummary !== 'NOOP' || hasOrderRows;
    const ready = running && currentWindowId && remainingSec !== null && (btcPrice !== null || toFinite(st?.anchor_btc) !== null);
    const businessByFill = filledTotal > 0;
    const businessByRealized = realizedPnl !== 0;

    if (running && !hits.running_started) {
      hits.running_started = true;
      firstSeq.running_started = i + 1;
    }
    if (currentWindowId && !hits.current_window_present) {
      hits.current_window_present = true;
      firstSeq.current_window_present = i + 1;
    }
    if (ready && !hits.context_ready) {
      hits.context_ready = true;
      firstSeq.context_ready = i + 1;
    }
    if (hasValidAction && !hits.valid_action_seen) {
      hits.valid_action_seen = true;
      firstSeq.valid_action_seen = i + 1;
    }
    if ((ordersOpen > 0 || ordersFilled > 0 || hasOrderRows) && !hits.orders_created) {
      hits.orders_created = true;
      firstSeq.orders_created = i + 1;
    }
    if ((businessByFill || businessByRealized) && !hits.result_materialized) {
      hits.result_materialized = true;
      firstSeq.result_materialized = i + 1;
      resultBasis = businessByFill ? 'filled_total>0' : 'realized_gross_pnl_total!=0';
    }

    stageTable.push({
      seq: i + 1,
      ts: new Date().toISOString(),
      running,
      current_window_id: currentWindowId,
      phase,
      btc_price: btcPrice,
      intents_summary: intentsSummary,
      orders_open: ordersOpen,
      orders_filled: ordersFilled,
      filled_total: filledTotal,
      realized_gross_pnl_total: realizedPnl,
      stage_reached: highestStage(hits)
    });
    finalSnapshot = { status, context, decision, orders, summary };

    if (hits.orders_created && hits.result_materialized) break;
  }

  await http.post('/bot/stop', {});
  await sleep(900);

  const [stoppedStatus, postmortem] = await Promise.all([
    http.get('/bot/status'),
    http.get('/bot/postmortem/latest')
  ]);
  const lastRun = stoppedStatus?.body?.last_run_snapshot || null;
  const pm = postmortem?.body?.postmortem || null;
  const postmortemMaterialized = Boolean(pm?.window_id) && ((toFinite(pm?.filled_total) ?? 0) > 0 || (toFinite(pm?.realized_gross_pnl_total) ?? 0) !== 0);
  const lastRunMaterialized = Boolean(lastRun?.current_window_id) && ((toFinite(lastRun?.filled_total) ?? 0) > 0 || (toFinite(lastRun?.realized_gross_pnl_total) ?? 0) !== 0);
  if (!hits.result_materialized && (postmortemMaterialized || lastRunMaterialized)) {
    hits.result_materialized = true;
    firstSeq.result_materialized = firstSeq.result_materialized || (stageTable.length + 1);
    resultBasis = postmortemMaterialized ? 'latest_postmortem_non_empty_window_result' : 'last_run_snapshot_non_empty_window_result';
  }

  const runtimeStartPass = hits.running_started;
  const windowReadyPass = hits.current_window_present && hits.context_ready;
  const actionEmittedPass = hits.valid_action_seen;
  const ordersMaterializedPass = hits.orders_created;
  const businessResultPass = hits.result_materialized;
  const runtimeToBusinessResultPass = runtimeStartPass && windowReadyPass && actionEmittedPass && ordersMaterializedPass && businessResultPass;

  const firstBreakLayer = runtimeToBusinessResultPass
    ? null
    : (!runtimeStartPass
      ? 'running_started'
      : (!windowReadyPass
        ? 'current_window_present/context_ready'
        : (!actionEmittedPass
          ? 'valid_action_seen'
          : (!ordersMaterializedPass
            ? 'orders_created'
            : 'result_materialized'))));

  return {
    sample_name: sampleName,
    scenario: scenario || 'real_no_debug',
    start_response: startRes,
    stage_hits: hits,
    stage_first_seq: firstSeq,
    stage_table: stageTable,
    result_materialized_basis: resultBasis,
    summary: {
      runtime_start_pass: runtimeStartPass,
      window_ready_pass: windowReadyPass,
      action_emitted_pass: actionEmittedPass,
      orders_materialized_pass: ordersMaterializedPass,
      business_result_pass: businessResultPass,
      runtime_to_business_result_pass: runtimeToBusinessResultPass
    },
    first_break_layer: firstBreakLayer,
    raw: {
      final_runtime_snapshot: finalSnapshot,
      stopped_status: stoppedStatus,
      latest_postmortem: postmortem
    }
  };
};

const main = async () => {
  const args = parseArgs();
  const samples = splitSamples(args.sampleName);
  if (!samples.length) throw new Error('sample is required');
  const http = createHttp(args.baseUrl);
  const boot = await ensureServer(args);
  try {
    const evaluations = [];
    for (const sample of samples) {
      const evaluation = await runSampleChain(http, sample);
      evaluations.push(evaluation);
    }
    const passedEvaluation = evaluations.find((item) => item.summary.runtime_to_business_result_pass === true) || null;
    const selected = passedEvaluation || evaluations[0];
    const pass = Boolean(passedEvaluation);
    const conclusion = pass
      ? '系统能从 running 走到有效业务结果'
      : `卡在 ${selected.first_break_layer} 阶段，第一断裂层在 ${selected.first_break_layer}`;
    const standard = buildStandardResult({
      scriptName: 'verify_runtime_to_business_result',
      taskId: args.taskId,
      sampleName: args.sampleName,
      pass,
      message: pass ? 'runtime -> business result 整链校验通过' : 'runtime -> business result 整链校验失败',
      firstBreakLayer: selected.first_break_layer,
      evidenceFile: args.output,
      summary: selected.summary,
      rawExcerpt: {
        selected_sample: selected.sample_name,
        result_materialized_basis: selected.result_materialized_basis,
        first_break_layer: selected.first_break_layer,
        conclusion
      }
    });

    const output = {
      ...standard,
      task_id: args.taskId,
      command: `node scripts/verify_runtime_to_business_result.mjs --task_id=${args.taskId} --sample=${args.sampleName}`,
      conclusion,
      runtime_business_stage_table: selected.stage_table,
      result_materialized_basis: selected.result_materialized_basis,
      result: selected.summary,
      sample_evaluations: evaluations.map((item) => ({
        sample_name: item.sample_name,
        scenario: item.scenario,
        stage_hits: item.stage_hits,
        stage_first_seq: item.stage_first_seq,
        result_materialized_basis: item.result_materialized_basis,
        summary: item.summary,
        first_break_layer: item.first_break_layer
      })),
      raw: evaluations.map((item) => ({
        sample_name: item.sample_name,
        scenario: item.scenario,
        raw: item.raw
      }))
    };

    ensureDir(args.output);
    fs.writeFileSync(args.output, JSON.stringify(output, null, 2));
    const logPath = writeStandardLog(args.output, standard);
    console.log(`VERIFY_OUTPUT=${args.output}`);
    console.log(`VERIFY_LOG=${logPath}`);
    console.log(JSON.stringify(output.result));
    if (!pass) process.exitCode = 1;
  } finally {
    await http.post('/bot/stop', {}).catch(() => null);
    if (boot.spawned && !boot.spawned.killed) boot.spawned.kill();
  }
};

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
