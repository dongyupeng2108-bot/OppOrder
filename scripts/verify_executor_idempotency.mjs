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
const DEFAULT_TASK_ID = '260324_044';

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: DEFAULT_BASE_URL,
  defaultOutputSuffix: 'executor_idempotency',
  defaultSampleName: 'debug_main_path_v1+debug_fill_yes_path_v1'
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
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
};

const ensureServer = async ({ baseUrl, spawnServer }) => {
  const http = createHttp(baseUrl);
  try {
    const status = await http.get('/bot/status');
    if (status.status === 200) return { spawned: null };
  } catch {}
  if (!spawnServer) {
    throw new Error(`server unreachable: ${baseUrl}`);
  }
  const child = spawn('node', ['strategies/crypto_binary/server.mjs', '--port=53123'], {
    cwd: REPO_ROOT,
    stdio: 'ignore',
    detached: false
  });
  for (let i = 0; i < 30; i += 1) {
    await sleep(500);
    try {
      const status = await http.get('/bot/status');
      if (status.status === 200) {
        return { spawned: child };
      }
    } catch {}
  }
  child.kill();
  throw new Error(`failed to boot server: ${baseUrl}`);
};

const uniqueCount = (arr, fn) => new Set((arr || []).map(fn).filter((v) => v !== null && v !== undefined && v !== '')).size;

const summarizeMainTicks = (ticks) => {
  const seenPlaceByWindow = new Set();
  const repeatedPlaceTicks = [];
  const nonPlaceAddedTicks = [];
  ticks.forEach((tick) => {
    const windowId = tick.window_id || '__null_window__';
    if (tick.place_ladder_this_tick && tick.new_orders_this_tick > 0) {
      if (seenPlaceByWindow.has(windowId)) {
        repeatedPlaceTicks.push(tick.tick);
      } else {
        seenPlaceByWindow.add(windowId);
      }
    }
    if (!tick.place_ladder_this_tick && tick.new_orders_this_tick > 0) {
      nonPlaceAddedTicks.push(tick.tick);
    }
  });
  return {
    repeated_place_tick_count: repeatedPlaceTicks.length,
    repeated_place_ticks: repeatedPlaceTicks,
    non_place_added_count: nonPlaceAddedTicks.length,
    non_place_added_ticks: nonPlaceAddedTicks,
    executor_idempotency_pass: repeatedPlaceTicks.length === 0 && nonPlaceAddedTicks.length === 0
  };
};

const toSourceAction = (order) => {
  if (order?.kind === 'ENTRY') return 'PLACE_BOTH_LADDERS';
  if (order?.kind === 'EXIT') return 'FLATTEN_POSITION';
  return 'UNKNOWN';
};

const captureMainPath = async (http) => {
  await http.post('/bot/stop', {});
  await sleep(350);
  const start = await http.post('/bot/start', { tick_interval_ms: 1000, debugScenario: 'main_path_v1' });

  const ticks = [];
  let prevIds = new Set();
  for (let i = 1; i <= 14; i += 1) {
    await sleep(700);
    const [preview, orders, status] = await Promise.all([
      http.get('/bot/decision-preview'),
      http.get('/bot/orders'),
      http.get('/bot/status')
    ]);
    const rows = orders?.body?.window_orders || [];
    const ids = new Set(rows.map((item) => item.order_id).filter(Boolean));
    const newOrders = [...ids].filter((id) => !prevIds.has(id));
    prevIds = ids;
    const intentsSummary = preview?.body?.intents_summary || '';
    ticks.push({
      tick: i,
      time: new Date().toISOString(),
      window_id: status?.body?.current_window_id ?? null,
      intents_summary: intentsSummary,
      reason: preview?.body?.reason || null,
      open_orders_count: rows.filter((item) => item.status === 'OPEN').length,
      new_orders_this_tick: newOrders.length,
      place_ladder_this_tick: /PLACE_LADDER/.test(intentsSummary)
    });
  }
  await http.post('/bot/stop', {});
  return {
    start_response: start,
    ticks,
    summary: summarizeMainTicks(ticks)
  };
};

const captureDirtyRestart = async (http) => {
  await http.post('/bot/stop', {});
  await sleep(350);
  await http.post('/bot/start', { tick_interval_ms: 1000, debugScenario: 'main_path_v1' });

  let prevRun1Ids = new Set();
  let historicalRows = [];
  let run1PlacedTick = null;
  for (let i = 1; i <= 14; i += 1) {
    await sleep(700);
    const [preview, orders, status] = await Promise.all([
      http.get('/bot/decision-preview'),
      http.get('/bot/orders'),
      http.get('/bot/status')
    ]);
    const rows = orders?.body?.window_orders || [];
    const ids = new Set(rows.map((item) => item.order_id).filter(Boolean));
    const newOrders = [...ids].filter((id) => !prevRun1Ids.has(id));
    prevRun1Ids = ids;
    const intentsSummary = preview?.body?.intents_summary || '';
    const isPlaceTick = /PLACE_LADDER/.test(intentsSummary);
    if (isPlaceTick && newOrders.length > 0) {
      run1PlacedTick = i;
      historicalRows = rows
        .filter((row) => newOrders.includes(row.order_id))
        .map((row) => ({
          order_id: row.order_id ?? null,
          window_id: row.inferred_window_id ?? status?.body?.current_window_id ?? null,
          created_at: row.created_at ?? null,
          source_action: toSourceAction(row),
          source_tick: 'historical_run1'
        }));
      break;
    }
  }
  await http.post('/bot/stop', {});
  await sleep(450);

  await http.post('/bot/start', { tick_interval_ms: 1000, debugScenario: 'main_path_v1' });
  let prevRun2Ids = new Set();
  const run2Ticks = [];
  let run2Tick2Rows = [];
  for (let i = 1; i <= 3; i += 1) {
    await sleep(700);
    const [preview, orders, status] = await Promise.all([
      http.get('/bot/decision-preview'),
      http.get('/bot/orders'),
      http.get('/bot/status')
    ]);
    const rows = orders?.body?.window_orders || [];
    const ids = new Set(rows.map((item) => item.order_id).filter(Boolean));
    const newOrders = [...ids].filter((id) => !prevRun2Ids.has(id));
    prevRun2Ids = ids;
    const intentsSummary = preview?.body?.intents_summary || '';
    run2Ticks.push({
      tick: i,
      time: new Date().toISOString(),
      window_id: status?.body?.current_window_id ?? null,
      intents_summary: intentsSummary,
      reason: preview?.body?.reason || null,
      new_orders_this_tick: newOrders.length
    });
    if (i === 2) {
      run2Tick2Rows = rows.map((row) => ({
        order_id: row.order_id ?? null,
        window_id: row.inferred_window_id ?? status?.body?.current_window_id ?? null,
        created_at: row.created_at ?? null,
        source_action: toSourceAction(row),
        source_tick: 'run2_tick2'
      }));
    }
  }
  await http.post('/bot/stop', {});

  const historicalIds = new Set(historicalRows.map((row) => row.order_id).filter(Boolean));
  const run2Tick2Ids = new Set(run2Tick2Rows.map((row) => row.order_id).filter(Boolean));
  const overlapOrderIds = [...historicalIds].filter((id) => run2Tick2Ids.has(id));
  const tick2 = run2Ticks.find((row) => row.tick === 2) || null;
  const dirtyRestartPass = historicalRows.length > 0
    && tick2 != null
    && tick2.intents_summary === 'NOOP'
    && tick2.reason === 'pre_open_or_open_not_open_delay'
    && tick2.new_orders_this_tick === 0
    && overlapOrderIds.length === 0;
  const sourceTable = [
    ...historicalRows.map((row) => ({ ...row, counted_as_new_in_run2: false })),
    ...run2Tick2Rows.map((row) => ({ ...row, counted_as_new_in_run2: false }))
  ];
  return {
    run1_first_place_tick: run1PlacedTick,
    run2_ticks: run2Ticks,
    overlap_order_ids: overlapOrderIds,
    dirty_restart_pass: dirtyRestartPass,
    source_table: sourceTable
  };
};

const captureFillPath = async (http) => {
  await http.post('/bot/stop', {});
  await sleep(350);
  await http.post('/bot/start', { tick_interval_ms: 1000, debugScenario: 'fill_yes_path_v1' });

  let sawFilled = false;
  for (let i = 0; i < 28; i += 1) {
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
  const windowId = state?.last_run_snapshot?.current_window_id || pm?.window_id || null;
  const perfRows = performance?.body?.summary?.participating_postmortem_rows || [];
  const perfTarget = perfRows
    .filter((row) => row.window_id === windowId)
    .sort((a, b) => String(b.completed_at).localeCompare(String(a.completed_at)))[0] || null;

  const uniqueFilled = uniqueCount(rows.filter((item) => item.status === 'FILLED'), (item) => item.order_id);
  const table = {
    window_id: windowId,
    total_orders: rows.length,
    unique_order_id_count: uniqueCount(rows, (item) => item.order_id),
    unique_filled_order_id_count: uniqueFilled,
    unique_cancelled_order_id_count: uniqueCount(rows.filter((item) => item.status === 'CANCELLED'), (item) => item.order_id),
    summary_filled_total: summary?.body?.filled_total ?? null,
    last_run_filled_total: state?.last_run_snapshot?.filled_total ?? null,
    postmortem_filled_total: pm?.filled_total ?? null,
    performance_target_window_filled_total: perfTarget ? Number(perfTarget.filled_total || 0) : null
  };

  const filledTotalChainPass = uniqueFilled >= 1
    && table.summary_filled_total === uniqueFilled
    && table.last_run_filled_total === uniqueFilled
    && table.postmortem_filled_total === uniqueFilled
    && table.performance_target_window_filled_total === uniqueFilled;

  return {
    saw_filled: sawFilled,
    table,
    filled_total_chain_pass: filledTotalChainPass
  };
};

const captureWindowIsolation = async (http) => {
  await http.post('/bot/stop', {});
  await sleep(300);
  await http.post('/bot/start', { tick_interval_ms: 1000, debugScenario: 'main_path_v1' });
  for (let i = 0; i < 8; i += 1) {
    await sleep(650);
    const state = await http.get('/bot/status');
    if (state?.body?.running === true && state?.body?.current_window_id) break;
  }
  const r1Orders = await http.get('/bot/orders');
  const r1Ids = (r1Orders?.body?.window_orders || []).map((item) => item.order_id).filter(Boolean);
  const r1Window = r1Orders?.body?.window_scope?.display_window_id || null;
  await http.post('/bot/stop', {});
  await sleep(350);

  await http.post('/bot/start', { tick_interval_ms: 1000, debugScenario: 'fill_yes_path_v1' });
  for (let i = 0; i < 10; i += 1) {
    await sleep(650);
    const state = await http.get('/bot/status');
    if (state?.body?.running === true && state?.body?.current_window_id) break;
  }
  const r2Orders = await http.get('/bot/orders');
  await http.post('/bot/stop', {});

  const r2Rows = r2Orders?.body?.window_orders || [];
  const overlap = r2Rows.map((item) => item.order_id).filter((id) => r1Ids.includes(id));
  const result = {
    round1_window_id: r1Window,
    round2_window_id: r2Orders?.body?.window_scope?.display_window_id || null,
    hidden_other_window_count: r2Orders?.body?.hidden_other_window_count ?? null,
    overlap_order_ids: overlap,
    scope: r2Orders?.body?.window_scope?.scope || null
  };
  result.window_isolation_pass = result.scope === 'current_window'
    && result.hidden_other_window_count === 0
    && overlap.length === 0;
  return result;
};

const main = async () => {
  const args = parseArgs();
  const http = createHttp(args.baseUrl);
  const boot = await ensureServer(args);

  let output = null;
  try {
    const mainPath = await captureMainPath(http);
    const fillPath = await captureFillPath(http);
    const isolation = await captureWindowIsolation(http);
    const dirtyRestart = await captureDirtyRestart(http);

    const pass = mainPath.summary.executor_idempotency_pass
      && isolation.window_isolation_pass
      && fillPath.filled_total_chain_pass
      && dirtyRestart.dirty_restart_pass;
    const firstBreakLayer = pass ? null : (!mainPath.summary.executor_idempotency_pass
      ? 'executor idempotency'
      : (!dirtyRestart.dirty_restart_pass
        ? 'dirty restart'
        : (!isolation.window_isolation_pass ? 'window isolation' : 'filled_total chain')));
    const standard = buildStandardResult({
      scriptName: 'verify_executor_idempotency',
      taskId: args.taskId,
      sampleName: args.sampleName,
      pass,
      message: pass ? 'executor idempotency 校验通过' : 'executor idempotency 校验失败',
      firstBreakLayer,
      evidenceFile: args.output,
      summary: {
        executor_idempotency_pass: mainPath.summary.executor_idempotency_pass,
        window_isolation_pass: isolation.window_isolation_pass,
        filled_total_chain_pass: fillPath.filled_total_chain_pass,
        dirty_restart_pass: dirtyRestart.dirty_restart_pass
      },
      rawExcerpt: {
        repeated_place_tick_count: mainPath.summary.repeated_place_tick_count,
        non_place_added_count: mainPath.summary.non_place_added_count,
        unique_filled_order_id_count: fillPath.table.unique_filled_order_id_count,
        dirty_restart_overlap_count: dirtyRestart.overlap_order_ids.length,
        dirty_restart_tick2_new_orders: dirtyRestart.run2_ticks.find((row) => row.tick === 2)?.new_orders_this_tick ?? null
      }
    });
    output = {
      ...standard,
      task_id: args.taskId,
      command: `node scripts/verify_executor_idempotency.mjs --task_id=${args.taskId}`,
      scenarios: {
        main_path_v1: mainPath,
        fill_yes_path_v1: fillPath
      },
      dirty_restart: dirtyRestart,
      window_isolation: isolation,
      result: {
        executor_idempotency_pass: mainPath.summary.executor_idempotency_pass,
        window_isolation_pass: isolation.window_isolation_pass,
        filled_total_chain_pass: fillPath.filled_total_chain_pass,
        dirty_restart_pass: dirtyRestart.dirty_restart_pass
      }
    };

    ensureDir(args.output);
    fs.writeFileSync(args.output, JSON.stringify(output, null, 2));
    const logPath = writeStandardLog(args.output, standard);
    console.log(`VERIFY_OUTPUT=${args.output}`);
    console.log(`VERIFY_LOG=${logPath}`);
    console.log(JSON.stringify(output.result));

    if (!output.result.executor_idempotency_pass || !output.result.window_isolation_pass || !output.result.filled_total_chain_pass || !output.result.dirty_restart_pass) {
      process.exitCode = 1;
    }
  } finally {
    if (boot.spawned && !boot.spawned.killed) {
      boot.spawned.kill();
    }
  }
};

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
