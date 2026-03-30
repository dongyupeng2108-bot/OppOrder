import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { buildStandardResult, ensureDir, parseVerifyArgs, writeStandardLog } from './verify_standard_v1.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_TASK_ID = '260330_009';

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: 'http://localhost:53173',
  defaultOutputSuffix: 'truth_audit_order_table_ui_slim',
  defaultSampleName: 'order_table_ui_slim_v1'
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
const notContains = (text, token) => !contains(text, token);

const main = () => {
  const args = parseArgs();
  const oldSource = readGitFile('HEAD~1:ui/js/strategy-editor.js');
  const newSource = fs.readFileSync(path.join(REPO_ROOT, 'ui', 'js', 'strategy-editor.js'), 'utf8');
  const payload = {
    window_scope: { scope: 'current_window', display_window_id: 'w-slim' },
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
        resolved_window_id: 'w-slim',
        created_at: '2026-03-30T04:20:04.000Z'
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
        resolved_window_id: 'w-slim',
        created_at: '2026-03-30T04:20:03.000Z'
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
        resolved_window_id: 'w-slim',
        created_at: '2026-03-30T04:20:02.000Z'
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
        resolved_window_id: 'w-slim',
        created_at: '2026-03-30T04:20:01.000Z'
      }
    ]
  };
  const beforeRender = runRenderOrders(oldSource, payload);
  const afterRender = runRenderOrders(newSource, payload);
  const beforeHtml = beforeRender?.table_html || '';
  const afterHtml = afterRender?.table_html || '';

  const checks = {
    '009-A_pre_fix_has_parent_child_fill_en_status_and_close_explainers': contains(beforeHtml, '父单')
      && contains(beforeHtml, '子单(')
      && contains(beforeHtml, 'fill:')
      && (contains(beforeHtml, '>OPEN<') || contains(beforeHtml, '>FILLED<') || contains(beforeHtml, '>CANCELLED<'))
      && (contains(beforeHtml, '等待结算') || contains(beforeHtml, '结算价:') || contains(beforeHtml, 'tp:')),
    '009-B_post_fix_removed_four_weak_text_groups': notContains(afterHtml, '父单')
      && notContains(afterHtml, '子单(')
      && notContains(afterHtml, 'fill:')
      && notContains(afterHtml, '>OPEN<')
      && notContains(afterHtml, '>FILLED<')
      && notContains(afterHtml, '>CANCELLED<')
      && notContains(afterHtml, '等待结算')
      && notContains(afterHtml, '结算价:')
      && notContains(afterHtml, 'tp:'),
    '009-C_post_fix_status_column_chinese_only': contains(afterHtml, '挂单中')
      && contains(afterHtml, '已成交')
      && contains(afterHtml, '已撤单')
      && contains(afterHtml, '已经平仓'),
    '009-D_post_fix_close_price_single_value_only': contains(afterHtml, '<td>1.000</td>')
      && contains(afterHtml, '<td>0.910</td>')
      && notContains(afterHtml, '<div style="font-size:11px;color:#aaa;">'),
    '009-E_non_regression_header_and_main_type_kept': contains(newSource, '<th>订单类型</th><th>UP/DOWN</th><th>价格</th><th>数量</th><th>平仓价</th><th>状态</th>')
      && contains(afterHtml, '>YES</td>')
      && contains(afterHtml, '>NO</td>')
      && contains(afterHtml, '>YES平仓</td>')
      && contains(afterHtml, '>NO平仓</td>')
  };

  const keys = Object.keys(checks);
  const passChecks = keys.filter((k) => checks[k]).length;
  const failChecks = keys.length - passChecks;
  const pass = failChecks === 0;
  const conclusion = pass ? 'A：订单状态表 UI 已完成减噪收口且不回退 260330_007 主口径' : 'C：订单状态表 UI 减噪收口仍有缺口';
  const firstBreakLayer = pass ? null : '展示层（strategy-editor.js）';

  const standard = buildStandardResult({
    scriptName: 'truth_audit_order_table_ui_slim_260330_009',
    taskId: args.taskId,
    sampleName: args.sampleName,
    pass,
    message: pass ? '订单状态表 UI 简化修复通过' : '订单状态表 UI 简化修复失败',
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
