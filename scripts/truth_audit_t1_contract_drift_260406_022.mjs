import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildStandardResult, ensureDir, parseVerifyArgs, writeStandardLog } from './verify_standard_v1.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_TASK_ID = '260406_022';
const DEFAULT_BASE_URL = 'http://localhost:53123';

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: DEFAULT_BASE_URL,
  defaultOutputSuffix: 'truth_audit_t1_contract_drift_260406_022',
  defaultSampleName: 't1_contract_drift'
});

const main = async () => {
  const args = parseArgs();
  const uiFile = fs.readFileSync(path.join(REPO_ROOT, 'ui', 'js', 'strategy-editor.js'), 'utf8');
  const backendFile = fs.readFileSync(path.join(REPO_ROOT, 'strategies', 'crypto_binary', 'server.mjs'), 'utf8');
  const latest = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'rules', 'LATEST.json'), 'utf8'));

  const checks = {
    backend_requires_max_spread_bps: backendFile.includes("max_spread_bps must be non-negative integer"),
    backend_allowed_keys_contains_max_spread_bps: backendFile.includes("'max_spread_bps'"),
    ui_config_fields_contains_max_spread_bps: /BOT_CONFIG_FIELDS[\s\S]*max_spread_bps/.test(uiFile),
    ui_save_payload_contains_max_spread_bps: /se_readParamsFromForm[\s\S]*max_spread_bps/.test(uiFile),
    ui_has_input_param_max_spread_bps: /id="param_max_spread_bps"/.test(uiFile),
    contract_drift_detected: false,
    latest_points_to_260406_022: latest.task_id === args.taskId,
    governance_substitute_pass: false
  };
  checks.contract_drift_detected = checks.backend_requires_max_spread_bps
    && checks.backend_allowed_keys_contains_max_spread_bps
    && (!checks.ui_config_fields_contains_max_spread_bps || !checks.ui_save_payload_contains_max_spread_bps || !checks.ui_has_input_param_max_spread_bps);

  checks.governance_substitute_pass = checks.backend_requires_max_spread_bps
    && checks.backend_allowed_keys_contains_max_spread_bps
    && checks.contract_drift_detected
    && checks.latest_points_to_260406_022;

  const pass = checks.governance_substitute_pass;
  const firstBreakLayer = pass ? 'NONE_CHAIN_PASS' : 't1_contract_drift';
  const standard = buildStandardResult({
    scriptName: 'truth_audit_t1_contract_drift_260406_022',
    taskId: args.taskId,
    sampleName: args.sampleName,
    pass,
    message: `first_break_layer=${firstBreakLayer}; contract_drift_detected=${checks.contract_drift_detected}`,
    firstBreakLayer,
    evidenceFile: args.output,
    summary: { pass, first_break_layer: firstBreakLayer, contract_drift_detected: checks.contract_drift_detected, checks },
    rawExcerpt: {
      fail_to_pass: {
        before: 't1_contract_drift_not_located',
        after: pass ? 't1_contract_drift_located' : 't1_contract_drift_not_confirmed'
      },
      checks,
      contract_drift_detected: checks.contract_drift_detected
    }
  });

  ensureDir(args.output);
  const outputJson = { ...standard, task_id: args.taskId, task_type: 'business_implementation', checks, contract_drift_detected: checks.contract_drift_detected };
  fs.writeFileSync(args.output, JSON.stringify(outputJson, null, 2));
  const verifyLog = writeStandardLog(args.output, standard);
  console.log(`VERIFY_OUTPUT=${args.output}`);
  console.log(`VERIFY_LOG=${verifyLog}`);
  console.log(JSON.stringify({ pass, first_break_layer: firstBreakLayer, contract_drift_detected: checks.contract_drift_detected, checks }));
  if (!pass) process.exitCode = 1;
};

main().catch((error) => {
  console.error(error?.message || String(error));
  process.exit(1);
});
