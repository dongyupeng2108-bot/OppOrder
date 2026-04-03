import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildStandardResult, ensureDir, parseVerifyArgs, writeStandardLog } from '../verify_standard_v1.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_TASK_ID = '260403_017';
const ALLOWED_SAMPLES = ['notify_healthcheck_excerpt_fix_v1'];

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: 'http://localhost:53123',
  defaultOutputSuffix: 'truth_audit_notify_healthcheck_excerpt_fix_260403_017',
  defaultSampleName: ALLOWED_SAMPLES[0]
});

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const readLine1 = (file) => fs.readFileSync(file, 'utf8').split('\n')[0].trim();
const statusFromHttpLine = (line) => {
  const m = String(line || '').match(/HTTP\/\d\.\d\s+(\d{3})/);
  return m ? Number(m[1]) : null;
};

const main = async () => {
  const args = parseArgs();
  if (!ALLOWED_SAMPLES.includes(String(args.sampleName || '').trim())) throw new Error('ERR_INVALID_SAMPLE_NAME');

  const preTaskId = '260403_016';
  const preDir = path.join(REPO_ROOT, 'rules', 'task-reports', '2026-04', preTaskId);
  const preTruthFile = path.join(preDir, `${preTaskId}_truth_audit_postmortem_scope_fix.json`);
  const preNotifyFile = path.join(preDir, `notify_${preTaskId}.txt`);
  if (!fs.existsSync(preTruthFile) || !fs.existsSync(preNotifyFile)) throw new Error('ERR_PRE_EVIDENCE_MISSING_260403_016');

  const preTruth = readJson(preTruthFile);
  const preNotify = fs.readFileSync(preNotifyFile, 'utf8');
  const prePairsStatus = Number(preTruth?.evidence_index?.healthcheck?.pairs_status);
  const preRootStatus = Number(preTruth?.evidence_index?.healthcheck?.root_status);
  const preNotifyPairsLine = preNotify.split('\n').find((l) => l.startsWith('DOD_EVIDENCE_HEALTHCHECK_PAIRS:')) || '';
  const preConflict = {
    pre_json_root_status: preRootStatus,
    pre_json_pairs_status: prePairsStatus,
    pre_notify_pairs_line: preNotifyPairsLine,
    mismatch_pairs_404_vs_notify_200: prePairsStatus === 404 && /200\s+OK/i.test(preNotifyPairsLine)
  };

  const resultDir = path.join(REPO_ROOT, 'rules', 'task-reports', '2026-04', args.taskId);
  const notifyFile = path.join(resultDir, `notify_${args.taskId}.txt`);
  const rootFile = path.join(resultDir, `${args.taskId}_healthcheck_53122_root.txt`);
  const pairsFile = path.join(resultDir, `${args.taskId}_healthcheck_53122_pairs.txt`);

  const expectedRootStatus = Number.isInteger(preRootStatus) ? preRootStatus : 200;
  const expectedPairsStatus = Number.isInteger(prePairsStatus) ? prePairsStatus : 404;

  const postExists = fs.existsSync(notifyFile) && fs.existsSync(rootFile) && fs.existsSync(pairsFile);
  const rootLine = postExists ? readLine1(rootFile) : '';
  const pairsLine = postExists ? readLine1(pairsFile) : '';
  const notifyContent = postExists ? fs.readFileSync(notifyFile, 'utf8') : '';
  const notifyRootLine = postExists ? (notifyContent.split('\n').find((l) => l.startsWith('DOD_EVIDENCE_HEALTHCHECK_ROOT:')) || '') : '';
  const notifyPairsLine = postExists ? (notifyContent.split('\n').find((l) => l.startsWith('DOD_EVIDENCE_HEALTHCHECK_PAIRS:')) || '') : '';

  const expectedNotifyRootLine = `DOD_EVIDENCE_HEALTHCHECK_ROOT: ${args.taskId}_healthcheck_53122_root.txt => ${rootLine}`;
  const expectedNotifyPairsLine = `DOD_EVIDENCE_HEALTHCHECK_PAIRS: ${args.taskId}_healthcheck_53122_pairs.txt => ${pairsLine}`;
  const post = {
    expected_status: {
      root_status: expectedRootStatus,
      pairs_status: expectedPairsStatus
    },
    healthcheck_files: {
      root_line: rootLine,
      pairs_line: pairsLine,
      root_status: statusFromHttpLine(rootLine),
      pairs_status: statusFromHttpLine(pairsLine)
    },
    notify_excerpt: {
      root_line: notifyRootLine,
      pairs_line: notifyPairsLine
    }
  };

  const checks = {
    prefail_conflict_reproduced: preConflict.mismatch_pairs_404_vs_notify_200 === true,
    post_files_ready: postExists,
    post_root_status_match_expected: post.healthcheck_files.root_status === expectedRootStatus,
    post_pairs_status_match_expected: post.healthcheck_files.pairs_status === expectedPairsStatus,
    notify_root_matches_file_line: notifyRootLine === expectedNotifyRootLine,
    notify_pairs_matches_file_line: notifyPairsLine === expectedNotifyPairsLine
  };
  const pass = Object.values(checks).every(Boolean);

  const output = {
    fail_to_pass: {
      preFail: preConflict,
      postPass: post
    },
    healthcheck: {
      root_status: expectedRootStatus,
      pairs_status: expectedPairsStatus
    },
    samples: [
      { sample_type: 'pre_conflict_260403_016', is_real_runtime: true },
      { sample_type: 'post_consistency_260403_017', is_real_runtime: true }
    ],
    governance_substitute: {
      passed: checks.post_root_status_match_expected && checks.post_pairs_status_match_expected && checks.notify_root_matches_file_line && checks.notify_pairs_matches_file_line,
      source: 'notify_healthcheck_excerpt_mapping_fix'
    },
    non_regression: {
      notify_fields_not_removed: notifyRootLine.length > 0 && notifyPairsLine.length > 0
    },
    checks
  };

  const firstBreakLayer = pass ? 'NONE_CHAIN_PASS' : 'notify_healthcheck_excerpt_mapping';
  const standard = buildStandardResult({
    scriptName: 'truth_audit_notify_healthcheck_excerpt_fix_260403_017',
    taskId: args.taskId,
    sampleName: args.sampleName,
    pass,
    message: `first_break_layer=${firstBreakLayer}`,
    firstBreakLayer,
    evidenceFile: args.output,
    summary: { pass },
    rawExcerpt: output
  });
  const finalOutput = {
    ...standard,
    task_type: 'workflow_upgrade',
    conclusion_block: {
      verdict: pass ? 'A：通过' : 'C：存在断裂',
      first_break_layer: firstBreakLayer
    },
    evidence_index: output
  };
  ensureDir(args.output);
  fs.writeFileSync(args.output, JSON.stringify(finalOutput, null, 2));
  const verifyLog = writeStandardLog(args.output, standard);
  console.log(`VERIFY_OUTPUT=${args.output}`);
  console.log(`VERIFY_LOG=${verifyLog}`);
  console.log(JSON.stringify({ pass, first_break_layer: firstBreakLayer, checks }));
  if (!pass) process.exit(1);
};

main().catch((error) => {
  console.error(JSON.stringify({ event: 'AUDIT_FATAL', code: error?.message || 'ERR_UNHANDLED', allowed_samples: ALLOWED_SAMPLES }));
  process.exit(1);
});
