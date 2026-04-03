import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildStandardResult, ensureDir, parseVerifyArgs, writeStandardLog } from '../verify_standard_v1.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_TASK_ID = '260403_016';
const ALLOWED_SAMPLES = ['postmortem_scope_fix_v1'];

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: 'http://localhost:53130',
  defaultOutputSuffix: 'truth_audit_postmortem_scope_fix_260403_016',
  defaultSampleName: ALLOWED_SAMPLES[0]
});

const toNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const round6 = (n) => Number(toNum(n).toFixed(6));
const approxEq = (a, b, eps = 1e-9) => Math.abs(toNum(a) - toNum(b)) <= eps;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const getWindowId = (order) => {
  if (typeof order?.window_id === 'string' && order.window_id.length > 0) return order.window_id;
  if (typeof order?.resolved_window_id === 'string' && order.resolved_window_id.length > 0) return order.resolved_window_id;
  if (typeof order?.inferred_window_id === 'string' && order.inferred_window_id.length > 0) return order.inferred_window_id;
  return null;
};

const getWindowTruth = (allOrders, windowId) => {
  const windowOrders = allOrders.filter((o) => getWindowId(o) === windowId);
  const filled = windowOrders.filter((o) => o?.status === 'FILLED');
  const uniqueFilledOrderCount = new Set(
    filled.map((o) => o?.order_id).filter((id) => typeof id === 'string' && id.length > 0)
  ).size;
  const calcSide = (side) => {
    const entries = filled.filter((o) => o?.side === side && o?.kind === 'ENTRY');
    const exits = filled.filter((o) => o?.side === side && o?.kind !== 'ENTRY');
    const entrySize = entries.reduce((sum, o) => sum + toNum(o?.size), 0);
    if (entrySize <= 0) return 0;
    const entryNotional = entries.reduce((sum, o) => sum + toNum(o?.fill_price) * toNum(o?.size), 0);
    const avgFill = entryNotional / entrySize;
    return exits.reduce((sum, o) => sum + (toNum(o?.fill_price) - avgFill) * toNum(o?.size), 0);
  };
  const realized = calcSide('YES') + calcSide('NO');
  return {
    window_id: windowId,
    unique_filled_order_count: uniqueFilledOrderCount,
    filled_total_truth: uniqueFilledOrderCount,
    realized_gross_pnl_total_truth: round6(realized)
  };
};

const fetchJson = async (url, options = undefined) => {
  try {
    const resp = await fetch(url, options);
    const text = await resp.text();
    let json = null;
    try { json = JSON.parse(text); } catch { json = null; }
    return { ok: resp.ok, status: resp.status, json, text, error: null };
  } catch (error) {
    return { ok: false, status: 0, json: null, text: '', error: error?.message || 'fetch_failed' };
  }
};

const extractPrefailRows = () => {
  const prePath = path.join(REPO_ROOT, 'rules', 'task-reports', '2026-04', '260403_015', '260403_015_truth_audit_today_summary_distortion.json');
  if (!fs.existsSync(prePath)) return [];
  const pre = JSON.parse(fs.readFileSync(prePath, 'utf8'));
  const samples = Array.isArray(pre?.evidence_index?.order_truth_samples) ? pre.evidence_index.order_truth_samples : [];
  return samples
    .filter((s) => toNum(s?.row?.realized_gross_pnl_total) > 0 && toNum(s?.order_truth?.realized_gross_pnl_total_truth) === 0)
    .slice(0, 2)
    .map((s) => ({
      window_id: s?.row?.window_id ?? null,
      row_realized_gross_pnl_total: toNum(s?.row?.realized_gross_pnl_total),
      truth_realized_gross_pnl_total: toNum(s?.order_truth?.realized_gross_pnl_total_truth),
      row_filled_total: toNum(s?.row?.filled_total),
      truth_filled_total: toNum(s?.order_truth?.filled_total_truth)
    }));
};

const main = async () => {
  const args = parseArgs();
  if (!ALLOWED_SAMPLES.includes(String(args.sampleName || '').trim())) throw new Error('ERR_INVALID_SAMPLE_NAME');

  const prefailRows = extractPrefailRows();
  if (prefailRows.length < 2) throw new Error('ERR_MISSING_PREFAIL_EVIDENCE');

  const healthBaseUrl = args.baseUrl;
  const rootResp = await fetchJson(`${healthBaseUrl}/`);
  const pairsResp = await fetchJson(`${healthBaseUrl}/pairs`);
  if (!rootResp.ok) throw new Error(`ERR_ROOT_HTTP_${rootResp.status}`);

  const resetResp = await fetchJson(`${args.baseUrl}/bot/performance/today/reset`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  if (!resetResp.ok || resetResp?.json?.ok !== true) throw new Error(`ERR_RESET_HTTP_${resetResp.status}`);
  const baselineTs = Number(resetResp?.json?.today_reset_baseline_ts);
  if (!Number.isFinite(baselineTs)) throw new Error('ERR_INVALID_BASELINE_TS');

  const statusBefore = await fetchJson(`${args.baseUrl}/bot/status`);
  if (!statusBefore.ok) throw new Error(`ERR_STATUS_HTTP_${statusBefore.status}`);
  if (statusBefore?.json?.running !== true) {
    const startResp = await fetchJson(`${args.baseUrl}/bot/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tick_interval_ms: 2000 })
    });
    if (!startResp.ok || startResp?.json?.ok !== true) throw new Error(`ERR_START_HTTP_${startResp.status}`);
  }

  const deadline = Date.now() + (15 * 60 * 1000);
  let summary = null;
  let status = null;
  let allOrders = [];
  let postResetRows = [];
  while (Date.now() < deadline) {
    const [summaryResp, statusResp, ordersResp] = await Promise.all([
      fetchJson(`${args.baseUrl}/bot/performance/summary?preset=today&detail=1`),
      fetchJson(`${args.baseUrl}/bot/status`),
      fetchJson(`${args.baseUrl}/bot/orders`)
    ]);
    if (!summaryResp.ok || !statusResp.ok || !ordersResp.ok) {
      await sleep(15000);
      continue;
    }
    summary = summaryResp?.json?.summary || null;
    status = statusResp?.json || null;
    allOrders = Array.isArray(ordersResp?.json?.all_orders) ? ordersResp.json.all_orders : [];
    const rows = Array.isArray(summary?.participating_postmortem_rows) ? summary.participating_postmortem_rows : [];
    postResetRows = rows.filter((r) => {
      const ts = Date.parse(String(r?.completed_at || ''));
      return Number.isFinite(ts) && ts >= baselineTs;
    });
    const uniq = new Set(postResetRows.map((r) => r?.window_id).filter(Boolean));
    if (uniq.size >= 2) break;
    await sleep(15000);
  }

  const uniquePostWindows = Array.from(new Set(postResetRows.map((r) => r?.window_id).filter(Boolean)));
  if (uniquePostWindows.length < 2) throw new Error('ERR_NOT_ENOUGH_POST_RESET_COMPLETED_WINDOWS');

  const selectedRows = uniquePostWindows.slice(0, 2).map((windowId) => postResetRows.find((r) => r?.window_id === windowId)).filter(Boolean);
  const postRowsWithTruth = selectedRows.map((row) => {
    const truth = getWindowTruth(allOrders, row.window_id);
    return {
      window_id: row?.window_id ?? null,
      completed_at: row?.completed_at ?? null,
      row_filled_total: toNum(row?.filled_total),
      row_realized_gross_pnl_total: round6(row?.realized_gross_pnl_total),
      truth_realized_gross_pnl_total: truth.realized_gross_pnl_total_truth,
      truth_filled_total: truth.filled_total_truth,
      in_win_rate_numerator: toNum(row?.realized_gross_pnl_total) > 0,
      filled_match: approxEq(toNum(row?.filled_total), truth.filled_total_truth),
      realized_match: approxEq(toNum(row?.realized_gross_pnl_total), truth.realized_gross_pnl_total_truth)
    };
  });

  const allPostRowsWithTruth = postResetRows.map((row) => {
    const truth = getWindowTruth(allOrders, row.window_id);
    return {
      window_id: row?.window_id ?? null,
      row_realized_gross_pnl_total: round6(row?.realized_gross_pnl_total),
      truth_realized_gross_pnl_total: truth.realized_gross_pnl_total_truth,
      mismatch_pollution: toNum(row?.realized_gross_pnl_total) > 0 && approxEq(truth.realized_gross_pnl_total_truth, 0) && !approxEq(toNum(row?.realized_gross_pnl_total), 0)
    };
  });
  const pollutionRows = allPostRowsWithTruth.filter((r) => r.mismatch_pollution);

  const winNumerator = postResetRows.filter((r) => toNum(r?.realized_gross_pnl_total) > 0).length;
  const winDenominator = postResetRows.length;
  const winRatePercent = winDenominator > 0 ? round6((winNumerator / winDenominator) * 100) : 0;
  const pnlSum = round6(postResetRows.reduce((sum, r) => sum + toNum(r?.realized_gross_pnl_total), 0));

  const runningWindowId = status?.current_window_id ?? null;
  const runningNotIncluded = typeof runningWindowId !== 'string' || !postResetRows.some((r) => r?.window_id === runningWindowId);

  const stopResp = await fetchJson(`${args.baseUrl}/bot/stop`, { method: 'POST' });
  const summaryAfterStopResp = await fetchJson(`${args.baseUrl}/bot/performance/summary?preset=today&detail=1`);
  const stopNonRegression = stopResp.ok && stopResp?.json?.ok === true && summaryAfterStopResp.ok && summaryAfterStopResp?.json?.ok === true;

  const checks = {
    prefail_contamination_present: prefailRows.length >= 2,
    post_reset_two_completed_windows_ready: postRowsWithTruth.length >= 2,
    post_reset_rows_match_truth: postRowsWithTruth.every((r) => r.filled_match && r.realized_match),
    post_reset_no_pollution_rows: pollutionRows.length === 0,
    running_window_not_counted: runningNotIncluded,
    stop_semantics_chain_alive: stopNonRegression,
    healthcheck_root_pairs_checked: rootResp.status === 200 && (pairsResp.status === 200 || pairsResp.status === 404)
  };
  const pass = Object.values(checks).every(Boolean);

  const failToPass = {
    preFail: {
      postmortem_row_pnl_gt_zero_but_truth_zero: prefailRows
    },
    postPass: {
      reset_after_new_windows_row_truth_consistent: postRowsWithTruth,
      no_new_pollution_rows: pollutionRows.length === 0
    }
  };
  const samples = postRowsWithTruth.map((row) => ({
    window_id: row.window_id,
    is_real_runtime: true,
    sample_type: 'post_reset_completed_window'
  }));
  const nonRegression = {
    running_not_pre_counted_today: runningNotIncluded,
    stop_does_not_break_stats_chain: stopNonRegression,
    today_reset_baseline_usable: Number.isFinite(baselineTs)
  };
  const healthcheck = {
    root_status: rootResp.status,
    pairs_status: pairsResp.status
  };

  const output = {
    snapshot: {
      base_url: args.baseUrl,
      healthcheck_base_url: healthBaseUrl,
      baseline_ts: baselineTs,
      baseline_at: new Date(baselineTs).toISOString()
    },
    fail_to_pass: failToPass,
    today_summary_after_fix: {
      window_count: summary?.window_count ?? null,
      filled_total: summary?.filled_total ?? null,
      realized_gross_pnl_total: summary?.realized_gross_pnl_total ?? null,
      participating_count: postResetRows.length
    },
    post_reset_rows_reconcile_table: postRowsWithTruth,
    post_reset_win_rate_manual: {
      win_numerator: winNumerator,
      win_denominator: winDenominator,
      win_rate_percent: winRatePercent,
      realized_gross_pnl_total_sum: pnlSum
    },
    post_reset_pollution_rows: pollutionRows,
    non_regression: nonRegression,
    healthcheck,
    samples,
    checks
  };

  const firstBreakLayer = pass ? 'NONE_CHAIN_PASS' : 'postmortem_result_snapshot_scope_mismatch';
  const standard = buildStandardResult({
    scriptName: 'truth_audit_postmortem_scope_fix_260403_016',
    taskId: args.taskId,
    sampleName: args.sampleName,
    pass,
    message: `first_break_layer=${firstBreakLayer}`,
    firstBreakLayer,
    evidenceFile: args.output,
    summary: { pass },
    rawExcerpt: output
  });
  const finalOutput = {
    ...standard,
    task_type: 'fix_acceptance_heavy',
    conclusion_block: {
      verdict: pass ? 'A：通过' : 'C：存在断裂',
      first_break_layer: firstBreakLayer
    },
    evidence_index: output
  };
  ensureDir(args.output);
  fs.writeFileSync(args.output, JSON.stringify(finalOutput, null, 2));
  const verifyLog = writeStandardLog(args.output, standard);
  console.log(`VERIFY_OUTPUT=${args.output}`);
  console.log(`VERIFY_LOG=${verifyLog}`);
  console.log(JSON.stringify({ pass, first_break_layer: firstBreakLayer, checks }));
  if (!pass) process.exit(1);
};

main().catch((error) => {
  console.error(JSON.stringify({ event: 'AUDIT_FATAL', code: error?.message || 'ERR_UNHANDLED', allowed_samples: ALLOWED_SAMPLES }));
  process.exit(1);
});
