import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildStandardResult, ensureDir, parseVerifyArgs, writeStandardLog } from './verify_standard_v1.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_TASK_ID = '260406_031';
const DEFAULT_BASE_URL = 'http://localhost:53123';

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: DEFAULT_BASE_URL,
  defaultOutputSuffix: 'truth_audit_t5_order_win_rate_260406_031',
  defaultSampleName: 't5_order_win_rate'
});

const main = async () => {
  const args = parseArgs();
  const serverFile = fs.readFileSync(path.join(REPO_ROOT, 'strategies', 'crypto_binary', 'server.mjs'), 'utf8');
  const uiFile = fs.readFileSync(path.join(REPO_ROOT, 'ui', 'js', 'strategy-editor.js'), 'utf8');
  const latest = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'rules', 'LATEST.json'), 'utf8'));

  const checks = {
    server_has_winning_order_total: /winning_order_total/.test(serverFile),
    server_has_order_win_rate: /order_win_rate/.test(serverFile),
    server_order_win_rate_formula_by_filled_total: /const orderWinRate = filledTotal > 0 \? \(winningOrderTotal \/ filledTotal\) : 0;/.test(serverFile),
    ui_label_is_order_win_rate: /订单胜率/.test(uiFile),
    ui_uses_winning_order_total_over_filled_total: /orderWinNumerator[\s\S]*summary\?\.winning_order_total[\s\S]*orderWinDenominator[\s\S]*summary\?\.filled_total/.test(uiFile),
    ui_note_declares_order_formula: /订单胜率=盈利订单\/总成交订单/.test(uiFile),
    latest_points_to_260406_031: latest.task_id === args.taskId,
    governance_substitute_pass: false
  };
  checks.governance_substitute_pass = Object.entries(checks)
    .filter(([k]) => k !== 'governance_substitute_pass')
    .every(([, v]) => Boolean(v));

  const pass = checks.governance_substitute_pass;
  const firstBreakLayer = pass ? 'NONE_CHAIN_PASS' : 't5_order_win_rate';
  const standard = buildStandardResult({
    scriptName: 'truth_audit_t5_order_win_rate_260406_031',
    taskId: args.taskId,
    sampleName: args.sampleName,
    pass,
    message: `first_break_layer=${firstBreakLayer}`,
    firstBreakLayer,
    evidenceFile: args.output,
    summary: { pass, first_break_layer: firstBreakLayer, checks },
    rawExcerpt: {
      fail_to_pass: {
        before: 'win_rate_by_window',
        after: pass ? 'win_rate_by_orders' : 'order_win_rate_not_fixed'
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
