import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { buildStandardResult, ensureDir, parseVerifyArgs, writeStandardLog } from './verify_standard_v1.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_TASK_ID = '260330_032';
const MAX_WALL_MS = 15 * 60 * 1000;
const ALLOWED_SAMPLES = ['restart_same_window_down_cancel_guard_v1'];

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: 'http://localhost:53231',
  defaultOutputSuffix: 'verify_cancel_decision_emission_restart_guard_260330_032',
  defaultSampleName: ALLOWED_SAMPLES[0]
});

const readJsonSafe = (filePath) => {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
};

const ensureSampleAllowed = (sampleName) => {
  const normalized = String(sampleName || '').trim();
  if (ALLOWED_SAMPLES.includes(normalized)) return normalized;
  throw new Error(`ERR_INVALID_SAMPLE_NAME: sample=${normalized || '<empty>'}; allowed=${ALLOWED_SAMPLES.join(',')}`);
};

const collectStdTail = (text) => String(text || '')
  .split(/\r?\n/)
  .map((line) => line.trimEnd())
  .filter(Boolean)
  .slice(-100);

const main = () => {
  const args = parseArgs();
  const sampleName = ensureSampleAllowed(args.sampleName);
  ensureDir(args.output);
  const reportsDir = path.dirname(args.output);
  const auditOutput = path.join(reportsDir, `${args.taskId}_truth_audit_cancel_decision_emission_fix_260330_031.json`);
  const commandArgs = [
    path.join('scripts', 'truth_audit_cancel_decision_emission_fix_260330_031.mjs'),
    `--task_id=${args.taskId}`,
    '--sample=cancel_decision_emission_fix_v1',
    `--output=${auditOutput}`
  ];

  const run = spawnSync(process.execPath, commandArgs, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: MAX_WALL_MS,
    killSignal: 'SIGTERM'
  });

  const parsed = readJsonSafe(auditOutput);
  const restart = parsed?.evidence_index?.real_runtime_restart || {};
  const beforeThreshold = restart?.before_threshold || null;
  const afterThreshold = restart?.after_threshold || null;
  const trackedNoOrderId = restart?.tracked_no_order_id || null;
  const cancelOpenNoEmitted = restart?.cancel_open_no_emitted === true;
  const cancelExecutionSeen = restart?.cancel_execution_seen === true;
  const reasonCode = (() => {
    if (run.error?.code === 'ETIMEDOUT') return 'ERR_MAX_WALL_TIME_EXCEEDED';
    if (!parsed) return 'ERR_AUDIT_OUTPUT_MISSING';
    if (cancelOpenNoEmitted !== true) return 'ERR_CANCEL_OPEN_NO_NOT_EMITTED';
    if (cancelExecutionSeen !== true) return 'ERR_CANCEL_EXECUTION_NOT_SEEN';
    if (!beforeThreshold || !afterThreshold) return 'ERR_THRESHOLD_FACTS_MISSING';
    if (Number(beforeThreshold.remaining_sec) <= 60) return 'ERR_BEFORE_THRESHOLD_NOT_GT_60';
    if (Number(afterThreshold.remaining_sec) > 60) return 'ERR_AFTER_THRESHOLD_NOT_LE_60';
    if (!trackedNoOrderId) return 'ERR_TRACKED_NO_ORDER_ID_MISSING';
    return 'NONE';
  })();

  const checks = {
    tracked_no_order_id_present: Boolean(trackedNoOrderId),
    threshold_before_gt_60: Number(beforeThreshold?.remaining_sec) > 60,
    threshold_after_le_60: Number(afterThreshold?.remaining_sec) <= 60,
    cancel_open_no_emitted: cancelOpenNoEmitted,
    cancel_execution_seen: cancelExecutionSeen,
    first_break_layer_clean: String(parsed?.conclusion_block?.first_break_layer || '') === 'NONE_CHAIN_PASS'
  };
  const keys = Object.keys(checks);
  const passChecks = keys.filter((k) => checks[k]).length;
  const failChecks = keys.length - passChecks;
  const pass = run.status === 0 && parsed?.pass === true && reasonCode === 'NONE' && failChecks === 0;

  const standard = buildStandardResult({
    scriptName: 'verify_cancel_decision_emission_restart_guard_260330_032',
    taskId: args.taskId,
    sampleName,
    pass,
    message: pass ? 'restart down cancel regression guard pass' : 'restart down cancel regression guard fail',
    firstBreakLayer: pass ? 'NONE_CHAIN_PASS' : (parsed?.conclusion_block?.first_break_layer || 'cancel_decision_emission_regression_guard'),
    evidenceFile: args.output,
    summary: {
      total_checks: keys.length,
      pass_checks: passChecks,
      fail_checks: failChecks,
      checks
    },
    rawExcerpt: {
      tracked_no_order_id: trackedNoOrderId,
      before_threshold_remaining_sec: beforeThreshold?.remaining_sec ?? null,
      after_threshold_remaining_sec: afterThreshold?.remaining_sec ?? null,
      cancel_open_no_emitted: cancelOpenNoEmitted,
      cancel_execution_seen: cancelExecutionSeen,
      reason_code: reasonCode
    }
  });

  const output = {
    ...standard,
    task_id: args.taskId,
    conclusion_block: {
      verdict: pass ? 'A：通过' : 'C：存在断裂',
      reason_code: reasonCode,
      first_break_layer: standard.first_break_layer
    },
    key_facts: {
      tracked_no_order_id: trackedNoOrderId,
      remaining_sec_before_threshold: beforeThreshold?.remaining_sec ?? null,
      remaining_sec_after_threshold: afterThreshold?.remaining_sec ?? null,
      cancel_open_no_emitted: cancelOpenNoEmitted,
      cancel_execution_seen: cancelExecutionSeen
    },
    key_counters: {
      total_checks: keys.length,
      pass_checks: passChecks,
      fail_checks: failChecks
    },
    evidence_index: {
      wrapped_audit_output: auditOutput,
      wrapped_audit_heartbeat_log: parsed?.evidence_index?.heartbeat_log || null,
      wrapped_audit_runtime_exit_shapes: parsed?.evidence_index?.runtime_exit_shapes || null,
      wrapped_audit_real_runtime_restart: restart,
      wrapped_command: `node ${commandArgs.join(' ')}`,
      wrapped_exit_code: run.status ?? (run.error?.code === 'ETIMEDOUT' ? 124 : 1),
      wrapped_signal: run.signal || null,
      stdout_tail: collectStdTail(run.stdout),
      stderr_tail: collectStdTail(run.stderr)
    },
    result: checks
  };

  fs.writeFileSync(args.output, JSON.stringify(output, null, 2));
  const logPath = writeStandardLog(args.output, standard);
  console.log(`VERIFY_OUTPUT=${args.output}`);
  console.log(`VERIFY_LOG=${logPath}`);
  console.log(JSON.stringify({
    pass,
    reason_code: reasonCode,
    tracked_no_order_id: trackedNoOrderId,
    cancel_open_no_emitted: cancelOpenNoEmitted,
    cancel_execution_seen: cancelExecutionSeen
  }));
  if (!pass) process.exitCode = 1;
};

main();
