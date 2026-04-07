import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildStandardResult, ensureDir, parseVerifyArgs, writeStandardLog } from './verify_standard_v1.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_TASK_ID = '260406_025';
const DEFAULT_BASE_URL = 'http://localhost:53123';

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: DEFAULT_BASE_URL,
  defaultOutputSuffix: 'truth_audit_t2_fix_feedback_state_260406_025',
  defaultSampleName: 't2_fix_feedback_state'
});

const main = async () => {
  const args = parseArgs();
  const uiFile = fs.readFileSync(path.join(REPO_ROOT, 'ui', 'js', 'strategy-editor.js'), 'utf8');
  const latest = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'rules', 'LATEST.json'), 'utf8'));

  const checks = {
    has_param_save_state_machine: /let _seParamSaveState = 'idle'/.test(uiFile),
    has_dynamic_effective_hint_renderer: /function se_renderParamEffectiveHint\(\)/.test(uiFile),
    failure_hint_has_unsaved_text: /最近一次保存失败：参数未保存，当前运行继续沿用旧配置/.test(uiFile),
    success_hint_kept_separate: /参数已保存：将在下一轮启动时生效/.test(uiFile),
    save_failed_path_updates_state: /_seParamSaveState = 'failed'[\s\S]*se_renderParamEffectiveHint\(\)/.test(uiFile),
    saved_active_failure_specific_text: /最近一次保存失败：saved 未更新/.test(uiFile),
    latest_points_to_260406_025: latest.task_id === args.taskId,
    governance_substitute_pass: false
  };
  checks.governance_substitute_pass = Object.entries(checks)
    .filter(([k]) => k !== 'governance_substitute_pass')
    .every(([, v]) => Boolean(v));

  const pass = checks.governance_substitute_pass;
  const firstBreakLayer = pass ? 'NONE_CHAIN_PASS' : 't2_fix_feedback_state';
  const standard = buildStandardResult({
    scriptName: 'truth_audit_t2_fix_feedback_state_260406_025',
    taskId: args.taskId,
    sampleName: args.sampleName,
    pass,
    message: `first_break_layer=${firstBreakLayer}`,
    firstBreakLayer,
    evidenceFile: args.output,
    summary: { pass, first_break_layer: firstBreakLayer, checks },
    rawExcerpt: {
      fail_to_pass: {
        before: 'save_feedback_semantic_conflict_present',
        after: pass ? 'save_feedback_semantic_conflict_fixed' : 'save_feedback_semantic_conflict_not_fixed'
      },
      checks
    }
  });

  ensureDir(args.output);
  const outputJson = { ...standard, task_id: args.taskId, task_type: 'business_implementation', checks };
  fs.writeFileSync(args.output, JSON.stringify(outputJson, null, 2));
  const verifyLog = writeStandardLog(args.output, standard);
  console.log(`VERIFY_OUTPUT=${args.output}`);
  console.log(`VERIFY_LOG=${verifyLog}`);
  console.log(JSON.stringify({ pass, first_break_layer: firstBreakLayer, checks }));
  if (!pass) process.exitCode = 1;
};

main().catch((error) => {
  console.error(error?.message || String(error));
  process.exit(1);
});
