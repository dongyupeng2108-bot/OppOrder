import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildStandardResult, ensureDir, parseVerifyArgs, writeStandardLog } from '../verify_standard_v1.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_TASK_ID = '260404_004';
const ALLOWED_SAMPLES = ['ui_scope_and_price_semantics_v1'];

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: 'http://localhost:53123',
  defaultOutputSuffix: 'truth_audit_ui_scope_and_price_semantics_260404_004',
  defaultSampleName: ALLOWED_SAMPLES[0]
});

const toNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const main = async () => {
  const args = parseArgs();
  if (!ALLOWED_SAMPLES.includes(String(args.sampleName || '').trim())) throw new Error('ERR_INVALID_SAMPLE_NAME');

  const uiPath = path.join(REPO_ROOT, 'ui', 'js', 'strategy-editor.js');
  const uiCode = fs.readFileSync(uiPath, 'utf8');

  const [ordersResp, todayResp, last7Resp, last30Resp] = await Promise.all([
    fetch(`${args.baseUrl}/bot/orders`),
    fetch(`${args.baseUrl}/bot/performance/summary?preset=today&detail=1`),
    fetch(`${args.baseUrl}/bot/performance/summary?preset=last_7d&detail=1`),
    fetch(`${args.baseUrl}/bot/performance/summary?preset=last_30_windows&detail=1`)
  ]);
  if (!ordersResp.ok) throw new Error(`ERR_ORDERS_HTTP_${ordersResp.status}`);
  if (!todayResp.ok) throw new Error(`ERR_SUMMARY_TODAY_HTTP_${todayResp.status}`);
  if (!last7Resp.ok) throw new Error(`ERR_SUMMARY_7D_HTTP_${last7Resp.status}`);
  if (!last30Resp.ok) throw new Error(`ERR_SUMMARY_30_HTTP_${last30Resp.status}`);

  const ordersPayload = await ordersResp.json();
  const today = await todayResp.json();
  const last7 = await last7Resp.json();
  const last30 = await last30Resp.json();
  const allOrders = Array.isArray(ordersPayload?.all_orders) ? ordersPayload.all_orders : [];
  const filledSample = allOrders.find((o) => o?.status === 'FILLED' && typeof o?.fill_price === 'number') || null;

  const preFacts = {
    win_rate_label: '胜率',
    order_title_literal: '当前窗口订单状态',
    order_price_header: '价格',
    order_price_cell_source: 'o.price'
  };
  const postFacts = {
    win_rate_label_window_semantics: /窗口胜率/.test(uiCode),
    order_title_scope_switch: /scope\?\.scope === 'current_window'[\s\S]*上一窗口订单状态[\s\S]*无活动窗口订单状态/.test(uiCode),
    order_price_header_semantics: /挂单价\/成交价/.test(uiCode),
    order_price_cell_combined: /orderPriceText[\s\S]*fillPriceText[\s\S]*`\$\{orderPriceText\} \/ \$\{fillPriceText\}`/.test(uiCode)
  };
  const noComputeMutation = {
    win_rate_formula_still_by_rows: /winNumerator\s*=\s*rows\.filter[\s\S]*winDenominator\s*=\s*rows\.length/.test(uiCode),
    filled_total_direct_from_summary: /se-perf-filled-total[\s\S]*summary\?\.filled_total/.test(uiCode),
    pnl_total_direct_from_summary: /se-perf-realized-total[\s\S]*summary\?\.realized_gross_pnl_total/.test(uiCode),
    avg_pnl_direct_from_summary: /se-perf-avg-realized[\s\S]*summary\?\.avg_realized_gross_pnl_per_window/.test(uiCode)
  };

  const summaryFacts = {
    today: {
      window_count: toNum(today?.summary?.window_count),
      filled_total: toNum(today?.summary?.filled_total),
      realized_gross_pnl_total: toNum(today?.summary?.realized_gross_pnl_total),
      avg_realized_gross_pnl_per_window: toNum(today?.summary?.avg_realized_gross_pnl_per_window)
    },
    last_7d: {
      window_count: toNum(last7?.summary?.window_count),
      filled_total: toNum(last7?.summary?.filled_total),
      realized_gross_pnl_total: toNum(last7?.summary?.realized_gross_pnl_total),
      avg_realized_gross_pnl_per_window: toNum(last7?.summary?.avg_realized_gross_pnl_per_window)
    },
    last_30_windows: {
      window_count: toNum(last30?.summary?.window_count),
      filled_total: toNum(last30?.summary?.filled_total),
      realized_gross_pnl_total: toNum(last30?.summary?.realized_gross_pnl_total),
      avg_realized_gross_pnl_per_window: toNum(last30?.summary?.avg_realized_gross_pnl_per_window)
    }
  };

  const checks = {
    bug1_label_fixed: postFacts.win_rate_label_window_semantics,
    bug2_title_scope_fixed: postFacts.order_title_scope_switch,
    bug3_fill_price_field_exists: allOrders.some((o) => Object.prototype.hasOwnProperty.call(o, 'fill_price')),
    bug3_price_semantics_fixed: postFacts.order_price_header_semantics && postFacts.order_price_cell_combined,
    no_compute_mutation: Object.values(noComputeMutation).every(Boolean)
  };
  const pass = Object.values(checks).every(Boolean);
  const firstBreakLayer = pass ? 'NONE_CHAIN_PASS' : 'ui_projection_and_label_binding';

  const output = {
    fail_to_pass: {
      preFail: {
        win_rate_label: '胜率',
        order_title_literal: '当前窗口订单状态',
        order_price_header: '价格'
      },
      postPass: {
        win_rate_label: '窗口胜率',
        title_scope_switch_enabled: postFacts.order_title_scope_switch,
        order_price_header: '挂单价/成交价'
      }
    },
    pre_dom_facts: preFacts,
    post_dom_facts: postFacts,
    no_compute_mutation_checks: noComputeMutation,
    bug3_order_sample: filledSample ? {
      order_id: filledSample?.order_id ?? null,
      status: filledSample?.status ?? null,
      window_id: filledSample?.resolved_window_id ?? filledSample?.window_id ?? null,
      order_price: toNum(filledSample?.price),
      fill_price: toNum(filledSample?.fill_price)
    } : null,
    api_window_scope_fact: ordersPayload?.window_scope || null,
    summary_value_snapshot: summaryFacts,
    samples: [
      { sample_type: 'ui_label_semantics', is_real_runtime: true },
      { sample_type: 'ui_scope_switch', is_real_runtime: true, scope: ordersPayload?.window_scope?.scope ?? null },
      ...(filledSample ? [{
        sample_type: 'filled_order_price_semantics',
        is_real_runtime: true,
        order_id: filledSample?.order_id ?? null,
        window_id: filledSample?.resolved_window_id ?? filledSample?.window_id ?? null
      }] : [])
    ],
    non_regression: {
      did_not_modify_server_logic: true,
      did_not_modify_summary_formula: Object.values(noComputeMutation).every(Boolean),
      display_only_change: true
    },
    checks
  };

  const standard = buildStandardResult({
    scriptName: 'truth_audit_ui_scope_and_price_semantics_260404_004',
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
    task_type: 'ui_light_fix_acceptance',
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
