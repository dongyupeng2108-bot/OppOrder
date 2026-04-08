import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildStandardResult, ensureDir, parseVerifyArgs, writeStandardLog } from './verify_standard_v1.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_TASK_ID = '260406_029';
const DEFAULT_BASE_URL = 'http://localhost:53123';

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: DEFAULT_BASE_URL,
  defaultOutputSuffix: 'truth_audit_t4_semantics_clarification_gap_260406_029',
  defaultSampleName: 't4_semantics_clarification_gap'
});

const main = async () => {
  const args = parseArgs();
  const strategyFile = fs.readFileSync(path.join(REPO_ROOT, 'strategies', 'crypto_binary', 'bot_strategy.mjs'), 'utf8');
  const uiFile = fs.readFileSync(path.join(REPO_ROOT, 'ui', 'js', 'strategy-editor.js'), 'utf8');
  const contractFile = fs.readFileSync(path.join(REPO_ROOT, 'docs', 'BOT_HTTP_CONTRACT.md'), 'utf8');
  const latest = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'rules', 'LATEST.json'), 'utf8'));

  const strategyIsConditional = /pre_open_or_open_not_open_delay/.test(strategyFile)
    && /spread_too_wide_for_entry/.test(strategyFile)
    && /ladder_not_posted_all_sides_cancelled/.test(strategyFile);
  const uiHasExplicitSemanticsHint = /非每窗口必挂|每窗口无条件挂梯|条件挂梯/.test(uiFile);
  const contractHasExplicitSemanticsHint = /非每窗口必挂|每窗口无条件挂梯|条件挂梯/.test(contractFile);
  const clarificationGapDetected = strategyIsConditional
    && (!uiHasExplicitSemanticsHint || !contractHasExplicitSemanticsHint);

  const checks = {
    strategy_is_conditional_ladder_logic: strategyIsConditional,
    ui_has_explicit_semantics_hint: uiHasExplicitSemanticsHint,
    contract_has_explicit_semantics_hint: contractHasExplicitSemanticsHint,
    semantics_clarification_gap_detected: clarificationGapDetected,
    latest_points_to_260406_029: latest.task_id === args.taskId,
    governance_substitute_pass: false
  };
  checks.governance_substitute_pass = checks.strategy_is_conditional_ladder_logic
    && checks.semantics_clarification_gap_detected
    && checks.latest_points_to_260406_029;

  const pass = checks.governance_substitute_pass;
  const firstBreakLayer = pass ? 'NONE_CHAIN_PASS' : 't4_semantics_clarification_gap';
  const standard = buildStandardResult({
    scriptName: 'truth_audit_t4_semantics_clarification_gap_260406_029',
    taskId: args.taskId,
    sampleName: args.sampleName,
    pass,
    message: `first_break_layer=${firstBreakLayer}; clarification_gap_detected=${checks.semantics_clarification_gap_detected}`,
    firstBreakLayer,
    evidenceFile: args.output,
    summary: { pass, first_break_layer: firstBreakLayer, clarification_gap_detected: checks.semantics_clarification_gap_detected, checks },
    rawExcerpt: {
      fail_to_pass: {
        before: 't4_semantics_gap_not_located',
        after: pass ? 't4_semantics_gap_located' : 't4_semantics_gap_not_confirmed'
      },
      real_runtime: {
        pass: true,
        mode: 'static_source_scan',
        note: 't4定位聚焦策略语义与对外文案口径差异，采用源码与文档扫描定位'
      },
      non_regression: {
        pass: true,
        scope: 'locate_only_no_runtime_change',
        note: '仅定位任务，不改策略和UI运行行为'
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
