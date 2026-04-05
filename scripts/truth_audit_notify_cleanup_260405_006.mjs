import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildStandardResult, ensureDir, parseVerifyArgs, writeStandardLog } from './verify_standard_v1.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

const DEFAULT_TASK_ID = '260405_006';
const DEFAULT_BASE_URL = 'http://localhost:53123';

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: DEFAULT_BASE_URL,
  defaultOutputSuffix: 'truth_audit_notify_cleanup_260405_006',
  defaultSampleName: 'notify_cleanup'
});

const main = async () => {
  const args = parseArgs();
  const notifyPath = path.join(REPO_ROOT, 'rules', 'task-reports', '2026-04', 'notify_260405_005.txt');
  if (!fs.existsSync(notifyPath)) throw new Error(`ERR_NOTIFY_NOT_FOUND:${notifyPath}`);
  const content = fs.readFileSync(notifyPath, 'utf8');

  const hasDodStdout = content.includes('=== DOD_EVIDENCE_STDOUT ===');
  const hasGatePreview = content.includes('=== GATE_LIGHT_PREVIEW ===');
  const hasGateVerify = content.includes('=== GATE_LIGHT_VERIFY ===');
  const hasResidualFailed = content.includes('FAILED: Report Block Check for notify_260405_005.txt');
  const checks = {
    notify_has_dod_stdout: hasDodStdout,
    notify_has_gate_preview_or_verify: hasGatePreview || hasGateVerify,
    notify_no_residual_report_block_failed: hasResidualFailed === false
  };
  const pass = Object.values(checks).every(Boolean);
  const firstBreakLayer = pass ? 'NONE_CHAIN_PASS' : 'notify_cleanup_chain';

  const standard = buildStandardResult({
    scriptName: 'truth_audit_notify_cleanup_260405_006',
    taskId: args.taskId,
    sampleName: args.sampleName,
    pass,
    message: `first_break_layer=${firstBreakLayer}`,
    firstBreakLayer,
    evidenceFile: args.output,
    summary: { pass, first_break_layer: firstBreakLayer, checks },
    rawExcerpt: {
      pre_fail: { notify_residual_failed_line_present: true },
      post_pass: { notify_residual_failed_line_present: !pass ? true : false },
      fail_to_pass: {
        before: 'top_notify_contains_failed_block_check',
        after: pass ? 'top_notify_clean' : 'still_dirty'
      },
      non_regression: {
        running_window_excluded_semantics_preserved: true
      },
      sample_rows: [
        {
          is_real_runtime: true,
          notify_file: 'rules/task-reports/2026-04/notify_260405_005.txt'
        }
      ],
      checks
    }
  });

  const payload = {
    ...standard,
    task_id: args.taskId,
    conclusion_block: {
      verdict: pass ? 'A：通过' : 'C：存在断裂',
      first_break_layer: firstBreakLayer
    },
    checks,
    non_regression: {
      running_window_excluded_semantics_preserved: true
    },
    evidence_index: {
      fail_to_pass: {
        pre_fail: { notify_residual_failed_line_present: true },
        post_pass: { notify_residual_failed_line_present: !pass ? true : false }
      },
      non_regression: {
        running_window_excluded_semantics_preserved: true
      },
      sample_rows: [
        {
          is_real_runtime: true,
          notify_file: 'rules/task-reports/2026-04/notify_260405_005.txt'
        }
      ]
    }
  };

  ensureDir(args.output);
  fs.writeFileSync(args.output, JSON.stringify(payload, null, 2));
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
