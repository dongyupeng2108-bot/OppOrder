import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { buildStandardResult, ensureDir, parseVerifyArgs, writeStandardLog } from './verify_standard_v1.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_TASK_ID = '260403_006';
const ALLOWED_SAMPLES = ['snippet_git_local_first_v1'];

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: 'http://localhost:53122',
  defaultOutputSuffix: 'truth_audit_snippet_git_local_first_260403_006',
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
  return { exit_code: proc.status, out: `${proc.stdout || ''}\n${proc.stderr || ''}` };
};

const main = async () => {
  const args = parseArgs();
  if (!ALLOWED_SAMPLES.includes(String(args.sampleName || '').trim())) throw new Error('ERR_INVALID_SAMPLE_NAME');

  const currentTask = args.taskId;
  const currentDir = path.join(REPO_ROOT, 'rules', 'task-reports', '2026-04', currentTask);
  const heavySampleTask = '260403_002';
  const heavySampleDir = path.join(REPO_ROOT, 'rules', 'task-reports', '2026-04', heavySampleTask);
  const lightTask = '260330_045';
  const lightDir = path.join(REPO_ROOT, 'rules', 'task-reports', '2026-03');

  const heavyCoverage = runGate({ taskId: heavySampleTask, resultDir: heavySampleDir, profile: 'heavy', extraEnv: { GATE_LIGHT_GENERATE_PREVIEW: '1' } });
  const heavySuccess = runGate({ taskId: currentTask, resultDir: currentDir, profile: 'heavy' });
  const heavyInsufficient = runGate({ taskId: currentTask, resultDir: currentDir, profile: 'heavy', extraEnv: { GATE_SNIPPET_FORCE_FETCH: '1' } });
  const lightSmoke = runGate({ taskId: lightTask, resultDir: lightDir, profile: 'light' });

  const checks = {
    heavy_sample_260403002_exit_ok: heavyCoverage.exit_code === 0,
    heavy_sample_coverage_seen: /news_pull_response\.schema|Rank V2 Contract Verification|Export V1 Contract Verification|Ledger V0 Contract Verification/.test(heavyCoverage.out),
    heavy_success_exit_ok: heavySuccess.exit_code === 0,
    strategy_local_first: heavySuccess.out.includes('SNIPPET_GIT_STRATEGY=local_first'),
    fetch_not_needed: heavySuccess.out.includes('SNIPPET_GIT_FETCH_NEEDED=false'),
    snippet_verified: heavySuccess.out.includes('SnippetCommitMustMatch verified.'),
    heavy_mandatory_verified: heavySuccess.out.includes('Heavy mandatory evidence verified.'),
    heavy_info_insufficient_exit_ok: heavyInsufficient.exit_code === 0,
    fetch_needed_true: heavyInsufficient.out.includes('SNIPPET_GIT_FETCH_NEEDED=true'),
    fetch_reason_logged: heavyInsufficient.out.includes('SNIPPET_GIT_FETCH_REASON='),
    fetch_action_logged: heavyInsufficient.out.includes('SNIPPET_GIT_FETCH_ACTION=git fetch origin --deepen=50'),
    snippet_after_fetch_verified: heavyInsufficient.out.includes('SnippetCommitMustMatch verified.'),
    light_smoke_exit_ok: lightSmoke.exit_code === 0,
    light_profile_seen: lightSmoke.out.includes('TASK_PROFILE=light'),
    light_skiplist_seen: lightSmoke.out.includes('LIGHT profile: skipping heavy-only contract checks')
  };

  const pass = Object.values(checks).every(Boolean);
  const firstBreakLayer = pass ? 'NONE_CHAIN_PASS' : 'snippet_git_local_first';
  const standard = buildStandardResult({
    scriptName: 'truth_audit_snippet_git_local_first_260403_006',
    taskId: args.taskId,
    sampleName: args.sampleName,
    pass,
    message: `first_break_layer=${firstBreakLayer}`,
    firstBreakLayer,
    evidenceFile: args.output,
    summary: { first_break_layer: firstBreakLayer, pass },
    rawExcerpt: { checks }
  });

  const output = {
    ...standard,
    task_id: args.taskId,
    conclusion_block: { verdict: pass ? 'A：通过' : 'C：存在断裂', first_break_layer: firstBreakLayer },
    evidence_index: {
      checks,
      git_strategy: 'local_first',
      heavy_success_excerpt: heavySuccess.out.split('\n').filter((l) => /SNIPPET_GIT_STRATEGY=local_first|SNIPPET_GIT_FETCH_NEEDED=false|SnippetCommitMustMatch verified|Heavy mandatory evidence verified|HEAVY_PARALLEL_START|MOCK_SERVER_SESSION|HEAVY_ENDPOINT_HARD_TIMEOUT_MS=4000/.test(l)).slice(0, 120),
      heavy_info_insufficient_excerpt: heavyInsufficient.out.split('\n').filter((l) => /SNIPPET_GIT_FETCH_NEEDED=true|SNIPPET_GIT_FETCH_REASON=|SNIPPET_GIT_FETCH_ACTION=|SnippetCommitMustMatch verified/.test(l)).slice(0, 120),
      light_smoke_excerpt: lightSmoke.out.split('\n').filter((l) => /TASK_PROFILE=light|LIGHT profile: skipping heavy-only contract checks|GATE_LIGHT_EXIT=0/.test(l)).slice(0, 80)
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
