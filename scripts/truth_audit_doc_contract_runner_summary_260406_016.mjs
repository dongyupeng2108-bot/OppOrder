import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildStandardResult, ensureDir, parseVerifyArgs, writeStandardLog } from './verify_standard_v1.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

const DEFAULT_TASK_ID = '260406_016';
const DEFAULT_BASE_URL = 'http://localhost:53123';

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: DEFAULT_BASE_URL,
  defaultOutputSuffix: 'truth_audit_doc_contract_runner_summary_260406_016',
  defaultSampleName: 'doc_contract_runner_summary'
});

const readJson = (absPath) => {
  try {
    return JSON.parse(fs.readFileSync(absPath, 'utf8'));
  } catch {
    return null;
  }
};

const main = async () => {
  const args = parseArgs();
  const contractPath = path.join(REPO_ROOT, 'docs', 'BOT_HTTP_CONTRACT.md');
  const statusExamplePath = path.join(REPO_ROOT, 'docs', 'examples', 'bot_status.example.json');
  const runnerSummaryExamplePath = path.join(REPO_ROOT, 'docs', 'examples', 'bot_runner_last_summary.example.json');
  const verifyScriptPath = path.join(REPO_ROOT, 'scripts', 'verify_doc_contract_examples.mjs');
  const latestPath = path.join(REPO_ROOT, 'rules', 'LATEST.json');

  const contract = fs.existsSync(contractPath) ? fs.readFileSync(contractPath, 'utf8') : '';
  const statusExample = readJson(statusExamplePath) || {};
  const runnerSummaryExample = readJson(runnerSummaryExamplePath) || {};
  const verifyScript = fs.existsSync(verifyScriptPath) ? fs.readFileSync(verifyScriptPath, 'utf8') : '';
  const latest = readJson(latestPath) || {};

  const checks = {
    contract_declares_tick_summary: /tick_summary/.test(contract),
    contract_declares_runner_last_summary_endpoint: /GET \/bot\/runner\/last-summary/.test(contract),
    status_example_has_last_tick_summary: Object.prototype.hasOwnProperty.call(statusExample, 'last_tick_summary')
      && Object.prototype.hasOwnProperty.call(statusExample?.active_runtime_snapshot || {}, 'last_tick_summary'),
    runner_summary_example_has_required_keys: ['ok', 'last_tick_at', 'last_tick_summary']
      .every((k) => Object.prototype.hasOwnProperty.call(runnerSummaryExample, k)),
    verify_script_checks_runner_summary_example: /bot_runner_last_summary\.example\.json/.test(verifyScript),
    latest_points_to_260406_016: latest.task_id === args.taskId,
    governance_substitute_pass: false
  };
  checks.governance_substitute_pass = Object.entries(checks)
    .filter(([k]) => k !== 'governance_substitute_pass')
    .every(([, v]) => Boolean(v));

  const pass = checks.governance_substitute_pass;
  const firstBreakLayer = pass ? 'NONE_CHAIN_PASS' : 'doc_contract_runner_summary';
  const standard = buildStandardResult({
    scriptName: 'truth_audit_doc_contract_runner_summary_260406_016',
    taskId: args.taskId,
    sampleName: args.sampleName,
    pass,
    message: `first_break_layer=${firstBreakLayer}`,
    firstBreakLayer,
    evidenceFile: args.output,
    summary: { pass, first_break_layer: firstBreakLayer, checks },
    rawExcerpt: {
      fail_to_pass: {
        before: 'doc_contract_runner_summary_incomplete',
        after: pass ? 'doc_contract_runner_summary_complete' : 'doc_contract_runner_summary_still_broken'
      },
      governance_substitute: {
        pass: checks.governance_substitute_pass
      },
      checks
    }
  });

  ensureDir(args.output);
  const outputJson = { ...standard, task_id: args.taskId, task_type: 'business_implementation', checks };
  fs.writeFileSync(args.output, JSON.stringify(outputJson, null, 2));
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
