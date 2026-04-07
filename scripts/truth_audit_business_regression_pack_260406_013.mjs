import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildStandardResult, ensureDir, parseVerifyArgs, writeStandardLog } from './verify_standard_v1.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

const DEFAULT_TASK_ID = '260406_013';
const DEFAULT_BASE_URL = 'http://localhost:53123';

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: DEFAULT_BASE_URL,
  defaultOutputSuffix: 'truth_audit_business_regression_pack_260406_013',
  defaultSampleName: 'business_regression_pack'
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
  const reportDir = path.join(REPO_ROOT, 'rules', 'task-reports', '2026-04');
  const requiredTruthAudits = [
    '260406_006_truth_audit_bot_api_invalid_json_260406_006.json',
    '260406_007_truth_audit_bot_api_payload_shape_260406_007.json',
    '260406_008_truth_audit_bot_runner_tick_payload_guard_260406_008.json',
    '260406_009_truth_audit_json_guard_remaining_endpoints_260406_009.json',
    '260406_010_truth_audit_json_error_semantics_260406_010.json',
    '260406_011_truth_audit_runner_tick_contract_260406_011.json'
  ];

  const truthAuditChecks = requiredTruthAudits.map((name) => {
    const abs = path.join(reportDir, name);
    const json = readJson(abs);
    return {
      name,
      exists: fs.existsSync(abs),
      pass: json?.pass === true,
      first_break_layer: json?.first_break_layer || null
    };
  });

  const semanticsDocPath = path.join(REPO_ROOT, 'docs', 'standards', 'api_json_error_semantics.md');
  const semanticsDoc = fs.existsSync(semanticsDocPath) ? fs.readFileSync(semanticsDocPath, 'utf8') : '';
  const latest = readJson(path.join(REPO_ROOT, 'rules', 'LATEST.json'));

  const checks = {
    regression_truth_audits_all_exist: truthAuditChecks.every((x) => x.exists),
    regression_truth_audits_all_pass: truthAuditChecks.every((x) => x.pass),
    semantics_doc_declares_invalid_json_payload: /invalid json payload/.test(semanticsDoc),
    semantics_doc_declares_invalid_json_payload_type: /invalid json payload type/.test(semanticsDoc),
    latest_points_to_260406_013: latest?.task_id === args.taskId,
    governance_substitute_pass: false
  };
  checks.governance_substitute_pass = Object.entries(checks)
    .filter(([k]) => k !== 'governance_substitute_pass')
    .every(([, v]) => Boolean(v));

  const pass = checks.governance_substitute_pass;
  const firstBreakLayer = pass ? 'NONE_CHAIN_PASS' : 'business_regression_pack';
  const standard = buildStandardResult({
    scriptName: 'truth_audit_business_regression_pack_260406_013',
    taskId: args.taskId,
    sampleName: args.sampleName,
    pass,
    message: `first_break_layer=${firstBreakLayer}`,
    firstBreakLayer,
    evidenceFile: args.output,
    summary: { pass, first_break_layer: firstBreakLayer, checks },
    rawExcerpt: {
      fail_to_pass: {
        before: 'regression_pack_not_built',
        after: pass ? 'regression_pack_built' : 'regression_pack_incomplete'
      },
      governance_substitute: {
        pass: checks.governance_substitute_pass
      },
      checks,
      truth_audit_checks: truthAuditChecks
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
