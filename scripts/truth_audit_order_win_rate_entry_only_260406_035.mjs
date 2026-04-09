import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createBotOrderLedger } from '../strategies/crypto_binary/bot_order_ledger.mjs';
import { buildStandardResult, ensureDir, parseVerifyArgs, writeStandardLog } from './verify_standard_v1.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_TASK_ID = '260406_035';
const DEFAULT_BASE_URL = 'http://localhost:53123';

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: DEFAULT_BASE_URL,
  defaultOutputSuffix: 'truth_audit_order_win_rate_entry_only_260406_035',
  defaultSampleName: 'order_win_rate_entry_only'
});

const runRuntimeLedgerSample = () => {
  const ledger = createBotOrderLedger();
  ledger.applyAction('PLACE_YES_LADDER', {
    ladder: [{ price: 0.2, size: 1, tp_price: 0.9 }],
    source: 'audit_entry_only'
  });
  ledger.applyFills({
    window_id: 'audit_entry_only',
    ask_yes: 0.2,
    ask_no: 0.99,
    bid_yes: 0.95,
    bid_no: 0.01
  });
  ledger.applyFills({
    window_id: 'audit_entry_only',
    ask_yes: 0.99,
    ask_no: 0.99,
    bid_yes: 0.95,
    bid_no: 0.01
  });
  const summary = ledger.getSummary();
  const orders = ledger.getOrders();
  const entryFilled = orders.filter((o) => o.status === 'FILLED' && o.kind === 'ENTRY').length;
  const exitFilled = orders.filter((o) => o.status === 'FILLED' && o.kind === 'TAKE_PROFIT').length;
  return {
    filled_total: summary?.filled_total ?? null,
    entry_filled_total: entryFilled,
    exit_filled_total: exitFilled
  };
};

const main = async () => {
  const args = parseArgs();
  const serverFile = fs.readFileSync(path.join(REPO_ROOT, 'strategies', 'crypto_binary', 'server.mjs'), 'utf8');
  const uiFile = fs.readFileSync(path.join(REPO_ROOT, 'ui', 'js', 'strategy-editor.js'), 'utf8');
  const latest = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'rules', 'LATEST.json'), 'utf8'));
  const runtime = runRuntimeLedgerSample();

  const checks = {
    postmortem_has_entry_filled_total_column: /bot_entry_filled_total/.test(serverFile),
    summary_uses_entry_filled_total_for_denominator: /const orderWinRate = entryFilledTotal > 0 \? \(winningEntryOrderTotal \/ entryFilledTotal\) : 0;/.test(serverFile),
    summary_exposes_entry_win_rate_fields: /entry_filled_total:\s*entryFilledTotal/.test(serverFile) && /winning_entry_order_total:\s*winningEntryOrderTotal/.test(serverFile),
    ui_uses_entry_filled_total_for_win_rate: /orderWinDenominator = toFinite\(summary\?\.entry_filled_total\)/.test(uiFile),
    ui_note_declares_entry_only_semantics: /平仓单不计入/.test(uiFile),
    runtime_sample_has_exit_fills_but_entry_count_distinct: runtime.filled_total > runtime.entry_filled_total && runtime.exit_filled_total > 0,
    latest_points_to_260406_035: latest.task_id === args.taskId,
    governance_substitute_pass: false
  };
  checks.governance_substitute_pass = Object.entries(checks)
    .filter(([k]) => k !== 'governance_substitute_pass')
    .every(([, v]) => Boolean(v));

  const pass = checks.governance_substitute_pass;
  const firstBreakLayer = pass ? 'NONE_CHAIN_PASS' : 'order_win_rate_entry_only';
  const standard = buildStandardResult({
    scriptName: 'truth_audit_order_win_rate_entry_only_260406_035',
    taskId: args.taskId,
    sampleName: args.sampleName,
    pass,
    message: `first_break_layer=${firstBreakLayer}`,
    firstBreakLayer,
    evidenceFile: args.output,
    summary: { pass, first_break_layer: firstBreakLayer, checks },
    rawExcerpt: {
      fail_to_pass: {
        before: 'win_rate_counts_exit_orders',
        after: pass ? 'win_rate_entry_only' : 'win_rate_still_counts_exit'
      },
      real_runtime: {
        pass: checks.runtime_sample_has_exit_fills_but_entry_count_distinct,
        runtime
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
