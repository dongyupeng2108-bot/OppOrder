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
const DEFAULT_TASK_ID = '260324_036';

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: DEFAULT_BASE_URL,
  defaultOutputSuffix: 'result_chain_consistency',
  defaultSampleName: 'debug_fill_yes_path_v1'
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

const uniqueCount = (arr, fn) => new Set((arr || []).map(fn).filter((v) => v !== null && v !== undefined && v !== '')).size;

const normalizeScenario = (sampleName) => {
  const lower = String(sampleName || '').toLowerCase();
  if (lower.includes('debug_exit_yes_path_v1')) return 'exit_yes_path_v1';
  return 'fill_yes_path_v1';
};

const captureFilledResultChain = async (http, sampleName) => {
  await http.post('/bot/stop', {});
  await sleep(350);
  const scenario = normalizeScenario(sampleName);
  const start = await http.post('/bot/start', { tick_interval_ms: 1000, debugScenario: scenario });
  let sawFilled = false;
  for (let i = 0; i < 30; i += 1) {
    await sleep(650);
    const orders = await http.get('/bot/orders');
    const rows = orders?.body?.window_orders || [];
    if (rows.some((item) => item.status === 'FILLED')) {
      sawFilled = true;
      break;
    }
  }
  await http.post('/bot/stop', {});
  await sleep(800);

  const [orders, status, postmortem, summary, performance] = await Promise.all([
    http.get('/bot/orders'),
    http.get('/bot/status'),
    http.get('/bot/postmortem/latest'),
    http.get('/bot/paper/summary'),
    http.get('/bot/performance/summary?preset=today&detail=1')
  ]);

  const rows = orders?.body?.window_orders || [];
  const state = status?.body || {};
  const pm = postmortem?.body?.postmortem || {};
  const summaryBody = summary?.body || {};
  const perfRows = performance?.body?.summary?.participating_postmortem_rows || [];
  const targetWindowId = state?.last_run_snapshot?.current_window_id || pm?.window_id || null;
  const perfTarget = perfRows
    .filter((row) => row.window_id === targetWindowId)
    .sort((a, b) => String(b.completed_at).localeCompare(String(a.completed_at)))[0] || null;

  const uniqueOrderIdCount = uniqueCount(rows, (item) => item.order_id);
  const uniqueFilledOrderIdCount = uniqueCount(rows.filter((item) => item.status === 'FILLED'), (item) => item.order_id);
  const uniqueCancelledOrderIdCount = uniqueCount(rows.filter((item) => item.status === 'CANCELLED'), (item) => item.order_id);
  const summaryFilledTotal = summaryBody.filled_total ?? null;
  const summaryCancelledTotal = summaryBody.cancelled_total ?? summaryBody.cancel_total ?? null;
  const lastRunFilledTotal = state?.last_run_snapshot?.filled_total ?? null;
  const postmortemFilledTotal = pm?.filled_total ?? null;
  const perfTargetFilledTotal = perfTarget ? Number(perfTarget.filled_total || 0) : null;

  const checks = {
    filled_total_equals_unique_filled_order_count: summaryFilledTotal === uniqueFilledOrderIdCount,
    last_run_equals_summary: lastRunFilledTotal === summaryFilledTotal,
    postmortem_equals_summary: postmortemFilledTotal === summaryFilledTotal,
    performance_equals_summary: perfTargetFilledTotal === summaryFilledTotal
  };
  const sampleSufficient = uniqueFilledOrderIdCount >= 1;
  const pass = sampleSufficient && Object.values(checks).every((item) => item === true);
  const firstBreakLayer = !sampleSufficient
    ? 'sample insufficiency'
    : (!checks.filled_total_equals_unique_filled_order_count
      ? 'filled_total chain'
      : (!checks.last_run_equals_summary
        ? 'last_run_snapshot chain'
        : (!checks.postmortem_equals_summary
          ? 'postmortem chain'
          : (!checks.performance_equals_summary ? 'performance chain' : null))));

  return {
    start,
    scenario,
    saw_filled: sawFilled,
    sample_sufficient: sampleSufficient,
    checks,
    pass,
    first_break_layer: firstBreakLayer,
    reconciliation_table: {
      window_id: targetWindowId,
      unique_order_id_count: uniqueOrderIdCount,
      unique_filled_order_id_count: uniqueFilledOrderIdCount,
      unique_cancelled_order_id_count: uniqueCancelledOrderIdCount,
      summary_filled_total: summaryFilledTotal,
      summary_cancelled_total: summaryCancelledTotal,
      summary_cancelled_total_basis: summaryBody.cancelled_total !== undefined ? 'summary.cancelled_total' : (summaryBody.cancel_total !== undefined ? 'summary.cancel_total' : 'missing'),
      last_run_filled_total: lastRunFilledTotal,
      postmortem_filled_total: postmortemFilledTotal,
      performance_target_window_filled_total: perfTargetFilledTotal
    },
    raw: {
      orders,
      status,
      postmortem,
      summary,
      performance
    }
  };
};

const main = async () => {
  const args = parseArgs();
  const http = createHttp(args.baseUrl);
  const boot = await ensureServer(args);
  try {
    const chain = await captureFilledResultChain(http, args.sampleName);
    const standard = buildStandardResult({
      scriptName: 'verify_result_chain_consistency',
      taskId: args.taskId,
      sampleName: args.sampleName,
      pass: chain.pass,
      message: chain.pass ? 'result chain 一致性校验通过' : 'result chain 一致性校验失败',
      firstBreakLayer: chain.first_break_layer,
      evidenceFile: args.output,
      summary: {
        sample_sufficient: chain.sample_sufficient,
        filled_total_equals_unique_filled_order_count: chain.checks.filled_total_equals_unique_filled_order_count,
        last_run_equals_summary: chain.checks.last_run_equals_summary,
        postmortem_equals_summary: chain.checks.postmortem_equals_summary,
        performance_equals_summary: chain.checks.performance_equals_summary
      },
      rawExcerpt: {
        window_id: chain.reconciliation_table.window_id,
        unique_filled_order_id_count: chain.reconciliation_table.unique_filled_order_id_count,
        summary_filled_total: chain.reconciliation_table.summary_filled_total,
        performance_target_window_filled_total: chain.reconciliation_table.performance_target_window_filled_total
      }
    });
    const output = {
      ...standard,
      task_id: args.taskId,
      command: `node scripts/verify_result_chain_consistency.mjs --task_id=${args.taskId} --sample=${args.sampleName}`,
      result_chain_table: chain.reconciliation_table,
      checks: chain.checks,
      sample_sufficient: chain.sample_sufficient,
      scenario: chain.scenario,
      result: {
        result_chain_consistency_pass: chain.pass
      },
      raw: chain.raw
    };
    ensureDir(args.output);
    fs.writeFileSync(args.output, JSON.stringify(output, null, 2));
    const logPath = writeStandardLog(args.output, standard);
    console.log(`VERIFY_OUTPUT=${args.output}`);
    console.log(`VERIFY_LOG=${logPath}`);
    console.log(JSON.stringify(output.result));
    if (!chain.pass) process.exitCode = 1;
  } finally {
    if (boot.spawned && !boot.spawned.killed) boot.spawned.kill();
  }
};

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
