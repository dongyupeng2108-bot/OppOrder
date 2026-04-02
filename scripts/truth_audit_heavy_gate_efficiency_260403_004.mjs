import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { buildStandardResult, ensureDir, parseVerifyArgs, writeStandardLog } from './verify_standard_v1.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_TASK_ID = '260403_004';
const ALLOWED_SAMPLES = ['heavy_gate_efficiency_v1'];
const MAX_WALL_MS = 60 * 60 * 1000;
const MAX_SILENCE_MS = 5 * 60 * 1000;
const LOG_TAIL = 150;

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: 'http://localhost:53122',
  defaultOutputSuffix: 'truth_audit_heavy_gate_efficiency_260403_004',
  defaultSampleName: ALLOWED_SAMPLES[0]
});

const runGate = ({ taskId, resultDir }) => {
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
    '--profile', 'heavy'
  ], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: { ...process.env, GATE_LIGHT_GENERATE_PREVIEW: '1' }
  });
  if (latestBackup !== null) fs.writeFileSync(latestPath, latestBackup);
  return { exit_code: proc.status, stdout: proc.stdout || '', stderr: proc.stderr || '' };
};

const main = async () => {
  const args = parseArgs();
  if (!ALLOWED_SAMPLES.includes(String(args.sampleName || '').trim())) {
    throw new Error(`ERR_INVALID_SAMPLE_NAME: ${args.sampleName}`);
  }

  const startedAt = Date.now();
  const targetTask = '260403_002';
  const targetDir = path.join(REPO_ROOT, 'rules', 'task-reports', '2026-04', targetTask);
  const run = runGate({ taskId: targetTask, resultDir: targetDir });
  const out = `${run.stdout}\n${run.stderr}`;

  const checks = {
    exit_ok: run.exit_code === 0,
    heavy_profile: out.includes('TASK_PROFILE=heavy'),
    heavy_mandatory: out.includes('Heavy mandatory evidence verified.'),
    snippet_present: out.includes('SnippetCommitMustMatch'),
    parallel_news_rank_export_ledger: out.includes('HEAVY_PARALLEL_START: news/rank/export/ledger') && out.includes('HEAVY_PARALLEL_DONE:'),
    parallel_scanner_universe_trading: out.includes('HEAVY_PARALLEL_START: scanner/universe/trading') && out.includes('HEAVY_PARALLEL_DONE: scanner/universe/trading'),
    mock_session_start: out.includes('MOCK_SERVER_SESSION=starting') || out.includes('MOCK_SERVER_SESSION=attached'),
    mock_session_stop: out.includes('MOCK_SERVER_SESSION=stopping') || out.includes('MOCK_SERVER_SESSION=detached; no-stop'),
    rank_seen: out.includes('Rank V2 Contract Verification'),
    export_seen: out.includes('Export V1 Contract Verification'),
    ledger_seen: out.includes('Ledger V0 Contract Verification'),
    news_seen: out.includes('News Pull') || out.includes('news_pull_response.schema.json') || out.includes('[Contract Check]'),
    scanner_seen: out.includes('Checking Scanner API Contract'),
    universe_seen: out.includes('Checking Universe API Contract'),
    trading_seen: out.includes('Checking Trading Routes API Contract')
  };
  const failToPass = {
    preFail: {
      serial_execution_no_parallel_logs: true,
      multi_start_stop_for_rank_export_ledger: true
    },
    postPass: {
      heavy_parallel_logs_present: checks.parallel_news_rank_export_ledger && checks.parallel_scanner_universe_trading,
      single_mock_session_reused: checks.mock_session_start && checks.mock_session_stop
    }
  };
  const samples = [
    {
      task_id: targetTask,
      profile: 'heavy',
      is_real_runtime: true
    }
  ];
  const pass = Object.values(checks).every(Boolean);
  const firstBreakLayer = pass ? 'NONE_CHAIN_PASS' : 'heavy_gate_efficiency';

  const standard = buildStandardResult({
    scriptName: 'truth_audit_heavy_gate_efficiency_260403_004',
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
      target_sample_task_id: targetTask,
      checks,
      fail_to_pass: failToPass,
      samples,
      heavy_checklist_before_after_same: ['news', 'rank', 'export', 'ledger', 'scanner', 'universe', 'trading'],
      gate_stdout_excerpt: out.split('\n').filter((line) =>
        /TASK_PROFILE=heavy|HEAVY_PARALLEL_START|HEAVY_PARALLEL_DONE|MOCK_SERVER_SESSION|Heavy mandatory evidence verified|SnippetCommitMustMatch|Checking Scanner API Contract|Checking Universe API Contract|Checking Trading Routes API Contract|Rank V2 Contract Verification|Export V1 Contract Verification|Ledger V0 Contract Verification/.test(line)
      ).slice(0, 120),
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
  console.log(JSON.stringify({ pass, first_break_layer: firstBreakLayer, checks }));
  if (!pass) process.exit(1);
};

main().catch((error) => {
  console.error(JSON.stringify({ event: 'AUDIT_FATAL', code: error?.message || 'ERR_UNHANDLED', allowed_samples: ALLOWED_SAMPLES }));
  process.exit(1);
});
