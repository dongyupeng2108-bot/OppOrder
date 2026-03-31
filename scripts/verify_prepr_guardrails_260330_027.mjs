import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { buildStandardResult, ensureDir, parseVerifyArgs, writeStandardLog } from './verify_standard_v1.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_TASK_ID = '260330_027';

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: 'http://localhost:53227',
  defaultOutputSuffix: 'verify_prepr_guardrails',
  defaultSampleName: 'prepr_guardrails_v1'
});

const readJsonSafe = (filePath) => {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
};

const runLayered = (extraArgs, outputName) => {
  const outPath = path.join(REPO_ROOT, 'rules', 'task-reports', '2026-03', outputName);
  const args = [
    path.join('scripts', 'run_layered_verify.mjs'),
    '--mode=prepr',
    `--task_id=${DEFAULT_TASK_ID}`,
    '--sample=prepr_guardrails_v1',
    '--module=p1guard',
    '--prepr_guard_only=true',
    '--prepr_reports_dir=rules/task-reports/2026-03',
    `--output=${outPath}`,
    ...extraArgs
  ];
  const result = spawnSync(process.execPath, args, { cwd: REPO_ROOT, encoding: 'utf8' });
  const parsed = readJsonSafe(outPath);
  return {
    command: `node ${args.join(' ')}`,
    exit_code: result.status ?? 1,
    output_path: outPath,
    parsed,
    stdout_tail: String(result.stdout || '').split(/\r?\n/).filter(Boolean).slice(-20),
    stderr_tail: String(result.stderr || '').split(/\r?\n/).filter(Boolean).slice(-20)
  };
};

const main = () => {
  const args = parseArgs();
  const negativeMainVerify = runLayered(['--prepr_simulate_main_verify_fail=true'], `${DEFAULT_TASK_ID}_layered_guard_neg_main_verify.json`);
  const negativeDirty = runLayered(['--prepr_simulate_dirty=true'], `${DEFAULT_TASK_ID}_layered_guard_neg_dirty.json`);
  const negativeLatest = runLayered(['--prepr_simulate_latest_out_of_sync=true'], `${DEFAULT_TASK_ID}_layered_guard_neg_latest.json`);
  const positiveAllow = runLayered(['--prepr_simulate_main_verify_pass=true'], `${DEFAULT_TASK_ID}_layered_guard_pos_allow.json`);

  const checks = {
    neg_main_verify_blocked: negativeMainVerify.parsed?.prepr_guard?.allow_prepr === false
      && (negativeMainVerify.parsed?.prepr_guard?.reasons || []).includes('BLOCK_PREPR_MAIN_VERIFY_NOT_PASS'),
    neg_dirty_blocked: negativeDirty.parsed?.prepr_guard?.allow_prepr === false
      && (negativeDirty.parsed?.prepr_guard?.reasons || []).includes('BLOCK_PREPR_WORKSPACE_DIRTY'),
    neg_latest_blocked: negativeLatest.parsed?.prepr_guard?.allow_prepr === false
      && (negativeLatest.parsed?.prepr_guard?.reasons || []).includes('BLOCK_PREPR_LATEST_OUT_OF_SYNC'),
    positive_allow_prepr: positiveAllow.parsed?.prepr_guard?.allow_prepr === true
  };
  const keys = Object.keys(checks);
  const passChecks = keys.filter((k) => checks[k]).length;
  const failChecks = keys.length - passChecks;
  const pass = failChecks === 0;

  const standard = buildStandardResult({
    scriptName: 'verify_prepr_guardrails_260330_027',
    taskId: args.taskId,
    sampleName: args.sampleName,
    pass,
    message: pass ? 'prepr guardrails pass' : 'prepr guardrails fail',
    firstBreakLayer: pass ? 'NONE_CHAIN_PASS' : 'prepr_guardrails',
    evidenceFile: args.output,
    summary: {
      total_checks: keys.length,
      pass_checks: passChecks,
      fail_checks: failChecks,
      checks
    },
    rawExcerpt: {
      negative_main_verify: negativeMainVerify.parsed?.prepr_guard || null,
      negative_dirty: negativeDirty.parsed?.prepr_guard || null,
      negative_latest: negativeLatest.parsed?.prepr_guard || null,
      positive_allow: positiveAllow.parsed?.prepr_guard || null
    }
  });

  const output = {
    ...standard,
    task_id: args.taskId,
    evidence_index: {
      negative_main_verify: negativeMainVerify,
      negative_dirty: negativeDirty,
      negative_latest: negativeLatest,
      positive_allow: positiveAllow
    },
    key_counters: {
      total_checks: keys.length,
      pass_checks: passChecks,
      fail_checks: failChecks
    },
    result: checks
  };

  ensureDir(args.output);
  fs.writeFileSync(args.output, JSON.stringify(output, null, 2));
  const logPath = writeStandardLog(args.output, standard);
  console.log(`VERIFY_OUTPUT=${args.output}`);
  console.log(`VERIFY_LOG=${logPath}`);
  console.log(JSON.stringify({ pass, pass_checks: passChecks, fail_checks: failChecks }));
  if (!pass) process.exitCode = 1;
};

main();
