import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createBotOrderLedger } from '../strategies/crypto_binary/bot_order_ledger.mjs';
import { buildStandardResult, ensureDir, parseVerifyArgs, writeStandardLog } from './verify_standard_v1.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_TASK_ID = '260406_034';
const DEFAULT_BASE_URL = 'http://localhost:53123';

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: DEFAULT_BASE_URL,
  defaultOutputSuffix: 'truth_audit_cancel_scope_entry_only_260406_034',
  defaultSampleName: 'cancel_scope_entry_only'
});

const runRuntimeSample = () => {
  const ledger = createBotOrderLedger();
  ledger.applyAction('PLACE_YES_LADDER', {
    ladder: [{ price: 0.2, size: 1, tp_price: 0.9 }],
    source: 'audit_window'
  });
  ledger.applyAction('PLACE_NO_LADDER', {
    ladder: [{ price: 0.3, size: 1, tp_price: 0.9 }],
    source: 'audit_window'
  });
  ledger.applyFills({
    window_id: 'audit_window',
    ask_yes: 0.2,
    ask_no: 0.99,
    bid_yes: 0.19,
    bid_no: 0.01
  });
  const beforeCancel = ledger.getOrders();
  const beforeTpOpen = beforeCancel.filter((o) => o.kind === 'TAKE_PROFIT' && o.status === 'OPEN').length;
  ledger.applyAction('CANCEL_ALL_OPEN', { source: 'audit_cancel' });
  const afterCancel = ledger.getOrders();
  const tpOpenAfter = afterCancel.filter((o) => o.kind === 'TAKE_PROFIT' && o.status === 'OPEN').length;
  const entryCancelled = afterCancel.filter((o) => o.kind === 'ENTRY' && o.status === 'CANCELLED').length;
  const tpCancelled = afterCancel.filter((o) => o.kind === 'TAKE_PROFIT' && o.status === 'CANCELLED').length;
  return {
    beforeTpOpen,
    tpOpenAfter,
    entryCancelled,
    tpCancelled,
    snapshot: afterCancel
  };
};

const main = async () => {
  const args = parseArgs();
  const ledgerFile = fs.readFileSync(path.join(REPO_ROOT, 'strategies', 'crypto_binary', 'bot_order_ledger.mjs'), 'utf8');
  const latest = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'rules', 'LATEST.json'), 'utf8'));
  const runtime = runRuntimeSample();

  const checks = {
    cancel_open_scope_restricted_to_entry_in_code: /order\.status === 'OPEN' && order\.kind === 'ENTRY'/.test(ledgerFile),
    runtime_entry_orders_cancelled: runtime.entryCancelled > 0,
    runtime_take_profit_not_cancelled: runtime.tpCancelled === 0 && runtime.tpOpenAfter >= runtime.beforeTpOpen,
    latest_points_to_260406_034: latest.task_id === args.taskId,
    governance_substitute_pass: false
  };
  checks.governance_substitute_pass = Object.entries(checks)
    .filter(([k]) => k !== 'governance_substitute_pass')
    .every(([, v]) => Boolean(v));

  const pass = checks.governance_substitute_pass;
  const firstBreakLayer = pass ? 'NONE_CHAIN_PASS' : 'cancel_scope_entry_only';
  const standard = buildStandardResult({
    scriptName: 'truth_audit_cancel_scope_entry_only_260406_034',
    taskId: args.taskId,
    sampleName: args.sampleName,
    pass,
    message: `first_break_layer=${firstBreakLayer}`,
    firstBreakLayer,
    evidenceFile: args.output,
    summary: { pass, first_break_layer: firstBreakLayer, checks },
    rawExcerpt: {
      fail_to_pass: {
        before: 'cancel_rules_can_remove_take_profit_orders',
        after: pass ? 'cancel_rules_entry_only_take_profit_protected' : 'cancel_scope_not_fixed'
      },
      real_runtime: {
        pass: checks.runtime_entry_orders_cancelled && checks.runtime_take_profit_not_cancelled,
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
