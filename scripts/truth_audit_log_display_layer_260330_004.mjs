import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { buildStandardResult, ensureDir, parseVerifyArgs, writeStandardLog } from './verify_standard_v1.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_TASK_ID = '260330_004';

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: 'http://localhost:53170',
  defaultOutputSuffix: 'truth_audit_log_display_layer',
  defaultSampleName: 'log_display_layer_v1'
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

const buildFakeElement = () => ({
  _innerHTML: '',
  children: [],
  style: {},
  textContent: '',
  scrollTop: 0,
  scrollHeight: 0,
  get innerHTML() {
    return this._innerHTML;
  },
  set innerHTML(v) {
    this._innerHTML = String(v || '');
    this.children = [];
  },
  appendChild(node) {
    this.children.push(node);
    this._innerHTML += `${this._innerHTML ? '' : ''}<div class="${node.className || ''}">${node.textContent || ''}</div>`;
    this.scrollHeight = this.children.length;
  },
  removeChild() {
    this.children.shift();
    this.scrollHeight = this.children.length;
  },
  get firstChild() {
    return this.children[0] || null;
  }
});

const runRenderWithSource = (sourceText, logs, switchRaw = false) => {
  const fnNames = [
    'se_logEventLabel',
    'se_logLevelLabel',
    'se_hasLatinWord',
    'se_translateLogDetail',
    'se_logReasonToken',
    'se_isNoiseLog',
    'se_buildStateSentence',
    'se_isKeyLog',
    'se_refreshLogViewModeUI',
    'se_renderLogAreaByMode',
    'se_setLogViewMode',
    'se_renderLogs'
  ];
  const blocks = fnNames.map((name) => extractFunctionSource(sourceText, name)).filter(Boolean).join('\n');
  if (!blocks.includes('function se_renderLogs(')) return null;
  const elements = {
    'se-log-area': buildFakeElement(),
    'se-log-view-key': buildFakeElement(),
    'se-log-view-raw': buildFakeElement(),
    'se-log-view-hint': buildFakeElement()
  };
  const sandbox = {
    _seLastLogTs: '',
    _seErrorCount: 0,
    _se_running: false,
    _seLogViewMode: 'key',
    _seLogEntriesRaw: [],
    _seLogEntriesKey: [],
    _seLogNoiseSuppressed: 0,
    se_stopBot: () => {},
    alert: () => {},
    document: {
      getElementById: (id) => elements[id] || null,
      createElement: () => ({ className: '', textContent: '' })
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(`${blocks}\nglobalThis.__render = se_renderLogs;globalThis.__setMode = typeof se_setLogViewMode==='function'?se_setLogViewMode:null;`, sandbox);
  sandbox.__render(logs);
  const keyHtml = elements['se-log-area'].innerHTML || '';
  const keyHint = elements['se-log-view-hint'].textContent || '';
  let rawHtml = '';
  let rawHint = '';
  if (switchRaw && typeof sandbox.__setMode === 'function') {
    sandbox.__setMode('raw');
    rawHtml = elements['se-log-area'].innerHTML || '';
    rawHint = elements['se-log-view-hint'].textContent || '';
  }
  return { keyHtml, keyHint, rawHtml, rawHint };
};

const main = () => {
  const args = parseArgs();
  const oldSource = spawnSync('git', ['show', 'HEAD~1:ui/js/strategy-editor.js'], { cwd: REPO_ROOT, encoding: 'utf8' }).stdout || '';
  const newSource = fs.readFileSync(path.join(REPO_ROOT, 'ui', 'js', 'strategy-editor.js'), 'utf8');
  const logs = [
    { ts: '2026-03-30T02:00:01.000Z', level: 'info', event: 'RUNNER_TICK', message: 'tick price_or_bounds_null', data: { reason: 'price_or_bounds_null', intents_summary: 'NOOP' } },
    { ts: '2026-03-30T02:00:02.000Z', level: 'info', event: 'BOT_TICK_OK', message: 'scheduled tick ok', data: { reason: 'scheduled_tick_ok', intents_summary: 'NOOP' } },
    { ts: '2026-03-30T02:00:03.000Z', level: 'info', event: 'BOT_WINDOW_INITIALIZED', message: 'window initialized', data: {} },
    { ts: '2026-03-30T02:00:04.000Z', level: 'info', event: 'BOT_ORDER_APPLY', message: 'PLACE_LADDER(BOTH)', data: { intents_summary: 'PLACE_LADDER(BOTH)' } },
    { ts: '2026-03-30T02:00:05.000Z', level: 'info', event: 'BOT_FILL', message: 'filled 1 orders', data: { fills: [{ side: 'NO', order_id: 'x1' }] } }
  ];
  const before = runRenderWithSource(oldSource, logs, false);
  const after = runRenderWithSource(newSource, logs, true);
  if (!before || !after) throw new Error('log render function parse failed');

  const checks = {
    '004-A_pre_fix_noise_spam_in_default_view': before.keyHtml.includes('周期检查正常') && before.keyHtml.includes('tick 价格或边界未就绪') && before.keyHtml.includes('scheduled tick ok'),
    '004-B_post_fix_default_is_key_stream': !after.keyHtml.includes('scheduled tick ok') && !after.keyHtml.includes('price_or_bounds_null') && after.keyHtml.includes('已挂 UP 2 单 / DOWN 2 单'),
    '004-C_post_fix_raw_log_second_layer_available': after.rawHtml.includes('scheduled tick ok') && after.rawHtml.includes('price_or_bounds_null') && after.rawHint.includes('原始日志'),
    '004-D_post_fix_state_sentence_examples_present': after.keyHtml.includes('进入新窗口，开始等待 open_delay') && after.keyHtml.includes('已挂 UP 2 单 / DOWN 2 单') && after.keyHtml.includes('NO 方向 1 单成交'),
    '004-E_scope_not_touch_execution_chain': !newSource.includes('function decideBotAction') && !newSource.includes('applyIntents('),
    '004-F_scope_not_touch_module_test_runner': !newSource.includes('verify_module1_strategy_input')
  };

  const keys = Object.keys(checks);
  const passChecks = keys.filter((k) => checks[k]).length;
  const failChecks = keys.length - passChecks;
  const pass = failChecks === 0;
  const conclusion = pass ? 'A：实时日志默认口径已收口为关键信息流' : 'C：实时日志展示口径未完全收口';
  const firstBreakLayer = pass ? null : '展示层（strategy-editor.js）';

  const standard = buildStandardResult({
    scriptName: 'truth_audit_log_display_layer_260330_004',
    taskId: args.taskId,
    sampleName: args.sampleName,
    pass,
    message: pass ? '实时日志展示层重构通过' : '实时日志展示层重构失败',
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
      before_default_excerpt: before.keyHtml.slice(0, 1200),
      after_key_excerpt: after.keyHtml.slice(0, 1200),
      after_raw_excerpt: after.rawHtml.slice(0, 1200)
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
      before_render: before,
      after_render: after
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
