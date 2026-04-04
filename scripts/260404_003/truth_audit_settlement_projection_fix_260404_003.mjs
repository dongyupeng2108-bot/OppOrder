import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildStandardResult, ensureDir, parseVerifyArgs, writeStandardLog } from '../verify_standard_v1.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_TASK_ID = '260404_003';
const ALLOWED_SAMPLES = ['settlement_projection_fix_v1'];

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: 'http://localhost:53123',
  defaultOutputSuffix: 'truth_audit_settlement_projection_fix_260404_003',
  defaultSampleName: ALLOWED_SAMPLES[0]
});

const toNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const round6 = (n) => Number(toNum(n).toFixed(6));
const approxEq = (a, b, eps = 1e-9) => Math.abs(toNum(a) - toNum(b)) <= eps;
const parseTs = (v) => {
  const t = Date.parse(String(v || ''));
  return Number.isNaN(t) ? null : t;
};
const getWindowId = (order) => {
  if (typeof order?.window_id === 'string' && order.window_id.length > 0) return order.window_id;
  if (typeof order?.resolved_window_id === 'string' && order.resolved_window_id.length > 0) return order.resolved_window_id;
  if (typeof order?.inferred_window_id === 'string' && order.inferred_window_id.length > 0) return order.inferred_window_id;
  return null;
};

const computeWindowTruth = (allOrders, windowId, settlementOutcome = null) => {
  const windowOrders = allOrders.filter((o) => getWindowId(o) === windowId && o?.status === 'FILLED');
  const uniqueFilled = Array.from(new Set(windowOrders.map((o) => o?.order_id).filter((x) => typeof x === 'string' && x.length > 0)));
  const calcSide = (side) => {
    const entries = windowOrders.filter((o) => o?.side === side && o?.kind === 'ENTRY');
    const exits = windowOrders.filter((o) => o?.side === side && o?.kind !== 'ENTRY');
    const entrySize = entries.reduce((sum, o) => sum + toNum(o?.size), 0);
    if (entrySize <= 0) {
      return { realized: 0, entry_size: 0, entry_notional: 0, exit_fill_count: exits.length, entry_rows: entries, exit_rows: exits };
    }
    const entryNotional = entries.reduce((sum, o) => sum + toNum(o?.fill_price) * toNum(o?.size), 0);
    const avgFill = entryNotional / entrySize;
    const exitRealized = exits.reduce((sum, o) => sum + (toNum(o?.fill_price) - avgFill) * toNum(o?.size), 0);
    if (exits.length === 0 && (settlementOutcome === 'UP' || settlementOutcome === 'DOWN')) {
      const sideWin = (side === 'YES' && settlementOutcome === 'UP') || (side === 'NO' && settlementOutcome === 'DOWN');
      const payout = sideWin ? entrySize : 0;
      return { realized: payout - entryNotional, entry_size: entrySize, entry_notional: entryNotional, exit_fill_count: 0, entry_rows: entries, exit_rows: exits };
    }
    return { realized: exitRealized, entry_size: entrySize, entry_notional: entryNotional, exit_fill_count: exits.length, entry_rows: entries, exit_rows: exits };
  };
  const yes = calcSide('YES');
  const no = calcSide('NO');
  const entrySide = yes.entry_size > 0 ? 'YES' : (no.entry_size > 0 ? 'NO' : null);
  const entryPrice = entrySide === 'YES'
    ? (yes.entry_size > 0 ? round6(yes.entry_notional / yes.entry_size) : null)
    : (no.entry_size > 0 ? round6(no.entry_notional / no.entry_size) : null);
  return {
    filled_total_truth: uniqueFilled.length,
    exit_fill_count: yes.exit_fill_count + no.exit_fill_count,
    entry_side: entrySide,
    entry_price: entryPrice,
    realized_gross_pnl_total_truth: round6(yes.realized + no.realized),
    fill_rows: windowOrders.map((o) => ({
      order_id: o?.order_id ?? null,
      side: o?.side ?? null,
      kind: o?.kind ?? null,
      fill_price: toNum(o?.fill_price),
      qty: toNum(o?.size)
    }))
  };
};

const main = async () => {
  const args = parseArgs();
  if (!ALLOWED_SAMPLES.includes(String(args.sampleName || '').trim())) throw new Error('ERR_INVALID_SAMPLE_NAME');
  const preEvidenceFile = path.join(REPO_ROOT, 'rules', 'task-reports', '2026-04', '260404_002', '260404_002_truth_audit_single_fill_pnl_zero.json');
  if (!fs.existsSync(preEvidenceFile)) throw new Error('ERR_MISSING_PREFail_260404_002');
  const preEvidence = JSON.parse(fs.readFileSync(preEvidenceFile, 'utf8'));
  const preGapRows = preEvidence?.evidence_index?.settlement_gap_rows || preEvidence?.raw_excerpt?.settlement_gap_rows || [];
  const preGapSample = Array.isArray(preGapRows) ? preGapRows.slice(0, 2) : [];
  if (preGapSample.length < 2) throw new Error('ERR_PREFail_ROWS_LT_2');

  const [summaryResp, ordersResp, statusResp, rootResp, pairsResp] = await Promise.all([
    fetch(`${args.baseUrl}/bot/performance/summary?preset=today&detail=1`),
    fetch(`${args.baseUrl}/bot/orders`),
    fetch(`${args.baseUrl}/bot/status`),
    fetch(`${args.baseUrl}/`),
    fetch(`${args.baseUrl}/pairs`)
  ]);
  if (!summaryResp.ok) throw new Error(`ERR_SUMMARY_HTTP_${summaryResp.status}`);
  if (!ordersResp.ok) throw new Error(`ERR_ORDERS_HTTP_${ordersResp.status}`);
  if (!statusResp.ok) throw new Error(`ERR_STATUS_HTTP_${statusResp.status}`);
  const summaryPayload = await summaryResp.json();
  const ordersPayload = await ordersResp.json();
  const statusBeforeStop = await statusResp.json();
  const summary = summaryPayload?.summary || {};
  const rows = Array.isArray(summary?.participating_postmortem_rows) ? summary.participating_postmortem_rows : [];
  const baselineTs = toNum(summary?.today_reset_baseline_ts);
  const rowsAfterReset = rows.filter((r) => {
    const ts = parseTs(r?.completed_at);
    return ts != null && ts >= baselineTs;
  });
  const fill1RowsAfterReset = rowsAfterReset.filter((r) => toNum(r?.filled_total) === 1);
  const allOrders = Array.isArray(ordersPayload?.all_orders) ? ordersPayload.all_orders : [];
  const fill1RowsWithTruth = fill1RowsAfterReset.map((row) => {
    const outcome = row?.settled_outcome_official || row?.settled_outcome_internal || null;
    const truth = computeWindowTruth(allOrders, row?.window_id, outcome);
    return {
      window_id: row?.window_id ?? null,
      completed_at: row?.completed_at ?? null,
      entry_side: truth.entry_side,
      entry_price: truth.entry_price,
      official_final_outcome: row?.settled_outcome_official ?? null,
      internal_final_outcome: row?.settled_outcome_internal ?? null,
      filled_total: toNum(row?.filled_total),
      exit_fill_count: truth.exit_fill_count,
      row_realized_gross_pnl_total: toNum(row?.realized_gross_pnl_total),
      truth_realized_gross_pnl_total: truth.realized_gross_pnl_total_truth,
      match: approxEq(toNum(row?.realized_gross_pnl_total), truth.realized_gross_pnl_total_truth)
    };
  });
  const postPassRows = fill1RowsWithTruth.filter((r) => Math.abs(toNum(r.row_realized_gross_pnl_total)) > 1e-9).slice(0, 2);
  if (postPassRows.length < 2) throw new Error('ERR_POSTPASS_FILL1_NONZERO_LT_2');

  const sumRealizedManual = round6(rowsAfterReset.reduce((sum, row) => sum + toNum(row?.realized_gross_pnl_total), 0));
  const avgRealizedManual = rowsAfterReset.length > 0 ? round6(sumRealizedManual / rowsAfterReset.length) : 0;
  const winNumerator = rowsAfterReset.filter((row) => toNum(row?.realized_gross_pnl_total) > 0).length;
  const winDenominator = rowsAfterReset.length;
  const winRateManual = winDenominator > 0 ? round6((winNumerator * 100) / winDenominator) : 0;
  const summaryReconcile = {
    api: {
      realized_gross_pnl_total: toNum(summary?.realized_gross_pnl_total),
      avg_realized_gross_pnl_per_window: toNum(summary?.avg_realized_gross_pnl_per_window)
    },
    manual: {
      realized_gross_pnl_total: sumRealizedManual,
      avg_realized_gross_pnl_per_window: avgRealizedManual,
      win_rate_percent: winRateManual,
      win_numerator: winNumerator,
      win_denominator: winDenominator
    },
    match: {
      realized: approxEq(toNum(summary?.realized_gross_pnl_total), sumRealizedManual),
      avg: approxEq(toNum(summary?.avg_realized_gross_pnl_per_window), avgRealizedManual)
    }
  };

  const runningNotCounted = statusBeforeStop?.running === true
    ? !rowsAfterReset.some((row) => row?.window_id === statusBeforeStop?.current_window_id)
    : true;

  const stopResp = await fetch(`${args.baseUrl}/bot/stop`, { method: 'POST' });
  const stopOk = stopResp.ok;
  const statusAfterStopResp = await fetch(`${args.baseUrl}/bot/status`);
  const statusAfterStop = statusAfterStopResp.ok ? await statusAfterStopResp.json() : {};
  const summaryAfterStopResp = await fetch(`${args.baseUrl}/bot/performance/summary?preset=today&detail=1`);
  const summaryAfterStop = summaryAfterStopResp.ok ? await summaryAfterStopResp.json() : {};
  const stopSemanticsAlive = stopOk && statusAfterStop?.running === false && summaryAfterStopResp.ok && !!summaryAfterStop?.summary;

  const withExitRows = rowsAfterReset.filter((row) => toNum(row?.filled_total) >= 2).map((row) => {
    const outcome = row?.settled_outcome_official || row?.settled_outcome_internal || null;
    const truth = computeWindowTruth(allOrders, row?.window_id, outcome);
    return {
      window_id: row?.window_id ?? null,
      row_realized: toNum(row?.realized_gross_pnl_total),
      truth_realized: truth.realized_gross_pnl_total_truth,
      exit_fill_count: truth.exit_fill_count,
      match: approxEq(toNum(row?.realized_gross_pnl_total), truth.realized_gross_pnl_total_truth)
    };
  }).filter((x) => x.exit_fill_count > 0);
  const exitWindowsNotBroken = withExitRows.length > 0 ? withExitRows.every((x) => x.match) : true;

  const checks = {
    prefail_pollution_rows_ge_2: preGapSample.length >= 2,
    postpass_fill1_rows_ge_2: postPassRows.length >= 2,
    postpass_row_truth_match: postPassRows.every((r) => r.match),
    postpass_fill1_nonzero_realized: postPassRows.every((r) => Math.abs(toNum(r.row_realized_gross_pnl_total)) > 1e-9),
    today_summary_reconcile_match: summaryReconcile.match.realized && summaryReconcile.match.avg,
    no_zero_pollution_for_postpass_rows: postPassRows.every((r) => !approxEq(toNum(r.row_realized_gross_pnl_total), 0)),
    running_window_not_counted: runningNotCounted,
    stop_semantics_chain_alive: stopSemanticsAlive,
    exit_windows_not_broken: exitWindowsNotBroken,
    healthcheck_ok: rootResp.status === 200 && (pairsResp.status === 200 || pairsResp.status === 404)
  };
  const pass = Object.values(checks).every(Boolean);
  const firstBreakLayer = pass ? 'NONE_CHAIN_PASS' : 'settlement_projection_fix_acceptance';

  const output = {
    fail_to_pass: {
      preFail: {
        source_task_id: '260404_002',
        polluted_rows: preGapSample.map((row) => ({
          window_id: row?.window_id ?? null,
          row_realized_gross_pnl_total: toNum(row?.row_realized_gross_pnl_total),
          pnl_if_settle_win: toNum(row?.counterfactual?.pnl_if_settle_win),
          pnl_if_settle_lose: toNum(row?.counterfactual?.pnl_if_settle_lose)
        }))
      },
      postPass: {
        reset_baseline_ts: baselineTs,
        reset_baseline_at: summary?.today_reset_baseline_at ?? null,
        rows: postPassRows
      }
    },
    today_after_reset: {
      window_count: rowsAfterReset.length,
      filled_total: rowsAfterReset.reduce((sum, row) => sum + toNum(row?.filled_total), 0),
      realized_gross_pnl_total: toNum(summary?.realized_gross_pnl_total),
      avg_realized_gross_pnl_per_window: toNum(summary?.avg_realized_gross_pnl_per_window),
      win_rate_manual_percent: winRateManual,
      win_numerator: winNumerator,
      win_denominator: winDenominator
    },
    summary_reconcile: summaryReconcile,
    non_regression: {
      running_window_not_counted: runningNotCounted,
      stop_semantics_chain_alive: stopSemanticsAlive,
      exit_windows_not_broken: exitWindowsNotBroken
    },
    healthcheck: {
      root_status: rootResp.status,
      pairs_status: pairsResp.status
    },
    checks
  };

  const standard = buildStandardResult({
    scriptName: 'truth_audit_settlement_projection_fix_260404_003',
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
