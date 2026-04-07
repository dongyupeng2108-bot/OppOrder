import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildStandardResult, ensureDir, parseVerifyArgs, writeStandardLog } from './verify_standard_v1.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_TASK_ID = '260406_027';
const DEFAULT_BASE_URL = 'http://localhost:53123';

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: DEFAULT_BASE_URL,
  defaultOutputSuffix: 'truth_audit_t3_fix_log_gap_260406_027',
  defaultSampleName: 't3_fix_log_gap'
});

const main = async () => {
  const args = parseArgs();
  const uiFile = fs.readFileSync(path.join(REPO_ROOT, 'ui', 'js', 'strategy-editor.js'), 'utf8');
  const latest = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'rules', 'LATEST.json'), 'utf8'));

  const checks = {
    has_merge_log_entries_helper: /function se_mergeLogEntries\(/.test(uiFile),
    key_mode_fetches_window_logs: /\/bot\/logs\?limit=200&window_id=\$\{encodeURIComponent\(currentWindowId\)\}/.test(uiFile),
    key_mode_fetches_runner_tick_logs: /\/bot\/logs\?limit=200&event=RUNNER_TICK&window_id=\$\{encodeURIComponent\(currentWindowId\)\}/.test(uiFile),
    base_log_limit_upgraded_to_500: /\/bot\/logs\?limit=500/.test(uiFile),
    key_log_includes_spread_too_wide_reason: /se_isKeyLog[\s\S]*spread_too_wide_for_entry/.test(uiFile),
    key_log_includes_ladder_not_posted_reason: /se_isKeyLog[\s\S]*ladder_not_posted/.test(uiFile),
    state_sentence_describes_spread_guard: /点差过大，本窗口暂不挂单/.test(uiFile),
    latest_points_to_260406_027: latest.task_id === args.taskId,
    governance_substitute_pass: false
  };
  checks.governance_substitute_pass = Object.entries(checks)
    .filter(([k]) => k !== 'governance_substitute_pass')
    .every(([, v]) => Boolean(v));

  const pass = checks.governance_substitute_pass;
  const firstBreakLayer = pass ? 'NONE_CHAIN_PASS' : 't3_fix_log_gap';
  const standard = buildStandardResult({
    scriptName: 'truth_audit_t3_fix_log_gap_260406_027',
    taskId: args.taskId,
    sampleName: args.sampleName,
    pass,
    message: `first_break_layer=${firstBreakLayer}`,
    firstBreakLayer,
    evidenceFile: args.output,
    summary: { pass, first_break_layer: firstBreakLayer, checks },
    rawExcerpt: {
      fail_to_pass: {
        before: 't3_order_log_gap_present',
        after: pass ? 't3_order_log_gap_fixed' : 't3_order_log_gap_not_fixed'
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
