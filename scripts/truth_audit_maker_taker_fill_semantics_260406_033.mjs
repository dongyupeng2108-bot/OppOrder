import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createBotOrderLedger } from '../strategies/crypto_binary/bot_order_ledger.mjs';
import { buildStandardResult, ensureDir, parseVerifyArgs, writeStandardLog } from './verify_standard_v1.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_TASK_ID = '260406_033';
const DEFAULT_BASE_URL = 'http://localhost:53123';

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: DEFAULT_BASE_URL,
  defaultOutputSuffix: 'truth_audit_maker_taker_fill_semantics_260406_033',
  defaultSampleName: 'maker_taker_fill_semantics'
});

const runLedgerSamples = () => {
  const makerLedger = createBotOrderLedger();
  makerLedger.applyAction('PLACE_NO_LADDER', {
    ladder: [{ price: 0.4, size: 2, tp_price: 1 }],
    source: 'audit_maker'
  });
  const makerFill = makerLedger.applyFills({ window_id: 'w-maker', ask_no: 0.22, ask_yes: 0.8, bid_no: 0.2, bid_yes: 0.2 });
  const makerOrder = (makerFill.filled_orders || [])[0] || null;

  const takerLedger = createBotOrderLedger();
  takerLedger.applyAction('PLACE_NO_LADDER', {
    ladder: [{ price: 0.4, size: 2, tp_price: 1 }],
    source: 'audit_taker',
    post_mode: 'immediate_taker'
  });
  const takerFill = takerLedger.applyFills({ window_id: 'w-taker', ask_no: 0.22, ask_yes: 0.8, bid_no: 0.2, bid_yes: 0.2 });
  const takerOrder = (takerFill.filled_orders || [])[0] || null;
  return { makerOrder, takerOrder };
};

const main = async () => {
  const args = parseArgs();
  const ledgerFile = fs.readFileSync(path.join(REPO_ROOT, 'strategies', 'crypto_binary', 'bot_order_ledger.mjs'), 'utf8');
  const latest = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'rules', 'LATEST.json'), 'utf8'));
  const { makerOrder, takerOrder } = runLedgerSamples();

  const checks = {
    has_post_mode_field_in_order: /post_mode/.test(ledgerFile),
    has_posted_price_field_in_order: /posted_price/.test(ledgerFile),
    default_post_mode_is_resting_maker: /DEFAULT_POST_MODE = 'resting_maker'/.test(ledgerFile),
    runtime_maker_fill_price_equals_posted_price: makerOrder?.post_mode === 'resting_maker'
      && Number(makerOrder?.fill_price) === Number(makerOrder?.posted_price),
    runtime_taker_fill_price_equals_market_price: takerOrder?.post_mode === 'immediate_taker'
      && Number(takerOrder?.fill_price) === 0.22,
    latest_points_to_260406_033: latest.task_id === args.taskId,
    governance_substitute_pass: false
  };
  checks.governance_substitute_pass = Object.entries(checks)
    .filter(([k]) => k !== 'governance_substitute_pass')
    .every(([, v]) => Boolean(v));

  const pass = checks.governance_substitute_pass;
  const firstBreakLayer = pass ? 'NONE_CHAIN_PASS' : 'maker_taker_fill_semantics';
  const standard = buildStandardResult({
    scriptName: 'truth_audit_maker_taker_fill_semantics_260406_033',
    taskId: args.taskId,
    sampleName: args.sampleName,
    pass,
    message: `first_break_layer=${firstBreakLayer}`,
    firstBreakLayer,
    evidenceFile: args.output,
    summary: { pass, first_break_layer: firstBreakLayer, checks },
    rawExcerpt: {
      fail_to_pass: {
        before: 'entry_fill_price_uses_market_price_even_for_resting_maker',
        after: pass ? 'maker_taker_fill_semantics_split_applied' : 'maker_taker_fill_semantics_not_fixed'
      },
      real_runtime: {
        pass: checks.runtime_maker_fill_price_equals_posted_price && checks.runtime_taker_fill_price_equals_market_price,
        maker_sample: makerOrder,
        taker_sample: takerOrder
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
