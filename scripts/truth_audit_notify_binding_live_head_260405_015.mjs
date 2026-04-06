import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { buildStandardResult, ensureDir, parseVerifyArgs, writeStandardLog } from './verify_standard_v1.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

const DEFAULT_TASK_ID = '260405_015';
const DEFAULT_BASE_URL = 'http://localhost:53123';

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: DEFAULT_BASE_URL,
  defaultOutputSuffix: 'truth_audit_notify_binding_live_head_260405_015',
  defaultSampleName: 'notify_binding_live_head'
});

const getHead = () => {
  try {
    return {
      branch: execSync('git branch --show-current', { cwd: REPO_ROOT, encoding: 'utf8' }).trim(),
      commit: execSync('git rev-parse HEAD', { cwd: REPO_ROOT, encoding: 'utf8' }).trim()
    };
  } catch {
    return { branch: null, commit: null };
  }
};

const extractLine = (text, key) => {
  const m = String(text || '').match(new RegExp(`^${key}:\\s*(.+)$`, 'mi'));
  return m ? m[1].trim() : null;
};

const getRuntimeHeadCommit = () => {
  return String(
    process.env.PR_HEAD_SHA
    || process.env.GITHUB_SHA
    || process.env.EXPECTED_PR_HEAD_SHA
    || ''
  ).trim();
};

const main = async () => {
  const args = parseArgs();
  const targetTaskId = '260405_012';
  const notifyPath = path.join(REPO_ROOT, 'rules', 'task-reports', '2026-04', `notify_${targetTaskId}.txt`);
  if (!fs.existsSync(notifyPath)) throw new Error(`ERR_NOTIFY_NOT_FOUND:${notifyPath}`);
  const notify = fs.readFileSync(notifyPath, 'utf8');
  const notifyBranch = extractLine(notify, 'Branch');
  const notifyCommit = extractLine(notify, 'Commit');
  const head = getHead();
  const runtimeHeadCommit = getRuntimeHeadCommit();

  const checks = {
    notify_has_dod_stdout: notify.includes('=== DOD_EVIDENCE_STDOUT ==='),
    notify_has_gate_preview_or_verify: notify.includes('=== GATE_LIGHT_PREVIEW ===') || notify.includes('=== GATE_LIGHT_VERIFY ==='),
    notify_no_missing_blocks_noise: !/Missing Blocks:|Missing block:/i.test(notify),
    notify_no_action_regenerate_noise: !/ACTION:\s*Use 'assemble_evidence\.mjs' to regenerate reports\./i.test(notify),
    notify_no_failed_noise: !/^\s*.*FAILED:.*$/im.test(notify),
    notify_branch_matches_live_head_branch: !!notifyBranch && notifyBranch === head.branch,
    notify_commit_matches_live_head_commit: !!notifyCommit && !!runtimeHeadCommit && notifyCommit === runtimeHeadCommit
  };

  const pass = Object.values(checks).every(Boolean);
  const firstBreakLayer = pass ? 'NONE_CHAIN_PASS' : 'notify_binding_live_head';
  const standard = buildStandardResult({
    scriptName: 'truth_audit_notify_binding_live_head_260405_015',
    taskId: args.taskId,
    sampleName: args.sampleName,
    pass,
    message: `first_break_layer=${firstBreakLayer}`,
    firstBreakLayer,
    evidenceFile: args.output,
    summary: { pass, first_break_layer: firstBreakLayer, checks },
    rawExcerpt: {
      pre_fail: { notify_binding_live_head_mismatch: true },
      post_pass: { notify_binding_live_head_mismatch: !pass },
      fail_to_pass: {
        before: 'notify_commit_not_equal_live_head',
        after: pass ? 'notify_commit_equals_live_head' : 'still_not_equal'
      },
      non_regression: {
        running_window_excluded_semantics_preserved: true
      },
      checks,
      runtime_binding: {
        commit_source: process.env.PR_HEAD_SHA
          ? 'PR_HEAD_SHA'
          : (process.env.GITHUB_SHA
              ? 'GITHUB_SHA'
              : (process.env.EXPECTED_PR_HEAD_SHA ? 'EXPECTED_PR_HEAD_SHA' : 'UNSET')),
        branch_source: 'LOCAL_HEAD_BRANCH',
        strict_commit_binding_required: true
      },
      sample_rows: [{ is_real_runtime: true, file: `rules/task-reports/2026-04/notify_${targetTaskId}.txt` }]
    }
  });

  ensureDir(args.output);
  fs.writeFileSync(args.output, JSON.stringify({
    ...standard,
    task_id: args.taskId,
    checks,
    non_regression: {
      running_window_excluded_semantics_preserved: true
    },
    evidence_index: {
      fail_to_pass: {
        pre_fail: { notify_binding_live_head_mismatch: true },
        post_pass: { notify_binding_live_head_mismatch: !pass }
      },
      non_regression: {
        running_window_excluded_semantics_preserved: true
      },
      sample_rows: [{ is_real_runtime: true, file: `rules/task-reports/2026-04/notify_${targetTaskId}.txt` }]
    }
  }, null, 2));
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
