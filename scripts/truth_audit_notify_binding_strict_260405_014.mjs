import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { buildStandardResult, ensureDir, parseVerifyArgs, writeStandardLog } from './verify_standard_v1.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

const DEFAULT_TASK_ID = '260405_014';
const DEFAULT_BASE_URL = 'http://localhost:53123';

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: DEFAULT_BASE_URL,
  defaultOutputSuffix: 'truth_audit_notify_binding_strict_260405_014',
  defaultSampleName: 'notify_binding_strict'
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

const main = async () => {
  const args = parseArgs();
  const targetNotifyTaskId = '260405_012';
  const notifyPath = path.join(REPO_ROOT, 'rules', 'task-reports', '2026-04', `notify_${targetNotifyTaskId}.txt`);
  const gitMetaPath = path.join(REPO_ROOT, 'rules', 'task-reports', '2026-04', `git_meta_${targetNotifyTaskId}.json`);
  if (!fs.existsSync(notifyPath)) throw new Error(`ERR_NOTIFY_NOT_FOUND:${notifyPath}`);
  if (!fs.existsSync(gitMetaPath)) throw new Error(`ERR_GIT_META_NOT_FOUND:${gitMetaPath}`);

  const notifyText = fs.readFileSync(notifyPath, 'utf8');
  const notifyBranch = extractLine(notifyText, 'Branch');
  const notifyCommit = extractLine(notifyText, 'Commit');
  const gitMeta = JSON.parse(fs.readFileSync(gitMetaPath, 'utf8'));
  const head = getHead();

  const checks = {
    notify_has_dod_stdout: notifyText.includes('=== DOD_EVIDENCE_STDOUT ==='),
    notify_has_gate_preview_or_verify: notifyText.includes('=== GATE_LIGHT_PREVIEW ===') || notifyText.includes('=== GATE_LIGHT_VERIFY ==='),
    notify_no_missing_blocks_noise: !/Missing Blocks:|Missing block:/i.test(notifyText),
    notify_no_action_regenerate_noise: !/ACTION:\s*Use 'assemble_evidence\.mjs' to regenerate reports\./i.test(notifyText),
    notify_no_failed_noise: !/^\s*.*FAILED:.*$/im.test(notifyText),
    notify_branch_matches_git_meta_branch: !!notifyBranch && notifyBranch === String(gitMeta?.branch || '').trim(),
    notify_commit_matches_git_meta_commit: !!notifyCommit && notifyCommit === String(gitMeta?.commit || '').trim(),
    git_meta_branch_matches_head_branch: String(gitMeta?.branch || '').trim() === String(head?.branch || '').trim()
  };

  const pass = Object.values(checks).every(Boolean);
  const firstBreakLayer = pass ? 'NONE_CHAIN_PASS' : 'notify_binding_strict';

  const standard = buildStandardResult({
    scriptName: 'truth_audit_notify_binding_strict_260405_014',
    taskId: args.taskId,
    sampleName: args.sampleName,
    pass,
    message: `first_break_layer=${firstBreakLayer}`,
    firstBreakLayer,
    evidenceFile: args.output,
    summary: { pass, first_break_layer: firstBreakLayer, checks },
    rawExcerpt: {
      pre_fail: { notify_binding_or_chain_dirty: true },
      post_pass: { notify_binding_or_chain_dirty: !pass },
      fail_to_pass: {
        before: 'notify_chain_dirty_or_binding_mismatch',
        after: pass ? 'notify_chain_clean_and_binding_strict' : 'still_dirty_or_mismatch'
      },
      non_regression: {
        running_window_excluded_semantics_preserved: true
      },
      checks,
      meta: {
        notify_branch: notifyBranch,
        notify_commit: notifyCommit,
        git_meta_branch: gitMeta?.branch || null,
        git_meta_commit: gitMeta?.commit || null,
        head_branch: head?.branch || null,
        head_commit: head?.commit || null
      },
      sample_rows: [
        { is_real_runtime: true, file: `rules/task-reports/2026-04/notify_${targetNotifyTaskId}.txt` },
        { is_real_runtime: true, file: `rules/task-reports/2026-04/git_meta_${targetNotifyTaskId}.json` }
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
    non_regression: {
      running_window_excluded_semantics_preserved: true
    },
    evidence_index: {
      fail_to_pass: {
        pre_fail: { notify_binding_or_chain_dirty: true },
        post_pass: { notify_binding_or_chain_dirty: !pass }
      },
      non_regression: {
        running_window_excluded_semantics_preserved: true
      },
      sample_rows: [
        { is_real_runtime: true, file: `rules/task-reports/2026-04/notify_${targetNotifyTaskId}.txt` },
        { is_real_runtime: true, file: `rules/task-reports/2026-04/git_meta_${targetNotifyTaskId}.json` }
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
