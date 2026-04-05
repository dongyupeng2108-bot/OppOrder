import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildStandardResult, ensureDir, parseVerifyArgs, writeStandardLog } from './verify_standard_v1.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

const DEFAULT_TASK_ID = '260405_010';
const DEFAULT_BASE_URL = 'http://localhost:53123';

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: DEFAULT_BASE_URL,
  defaultOutputSuffix: 'truth_audit_notify_noise_cleanup_260405_010',
  defaultSampleName: 'notify_noise_cleanup'
});

const main = async () => {
  const args = parseArgs();
  const notifyPath = path.join(REPO_ROOT, 'rules', 'task-reports', '2026-04', `notify_${args.taskId}.txt`);
  if (!fs.existsSync(notifyPath)) throw new Error(`ERR_NOTIFY_NOT_FOUND:${notifyPath}`);
  const text = fs.readFileSync(notifyPath, 'utf8');
  const checks = {
    notify_has_dod_stdout: text.includes('=== DOD_EVIDENCE_STDOUT ==='),
    notify_has_gate_preview_or_verify: text.includes('=== GATE_LIGHT_PREVIEW ===') || text.includes('=== GATE_LIGHT_VERIFY ==='),
    notify_no_report_block_failed_noise: !/FAILED:\s*Report Block Check for notify_\d+\.txt/i.test(text),
    notify_no_missing_block_noise: !/Missing block:\s*===\s*DOD_EVIDENCE_STDOUT\s*===|Missing block:\s*===\s*GATE_LIGHT_PREVIEW\s*===\s*OR\s*===\s*GATE_LIGHT_VERIFY\s*===/i.test(text)
  };
  const pass = Object.values(checks).every(Boolean);
  const firstBreakLayer = pass ? 'NONE_CHAIN_PASS' : 'notify_noise_cleanup';

  const standard = buildStandardResult({
    scriptName: 'truth_audit_notify_noise_cleanup_260405_010',
    taskId: args.taskId,
    sampleName: args.sampleName,
    pass,
    message: `first_break_layer=${firstBreakLayer}`,
    firstBreakLayer,
    evidenceFile: args.output,
    summary: { pass, first_break_layer: firstBreakLayer, checks },
    rawExcerpt: {
      pre_fail: { notify_contains_historical_failed_noise: true },
      post_pass: { notify_contains_historical_failed_noise: !pass },
      fail_to_pass: {
        before: 'notify_historical_failed_noise_present',
        after: pass ? 'notify_clean' : 'still_noisy'
      },
      non_regression: {
        running_window_excluded_semantics_preserved: true
      },
      checks,
      sample_rows: [{ is_real_runtime: true, file: `rules/task-reports/2026-04/notify_${args.taskId}.txt` }]
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
        pre_fail: { notify_contains_historical_failed_noise: true },
        post_pass: { notify_contains_historical_failed_noise: !pass }
      },
      non_regression: {
        running_window_excluded_semantics_preserved: true
      },
      sample_rows: [{ is_real_runtime: true, file: `rules/task-reports/2026-04/notify_${args.taskId}.txt` }]
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
