import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { buildStandardResult, ensureDir, parseVerifyArgs, writeStandardLog } from './verify_standard_v1.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_TASK_ID = '260329_002';

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: 'http://localhost:53131',
  defaultOutputSuffix: 'truth_audit_window_display_label',
  defaultSampleName: 'pm_window_display_name_with_debug_fallback_v1'
});

const extractFunctionSource = (text, fnName) => {
  const start = text.indexOf(`function ${fnName}(`);
  if (start < 0) return null;
  let idx = text.indexOf('{', start);
  if (idx < 0) return null;
  let depth = 0;
  for (let i = idx; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '{') depth += 1;
    if (ch === '}') depth -= 1;
    if (depth === 0) return text.slice(start, i + 1);
  }
  return null;
};

const getPreFixFact = () => {
  const out = spawnSync('git', ['show', 'HEAD~1:ui/js/strategy-editor.js'], { cwd: REPO_ROOT, encoding: 'utf8' });
  const text = out.status === 0 ? out.stdout : '';
  const rawLine = "se_setText('se-log-current-window', postmortem?.window_id || lastRun?.current_window_id);";
  return {
    git_show_ok: out.status === 0,
    raw_assignment_present: text.includes(rawLine),
    raw_assignment_line: rawLine
  };
};

const main = async () => {
  const args = parseArgs();
  const uiPath = path.join(REPO_ROOT, 'ui', 'js', 'strategy-editor.js');
  const uiText = fs.readFileSync(uiPath, 'utf8');
  const fnSource = extractFunctionSource(uiText, 'se_formatWindowDisplayName');
  if (!fnSource) throw new Error('se_formatWindowDisplayName not found');
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(`${fnSource}; globalThis.fn = se_formatWindowDisplayName;`, sandbox);
  const formatWindow = sandbox.fn;
  if (typeof formatWindow !== 'function') throw new Error('window formatter not executable');

  const realWindowId = 'btc-updown-5m-1774796100';
  const debugWindowId = 'debug-fill-yes-path-v1-w1';
  const realLabel = formatWindow(realWindowId);
  const debugLabel = formatWindow(debugWindowId);
  const preFix = getPreFixFact();
  const postFixAssignment = "se_setText('se-log-current-window', se_formatWindowDisplayName(postmortem?.window_id || lastRun?.current_window_id));";

  const checks = {
    '002-A_prefix_line_was_raw_window_id': preFix.raw_assignment_present === true,
    '002-B_real_pm_window_formats_to_et_label': typeof realLabel === 'string' && realLabel.includes('ET') && realLabel.includes(', ') && realLabel.includes('-'),
    '002-C_debug_window_keeps_raw_name': debugLabel === debugWindowId,
    '002-D_current_window_ui_uses_display_name': uiText.includes(postFixAssignment)
  };
  const checkKeys = Object.keys(checks);
  const passChecks = checkKeys.filter((k) => checks[k]).length;
  const failChecks = checkKeys.length - passChecks;
  const pass = failChecks === 0;
  const conclusion = pass ? 'A：当前窗口展示已切换为PM标签优先并保留debug回退' : 'C：存在业务语义断裂';
  const firstBreakLayer = pass ? null : 'C 当前窗口展示映射层';

  const standard = buildStandardResult({
    scriptName: 'truth_audit_window_display_label_260329_002',
    taskId: args.taskId,
    sampleName: args.sampleName,
    pass,
    message: pass ? '窗口展示口径修复通过' : '窗口展示口径修复失败',
    firstBreakLayer,
    evidenceFile: args.output,
    summary: {
      conclusion,
      total_checks: checkKeys.length,
      pass_checks: passChecks,
      fail_checks: failChecks,
      checks
    },
    rawExcerpt: {
      pre_fix_raw_line: preFix.raw_assignment_line,
      real_window_id: realWindowId,
      real_window_label: realLabel,
      debug_window_id: debugWindowId,
      debug_window_label: debugLabel
    }
  });

  const output = {
    ...standard,
    task_id: args.taskId,
    command: `node scripts/truth_audit_window_display_label_260329_002.mjs --task_id=${args.taskId} --sample=${args.sampleName}`,
    conclusion_block: {
      verdict: conclusion,
      first_break_layer: firstBreakLayer
    },
    key_counters: {
      total_checks: checkKeys.length,
      pass_checks: passChecks,
      fail_checks: failChecks
    },
    evidence_index: {
      pre_fix_fact: preFix,
      post_fix_fact: {
        display_assignment: postFixAssignment,
        display_assignment_present: uiText.includes(postFixAssignment),
        formatter_source_present: Boolean(fnSource)
      },
      samples: {
        real_window_id: realWindowId,
        real_window_label: realLabel,
        debug_window_id: debugWindowId,
        debug_window_label: debugLabel
      }
    },
    result: checks
  };

  ensureDir(args.output);
  fs.writeFileSync(args.output, JSON.stringify(output, null, 2));
  const logPath = writeStandardLog(args.output, standard);
  console.log(`VERIFY_OUTPUT=${args.output}`);
  console.log(`VERIFY_LOG=${logPath}`);
  console.log(JSON.stringify({ pass, conclusion, first_break_layer: firstBreakLayer, pass_checks: passChecks, fail_checks: failChecks }));
  if (!pass) process.exitCode = 1;
};

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
