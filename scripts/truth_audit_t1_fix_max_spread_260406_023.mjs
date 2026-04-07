import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildStandardResult, ensureDir, parseVerifyArgs, writeStandardLog } from './verify_standard_v1.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_TASK_ID = '260406_023';
const DEFAULT_BASE_URL = 'http://localhost:53123';

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: DEFAULT_BASE_URL,
  defaultOutputSuffix: 'truth_audit_t1_fix_max_spread_260406_023',
  defaultSampleName: 't1_fix_max_spread'
});

const main = async () => {
  const args = parseArgs();
  const uiFile = fs.readFileSync(path.join(REPO_ROOT, 'ui', 'js', 'strategy-editor.js'), 'utf8');
  const backendFile = fs.readFileSync(path.join(REPO_ROOT, 'strategies', 'crypto_binary', 'server.mjs'), 'utf8');
  const latest = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'rules', 'LATEST.json'), 'utf8'));

  const checks = {
    backend_requires_max_spread_bps: backendFile.includes("max_spread_bps must be non-negative integer"),
    ui_has_input_param_max_spread_bps: /id="param_max_spread_bps"/.test(uiFile),
    ui_config_fields_contains_max_spread_bps: /BOT_CONFIG_FIELDS[\s\S]*max_spread_bps/.test(uiFile),
    ui_read_params_contains_max_spread_bps: /se_readParamsFromForm[\s\S]*max_spread_bps/.test(uiFile),
    ui_validate_contains_max_spread_bps_rule: /se_validateParams[\s\S]*max_spread_bps 必须为非负整数/.test(uiFile),
    ui_pick_config_contains_max_spread_bps: /se_pickBotConfig[\s\S]*max_spread_bps/.test(uiFile),
    latest_points_to_260406_023: latest.task_id === args.taskId,
    governance_substitute_pass: false
  };
  checks.governance_substitute_pass = Object.entries(checks)
    .filter(([k]) => k !== 'governance_substitute_pass')
    .every(([, v]) => Boolean(v));

  const pass = checks.governance_substitute_pass;
  const firstBreakLayer = pass ? 'NONE_CHAIN_PASS' : 't1_fix_max_spread';
  const standard = buildStandardResult({
    scriptName: 'truth_audit_t1_fix_max_spread_260406_023',
    taskId: args.taskId,
    sampleName: args.sampleName,
    pass,
    message: `first_break_layer=${firstBreakLayer}`,
    firstBreakLayer,
    evidenceFile: args.output,
    summary: { pass, first_break_layer: firstBreakLayer, checks },
    rawExcerpt: {
      fail_to_pass: {
        before: 'ui_contract_drift_detected',
        after: pass ? 'ui_contract_drift_fixed' : 'ui_contract_drift_not_fixed'
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
