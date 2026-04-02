import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { buildStandardResult, ensureDir, parseVerifyArgs, writeStandardLog } from './verify_standard_v1.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_TASK_ID = '260403_003';
const MAX_WALL_MS = 60 * 60 * 1000;
const MAX_SILENCE_MS = 5 * 60 * 1000;
const LOG_TAIL = 150;
const ALLOWED_SAMPLES = ['workflow_profile_split_v1'];

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: 'http://localhost:53122',
  defaultOutputSuffix: 'truth_audit_workflow_profile_split_260403_003',
  defaultSampleName: ALLOWED_SAMPLES[0]
});

const runGate = ({ taskId, resultDir, profile }) => {
  const latestPath = path.join(REPO_ROOT, 'rules', 'LATEST.json');
  const latestBackup = fs.existsSync(latestPath) ? fs.readFileSync(latestPath, 'utf8') : null;
  fs.writeFileSync(latestPath, JSON.stringify({
    task_id: taskId,
    timestamp: new Date().toISOString().slice(0, 19).replace('T', ' ')
  }, null, 4) + '\n');
  const cmdArgs = ['scripts/gate_light_ci.mjs', '--task_id', taskId, '--result_dir', resultDir, '--profile', profile];
  const env = { ...process.env };
  if (profile === 'heavy') env.GATE_LIGHT_GENERATE_PREVIEW = '1';
  const proc = spawnSync(process.execPath, cmdArgs, { cwd: REPO_ROOT, encoding: 'utf8', env });
  if (latestBackup !== null) fs.writeFileSync(latestPath, latestBackup);
  return {
    exit_code: proc.status,
    stdout: proc.stdout || '',
    stderr: proc.stderr || '',
    checks: {
      profile_line: (proc.stdout || '').includes(`TASK_PROFILE=${profile}`),
      heavy_skip_list: (proc.stdout || '').includes('LIGHT profile: skipping heavy-only contract checks'),
      heavy_mandatory_verified: (proc.stdout || '').includes('Heavy mandatory evidence verified'),
      heavy_mandatory_skipped: (proc.stdout || '').includes('LIGHT profile: heavy mandatory evidence checks skipped')
    }
  };
};

const main = async () => {
  const args = parseArgs();
  const sampleName = String(args.sampleName || '').trim();
  if (!ALLOWED_SAMPLES.includes(sampleName)) throw new Error(`ERR_INVALID_SAMPLE_NAME: ${sampleName}`);

  const startedAt = Date.now();
  const lightResultDir = path.join(REPO_ROOT, 'rules', 'task-reports', '2026-03');
  const heavyResultDir = path.join(REPO_ROOT, 'rules', 'task-reports', '2026-04', '260403_002');

  const light = runGate({ taskId: '260330_045', resultDir: lightResultDir, profile: 'light' });
  const heavy = runGate({ taskId: '260403_002', resultDir: heavyResultDir, profile: 'heavy' });

  const pass = (
    light.exit_code === 0
    && heavy.exit_code === 0
    && light.checks.profile_line
    && light.checks.heavy_skip_list
    && light.checks.heavy_mandatory_skipped
    && heavy.checks.profile_line
    && heavy.checks.heavy_mandatory_verified
  );
  const firstBreakLayer = pass ? 'NONE_CHAIN_PASS' : 'workflow_profile_split';
  const standard = buildStandardResult({
    scriptName: 'truth_audit_workflow_profile_split_260403_003',
    taskId: args.taskId,
    sampleName,
    pass,
    message: `first_break_layer=${firstBreakLayer}`,
    firstBreakLayer,
    evidenceFile: args.output,
    summary: {
      first_break_layer: firstBreakLayer,
      light_exit: light.exit_code,
      heavy_exit: heavy.exit_code
    },
    rawExcerpt: {
      light_checks: light.checks,
      heavy_checks: heavy.checks
    }
  });

  const output = {
    ...standard,
    task_id: args.taskId,
    conclusion_block: {
      verdict: pass ? 'A：通过' : 'C：存在断裂',
      first_break_layer: firstBreakLayer
    },
    evidence_index: {
      light_sample: {
        task_id: '260330_045',
        profile: 'light',
        result_dir: lightResultDir,
        ...light
      },
      heavy_sample: {
        task_id: '260403_002',
        profile: 'heavy',
        result_dir: heavyResultDir,
        ...heavy
      },
      gate_diff_table: {
        both: ['LATEST一致性', 'scope lock', 'postflight/envelope', 'workspace_healer', 'doc path', 'healthcheck证据'],
        light_only: ['heavy-only contract checks skipped', 'heavy mandatory evidence skipped'],
        heavy_only: ['global contracts(news/rank/export/ledger/scanner/universe/trading)', 'heavy mandatory evidence(first_break_layer/fail->pass/real runtime/non-regression)']
      },
      guardrails: {
        max_wall_time_ms: MAX_WALL_MS,
        max_silence_ms: MAX_SILENCE_MS,
        log_tail: LOG_TAIL,
        wall_time_ms: Date.now() - startedAt
      }
    }
  };
  ensureDir(args.output);
  fs.writeFileSync(args.output, JSON.stringify(output, null, 2));
  const logPath = writeStandardLog(args.output, standard);
  console.log(`VERIFY_OUTPUT=${args.output}`);
  console.log(`VERIFY_LOG=${logPath}`);
  console.log(JSON.stringify({
    pass,
    first_break_layer: firstBreakLayer,
    light_exit: light.exit_code,
    heavy_exit: heavy.exit_code,
    light_checks: light.checks,
    heavy_checks: heavy.checks
  }));
  if (!pass) process.exit(1);
};

main().catch((error) => {
  console.error(JSON.stringify({ event: 'AUDIT_FATAL', code: error?.message || 'ERR_UNHANDLED', allowed_samples: ALLOWED_SAMPLES }));
  process.exit(1);
});
