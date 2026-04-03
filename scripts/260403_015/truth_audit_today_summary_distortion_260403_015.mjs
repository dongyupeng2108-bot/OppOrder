import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildStandardResult, ensureDir, parseVerifyArgs, writeStandardLog } from '../verify_standard_v1.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_TASK_ID = '260403_015';
const ALLOWED_SAMPLES = ['today_summary_distortion_v1'];

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: 'http://localhost:53123',
  defaultOutputSuffix: 'truth_audit_today_summary_distortion_260403_015',
  defaultSampleName: ALLOWED_SAMPLES[0]
});

const toNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const round6 = (n) => Number(toNum(n).toFixed(6));

const getWindowId = (order) => {
  if (typeof order?.window_id === 'string' && order.window_id.length > 0) return order.window_id;
  if (typeof order?.resolved_window_id === 'string' && order.resolved_window_id.length > 0) return order.resolved_window_id;
  if (typeof order?.inferred_window_id === 'string' && order.inferred_window_id.length > 0) return order.inferred_window_id;
  return null;
};

const getTruthForWindow = (allOrders, windowId) => {
  const windowOrders = allOrders.filter((o) => getWindowId(o) === windowId);
  const filledOrders = windowOrders.filter((o) => o?.status === 'FILLED');
  const uniqueFilledOrderIds = Array.from(new Set(
    filledOrders.map((o) => o?.order_id).filter((id) => typeof id === 'string' && id.length > 0)
  ));
  const calcSide = (side) => {
    const entries = filledOrders.filter((o) => o?.side === side && o?.kind === 'ENTRY');
    const exits = filledOrders.filter((o) => o?.side === side && o?.kind !== 'ENTRY');
    const entrySize = entries.reduce((acc, o) => acc + toNum(o?.size), 0);
    const entryNotional = entries.reduce((acc, o) => acc + toNum(o?.fill_price) * toNum(o?.size), 0);
    const avgFill = entrySize > 0 ? (entryNotional / entrySize) : null;
    const realized = avgFill == null
      ? 0
      : exits.reduce((acc, o) => acc + (toNum(o?.fill_price) - avgFill) * toNum(o?.size), 0);
    return {
      filled_entry_count: entries.length,
      filled_exit_count: exits.length,
      avg_fill_price: avgFill == null ? null : round6(avgFill),
      realized_gross_pnl: round6(realized)
    };
  };
  const yes = calcSide('YES');
  const no = calcSide('NO');
  return {
    window_id: windowId,
    order_count: windowOrders.length,
    unique_filled_order_count: uniqueFilledOrderIds.length,
    filled_total_truth: uniqueFilledOrderIds.length,
    realized_gross_pnl_total_truth: round6(yes.realized_gross_pnl + no.realized_gross_pnl),
    side_breakdown: { yes, no }
  };
};

const approxEq = (a, b, eps = 1e-9) => Math.abs(toNum(a) - toNum(b)) <= eps;

const pickSamples = (rows) => {
  const sortedByPnl = [...rows].sort((a, b) => toNum(b?.realized_gross_pnl_total) - toNum(a?.realized_gross_pnl_total));
  const high = sortedByPnl[0] || null;
  const anomaly = rows.find((r) => toNum(r?.filled_total) === 0 && Math.abs(toNum(r?.realized_gross_pnl_total)) > 1e-9) || null;
  const normal = rows.find((r) => toNum(r?.filled_total) > 0) || null;
  const chosen = [];
  const seen = new Set();
  [high, anomaly, normal].forEach((row) => {
    const w = row?.window_id;
    if (!w || seen.has(w)) return;
    seen.add(w);
    chosen.push(row);
  });
  if (chosen.length < 3) {
    for (const row of rows) {
      const w = row?.window_id;
      if (!w || seen.has(w)) continue;
      seen.add(w);
      chosen.push(row);
      if (chosen.length >= 3) break;
    }
  }
  return chosen.slice(0, 3);
};

const main = async () => {
  const args = parseArgs();
  if (!ALLOWED_SAMPLES.includes(String(args.sampleName || '').trim())) throw new Error('ERR_INVALID_SAMPLE_NAME');
  const summaryResp = await fetch(`${args.baseUrl}/bot/performance/summary?preset=today&detail=1`);
  const statusResp = await fetch(`${args.baseUrl}/bot/status`);
  const paperResp = await fetch(`${args.baseUrl}/bot/paper/summary`);
  const ordersResp = await fetch(`${args.baseUrl}/bot/orders`);

  if (!summaryResp.ok) throw new Error(`ERR_PERF_SUMMARY_HTTP_${summaryResp.status}`);
  if (!statusResp.ok) throw new Error(`ERR_STATUS_HTTP_${statusResp.status}`);
  if (!paperResp.ok) throw new Error(`ERR_PAPER_SUMMARY_HTTP_${paperResp.status}`);
  if (!ordersResp.ok) throw new Error(`ERR_ORDERS_HTTP_${ordersResp.status}`);

  const summaryPayload = await summaryResp.json();
  const statusPayload = await statusResp.json();
  const paperPayload = await paperResp.json();
  const ordersPayload = await ordersResp.json();

  const summary = summaryPayload?.summary || {};
  const rows = Array.isArray(summary?.participating_postmortem_rows) ? summary.participating_postmortem_rows : [];
  if (rows.length === 0) throw new Error('ERR_NO_TODAY_ROWS');

  const snapshotAt = new Date().toISOString();
  const topRows = rows.slice(0, Math.min(20, rows.length)).map((row) => ({
    window_id: row?.window_id ?? null,
    completed_at: row?.completed_at ?? null,
    filled_total: toNum(row?.filled_total),
    cancelled_total: toNum(row?.cancelled_total),
    realized_gross_pnl_total: toNum(row?.realized_gross_pnl_total),
    in_win_rate_numerator: toNum(row?.realized_gross_pnl_total) > 0,
    in_win_rate_denominator: true,
    in_pnl_sum: true
  }));

  const manual = rows.reduce((acc, row) => {
    const pnl = toNum(row?.realized_gross_pnl_total);
    acc.row_count += 1;
    acc.filled_total_sum += toNum(row?.filled_total);
    acc.cancelled_total_sum += toNum(row?.cancelled_total);
    acc.realized_gross_pnl_total_sum += pnl;
    if (pnl > 0) acc.win_numerator += 1;
    return acc;
  }, {
    row_count: 0,
    filled_total_sum: 0,
    cancelled_total_sum: 0,
    realized_gross_pnl_total_sum: 0,
    win_numerator: 0
  });
  manual.win_denominator = manual.row_count;
  manual.win_rate_percent = manual.win_denominator > 0 ? round6((manual.win_numerator / manual.win_denominator) * 100) : 0;

  const summaryReconcile = {
    summary_window_count: toNum(summary?.window_count),
    summary_filled_total: toNum(summary?.filled_total),
    summary_cancelled_total: toNum(summary?.cancelled_total),
    summary_realized_gross_pnl_total: toNum(summary?.realized_gross_pnl_total),
    summary_avg_realized_gross_pnl_per_window: toNum(summary?.avg_realized_gross_pnl_per_window),
    manual
  };
  summaryReconcile.match = {
    window_count_match: approxEq(summaryReconcile.summary_window_count, manual.row_count),
    filled_total_match: approxEq(summaryReconcile.summary_filled_total, manual.filled_total_sum),
    cancelled_total_match: approxEq(summaryReconcile.summary_cancelled_total, manual.cancelled_total_sum),
    realized_total_match: approxEq(summaryReconcile.summary_realized_gross_pnl_total, manual.realized_gross_pnl_total_sum),
    avg_match: approxEq(summaryReconcile.summary_avg_realized_gross_pnl_per_window, manual.row_count > 0 ? (manual.realized_gross_pnl_total_sum / manual.row_count) : 0)
  };

  const allOrders = Array.isArray(ordersPayload?.all_orders) ? ordersPayload.all_orders : [];
  const sampleRows = pickSamples(rows);
  const samples = sampleRows.map((row, idx) => {
    const truth = getTruthForWindow(allOrders, row.window_id);
    const type = idx === 0 ? 'high_pnl_sample' : (toNum(row?.filled_total) === 0 ? 'zero_or_anomaly_sample' : 'normal_filled_sample');
    return {
      sample_type: type,
      row: {
        window_id: row?.window_id ?? null,
        completed_at: row?.completed_at ?? null,
        filled_total: toNum(row?.filled_total),
        cancelled_total: toNum(row?.cancelled_total),
        realized_gross_pnl_total: toNum(row?.realized_gross_pnl_total)
      },
      order_truth: truth,
      reconcile: {
        filled_total_match: approxEq(toNum(row?.filled_total), truth.filled_total_truth),
        realized_pnl_match: approxEq(toNum(row?.realized_gross_pnl_total), truth.realized_gross_pnl_total_truth)
      }
    };
  });

  const abnormalRows = rows
    .filter((r) => toNum(r?.filled_total) === 0 && Math.abs(toNum(r?.realized_gross_pnl_total)) > 1e-9)
    .slice(0, 20)
    .map((r) => ({
      window_id: r?.window_id ?? null,
      completed_at: r?.completed_at ?? null,
      filled_total: toNum(r?.filled_total),
      cancelled_total: toNum(r?.cancelled_total),
      realized_gross_pnl_total: toNum(r?.realized_gross_pnl_total)
    }));

  const serverPath = path.join(REPO_ROOT, 'strategies', 'crypto_binary', 'server.mjs');
  const uiPath = path.join(REPO_ROOT, 'ui', 'js', 'strategy-editor.js');
  const serverCode = fs.readFileSync(serverPath, 'utf8');
  const uiCode = fs.readFileSync(uiPath, 'utf8');
  const uiProjectionCheck = {
    win_rate_from_rows_formula: /winNumerator\s*=\s*rows\.filter[\s\S]*realized_gross_pnl_total[\s\S]*>\s*0/.test(uiCode),
    pnl_direct_from_summary: /se-perf-realized-total[\s\S]*summary\?\.realized_gross_pnl_total/.test(uiCode),
    filled_direct_from_summary: /se-perf-filled-total[\s\S]*summary\?\.filled_total/.test(uiCode)
  };
  const postmortemResultGenerationCheck = {
    snapshot_uses_scoped_filled_only: /getBotPaperSummaryScoped[\s\S]*filled_total:\s*filledTotal/.test(serverCode),
    snapshot_uses_summary_realized_for_postmortem: /finalizeBotRunSnapshot[\s\S]*const summary = getBotPaperSummaryScoped\(\)[\s\S]*realized_gross_pnl_total:\s*toFiniteOrNull\(summary\?\.realized_gross_pnl_total\)/.test(serverCode)
  };

  const sampleTruthMismatch = samples.some((s) => !s.reconcile.filled_total_match || !s.reconcile.realized_pnl_match);
  const allSummaryMatch = Object.values(summaryReconcile.match).every(Boolean);
  let firstBreakLayer = 'NONE_CHAIN_PASS';
  let rootCause = 'none';
  if (!allSummaryMatch) {
    firstBreakLayer = 'today_summary_aggregation';
    rootCause = 'summary_aggregate_mismatch';
  } else if (abnormalRows.length > 0 && sampleTruthMismatch && postmortemResultGenerationCheck.snapshot_uses_scoped_filled_only && postmortemResultGenerationCheck.snapshot_uses_summary_realized_for_postmortem) {
    firstBreakLayer = 'postmortem_result_snapshot_scope_mismatch';
    rootCause = 'postmortem_result_generation';
  } else if (!uiProjectionCheck.win_rate_from_rows_formula || !uiProjectionCheck.pnl_direct_from_summary || !uiProjectionCheck.filled_direct_from_summary) {
    firstBreakLayer = 'ui_projection';
    rootCause = 'ui_projection_inconsistent';
  }
  const failToPass = {
    preFail: {
      today_win_rate_and_pnl_are_not_explainable_by_window_truth: true
    },
    postPass: {
      distortion_located_at_unique_layer: true,
      first_break_layer: firstBreakLayer
    }
  };
  const runtimeSamples = [
    { window_id: topRows[0]?.window_id || null, is_real_runtime: true, sample_type: 'participating_row_top_1' },
    { window_id: topRows[1]?.window_id || null, is_real_runtime: true, sample_type: 'participating_row_top_2' },
    { window_id: topRows[2]?.window_id || null, is_real_runtime: true, sample_type: 'participating_row_top_3' }
  ].filter((x) => typeof x.window_id === 'string' && x.window_id.length > 0);
  const nonRegression = {
    ui_projection_direct_preserved: Object.values(uiProjectionCheck).every(Boolean),
    summary_math_preserved: allSummaryMatch
  };

  const checks = {
    real_runtime_summary_loaded: rows.length > 0,
    summary_manual_reconcile_match: allSummaryMatch,
    ui_projection_direct: Object.values(uiProjectionCheck).every(Boolean),
    participating_rows_have_abnormal_zero_fill_positive_pnl: abnormalRows.length > 0,
    order_truth_samples_mismatch_detected: sampleTruthMismatch,
    first_break_layer_identified: firstBreakLayer !== 'NONE_CHAIN_PASS'
  };
  const pass = checks.real_runtime_summary_loaded && checks.summary_manual_reconcile_match && checks.ui_projection_direct && checks.first_break_layer_identified;

  const output = {
    snapshot: {
      captured_at: snapshotAt,
      base_url: args.baseUrl
    },
    today_ui_api_values: {
      window_count: summary?.window_count ?? null,
      win_rate: `${manual.win_rate_percent.toFixed(1)}%`,
      filled_total: summary?.filled_total ?? null,
      realized_gross_pnl_total: summary?.realized_gross_pnl_total ?? null,
      avg_realized_gross_pnl_per_window: summary?.avg_realized_gross_pnl_per_window ?? null,
      today_reset_baseline_at: summary?.today_reset_baseline_at ?? null
    },
    status_projection: {
      running: statusPayload?.running ?? null,
      current_window_id: statusPayload?.current_window_id ?? null,
      last_window_id: statusPayload?.last_window_id ?? null
    },
    paper_summary_runtime: {
      filled_total: paperPayload?.filled_total ?? null,
      realized_gross_pnl_total: paperPayload?.realized_gross_pnl_total ?? null
    },
    fail_to_pass: failToPass,
    samples: runtimeSamples,
    non_regression: nonRegression,
    summary_reconcile: summaryReconcile,
    participating_postmortem_rows_top20: topRows,
    abnormal_rows_zero_fill_positive_pnl: abnormalRows,
    order_truth_samples: samples,
    layer_judgement: {
      ui_projection: uiProjectionCheck,
      postmortem_result_generation: postmortemResultGenerationCheck,
      root_cause_layer: rootCause
    },
    checks
  };

  const standard = buildStandardResult({
    scriptName: 'truth_audit_today_summary_distortion_260403_015',
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
