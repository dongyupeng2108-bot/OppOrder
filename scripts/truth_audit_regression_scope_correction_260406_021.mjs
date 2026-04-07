import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildStandardResult, ensureDir, parseVerifyArgs, writeStandardLog } from './verify_standard_v1.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

const DEFAULT_TASK_ID = '260406_021';
const DEFAULT_BASE_URL = 'http://localhost:53123';

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: DEFAULT_BASE_URL,
  defaultOutputSuffix: 'truth_audit_regression_scope_correction_260406_021',
  defaultSampleName: 'regression_scope_correction'
});

const readJson = (absPath) => {
  try {
    return JSON.parse(fs.readFileSync(absPath, 'utf8'));
  } catch {
    return null;
  }
};

const checkAudit = (dir, name) => {
  const abs = path.join(dir, name);
  const json = readJson(abs);
  return {
    name,
    exists: fs.existsSync(abs),
    pass: json?.pass === true,
    first_break_layer: json?.first_break_layer || null
  };
};

const main = async () => {
  const args = parseArgs();
  const reportDir = path.join(REPO_ROOT, 'rules', 'task-reports', '2026-04');

  const baseline = checkAudit(reportDir, '260406_013_truth_audit_business_regression_pack_260406_013.json');
  const extensions = [
    checkAudit(reportDir, '260406_014_truth_audit_runner_tick_observability_260406_014.json'),
    checkAudit(reportDir, '260406_015_truth_audit_runner_last_summary_260406_015.json'),
    checkAudit(reportDir, '260406_016_truth_audit_doc_contract_runner_summary_260406_016.json'),
    checkAudit(reportDir, '260406_017_truth_audit_runner_summary_version_260406_017.json'),
    checkAudit(reportDir, '260406_018_truth_audit_bot_logs_filters_260406_018.json')
  ];

  const contractDocPath = path.join(REPO_ROOT, 'docs', 'BOT_HTTP_CONTRACT.md');
  const contractDoc = fs.existsSync(contractDocPath) ? fs.readFileSync(contractDocPath, 'utf8') : '';
  const latest = readJson(path.join(REPO_ROOT, 'rules', 'LATEST.json')) || {};

  const checks = {
    baseline_260406_013_exists_and_pass: baseline.exists && baseline.pass,
    extensions_260406_014_to_018_all_exist: extensions.every((x) => x.exists),
    extensions_260406_014_to_018_all_pass: extensions.every((x) => x.pass),
    contract_declares_runner_last_summary: /GET \/bot\/runner\/last-summary/.test(contractDoc),
    contract_declares_logs_filters: /GET \/bot\/logs/.test(contractDoc) && /event/.test(contractDoc) && /window_id/.test(contractDoc),
    latest_points_to_260406_021: latest.task_id === args.taskId,
    governance_substitute_pass: false
  };
  checks.governance_substitute_pass = Object.entries(checks)
    .filter(([k]) => k !== 'governance_substitute_pass')
    .every(([, v]) => Boolean(v));

  const pass = checks.governance_substitute_pass;
  const firstBreakLayer = pass ? 'NONE_CHAIN_PASS' : 'regression_scope_correction';
  const effectiveCoverage = '260406_013 baseline + 260406_014~260406_018 extensions';
  const standard = buildStandardResult({
    scriptName: 'truth_audit_regression_scope_correction_260406_021',
    taskId: args.taskId,
    sampleName: args.sampleName,
    pass,
    message: `first_break_layer=${firstBreakLayer}; effective_coverage=${effectiveCoverage}`,
    firstBreakLayer,
    evidenceFile: args.output,
    summary: { pass, first_break_layer: firstBreakLayer, effective_coverage: effectiveCoverage, checks },
    rawExcerpt: {
      fail_to_pass: {
        before: 'regression_scope_statement_not_aligned',
        after: pass ? 'regression_scope_statement_aligned' : 'regression_scope_statement_still_misaligned'
      },
      governance_substitute: {
        pass: checks.governance_substitute_pass
      },
      checks,
      effective_coverage: effectiveCoverage,
      baseline,
      extensions
    }
  });

  ensureDir(args.output);
  const outputJson = { ...standard, task_id: args.taskId, task_type: 'business_implementation', checks, effective_coverage: effectiveCoverage };
  fs.writeFileSync(args.output, JSON.stringify(outputJson, null, 2));
  const verifyLog = writeStandardLog(args.output, standard);
  console.log(`VERIFY_OUTPUT=${args.output}`);
  console.log(`VERIFY_LOG=${verifyLog}`);
  console.log(JSON.stringify({ pass, first_break_layer: firstBreakLayer, effective_coverage: effectiveCoverage, checks }));
  if (!pass) process.exitCode = 1;
};

main().catch((error) => {
  console.error(error?.message || String(error));
  process.exit(1);
});
