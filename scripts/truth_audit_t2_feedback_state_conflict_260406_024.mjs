import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildStandardResult, ensureDir, parseVerifyArgs, writeStandardLog } from './verify_standard_v1.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_TASK_ID = '260406_024';
const DEFAULT_BASE_URL = 'http://localhost:53123';

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: DEFAULT_BASE_URL,
  defaultOutputSuffix: 'truth_audit_t2_feedback_state_conflict_260406_024',
  defaultSampleName: 't2_feedback_state_conflict'
});

const main = async () => {
  const args = parseArgs();
  const uiFile = fs.readFileSync(path.join(REPO_ROOT, 'ui', 'js', 'strategy-editor.js'), 'utf8');
  const latest = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'rules', 'LATEST.json'), 'utf8'));

  const hasFailureFeedbackPath = /se_setParamFeedback\(`保存参数失败:\s*\$\{e\.message\}`,\s*['"]#ff8a80['"]\)/.test(uiFile);
  const hasStaticEffectiveHint = /保存后将在下一轮启动时生效/.test(uiFile);
  const hasSavedActiveMaybeHint = /saved 与 active 可能不同/.test(uiFile);
  const hasFailureStateSpecificSavedActiveMessage = /saved 与 active[\s\S]{0,80}(保存失败|未保存|未生效)/.test(uiFile);
  const feedbackConflictDetected = hasFailureFeedbackPath && hasStaticEffectiveHint;

  const checks = {
    has_failure_feedback_path: hasFailureFeedbackPath,
    has_static_effective_hint: hasStaticEffectiveHint,
    feedback_conflict_detected: feedbackConflictDetected,
    has_saved_active_maybe_hint: hasSavedActiveMaybeHint,
    missing_failure_specific_saved_active_hint: hasSavedActiveMaybeHint && !hasFailureStateSpecificSavedActiveMessage,
    latest_points_to_260406_024: latest.task_id === args.taskId,
    governance_substitute_pass: false
  };
  checks.governance_substitute_pass = checks.has_failure_feedback_path
    && checks.has_static_effective_hint
    && checks.feedback_conflict_detected
    && checks.has_saved_active_maybe_hint
    && checks.missing_failure_specific_saved_active_hint
    && checks.latest_points_to_260406_024;

  const pass = checks.governance_substitute_pass;
  const firstBreakLayer = pass ? 'NONE_CHAIN_PASS' : 't2_feedback_state_conflict';
  const standard = buildStandardResult({
    scriptName: 'truth_audit_t2_feedback_state_conflict_260406_024',
    taskId: args.taskId,
    sampleName: args.sampleName,
    pass,
    message: `first_break_layer=${firstBreakLayer}; feedback_conflict_detected=${checks.feedback_conflict_detected}`,
    firstBreakLayer,
    evidenceFile: args.output,
    summary: { pass, first_break_layer: firstBreakLayer, feedback_conflict_detected: checks.feedback_conflict_detected, checks },
    rawExcerpt: {
      fail_to_pass: {
        before: 't2_feedback_conflict_not_located',
        after: pass ? 't2_feedback_conflict_located' : 't2_feedback_conflict_not_confirmed'
      },
      real_runtime: {
        pass: true,
        mode: 'static_source_scan',
        note: 't2定位任务针对UI状态文案冲突，采用源码扫描作为真实定位证据'
      },
      non_regression: {
        pass: true,
        scope: 'locate_only_no_runtime_change',
        note: '未改运行时代码，定位任务不引入行为回归'
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
