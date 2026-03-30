import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { buildStandardResult, ensureDir, parseVerifyArgs, writeStandardLog } from './verify_standard_v1.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_TASK_ID = '260330_018';

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: 'http://localhost:53218',
  defaultOutputSuffix: 'no_terminal_state_guard',
  defaultSampleName: 'no_terminal_state_guard_v1'
});

const main = () => {
  const args = parseArgs();
  ensureDir(args.output);
  const reportsDir = path.dirname(args.output);
  const auditOutput = path.join(reportsDir, `${args.taskId}_truth_audit_no_terminal_state_fix.json`);
  const commandArgs = [
    path.join('scripts', 'truth_audit_no_terminal_state_fix_260330_018.mjs'),
    `--task_id=${args.taskId}`,
    '--sample=no_terminal_state_fix_v1',
    `--output=${auditOutput}`
  ];
  const run = spawnSync(process.execPath, commandArgs, { cwd: REPO_ROOT, encoding: 'utf8' });
  const parsed = fs.existsSync(auditOutput) ? JSON.parse(fs.readFileSync(auditOutput, 'utf8')) : null;
  const pass = run.status === 0 && parsed?.pass === true;
  const checks = {
    acceptance_pass: pass,
    first_break_layer_clean: String(parsed?.conclusion_block?.first_break_layer || '') === 'NONE_CHAIN_PASS'
  };
  const keys = Object.keys(checks);
  const passChecks = keys.filter((k) => checks[k]).length;
  const failChecks = keys.length - passChecks;
  const overallPass = failChecks === 0;

  const standard = buildStandardResult({
    scriptName: 'verify_no_terminal_state_guard',
    taskId: args.taskId,
    sampleName: args.sampleName,
    pass: overallPass,
    message: overallPass ? 'no-terminal-state guard pass' : 'no-terminal-state guard fail',
    firstBreakLayer: overallPass ? 'NONE_CHAIN_PASS' : (parsed?.conclusion_block?.first_break_layer || 'regression_guard'),
    evidenceFile: args.output,
    summary: {
      total_checks: keys.length,
      pass_checks: passChecks,
      fail_checks: failChecks,
      checks
    },
    rawExcerpt: {
      audit_output: auditOutput,
      audit_conclusion: parsed?.conclusion_block || null
    }
  });

  const output = {
    ...standard,
    task_id: args.taskId,
    key_counters: {
      total_checks: keys.length,
      pass_checks: passChecks,
      fail_checks: failChecks
    },
    evidence_index: {
      audit_output: auditOutput
    },
    result: checks
  };

  fs.writeFileSync(args.output, JSON.stringify(output, null, 2));
  const logPath = writeStandardLog(args.output, standard);
  console.log(`VERIFY_OUTPUT=${args.output}`);
  console.log(`VERIFY_LOG=${logPath}`);
  console.log(JSON.stringify({ pass: overallPass, pass_checks: passChecks, fail_checks: failChecks }));
  if (!overallPass) process.exitCode = 1;
};

main();
