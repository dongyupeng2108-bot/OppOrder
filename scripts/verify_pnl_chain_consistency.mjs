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
const DEFAULT_TASK_ID = '260324_039';

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: DEFAULT_BASE_URL,
  defaultOutputSuffix: 'pnl_chain_consistency',
  defaultSampleName: 'debug_exit_yes_path_v1+debug_fill_yes_path_v1'
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
  if (lower.includes('debug_exit_yes_path_v1')) return 'exit_yes_path_v1';
  if (lower.includes('debug_main_path_v1')) return 'main_path_v1';
  return 'fill_yes_path_v1';
};

const toNumberOrNull = (v) => {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const equalNullable = (a, b) => {
  if (a === null || b === null) return false;
  return Math.abs(a - b) <= 1e-9;
};

const splitSamples = (sampleNameRaw) => String(sampleNameRaw || '')
  .split('+')
  .map((v) => v.trim())
  .filter(Boolean);

const getPerfTargetRow = (performanceSummary, targetWindowId) => {
  const rows = performanceSummary?.participating_postmortem_rows || [];
  return rows
    .filter((row) => row?.window_id === targetWindowId)
    .sort((a, b) => String(b.completed_at).localeCompare(String(a.completed_at)))[0] || null;
};

const computeManualRealized = (orders) => {
  const rows = Array.isArray(orders) ? orders : [];
  const entryFilled = rows.find((row) => row?.kind === 'ENTRY' && row?.status === 'FILLED' && toNumberOrNull(row?.fill_price) !== null && toNumberOrNull(row?.size) !== null);
  if (!entryFilled) return { available: false, reason: 'no_filled_entry' };
  const exitFilled = rows.find((row) => row?.kind === 'EXIT' && row?.status === 'FILLED' && row?.side === entryFilled.side && toNumberOrNull(row?.fill_price) !== null && toNumberOrNull(row?.size) !== null);
  if (!exitFilled) return { available: false, reason: 'no_filled_exit' };
  const entry = toNumberOrNull(entryFilled.fill_price);
  const exit = toNumberOrNull(exitFilled.fill_price);
  const size = Math.min(toNumberOrNull(entryFilled.size), toNumberOrNull(exitFilled.size));
  if (entry === null || exit === null || size === null) return { available: false, reason: 'invalid_pair' };
  const side = String(entryFilled.side || '').toUpperCase();
  const pnl = side === 'NO' ? (entry - exit) * size : (exit - entry) * size;
  return {
    available: true,
    side,
    entry_price: entry,
    exit_price: exit,
    size,
    formula: side === 'NO' ? '(entry-exit)*size' : '(exit-entry)*size',
    manual_realized_pnl: pnl
  };
};

const captureSnapshotForSample = async (http, sampleName) => {
  await http.post('/bot/stop', {});
  await sleep(400);
  const scenario = normalizeScenario(sampleName);
  const startRes = await http.post('/bot/start', { tick_interval_ms: 1000, debugScenario: scenario });

  let runningCapture = null;
  let latestStatus = null;
  let realizedObserved = null;
  for (let i = 0; i < 70; i += 1) {
    await sleep(650);
    const [status, summary] = await Promise.all([http.get('/bot/status'), http.get('/bot/paper/summary')]);
    latestStatus = status;
    const unrealized = toNumberOrNull(summary?.body?.unrealized_gross_pnl_total);
    const realized = toNumberOrNull(summary?.body?.realized_gross_pnl_total);
    realizedObserved = realized;
    if (status?.body?.running === true && unrealized !== null) {
      runningCapture = {
        running_status: status,
        running_summary: summary,
        unrealized_gross_pnl_total: unrealized
      };
    }
    const autoStopped = status?.body?.running === false && status?.body?.last_run_snapshot;
    if (autoStopped && realized !== null) break;
    if (realized !== null && Math.abs(realized) > 1e-9 && autoStopped) break;
    if (Math.abs(unrealized ?? 0) > 1e-9 && autoStopped) break;
  }

  if (latestStatus?.body?.running === true || latestStatus?.body?.running === undefined) {
    await http.post('/bot/stop', {});
    await sleep(900);
  } else if (realizedObserved === null) {
    await sleep(300);
  } else {
    await sleep(500);
  }
  if (latestStatus?.body?.running !== false) {
    const check = await http.get('/bot/status');
    if (check?.body?.running === true) {
      await http.post('/bot/stop', {});
      await sleep(900);
    }
  }

  const [orders, status, postmortem, summary, performance] = await Promise.all([
    http.get('/bot/orders'),
    http.get('/bot/status'),
    http.get('/bot/postmortem/latest'),
    http.get('/bot/paper/summary'),
    http.get('/bot/performance/summary?preset=today&detail=1')
  ]);

  const statusBody = status?.body || {};
  const summaryBody = summary?.body || {};
  const postmortemBody = postmortem?.body?.postmortem || {};
  const performanceSummary = performance?.body?.summary || {};
  const targetWindowId = statusBody?.last_run_snapshot?.current_window_id || postmortemBody?.window_id || null;
  const perfTargetRow = getPerfTargetRow(performanceSummary, targetWindowId);
  const rows = Array.isArray(orders?.body?.orders) ? orders.body.orders : (Array.isArray(orders?.body?.window_orders) ? orders.body.window_orders : []);
  const manualRealized = computeManualRealized(rows);

  const realized = {
    summary: toNumberOrNull(summaryBody?.realized_gross_pnl_total),
    last_run_snapshot: toNumberOrNull(statusBody?.last_run_snapshot?.realized_gross_pnl_total),
    postmortem: toNumberOrNull(postmortemBody?.realized_gross_pnl_total),
    performance_target_window: perfTargetRow ? toNumberOrNull(perfTargetRow?.realized_gross_pnl_total) : null
  };
  const unrealized = {
    summary: { value: toNumberOrNull(summaryBody?.unrealized_gross_pnl_total), basis: summaryBody?.unrealized_gross_pnl_total === undefined ? 'missing' : 'summary.unrealized_gross_pnl_total' },
    last_run_snapshot: { value: toNumberOrNull(statusBody?.last_run_snapshot?.unrealized_gross_pnl_total), basis: statusBody?.last_run_snapshot?.unrealized_gross_pnl_total === undefined ? 'missing' : 'last_run_snapshot.unrealized_gross_pnl_total' },
    postmortem: { value: toNumberOrNull(postmortemBody?.unrealized_gross_pnl_total), basis: postmortemBody?.unrealized_gross_pnl_total === undefined ? 'missing' : 'postmortem.unrealized_gross_pnl_total' },
    performance_target_window: {
      value: perfTargetRow && perfTargetRow.unrealized_gross_pnl_total !== undefined ? toNumberOrNull(perfTargetRow.unrealized_gross_pnl_total) : null,
      basis: perfTargetRow && perfTargetRow.unrealized_gross_pnl_total !== undefined ? 'performance_target_window.unrealized_gross_pnl_total' : 'missing'
    }
  };
  const realizedChainPass = equalNullable(realized.summary, realized.last_run_snapshot)
    && equalNullable(realized.summary, realized.postmortem)
    && equalNullable(realized.summary, realized.performance_target_window);
  const unrealizedAllSupported = [unrealized.summary, unrealized.last_run_snapshot, unrealized.postmortem, unrealized.performance_target_window]
    .every((item) => item.basis !== 'missing');
  const unrealizedChainPass = unrealizedAllSupported
    ? (equalNullable(unrealized.summary.value, unrealized.last_run_snapshot.value)
      && equalNullable(unrealized.summary.value, unrealized.postmortem.value)
      && equalNullable(unrealized.summary.value, unrealized.performance_target_window.value))
    : false;

  return {
    sample_name: sampleName,
    scenario,
    start_status: startRes.status,
    target_window_id: targetWindowId,
    running_capture: runningCapture,
    realized,
    unrealized,
    realized_chain_pass: realizedChainPass,
    unrealized_chain_pass: unrealizedChainPass,
    unrealized_all_supported: unrealizedAllSupported,
    manual_realized: manualRealized,
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
  const samples = splitSamples(args.sampleName);
  if (!samples.length) throw new Error('sample is required');
  const http = createHttp(args.baseUrl);
  const boot = await ensureServer(args);
  try {
    const snapshots = [];
    for (const sample of samples) {
      const snap = await captureSnapshotForSample(http, sample);
      snapshots.push(snap);
    }
    const realizedSnap = snapshots.find((item) => {
      const value = item.realized.summary;
      return value !== null && Math.abs(value) > 1e-9;
    }) || null;
    const unrealizedSnap = snapshots.find((item) => {
      const value = item.running_capture?.unrealized_gross_pnl_total ?? item.unrealized.summary.value;
      return value !== null && Math.abs(value) > 1e-9;
    }) || null;
    const baseSnap = realizedSnap || snapshots[0];
    const realizedPnlChainPass = baseSnap.realized_chain_pass === true && realizedSnap !== null;
    const unrealizedPnlChainPass = baseSnap.unrealized_chain_pass === true && unrealizedSnap !== null;
    const pnlChainConsistencyPass = realizedPnlChainPass && unrealizedPnlChainPass;
    const firstBreakLayer = !realizedSnap
      ? 'sample insufficiency realized'
      : (!unrealizedSnap
        ? 'sample insufficiency unrealized'
        : (!realizedPnlChainPass
          ? 'realized pnl chain'
          : (!unrealizedPnlChainPass ? 'unrealized pnl chain' : null)));

    const manualRealized = baseSnap.manual_realized?.available ? baseSnap.manual_realized : null;
    const manualRealizedVsSummaryDelta = manualRealized
      ? (manualRealized.manual_realized_pnl - (baseSnap.realized.summary ?? 0))
      : null;
    const manualUnrealized = unrealizedSnap
      ? {
        position_size: unrealizedSnap.raw?.summary?.body?.yes_position_size ?? null,
        avg_entry_price: unrealizedSnap.raw?.summary?.body?.yes_avg_fill_price ?? null,
        current_mark_price: unrealizedSnap.raw?.status?.body?.anchor_btc ?? null,
        reported_unrealized_total: unrealizedSnap.raw?.summary?.body?.unrealized_gross_pnl_total ?? null
      }
      : null;

    const standard = buildStandardResult({
      scriptName: 'verify_pnl_chain_consistency',
      taskId: args.taskId,
      sampleName: args.sampleName,
      pass: pnlChainConsistencyPass,
      message: pnlChainConsistencyPass ? 'pnl chain 一致性校验通过' : 'pnl chain 一致性校验失败',
      firstBreakLayer,
      evidenceFile: args.output,
      summary: {
        realized_pnl_chain_pass: realizedPnlChainPass,
        unrealized_pnl_chain_pass: unrealizedPnlChainPass,
        pnl_chain_consistency_pass: pnlChainConsistencyPass
      },
      rawExcerpt: {
        target_window_id: baseSnap.target_window_id,
        realized_summary: baseSnap.realized.summary,
        realized_postmortem: baseSnap.realized.postmortem,
        unrealized_summary: baseSnap.unrealized.summary.value,
        unrealized_postmortem_basis: baseSnap.unrealized.postmortem.basis,
        unrealized_performance_basis: baseSnap.unrealized.performance_target_window.basis
      }
    });

    const output = {
      ...standard,
      task_id: args.taskId,
      command: `node scripts/verify_pnl_chain_consistency.mjs --task_id=${args.taskId} --sample=${args.sampleName}`,
      realized_reconciliation_table: {
        sample: baseSnap.sample_name,
        window_id: baseSnap.target_window_id,
        summary_realized_gross_pnl_total: baseSnap.realized.summary,
        last_run_snapshot_realized_gross_pnl_total: baseSnap.realized.last_run_snapshot,
        postmortem_realized_gross_pnl_total: baseSnap.realized.postmortem,
        performance_target_window_realized_gross_pnl_total: baseSnap.realized.performance_target_window
      },
      unrealized_reconciliation_table: {
        sample: baseSnap.sample_name,
        window_id: baseSnap.target_window_id,
        summary_unrealized_gross_pnl_total: baseSnap.unrealized.summary.value,
        summary_basis: baseSnap.unrealized.summary.basis,
        last_run_snapshot_unrealized_gross_pnl_total: baseSnap.unrealized.last_run_snapshot.value,
        last_run_snapshot_basis: baseSnap.unrealized.last_run_snapshot.basis,
        postmortem_unrealized_gross_pnl_total: baseSnap.unrealized.postmortem.value,
        postmortem_basis: baseSnap.unrealized.postmortem.basis,
        performance_target_window_unrealized_gross_pnl_total: baseSnap.unrealized.performance_target_window.value,
        performance_target_window_basis: baseSnap.unrealized.performance_target_window.basis
      },
      hand_calc: {
        realized: manualRealized ? {
          ...manualRealized,
          summary_realized_gross_pnl_total: baseSnap.realized.summary,
          delta_vs_summary: manualRealizedVsSummaryDelta
        } : { available: false, reason: baseSnap.manual_realized?.reason || 'not_available' },
        unrealized: manualUnrealized
      },
      result: {
        realized_pnl_chain_pass: realizedPnlChainPass,
        unrealized_pnl_chain_pass: unrealizedPnlChainPass,
        pnl_chain_consistency_pass: pnlChainConsistencyPass
      },
      sample_evaluations: snapshots.map((item) => ({
        sample_name: item.sample_name,
        scenario: item.scenario,
        target_window_id: item.target_window_id,
        realized_chain_pass: item.realized_chain_pass,
        unrealized_chain_pass: item.unrealized_chain_pass,
        unrealized_all_supported: item.unrealized_all_supported,
        realized_summary: item.realized.summary,
        unrealized_summary: item.unrealized.summary.value
      })),
      raw: snapshots.map((item) => ({
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
    if (!pnlChainConsistencyPass) process.exitCode = 1;
  } finally {
    if (boot.spawned && !boot.spawned.killed) boot.spawned.kill();
  }
};

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
