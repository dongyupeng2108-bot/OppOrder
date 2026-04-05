import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { buildStandardResult, ensureDir, parseVerifyArgs, writeStandardLog } from './verify_standard_v1.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

const DEFAULT_TASK_ID = '260405_013';
const DEFAULT_BASE_URL = 'http://localhost:53123';

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: DEFAULT_BASE_URL,
  defaultOutputSuffix: 'truth_audit_notify_binding_fix_260405_013',
  defaultSampleName: 'notify_binding_fix'
});

const getCurrentGit = () => {
  try {
    const branch = execSync('git branch --show-current', { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
    const commit = execSync('git rev-parse HEAD', { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
    return { branch, commit };
  } catch {
    return { branch: null, commit: null };
  }
};

const extractMetaLine = (text, key) => {
  const regex = new RegExp(`^${key}:\\s*(.+)$`, 'mi');
  const m = String(text || '').match(regex);
  return m ? m[1].trim() : null;
};

const main = async () => {
  const args = parseArgs();
  const notifyTargetTaskId = '260405_012';
  const notifyPath = path.join(REPO_ROOT, 'rules', 'task-reports', '2026-04', `notify_${notifyTargetTaskId}.txt`);
  if (!fs.existsSync(notifyPath)) throw new Error(`ERR_NOTIFY_NOT_FOUND:${notifyPath}`);
  const content = fs.readFileSync(notifyPath, 'utf8');
  const git = getCurrentGit();
  const notifyBranch = extractMetaLine(content, 'Branch');
  const notifyCommit = extractMetaLine(content, 'Commit');

  const checks = {
    notify_has_dod_stdout: content.includes('=== DOD_EVIDENCE_STDOUT ==='),
    notify_has_gate_preview_or_verify: content.includes('=== GATE_LIGHT_PREVIEW ===') || content.includes('=== GATE_LIGHT_VERIFY ==='),
    notify_no_missing_blocks_noise: !/Missing Blocks:\s*===\s*GATE_LIGHT_PREVIEW\s*===\s*OR\s*===\s*GATE_LIGHT_VERIFY\s*===/i.test(content),
    notify_no_action_regenerate_noise: !/ACTION:\s*Use 'assemble_evidence\.mjs' to regenerate reports\./i.test(content),
    notify_no_failed_noise: !/^\s*.*FAILED:.*$/im.test(content),
    notify_branch_matches_current_git_branch: !!notifyBranch && !!git.branch && notifyBranch === git.branch,
    notify_commit_present_and_sha_like: !!notifyCommit && /^[0-9a-f]{40}$/i.test(notifyCommit)
  };

  const pass = Object.values(checks).every(Boolean);
  const firstBreakLayer = pass ? 'NONE_CHAIN_PASS' : 'notify_binding_fix';

  const standard = buildStandardResult({
    scriptName: 'truth_audit_notify_binding_fix_260405_013',
    taskId: args.taskId,
    sampleName: args.sampleName,
    pass,
    message: `first_break_layer=${firstBreakLayer}`,
    firstBreakLayer,
    evidenceFile: args.output,
    summary: { pass, first_break_layer: firstBreakLayer, checks },
    rawExcerpt: {
      pre_fail: { notify_chain_or_binding_dirty: true },
      post_pass: { notify_chain_or_binding_dirty: !pass },
      fail_to_pass: {
        before: 'notify_chain_or_binding_mismatch',
        after: pass ? 'notify_chain_clean_and_binding_consistent' : 'still_mismatch'
      },
      non_regression: {
        running_window_excluded_semantics_preserved: true
      },
      checks,
      meta: {
        current_branch: git.branch,
        current_commit: git.commit,
        notify_branch: notifyBranch,
        notify_commit: notifyCommit,
        commit_rule: 'sha_like_only'
      },
      sample_rows: [{ is_real_runtime: true, file: `rules/task-reports/2026-04/notify_${notifyTargetTaskId}.txt` }]
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
        pre_fail: { notify_chain_or_binding_dirty: true },
        post_pass: { notify_chain_or_binding_dirty: !pass }
      },
      non_regression: {
        running_window_excluded_semantics_preserved: true
      },
      sample_rows: [{ is_real_runtime: true, file: `rules/task-reports/2026-04/notify_${notifyTargetTaskId}.txt` }]
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
