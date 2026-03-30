import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { buildStandardResult, ensureDir, parseVerifyArgs, writeStandardLog } from './verify_standard_v1.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_TASK_ID = '260330_007';

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: 'http://localhost:53172',
  defaultOutputSuffix: 'truth_audit_order_table_owner_header',
  defaultSampleName: 'order_table_owner_header_v1'
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
    window_scope: { scope: 'current_window', display_window_id: 'w-owner' },
    window_orders: [
      {
        kind: 'TAKE_PROFIT',
        side: 'NO',
        status: 'CANCELLED',
        price: 0.91,
        fill_price: null,
        size: 1,
        tp_price: 0.91,
        parent_order_id: 'parent-no-cancel-abc',
        resolved_window_id: 'w-owner',
        created_at: '2026-03-30T03:20:04.000Z'
      },
      {
        kind: 'TAKE_PROFIT',
        side: 'YES',
        status: 'FILLED',
        price: 0.88,
        fill_price: 0.88,
        size: 2,
        tp_price: 1,
        parent_order_id: 'parent-yes-fill-xyz',
        resolved_window_id: 'w-owner',
        created_at: '2026-03-30T03:20:03.000Z'
      },
      {
        kind: 'ENTRY',
        side: 'NO',
        status: 'FILLED',
        price: 0.35,
        fill_price: 0.35,
        size: 3,
        tp_price: 0.82,
        parent_order_id: null,
        resolved_window_id: 'w-owner',
        created_at: '2026-03-30T03:20:02.000Z'
      },
      {
        kind: 'ENTRY',
        side: 'YES',
        status: 'OPEN',
        price: 0.42,
        fill_price: null,
        size: 4,
        tp_price: 0.84,
        parent_order_id: null,
        resolved_window_id: 'w-owner',
        created_at: '2026-03-30T03:20:01.000Z'
      }
    ]
  };
  const beforeRender = runRenderOrders(oldSource, payload);
  const afterRender = runRenderOrders(newSource, payload);
  const beforeHtml = beforeRender?.table_html || '';
  const afterHtml = afterRender?.table_html || '';

  const checks = {
    '007-A_pre_fix_header_not_owner_schema': contains(oldSource, '<th>类型</th><th>方向</th><th>价格</th><th>状态</th><th>数量</th><th>平仓价</th>'),
    '007-B_post_fix_header_owner_schema_exact': contains(newSource, '<th>订单类型</th><th>UP/DOWN</th><th>价格</th><th>数量</th><th>平仓价</th><th>状态</th>'),
    '007-C_post_fix_four_owner_types_visible': contains(afterHtml, 'YES<div') && contains(afterHtml, 'NO<div') && contains(afterHtml, 'YES平仓<div') && contains(afterHtml, 'NO平仓<div'),
    '007-D_post_fix_status_cn_all_visible': contains(afterHtml, '挂单中') && contains(afterHtml, '已成交') && contains(afterHtml, '已撤单') && contains(afterHtml, '已经平仓'),
    '007-E_post_fix_updown_mapping_visible': contains(afterHtml, '>UP</td>') && contains(afterHtml, '>DOWN</td>'),
    '007-F_non_regression_close_price_dedupe_kept': !contains(afterHtml, 'tp:0.910') && contains(afterHtml, '>0.910</td>'),
    '007-G_field_sufficiency_kind_side_stable': contains(newSource, "const isCloseOrder = o.kind === 'TAKE_PROFIT' || o.kind === 'EXIT';")
      && contains(newSource, "o.side === 'YES' ? 'YES平仓'")
      && contains(newSource, "o.side === 'NO' ? 'NO平仓'")
  };

  const keys = Object.keys(checks);
  const passChecks = keys.filter((k) => checks[k]).length;
  const failChecks = keys.length - passChecks;
  const pass = failChecks === 0;
  const conclusion = pass ? 'A：订单状态表主展示口径已按 Owner 方案收口' : 'C：订单状态表主展示口径未完全收口';
  const firstBreakLayer = pass ? null : '展示层（strategy-editor.js）';

  const standard = buildStandardResult({
    scriptName: 'truth_audit_order_table_owner_header_260330_007',
    taskId: args.taskId,
    sampleName: args.sampleName,
    pass,
    message: pass ? '订单状态表 Owner 表头与语义修复通过' : '订单状态表 Owner 表头与语义修复失败',
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
