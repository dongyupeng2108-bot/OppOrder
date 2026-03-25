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
const DEFAULT_TASK_ID = '260324_038';

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: DEFAULT_BASE_URL,
  defaultOutputSuffix: 'order_scope_and_status',
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

const normalizeScenario = (sampleName) => {
  const lower = String(sampleName || '').toLowerCase();
  if (lower.includes('debug_fill_yes_path_v1')) return 'fill_yes_path_v1';
  if (lower.includes('debug_main_path_v1')) return 'main_path_v1';
  return 'fill_yes_path_v1';
};

const normalizeRows = (ordersPayload) => {
  const body = ordersPayload?.body || {};
  const list = Array.isArray(body.window_orders)
    ? [...body.window_orders]
    : (Array.isArray(body.orders) ? [...body.orders] : []);
  return list.map((row) => ({
    order_id: row?.order_id ?? null,
    status: row?.status ?? null,
    inferred_window_id: row?.inferred_window_id ?? null
  }));
};

const collectCrossWindowOverlap = (rowsList) => {
  const m = new Map();
  rowsList.flat().forEach((row) => {
    if (!row?.order_id) return;
    const windowId = row.inferred_window_id ?? '__null_window__';
    if (!m.has(row.order_id)) m.set(row.order_id, new Set());
    m.get(row.order_id).add(windowId);
  });
  return [...m.entries()]
    .filter(([, windows]) => windows.size > 1)
    .map(([orderId, windows]) => ({ order_id: orderId, window_ids: [...windows] }));
};

const collectTerminalConflict = (rows) => {
  const map = new Map();
  rows.forEach((row) => {
    if (!row?.order_id) return;
    if (!map.has(row.order_id)) map.set(row.order_id, new Set());
    if (row.status === 'FILLED' || row.status === 'CANCELLED') {
      map.get(row.order_id).add(row.status);
    }
  });
  return [...map.entries()]
    .filter(([, statuses]) => statuses.size > 1)
    .map(([orderId, statuses]) => ({ order_id: orderId, terminal_statuses: [...statuses] }));
};

const captureOrderScopeAndStatus = async (http, sampleName) => {
  await http.post('/bot/stop', {});
  await sleep(350);
  const scenario = normalizeScenario(sampleName);
  const start = await http.post('/bot/start', { tick_interval_ms: 1000, debugScenario: scenario });

  let runningProbe = null;
  let sawOpen = false;
  for (let i = 0; i < 26; i += 1) {
    await sleep(650);
    const [orders, status] = await Promise.all([http.get('/bot/orders'), http.get('/bot/status')]);
    const rows = normalizeRows(orders);
    const hasOpen = rows.some((item) => item.status === 'OPEN');
    if (hasOpen) sawOpen = true;
    const currentWindowId = status?.body?.current_window_id ?? null;
    const ready = status?.body?.running === true && currentWindowId;
    if (ready) {
      runningProbe = { orders, status, rows, current_window_id: currentWindowId };
      if (sawOpen) break;
    }
  }

  let filledAndCancelledSeen = false;
  let terminalProbe = null;
  for (let i = 0; i < 30; i += 1) {
    await sleep(650);
    const orders = await http.get('/bot/orders');
    const rows = normalizeRows(orders);
    const hasFilled = rows.some((item) => item.status === 'FILLED');
    const hasCancelled = rows.some((item) => item.status === 'CANCELLED');
    if (hasFilled && hasCancelled) {
      filledAndCancelledSeen = true;
      terminalProbe = { orders, rows };
      break;
    }
  }

  await http.post('/bot/stop', {});
  await sleep(900);

  const [stoppedOrders, stoppedStatus, postmortem] = await Promise.all([
    http.get('/bot/orders'),
    http.get('/bot/status'),
    http.get('/bot/postmortem/latest')
  ]);
  const stoppedRows = normalizeRows(stoppedOrders);
  const statusBody = stoppedStatus?.body || {};
  const targetLastWindowId = statusBody?.last_run_snapshot?.current_window_id
    || postmortem?.body?.postmortem?.window_id
    || stoppedOrders?.body?.window_scope?.display_window_id
    || null;

  const runningRows = runningProbe?.rows || [];
  const runningCurrentWindowId = runningProbe?.current_window_id || null;
  const runningHiddenOtherWindowCount = runningProbe?.orders?.body?.hidden_other_window_count ?? null;
  const runningMismatchRows = runningRows.filter((row) => row.inferred_window_id && row.inferred_window_id !== runningCurrentWindowId);
  const runningOverlapOrderIds = runningMismatchRows.map((row) => row.order_id).filter(Boolean);
  const currentWindowPure = Boolean(runningCurrentWindowId)
    && runningMismatchRows.length === 0
    && runningHiddenOtherWindowCount === 0
    && runningOverlapOrderIds.length === 0;

  const stoppedMismatchRows = stoppedRows.filter((row) => row.inferred_window_id && row.inferred_window_id !== targetLastWindowId);
  const stoppedPure = Boolean(targetLastWindowId) && stoppedMismatchRows.length === 0;

  const openVisible = runningRows.some((row) => row.status === 'OPEN');
  const filledVisible = stoppedRows.some((row) => row.status === 'FILLED');
  const cancelledVisible = stoppedRows.some((row) => row.status === 'CANCELLED');
  const terminalConflicts = collectTerminalConflict(stoppedRows);
  const statusSemanticsPass = openVisible && filledVisible && cancelledVisible && terminalConflicts.length === 0;

  const crossWindowOverlap = collectCrossWindowOverlap([runningRows, stoppedRows]);
  const crossWindowOverlapPass = crossWindowOverlap.length === 0;

  const sampleSufficient = openVisible && filledVisible && cancelledVisible && filledAndCancelledSeen;
  const windowIsolationPass = currentWindowPure && stoppedPure;
  const pass = sampleSufficient && windowIsolationPass && statusSemanticsPass && crossWindowOverlapPass;
  const firstBreakLayer = !sampleSufficient
    ? 'sample insufficiency'
    : (!windowIsolationPass
      ? 'window isolation'
      : (!statusSemanticsPass
        ? 'order status semantics'
        : (!crossWindowOverlapPass ? 'cross window overlap' : null)));

  return {
    start,
    scenario,
    pass,
    first_break_layer: firstBreakLayer,
    summary: {
      window_isolation_pass: windowIsolationPass,
      order_status_semantics_pass: statusSemanticsPass,
      cross_window_overlap_pass: crossWindowOverlapPass
    },
    reconciliation_table: {
      running_current_window_id: runningCurrentWindowId,
      running_order_count: runningRows.length,
      running_hidden_other_window_count: runningHiddenOtherWindowCount,
      running_overlap_order_ids: runningOverlapOrderIds,
      stopped_target_window_id: targetLastWindowId,
      stopped_order_count: stoppedRows.length,
      stopped_mismatch_order_count: stoppedMismatchRows.length,
      open_visible: openVisible,
      filled_visible: filledVisible,
      cancelled_visible: cancelledVisible,
      cross_window_overlap_count: crossWindowOverlap.length,
      terminal_conflict_count: terminalConflicts.length
    },
    raw_excerpt: {
      sample_sufficient: sampleSufficient,
      running_mismatch_sample: runningMismatchRows.slice(0, 5),
      stopped_mismatch_sample: stoppedMismatchRows.slice(0, 5),
      cross_window_overlap: crossWindowOverlap.slice(0, 20),
      terminal_conflicts: terminalConflicts.slice(0, 20)
    },
    raw: {
      running_probe: runningProbe,
      terminal_probe: terminalProbe,
      stopped_orders: stoppedOrders,
      stopped_status: stoppedStatus,
      postmortem
    }
  };
};

const main = async () => {
  const args = parseArgs();
  const http = createHttp(args.baseUrl);
  const boot = await ensureServer(args);
  try {
    const verification = await captureOrderScopeAndStatus(http, args.sampleName);
    const standard = buildStandardResult({
      scriptName: 'verify_order_scope_and_status',
      taskId: args.taskId,
      sampleName: args.sampleName,
      pass: verification.pass,
      message: verification.pass ? 'order scope / status 语义校验通过' : 'order scope / status 语义校验失败',
      firstBreakLayer: verification.first_break_layer,
      evidenceFile: args.output,
      summary: verification.summary,
      rawExcerpt: verification.raw_excerpt
    });
    const output = {
      ...standard,
      task_id: args.taskId,
      command: `node scripts/verify_order_scope_and_status.mjs --task_id=${args.taskId} --sample=${args.sampleName}`,
      order_scope_status_table: verification.reconciliation_table,
      result: verification.summary,
      raw: verification.raw
    };
    ensureDir(args.output);
    fs.writeFileSync(args.output, JSON.stringify(output, null, 2));
    const logPath = writeStandardLog(args.output, standard);
    console.log(`VERIFY_OUTPUT=${args.output}`);
    console.log(`VERIFY_LOG=${logPath}`);
    console.log(JSON.stringify(output.result));
    if (!verification.pass) process.exitCode = 1;
  } finally {
    if (boot.spawned && !boot.spawned.killed) boot.spawned.kill();
  }
};

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
