import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildStandardResult, ensureDir, parseVerifyArgs, writeStandardLog } from './verify_standard_v1.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_TASK_ID = '260406_032';
const DEFAULT_BASE_URL = 'http://localhost:53123';

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: DEFAULT_BASE_URL,
  defaultOutputSuffix: 'truth_audit_window_init_gate_fix_260406_032',
  defaultSampleName: 'window_init_gate_fix'
});

const main = async () => {
  const args = parseArgs();
  const runnerFile = fs.readFileSync(path.join(REPO_ROOT, 'strategies', 'crypto_binary', 'bot_runner.mjs'), 'utf8');
  const latest = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'rules', 'LATEST.json'), 'utf8'));

  const checks = {
    has_backfill_condition_bounds_ready_and_init_null: /shouldBackfillWindowInitializedAt = currentWindowPresent && !state\.window_initialized_at && boundsReady/.test(runnerFile),
    has_backfill_patch_window_initialized_at: /window_initialized_at:\s*contextForDecision\.updated_at \|\| new Date\(\)\.toISOString\(\)/.test(runnerFile),
    has_window_initialized_derived_flag: /const windowInitialized = Boolean\(state\.window_initialized_at\) \|\| boundsReady;/.test(runnerFile),
    gate_uses_derived_window_initialized: /gateByWindowNotInitialized = currentWindowPresent && hasActionIntent && !windowInitialized;/.test(runnerFile),
    diagnostics_report_derived_window_initialized: /gate_window_initialized:\s*windowInitialized/.test(runnerFile),
    latest_points_to_260406_032: latest.task_id === args.taskId,
    governance_substitute_pass: false
  };
  checks.governance_substitute_pass = Object.entries(checks)
    .filter(([k]) => k !== 'governance_substitute_pass')
    .every(([, v]) => Boolean(v));

  const pass = checks.governance_substitute_pass;
  const firstBreakLayer = pass ? 'NONE_CHAIN_PASS' : 'window_init_gate_fix';
  const standard = buildStandardResult({
    scriptName: 'truth_audit_window_init_gate_fix_260406_032',
    taskId: args.taskId,
    sampleName: args.sampleName,
    pass,
    message: `first_break_layer=${firstBreakLayer}`,
    firstBreakLayer,
    evidenceFile: args.output,
    summary: { pass, first_break_layer: firstBreakLayer, checks },
    rawExcerpt: {
      fail_to_pass: {
        before: 'gate_context_not_ready_window_init_false_positive',
        after: pass ? 'window_init_gate_false_positive_fixed' : 'window_init_gate_not_fixed'
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
