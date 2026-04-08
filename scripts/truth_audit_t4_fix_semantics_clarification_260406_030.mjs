import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildStandardResult, ensureDir, parseVerifyArgs, writeStandardLog } from './verify_standard_v1.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_TASK_ID = '260406_030';
const DEFAULT_BASE_URL = 'http://localhost:53123';

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: DEFAULT_BASE_URL,
  defaultOutputSuffix: 'truth_audit_t4_fix_semantics_clarification_260406_030',
  defaultSampleName: 't4_fix_semantics_clarification'
});

const main = async () => {
  const args = parseArgs();
  const uiFile = fs.readFileSync(path.join(REPO_ROOT, 'ui', 'js', 'strategy-editor.js'), 'utf8');
  const contractFile = fs.readFileSync(path.join(REPO_ROOT, 'docs', 'BOT_HTTP_CONTRACT.md'), 'utf8');
  const latest = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'rules', 'LATEST.json'), 'utf8'));

  const checks = {
    ui_has_conditional_ladder_clarification: /条件挂梯/.test(uiFile) && /每窗口无条件挂梯/.test(uiFile),
    contract_has_semantics_section: /## 挂梯语义澄清/.test(contractFile),
    contract_mentions_open_delay_reason: /pre_open_or_open_not_open_delay/.test(contractFile),
    contract_mentions_spread_guard_reason: /spread_too_wide_for_entry/.test(contractFile),
    contract_mentions_cancelled_reason: /ladder_not_posted_all_sides_cancelled/.test(contractFile),
    contract_has_window_event_diagnosis_suggestion: /\/bot\/logs\?event=RUNNER_TICK&window_id=<id>/.test(contractFile),
    latest_points_to_260406_030: latest.task_id === args.taskId,
    governance_substitute_pass: false
  };
  checks.governance_substitute_pass = Object.entries(checks)
    .filter(([k]) => k !== 'governance_substitute_pass')
    .every(([, v]) => Boolean(v));

  const pass = checks.governance_substitute_pass;
  const firstBreakLayer = pass ? 'NONE_CHAIN_PASS' : 't4_fix_semantics_clarification';
  const standard = buildStandardResult({
    scriptName: 'truth_audit_t4_fix_semantics_clarification_260406_030',
    taskId: args.taskId,
    sampleName: args.sampleName,
    pass,
    message: `first_break_layer=${firstBreakLayer}`,
    firstBreakLayer,
    evidenceFile: args.output,
    summary: { pass, first_break_layer: firstBreakLayer, checks },
    rawExcerpt: {
      fail_to_pass: {
        before: 't4_semantics_clarification_gap_present',
        after: pass ? 't4_semantics_clarification_gap_fixed' : 't4_semantics_clarification_gap_not_fixed'
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
