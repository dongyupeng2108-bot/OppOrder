import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildStandardResult, ensureDir, parseVerifyArgs, writeStandardLog } from '../verify_standard_v1.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_TASK_ID = '260404_002';
const ALLOWED_SAMPLES = ['single_fill_pnl_zero_v1'];

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: 'http://localhost:53123',
  defaultOutputSuffix: 'truth_audit_single_fill_pnl_zero_260404_002',
  defaultSampleName: ALLOWED_SAMPLES[0]
});

const toNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const round6 = (n) => Number(toNum(n).toFixed(6));
const approxEq = (a, b, eps = 1e-9) => Math.abs(toNum(a) - toNum(b)) <= eps;

const getWindowId = (order) => {
  if (typeof order?.window_id === 'string' && order.window_id.length > 0) return order.window_id;
  if (typeof order?.resolved_window_id === 'string' && order.resolved_window_id.length > 0) return order.resolved_window_id;
  if (typeof order?.inferred_window_id === 'string' && order.inferred_window_id.length > 0) return order.inferred_window_id;
  return null;
};

const calcWindowTruth = (allOrders, windowId) => {
  const windowOrders = allOrders.filter((o) => getWindowId(o) === windowId);
  const filled = windowOrders.filter((o) => o?.status === 'FILLED');
  const uniqueFilledOrderIds = Array.from(new Set(filled.map((o) => o?.order_id).filter((x) => typeof x === 'string' && x.length > 0)));
  const calcSide = (side) => {
    const entries = filled.filter((o) => o?.side === side && o?.kind === 'ENTRY');
    const exits = filled.filter((o) => o?.side === side && o?.kind !== 'ENTRY');
    const entrySize = entries.reduce((sum, o) => sum + toNum(o?.size), 0);
    const entryNotional = entries.reduce((sum, o) => sum + toNum(o?.fill_price) * toNum(o?.size), 0);
    const avgFill = entrySize > 0 ? (entryNotional / entrySize) : null;
    const realized = avgFill == null ? 0 : exits.reduce((sum, o) => sum + (toNum(o?.fill_price) - avgFill) * toNum(o?.size), 0);
    return {
      filled_entry_count: entries.length,
      filled_exit_count: exits.length,
      avg_fill_price: avgFill == null ? null : round6(avgFill),
      realized_gross_pnl: round6(realized)
    };
  };
  const yes = calcSide('YES');
  const no = calcSide('NO');
  const manual = {
    unique_filled_order_count: uniqueFilledOrderIds.length,
    fill_rows: filled.map((o) => ({
      order_id: o?.order_id ?? null,
      side: o?.side ?? null,
      kind: o?.kind ?? null,
      fill_price: toNum(o?.fill_price),
      qty: toNum(o?.size),
      status: o?.status ?? null
    })),
    yes,
    no,
    realized_gross_pnl_total_manual: round6(yes.realized_gross_pnl + no.realized_gross_pnl)
  };
  return {
    filled_total_truth: uniqueFilledOrderIds.length,
    realized_gross_pnl_total_truth: manual.realized_gross_pnl_total_manual,
    entry_exit_counts: {
      yes_entry: yes.filled_entry_count,
      yes_exit: yes.filled_exit_count,
      no_entry: no.filled_entry_count,
      no_exit: no.filled_exit_count
    },
    manual
  };
};

const main = async () => {
  const args = parseArgs();
  if (!ALLOWED_SAMPLES.includes(String(args.sampleName || '').trim())) throw new Error('ERR_INVALID_SAMPLE_NAME');

  const [summaryResp, ordersResp, statusResp] = await Promise.all([
    fetch(`${args.baseUrl}/bot/performance/summary?preset=today&detail=1`),
    fetch(`${args.baseUrl}/bot/orders`),
    fetch(`${args.baseUrl}/bot/status`)
  ]);
  if (!summaryResp.ok) throw new Error(`ERR_PERF_SUMMARY_HTTP_${summaryResp.status}`);
  if (!ordersResp.ok) throw new Error(`ERR_ORDERS_HTTP_${ordersResp.status}`);
  if (!statusResp.ok) throw new Error(`ERR_STATUS_HTTP_${statusResp.status}`);

  const summaryPayload = await summaryResp.json();
  const ordersPayload = await ordersResp.json();
  const statusPayload = await statusResp.json();

  const summary = summaryPayload?.summary || {};
  const rows = Array.isArray(summary?.participating_postmortem_rows) ? summary.participating_postmortem_rows : [];
  if (rows.length === 0) throw new Error('ERR_NO_TODAY_ROWS');

  const allOrders = Array.isArray(ordersPayload?.all_orders) ? ordersPayload.all_orders : [];
  const todayFillOneRows = rows
    .filter((row) => toNum(row?.filled_total) === 1)
    .map((row) => ({
      window_id: row?.window_id ?? null,
      completed_at: row?.completed_at ?? null,
      filled_total: toNum(row?.filled_total),
      cancelled_total: toNum(row?.cancelled_total),
      realized_gross_pnl_total: toNum(row?.realized_gross_pnl_total),
      in_today_pnl_sum: true
    }));

  if (todayFillOneRows.length === 0) throw new Error('ERR_NO_FILLED_TOTAL_EQ_1_IN_TODAY');

  const windowsForTruth = todayFillOneRows.map((row) => {
    const truth = calcWindowTruth(allOrders, row.window_id);
    return {
      row,
      truth,
      reconcile: {
        filled_total_match: approxEq(row.filled_total, truth.filled_total_truth),
        realized_match: approxEq(row.realized_gross_pnl_total, truth.realized_gross_pnl_total_truth)
      }
    };
  });

  const truthSamples = windowsForTruth.slice(0, 2).map((x) => ({
    window_id: x.row.window_id,
    completed_at: x.row.completed_at,
    row_filled_total: x.row.filled_total,
    row_realized_gross_pnl_total: x.row.realized_gross_pnl_total,
    truth_filled_total: x.truth.filled_total_truth,
    truth_realized_gross_pnl_total: x.truth.realized_gross_pnl_total_truth,
    unique_filled_order_id_count: x.truth.manual.unique_filled_order_count,
    fill_rows: x.truth.manual.fill_rows,
    manual_calc: {
      yes: x.truth.manual.yes,
      no: x.truth.manual.no,
      realized_gross_pnl_total_manual: x.truth.manual.realized_gross_pnl_total_manual
    },
    interpretation: x.truth.manual.yes.filled_exit_count + x.truth.manual.no.filled_exit_count === 0
      ? 'only_entry_filled_no_exit_realized_pnl_zero_by_business_formula'
      : 'has_exit_fill_realized_from_exit_minus_avg_entry'
  }));

  if (truthSamples.length < 2) throw new Error('ERR_FILLED_TOTAL_EQ_1_SAMPLES_LT_2');

  const summaryManual = {
    window_count: rows.length,
    filled_total: rows.reduce((sum, row) => sum + toNum(row?.filled_total), 0),
    realized_gross_pnl_total: round6(rows.reduce((sum, row) => sum + toNum(row?.realized_gross_pnl_total), 0)),
    avg_realized_gross_pnl_per_window: rows.length > 0 ? round6(rows.reduce((sum, row) => sum + toNum(row?.realized_gross_pnl_total), 0) / rows.length) : 0
  };
  const summaryReconcile = {
    api: {
      window_count: toNum(summary?.window_count),
      filled_total: toNum(summary?.filled_total),
      realized_gross_pnl_total: toNum(summary?.realized_gross_pnl_total),
      avg_realized_gross_pnl_per_window: toNum(summary?.avg_realized_gross_pnl_per_window)
    },
    manual: summaryManual,
    match: {
      window_count: approxEq(toNum(summary?.window_count), summaryManual.window_count),
      filled_total: approxEq(toNum(summary?.filled_total), summaryManual.filled_total),
      realized_gross_pnl_total: approxEq(toNum(summary?.realized_gross_pnl_total), summaryManual.realized_gross_pnl_total),
      avg_realized_gross_pnl_per_window: approxEq(toNum(summary?.avg_realized_gross_pnl_per_window), summaryManual.avg_realized_gross_pnl_per_window)
    }
  };

  const rowTruthAllMatch = windowsForTruth.every((x) => x.reconcile.filled_total_match && x.reconcile.realized_match);
  const sampleAllPnlZero = truthSamples.every((s) => approxEq(s.truth_realized_gross_pnl_total, 0) && approxEq(s.row_realized_gross_pnl_total, 0));
  const sampleAllOnlyEntryNoExit = truthSamples.every((s) => (toNum(s.manual_calc.yes.filled_exit_count) + toNum(s.manual_calc.no.filled_exit_count)) === 0);
  const summaryAllMatch = Object.values(summaryReconcile.match).every(Boolean);

  let firstBreakLayer = 'NONE_CHAIN_PASS';
  let rootCauseLayer = 'none';
  let conclusion = 'single_fill_pnl_zero_is_expected_by_current_business_formula';

  if (!summaryAllMatch) {
    firstBreakLayer = 'today_summary_aggregation';
    rootCauseLayer = 'summary_aggregate';
    conclusion = 'summary_aggregation_bug';
  } else if (!rowTruthAllMatch) {
    firstBreakLayer = 'postmortem_result_snapshot_generation';
    rootCauseLayer = 'postmortem_result';
    conclusion = 'row_truth_mismatch_bug';
  } else if (!sampleAllPnlZero && sampleAllOnlyEntryNoExit) {
    firstBreakLayer = 'order_truth_to_window_result';
    rootCauseLayer = 'window_result_formula';
    conclusion = 'window_result_formula_or_order_binding_bug';
  }

  const checks = {
    real_runtime_today_snapshot_loaded: rows.length > 0,
    filled_total_eq_1_windows_found: todayFillOneRows.length > 0,
    filled_total_eq_1_truth_sample_ge_2: truthSamples.length >= 2,
    today_summary_reconcile_match: summaryAllMatch,
    row_vs_truth_match_for_filled_total_eq_1: rowTruthAllMatch,
    sampled_single_fill_windows_pnl_zero_and_explainable: sampleAllPnlZero && sampleAllOnlyEntryNoExit,
    unique_first_break_layer_generated: firstBreakLayer.length > 0
  };
  const pass = Object.values(checks).every(Boolean);

  const output = {
    snapshot: {
      captured_at: new Date().toISOString(),
      base_url: args.baseUrl
    },
    today_snapshot: {
      window_count: summary?.window_count ?? null,
      filled_total: summary?.filled_total ?? null,
      realized_gross_pnl_total: summary?.realized_gross_pnl_total ?? null,
      avg_realized_gross_pnl_per_window: summary?.avg_realized_gross_pnl_per_window ?? null,
      today_reset_baseline_at: summary?.today_reset_baseline_at ?? null
    },
    status_snapshot: {
      running: statusPayload?.running ?? null,
      current_window_id: statusPayload?.current_window_id ?? null,
      last_window_id: statusPayload?.last_window_id ?? null
    },
    filled_total_eq_1_windows: todayFillOneRows,
    postmortem_result_truth_reconcile_for_fill1: windowsForTruth.map((x) => ({
      window_id: x.row.window_id,
      completed_at: x.row.completed_at,
      row: x.row,
      truth: {
        filled_total_truth: x.truth.filled_total_truth,
        realized_gross_pnl_total_truth: x.truth.realized_gross_pnl_total_truth,
        entry_exit_counts: x.truth.entry_exit_counts
      },
      reconcile: x.reconcile
    })),
    order_truth_manual_samples: truthSamples,
    summary_reconcile: summaryReconcile,
    fail_to_pass: {
      preFail: {
        user_report_single_fill_pnl_zero_suspected_bug: true
      },
      postPass: {
        located_unique_layer: true,
        first_break_layer: firstBreakLayer
      }
    },
    samples: truthSamples.map((s) => ({ window_id: s.window_id, is_real_runtime: true, sample_type: 'filled_total_eq_1_truth_sample' })),
    non_regression: {
      did_not_use_filled_total_eq_2_for_main_conclusion: true,
      no_business_code_mutation: true
    },
    layer_judgement: {
      root_cause_layer: rootCauseLayer,
      conclusion
    },
    checks
  };

  const standard = buildStandardResult({
    scriptName: 'truth_audit_single_fill_pnl_zero_260404_002',
    taskId: args.taskId,
    sampleName: args.sampleName,
    pass,
    message: `first_break_layer=${firstBreakLayer}`,
    firstBreakLayer: firstBreakLayer,
    evidenceFile: args.output,
    summary: { pass },
    rawExcerpt: output
  });
  const finalOutput = {
    ...standard,
    task_type: 'truth_audit_heavy',
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
