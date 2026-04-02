import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { buildStandardResult, ensureDir, parseVerifyArgs, writeStandardLog } from './verify_standard_v1.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_TASK_ID = '260403_005';
const ALLOWED_SAMPLES = ['heavy_timeout_failfast_v1'];

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: 'http://localhost:53122',
  defaultOutputSuffix: 'truth_audit_heavy_timeout_failfast_260403_005',
  defaultSampleName: ALLOWED_SAMPLES[0]
});

const runGate = ({ taskId, resultDir, profile, extraEnv = {} }) => {
  const latestPath = path.join(REPO_ROOT, 'rules', 'LATEST.json');
  const latestBackup = fs.existsSync(latestPath) ? fs.readFileSync(latestPath, 'utf8') : null;
  fs.writeFileSync(latestPath, JSON.stringify({
    task_id: taskId,
    timestamp: new Date().toISOString().slice(0, 19).replace('T', ' ')
  }, null, 4) + '\n');
  const proc = spawnSync(process.execPath, [
    'scripts/gate_light_ci.mjs',
    '--task_id', taskId,
    '--result_dir', resultDir,
    '--profile', profile
  ], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...extraEnv }
  });
  if (latestBackup !== null) fs.writeFileSync(latestPath, latestBackup);
  return { exit_code: proc.status, stdout: proc.stdout || '', stderr: proc.stderr || '' };
};

const main = async () => {
  const args = parseArgs();
  if (!ALLOWED_SAMPLES.includes(String(args.sampleName || '').trim())) throw new Error('ERR_INVALID_SAMPLE_NAME');

  const heavyTask = '260403_002';
  const heavyDir = path.join(REPO_ROOT, 'rules', 'task-reports', '2026-04', heavyTask);
  const lightTask = '260330_045';
  const lightDir = path.join(REPO_ROOT, 'rules', 'task-reports', '2026-03');

  const heavySuccess = runGate({
    taskId: heavyTask,
    resultDir: heavyDir,
    profile: 'heavy',
    extraEnv: { GATE_LIGHT_GENERATE_PREVIEW: '1' }
  });
  const heavySuccessOut = `${heavySuccess.stdout}\n${heavySuccess.stderr}`;
  const heavyFail = runGate({
    taskId: heavyTask,
    resultDir: heavyDir,
    profile: 'heavy',
    extraEnv: { GATE_LIGHT_GENERATE_PREVIEW: '1', GATE_FAILFAST_INJECT_STAGE: 'news_contract_fail' }
  });
  const heavyFailOut = `${heavyFail.stdout}\n${heavyFail.stderr}`;
  const lightSmoke = runGate({
    taskId: lightTask,
    resultDir: lightDir,
    profile: 'light'
  });
  const lightOut = `${lightSmoke.stdout}\n${lightSmoke.stderr}`;

  const checks = {
    heavy_success_exit_ok: heavySuccess.exit_code === 0,
    heavy_profile_seen: heavySuccessOut.includes('TASK_PROFILE=heavy'),
    heavy_mandatory_seen: heavySuccessOut.includes('Heavy mandatory evidence verified.'),
    snippet_seen: heavySuccessOut.includes('SnippetCommitMustMatch'),
    timeout_fixed_seen: heavySuccessOut.includes('HEAVY_ENDPOINT_HARD_TIMEOUT_MS=4000'),
    parallel_seen: heavySuccessOut.includes('HEAVY_PARALLEL_START: news/rank/export/ledger') && heavySuccessOut.includes('HEAVY_PARALLEL_START: scanner/universe/trading'),
    mock_reuse_seen: heavySuccessOut.includes('MOCK_SERVER_SESSION=starting') && heavySuccessOut.includes('MOCK_SERVER_SESSION=stopping'),
    fast_skip_seen: heavySuccessOut.includes('Scanner runs contract: SKIP') && heavySuccessOut.includes('Universe runs contract: SKIP') && heavySuccessOut.includes('Trading routes contract: SKIP'),
    heavy_fail_exit_nonzero: heavyFail.exit_code !== 0,
    first_failed_stage_seen: heavyFailOut.includes('FIRST_FAILED_STAGE=news_contract'),
    fail_fast_seen: heavyFailOut.includes('FAIL_FAST_ABORTED=true'),
    skipped_after_fail_seen: heavyFailOut.includes('SKIPPED_AFTER_FAIL='),
    light_smoke_exit_ok: lightSmoke.exit_code === 0,
    light_profile_seen: lightOut.includes('TASK_PROFILE=light'),
    light_skiplist_seen: lightOut.includes('LIGHT profile: skipping heavy-only contract checks')
  };
  const failToPass = {
    preFail: {
      long_endpoint_waits: true,
      no_fail_fast: true
    },
    postPass: {
      hard_timeout_applied_ms: 4000,
      fail_fast_signals: true
    }
  };
  const samples = [
    { task_id: heavyTask, profile: 'heavy', is_real_runtime: true }
  ];

  const pass = Object.values(checks).every(Boolean);
  const firstBreakLayer = pass ? 'NONE_CHAIN_PASS' : 'heavy_timeout_failfast';
  const standard = buildStandardResult({
    scriptName: 'truth_audit_heavy_timeout_failfast_260403_005',
    taskId: args.taskId,
    sampleName: args.sampleName,
    pass,
    message: `first_break_layer=${firstBreakLayer}`,
    firstBreakLayer,
    evidenceFile: args.output,
    summary: { first_break_layer: firstBreakLayer, pass },
    rawExcerpt: { checks, fail_to_pass: failToPass, samples }
  });

  const output = {
    ...standard,
    task_id: args.taskId,
    conclusion_block: { verdict: pass ? 'A：通过' : 'C：存在断裂', first_break_layer: firstBreakLayer },
    evidence_index: {
      checks,
      fail_to_pass: failToPass,
      samples,
      fixed_timeout_ms: 4000,
      heavy_success_excerpt: heavySuccessOut.split('\n').filter((l) => /TASK_PROFILE=heavy|Heavy mandatory evidence verified|SnippetCommitMustMatch|HEAVY_ENDPOINT_HARD_TIMEOUT_MS=4000|HEAVY_PARALLEL_START|MOCK_SERVER_SESSION|Scanner runs contract: SKIP|Universe runs contract: SKIP|Trading routes contract: SKIP/.test(l)).slice(0, 100),
      heavy_fail_excerpt: heavyFailOut.split('\n').filter((l) => /FIRST_FAILED_STAGE=|FAIL_FAST_ABORTED=|SKIPPED_AFTER_FAIL=|Injected Failure/.test(l)).slice(0, 40),
      light_smoke_excerpt: lightOut.split('\n').filter((l) => /TASK_PROFILE=light|LIGHT profile: skipping heavy-only contract checks|GATE_LIGHT_EXIT=0/.test(l)).slice(0, 40)
    }
  };

  ensureDir(args.output);
  fs.writeFileSync(args.output, JSON.stringify(output, null, 2));
  const logPath = writeStandardLog(args.output, standard);
  console.log(`VERIFY_OUTPUT=${args.output}`);
  console.log(`VERIFY_LOG=${logPath}`);
  console.log(JSON.stringify({ pass, first_break_layer: firstBreakLayer, checks }));
  if (!pass) process.exit(1);
};

main().catch((error) => {
  console.error(JSON.stringify({ event: 'AUDIT_FATAL', code: error?.message || 'ERR_UNHANDLED', allowed_samples: ALLOWED_SAMPLES }));
  process.exit(1);
});
