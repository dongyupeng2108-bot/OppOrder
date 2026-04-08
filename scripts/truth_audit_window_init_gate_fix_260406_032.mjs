import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createBotRunner } from '../strategies/crypto_binary/bot_runner.mjs';
import { buildStandardResult, ensureDir, parseVerifyArgs, writeStandardLog } from './verify_standard_v1.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_TASK_ID = '260406_032';
const DEFAULT_BASE_URL = 'http://localhost:53123';

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: DEFAULT_BASE_URL,
  defaultOutputSuffix: 'truth_audit_window_init_gate_fix_260406_032',
  defaultSampleName: 'window_init_gate_fix'
});

const clone = (value) => JSON.parse(JSON.stringify(value));

const runRuntimeSample = async ({ boundsReady }) => {
  const logs = [];
  let state = {
    mode: 'PAPER',
    current_window_id: 'w-runtime-1',
    window_initialized_at: null,
    anchor_btc: 65000,
    atr_5m: 90,
    upper_bound: boundsReady ? 65108 : null,
    lower_bound: boundsReady ? 64892 : null,
    ladder_posted: false,
    yes_order_ids: [],
    no_order_ids: [],
    yes_cancelled: false,
    no_cancelled: false,
    phase: 'WAIT_WINDOW_INIT'
  };
  const patchState = (patch) => {
    state = { ...state, ...(patch || {}) };
    return clone(state);
  };
  const runner = createBotRunner({
    config: { open_delay_sec: 0 },
    getContext: async () => ({
      window_id: 'w-runtime-1',
      btc_price: 65000,
      remaining_sec: 260,
      updated_at: new Date().toISOString()
    }),
    getState: () => clone(state),
    patchState,
    decide: () => ({
      intents: [{ kind: 'PLACE_LADDER', side: 'YES', ladder: [{ price: 0.4, size: 1 }] }],
      reason: 'ladder_not_posted',
      patches: {},
      diagnostics: { sample_bounds_ready: boundsReady }
    }),
    applyIntents: async (intents) => ({ changed: intents.length, applied: [] }),
    applyFills: async () => ({ changed: 0, filled_orders: [], blocked_cross_window_candidates: [] }),
    getOrders: () => [],
    getSummary: () => ({ open_total: 0, cancelled_total: 0, filled_total: 0 }),
    log: (entry) => { logs.push(clone(entry)); }
  });
  const tick = await runner.runSingleTick();
  return {
    tick,
    logs,
    state_after: clone(state)
  };
};

const main = async () => {
  const args = parseArgs();
  const latest = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'rules', 'LATEST.json'), 'utf8'));
  const failSample = await runRuntimeSample({ boundsReady: false });
  const passSample = await runRuntimeSample({ boundsReady: true });

  const failReason = failSample?.tick?.decision_preview?.reason ?? null;
  const passReason = passSample?.tick?.decision_preview?.reason ?? null;
  const passWindowInitializedAt = passSample?.state_after?.window_initialized_at ?? null;
  const failHasGateLog = failSample.logs.some((log) => log?.event === 'BOT_DECISION_GATED');
  const passHasGateWindowInitLog = passSample.logs.some((log) => log?.event === 'BOT_DECISION_GATED' && log?.message === 'gate_context_not_ready_window_init');

  const checks = {
    runtime_fail_sample_hits_window_init_gate: failReason === 'gate_context_not_ready_window_init' && failHasGateLog,
    runtime_pass_sample_not_blocked_by_window_init_gate: passReason !== 'gate_context_not_ready_window_init' && !passHasGateWindowInitLog,
    runtime_pass_sample_backfills_window_initialized_at: typeof passWindowInitializedAt === 'string' && passWindowInitializedAt.length > 0,
    runtime_fail_to_pass_chain_verified: failReason === 'gate_context_not_ready_window_init' && passReason !== 'gate_context_not_ready_window_init',
    latest_points_to_260406_032: latest.task_id === args.taskId,
    governance_substitute_pass: false
  };
  checks.governance_substitute_pass = Object.entries(checks)
    .filter(([k]) => k !== 'governance_substitute_pass')
    .every(([, v]) => Boolean(v));

  const pass = checks.governance_substitute_pass;
  const firstBreakLayer = pass ? 'NONE_CHAIN_PASS' : 'window_init_gate_fix';
  const standard = buildStandardResult({
    scriptName: 'truth_audit_window_init_gate_fix_260406_032',
    taskId: args.taskId,
    sampleName: args.sampleName,
    pass,
    message: `first_break_layer=${firstBreakLayer}`,
    firstBreakLayer,
    evidenceFile: args.output,
    summary: { pass, first_break_layer: firstBreakLayer, checks },
    rawExcerpt: {
      fail_to_pass: {
        before: 'gate_context_not_ready_window_init_false_positive',
        after: pass ? 'window_init_gate_false_positive_fixed' : 'window_init_gate_not_fixed'
      },
      real_runtime: {
        pass: checks.runtime_fail_to_pass_chain_verified,
        sample_fail: {
          reason: failReason,
          gate_log_seen: failHasGateLog
        },
        sample_pass: {
          reason: passReason,
          gate_window_init_log_seen: passHasGateWindowInitLog,
          window_initialized_at: passWindowInitializedAt
        }
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
