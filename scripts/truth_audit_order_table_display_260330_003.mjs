import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { buildStandardResult, ensureDir, parseVerifyArgs, writeStandardLog } from './verify_standard_v1.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_TASK_ID = '260330_003';

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: 'http://localhost:53169',
  defaultOutputSuffix: 'truth_audit_order_table_display',
  defaultSampleName: 'order_table_display_v1'
});

const extractFunctionSource = (text, fnName) => {
  const start = text.indexOf(`function ${fnName}(`);
  if (start < 0) return null;
  const open = text.indexOf('{', start);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '{') depth += 1;
    if (ch === '}') depth -= 1;
    if (depth === 0) return text.slice(start, i + 1);
  }
  return null;
};

const runRenderOrders = (sourceText, ordersPayload) => {
  const formatFn = extractFunctionSource(sourceText, 'se_formatStateValue');
  const renderFn = extractFunctionSource(sourceText, 'se_renderOrders');
  if (!formatFn || !renderFn) return null;
  const nodes = {
    'se-order-body': { innerHTML: '' },
    'se-order-title': { textContent: '' }
  };
  const sandbox = {
    document: {
      getElementById: (id) => nodes[id] || null
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(`${formatFn}\n${renderFn}\nglobalThis.__run = se_renderOrders;`, sandbox);
  sandbox.__run(ordersPayload, { running: true });
  return {
    table_html: nodes['se-order-body'].innerHTML || '',
    title: nodes['se-order-title'].textContent || ''
  };
};

const readGitFile = (refPath) => {
  const out = spawnSync('git', ['show', refPath], { cwd: REPO_ROOT, encoding: 'utf8' });
  return out.status === 0 ? out.stdout : '';
};

const contains = (text, token) => typeof text === 'string' && text.includes(token);

const main = () => {
  const args = parseArgs();
  const oldSource = readGitFile('HEAD~1:ui/js/strategy-editor.js');
  const newSource = fs.readFileSync(path.join(REPO_ROOT, 'ui', 'js', 'strategy-editor.js'), 'utf8');
  const payload = {
    window_scope: { scope: 'current_window', display_window_id: 'w-demo' },
    window_orders: [
      {
        kind: 'TAKE_PROFIT',
        side: 'NO',
        status: 'OPEN',
        price: 0.9,
        fill_price: null,
        size: 1,
        tp_price: 0.9,
        parent_order_id: 'parent-no-400-abcdef',
        resolved_window_id: 'w-demo',
        created_at: '2026-03-30T01:00:03.000Z'
      },
      {
        kind: 'ENTRY',
        side: 'NO',
        status: 'FILLED',
        price: 0.4,
        fill_price: 0.3,
        size: 1,
        tp_price: 0.9,
        parent_order_id: null,
        resolved_window_id: 'w-demo',
        created_at: '2026-03-30T01:00:02.000Z'
      },
      {
        kind: 'ENTRY',
        side: 'YES',
        status: 'OPEN',
        price: 0.4,
        fill_price: null,
        size: 2,
        tp_price: 0.85,
        parent_order_id: null,
        resolved_window_id: 'w-demo',
        created_at: '2026-03-30T01:00:01.000Z'
      }
    ]
  };
  const beforeRender = runRenderOrders(oldSource, payload);
  const afterRender = runRenderOrders(newSource, payload);
  const beforeHtml = beforeRender?.table_html || '';
  const afterHtml = afterRender?.table_html || '';

  const checks = {
    '003-A_pre_fix_close_price_repeats_tp_value': contains(beforeHtml, '0.900<div style="font-size:11px;color:#aaa;">tp:0.900</div>'),
    '003-B_post_fix_close_price_deduped': contains(afterHtml, '>0.900</td>') && !contains(afterHtml, 'tp:0.900'),
    '003-C_pre_fix_type_uses_raw_take_profit_text': contains(beforeHtml, 'TAKE_PROFIT'),
    '003-D_post_fix_type_full_readable_no_take_profit_truncate': contains(afterHtml, '止盈单') && !contains(afterHtml, 'TAKE_PROFIT'),
    '003-E_post_fix_parent_child_and_lifecycle_clear': contains(afterHtml, '父单') && contains(afterHtml, '子单(') && contains(afterHtml, 'OPEN') && contains(afterHtml, 'FILLED'),
    '003-F_non_regression_260329_007_current_window_filter_not_changed': contains(newSource, "const rowWindowId = item?.resolved_window_id ?? item?.inferred_window_id ?? null;")
      && contains(newSource, "return rowWindowId == null || rowWindowId === scope?.display_window_id;"),
    '003-G_non_regression_260330_001_prob_snapshot_not_changed': contains(newSource, "const scopedContext = orders?.context_snapshot && typeof orders.context_snapshot === 'object'")
      && contains(newSource, "se_renderContext(contextData, status, ordersData);")
  };

  const keys = Object.keys(checks);
  const passChecks = keys.filter((k) => checks[k]).length;
  const failChecks = keys.length - passChecks;
  const pass = failChecks === 0;
  const conclusion = pass ? 'A：当前窗口订单状态表展示口径已收口' : 'C：当前窗口订单状态表展示口径未完全收口';
  const firstBreakLayer = pass ? null : '展示层（strategy-editor.js）';

  const standard = buildStandardResult({
    scriptName: 'truth_audit_order_table_display_260330_003',
    taskId: args.taskId,
    sampleName: args.sampleName,
    pass,
    message: pass ? '订单状态表展示口径修复通过' : '订单状态表展示口径修复失败',
    firstBreakLayer,
    evidenceFile: args.output,
    summary: {
      conclusion,
      total_checks: keys.length,
      pass_checks: passChecks,
      fail_checks: failChecks,
      checks
    },
    rawExcerpt: {
      before_html_excerpt: beforeHtml.slice(0, 1200),
      after_html_excerpt: afterHtml.slice(0, 1200)
    }
  });

  const output = {
    ...standard,
    task_id: args.taskId,
    conclusion_block: {
      verdict: conclusion,
      first_break_layer: firstBreakLayer
    },
    key_counters: {
      total_checks: keys.length,
      pass_checks: passChecks,
      fail_checks: failChecks
    },
    evidence_index: {
      before_render: beforeRender,
      after_render: afterRender
    },
    result: checks
  };

  ensureDir(args.output);
  fs.writeFileSync(args.output, JSON.stringify(output, null, 2));
  const logPath = writeStandardLog(args.output, standard);
  console.log(`VERIFY_OUTPUT=${args.output}`);
  console.log(`VERIFY_LOG=${logPath}`);
  console.log(JSON.stringify({ pass, conclusion, pass_checks: passChecks, fail_checks: failChecks }));
  if (!pass) process.exitCode = 1;
};

main();
