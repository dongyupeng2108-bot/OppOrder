import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { buildStandardResult, ensureDir, parseVerifyArgs, writeStandardLog } from './verify_standard_v1.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_TASK_ID = '260330_005';

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: 'http://localhost:53171',
  defaultOutputSuffix: 'truth_audit_key_log_actions',
  defaultSampleName: 'key_log_actions_v1'
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

const createEl = () => ({
  textContent: '',
  children: [],
  style: {},
  _innerHTML: '',
  scrollTop: 0,
  scrollHeight: 0,
  get innerHTML() { return this._innerHTML; },
  set innerHTML(v) { this._innerHTML = String(v || ''); this.children = []; },
  appendChild(node) {
    this.children.push(node);
    this._innerHTML += `<div class="${node.className || ''}">${node.textContent || ''}</div>`;
    this.scrollHeight = this.children.length;
  },
  removeChild() { this.children.shift(); this.scrollHeight = this.children.length; },
  get firstChild() { return this.children[0] || null; }
});

const runView = (sourceText, logs, switchRaw = false) => {
  const needed = [
    'se_logEventLabel',
    'se_logLevelLabel',
    'se_hasLatinWord',
    'se_translateLogDetail',
    'se_logReasonToken',
    'se_isNoiseLog',
    'se_logIntentsToken',
    'se_buildStateSentence',
    'se_isKeyLog',
    'se_refreshLogViewModeUI',
    'se_renderLogAreaByMode',
    'se_setLogViewMode',
    'se_renderLogs'
  ];
  const code = needed.map((f) => extractFunctionSource(sourceText, f)).filter(Boolean).join('\n');
  if (!code.includes('function se_renderLogs(')) return null;
  const els = {
    'se-log-area': createEl(),
    'se-log-view-key': createEl(),
    'se-log-view-raw': createEl(),
    'se-log-view-hint': createEl()
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
      getElementById: (id) => els[id] || null,
      createElement: () => ({ className: '', textContent: '' })
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(`${code}\nglobalThis.__render=se_renderLogs;globalThis.__mode=(typeof se_setLogViewMode==='function'?se_setLogViewMode:null);`, sandbox);
  sandbox.__render(logs);
  const keyHtml = els['se-log-area'].innerHTML || '';
  const keyHint = els['se-log-view-hint'].textContent || '';
  let rawHtml = '';
  let rawHint = '';
  if (switchRaw && typeof sandbox.__mode === 'function') {
    sandbox.__mode('raw');
    rawHtml = els['se-log-area'].innerHTML || '';
    rawHint = els['se-log-view-hint'].textContent || '';
  }
  return { keyHtml, keyHint, rawHtml, rawHint };
};

const main = () => {
  const args = parseArgs();
  const oldSource = spawnSync('git', ['show', 'HEAD~1:ui/js/strategy-editor.js'], { cwd: REPO_ROOT, encoding: 'utf8' }).stdout || '';
  const newSource = fs.readFileSync(path.join(REPO_ROOT, 'ui', 'js', 'strategy-editor.js'), 'utf8');
  const logs = [
    { ts: '2026-03-30T03:00:01.000Z', level: 'info', event: 'BOT_INTENTS', message: 'PLACE_LADDER(BOTH)', data: { intents_summary: 'PLACE_LADDER(BOTH)', reason: 'ladder_not_posted' } },
    { ts: '2026-03-30T03:00:02.000Z', level: 'info', event: 'BOT_FILL', message: 'filled 1 orders', data: { fills: [{ side: 'NO' }] } },
    { ts: '2026-03-30T03:00:03.000Z', level: 'info', event: 'BOT_INTENTS', message: 'CANCEL_OPEN(NO)', data: { intents_summary: 'CANCEL_OPEN(NO)', reason: 'down_cancel_before_end' } },
    { ts: '2026-03-30T03:00:04.000Z', level: 'info', event: 'BOT_TICK_OK', message: 'scheduled tick ok', data: { reason: 'scheduled_tick_ok', intents_summary: 'NOOP' } },
    { ts: '2026-03-30T03:00:05.000Z', level: 'info', event: 'RUNNER_TICK', message: 'tick price_or_bounds_null', data: { reason: 'price_or_bounds_null', intents_summary: 'NOOP' } }
  ];
  const before = runView(oldSource, logs, false);
  const after = runView(newSource, logs, true);
  if (!before || !after) throw new Error('parse log functions failed');

  const checks = {
    '005-A_pre_fix_place_action_missing_in_default_key_stream': !before.keyHtml.includes('挂单完成') && !before.keyHtml.includes('已挂 UP 2 单 / DOWN 2 单'),
    '005-B_post_fix_place_action_back_in_default_key_stream': after.keyHtml.includes('挂单完成：UP 与 DOWN 已提交') || after.keyHtml.includes('已挂 UP 2 单 / DOWN 2 单'),
    '005-C_post_fix_fill_and_cancel_still_in_key_stream': after.keyHtml.includes('NO 方向 1 单成交') && (after.keyHtml.includes('DOWN 到时撤单（60秒）') || after.keyHtml.includes('DOWN 方向撤单已提交')),
    '005-D_post_fix_noise_events_still_second_layer_only': !after.keyHtml.includes('scheduled tick ok') && !after.keyHtml.includes('price_or_bounds_null') && after.rawHtml.includes('scheduled tick ok') && after.rawHtml.includes('price_or_bounds_null'),
    '005-E_scope_no_execution_chain_change': !newSource.includes('applyIntents(') && !newSource.includes('decideBotAction(')
  };
  const keys = Object.keys(checks);
  const passChecks = keys.filter((k) => checks[k]).length;
  const failChecks = keys.length - passChecks;
  const pass = failChecks === 0;
  const conclusion = pass ? 'A：挂单完成已回到默认关键信息流，且噪声仍受控' : 'C：关键日志映射仍存在缺口';

  const standard = buildStandardResult({
    scriptName: 'truth_audit_key_log_actions_260330_005',
    taskId: args.taskId,
    sampleName: args.sampleName,
    pass,
    message: pass ? '关键日志映射修复通过' : '关键日志映射修复失败',
    firstBreakLayer: pass ? null : '展示层（strategy-editor.js）',
    evidenceFile: args.output,
    summary: { conclusion, total_checks: keys.length, pass_checks: passChecks, fail_checks: failChecks, checks },
    rawExcerpt: {
      before_key_excerpt: before.keyHtml.slice(0, 1200),
      after_key_excerpt: after.keyHtml.slice(0, 1200),
      after_raw_excerpt: after.rawHtml.slice(0, 1200)
    }
  });

  const output = {
    ...standard,
    task_id: args.taskId,
    conclusion_block: {
      verdict: conclusion,
      first_break_layer: pass ? null : '展示层（strategy-editor.js）'
    },
    key_counters: {
      total_checks: keys.length,
      pass_checks: passChecks,
      fail_checks: failChecks
    },
    evidence_index: { before_render: before, after_render: after },
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
