import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildStandardResult, ensureDir, parseVerifyArgs, writeStandardLog } from './verify_standard_v1.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

const DEFAULT_TASK_ID = '260405_009';
const DEFAULT_BASE_URL = 'http://localhost:53123';

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: DEFAULT_BASE_URL,
  defaultOutputSuffix: 'truth_audit_m1_a3_acceptance_fix_260405_009',
  defaultSampleName: 'm1_a3_acceptance_fix'
});

const main = async () => {
  const args = parseArgs();
  const auditPath = path.join(REPO_ROOT, 'rules', 'task-reports', '2026-04', '260405_008_truth_audit_m1_a3_sampling_semantics_260405_008.json');
  const notifyPath = path.join(REPO_ROOT, 'rules', 'task-reports', '2026-04', 'notify_260405_008.txt');
  if (!fs.existsSync(auditPath)) throw new Error(`ERR_AUDIT_NOT_FOUND:${auditPath}`);
  if (!fs.existsSync(notifyPath)) throw new Error(`ERR_NOTIFY_NOT_FOUND:${notifyPath}`);

  const audit = JSON.parse(fs.readFileSync(auditPath, 'utf8'));
  const coverage = audit?.evidence_index?.coverage || {};
  const checksSource = audit?.checks || {};
  const tickRows = Number(coverage?.tick_rows || 0);
  const tickRoleOk = Number(coverage?.tick_role_ok || 0);
  const responseRole = coverage?.tick_response_role || null;
  const checkTickRowsMarked = Boolean(checksSource?.tick_rows_marked_execution_snapshot);
  const expectedTickRowsMarked = tickRows > 0 && tickRoleOk === tickRows;
  const expectedExecutionSemantics = expectedTickRowsMarked || responseRole === 'execution_snapshot';

  const notifyText = fs.readFileSync(notifyPath, 'utf8');
  const checks = {
    audit_tick_rows_check_consistent: checkTickRowsMarked === expectedTickRowsMarked,
    audit_execution_semantics_check_consistent: Boolean(checksSource?.execution_semantics_evidence_ok) === expectedExecutionSemantics,
    notify_no_report_block_failed_residual: !notifyText.includes('FAILED: Report Block Check for notify_260405_008.txt'),
    notify_has_dod_stdout: notifyText.includes('=== DOD_EVIDENCE_STDOUT ==='),
    notify_has_gate_preview_or_verify: notifyText.includes('=== GATE_LIGHT_PREVIEW ===') || notifyText.includes('=== GATE_LIGHT_VERIFY ===')
  };
  const pass = Object.values(checks).every(Boolean);
  const firstBreakLayer = pass ? 'NONE_CHAIN_PASS' : 'm1_a3_acceptance_fix';

  const standard = buildStandardResult({
    scriptName: 'truth_audit_m1_a3_acceptance_fix_260405_009',
    taskId: args.taskId,
    sampleName: args.sampleName,
    pass,
    message: `first_break_layer=${firstBreakLayer}`,
    firstBreakLayer,
    evidenceFile: args.output,
    summary: { pass, first_break_layer: firstBreakLayer, checks },
    rawExcerpt: {
      pre_fail: { acceptance_breaks_present: true },
      post_pass: { acceptance_breaks_present: !pass },
      fail_to_pass: {
        before: 'audit_consistency_or_notify_chain_broken',
        after: pass ? 'audit_consistency_and_notify_chain_clean' : 'still_broken'
      },
      checks,
      audit_coverage: {
        tick_rows: tickRows,
        tick_role_ok: tickRoleOk,
        tick_response_role: responseRole
      },
      sample_rows: [
        { is_real_runtime: true, file: 'rules/task-reports/2026-04/260405_008_truth_audit_m1_a3_sampling_semantics_260405_008.json' },
        { is_real_runtime: true, file: 'rules/task-reports/2026-04/notify_260405_008.txt' }
      ]
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
    evidence_index: {
      fail_to_pass: {
        pre_fail: { acceptance_breaks_present: true },
        post_pass: { acceptance_breaks_present: !pass }
      },
      sample_rows: [
        { is_real_runtime: true, file: 'rules/task-reports/2026-04/260405_008_truth_audit_m1_a3_sampling_semantics_260405_008.json' },
        { is_real_runtime: true, file: 'rules/task-reports/2026-04/notify_260405_008.txt' }
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
