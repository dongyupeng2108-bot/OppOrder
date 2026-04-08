import fs from 'fs';
import http from 'http';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { buildStandardResult, ensureDir, parseVerifyArgs, writeStandardLog } from './verify_standard_v1.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_TASK_ID = '260406_032';
const DEFAULT_BASE_URL = 'http://localhost:54132';

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: DEFAULT_BASE_URL,
  defaultOutputSuffix: 'truth_audit_window_init_gate_fix_260406_032',
  defaultSampleName: 'window_init_gate_fix'
});

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const toFinite = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};
const parseJson = (text) => {
  try {
    return JSON.parse(String(text || '{}'));
  } catch {
    return {};
  }
};
const requestPath = (urlObj, pathName, method, body, headers = {}) => new Promise((resolve, reject) => {
  const req = http.request({
    hostname: urlObj.hostname,
    port: Number(urlObj.port),
    path: pathName,
    method,
    headers
  }, (res) => {
    let data = '';
    res.on('data', (chunk) => { data += String(chunk); });
    res.on('end', () => resolve({ status: res.statusCode || 0, body: data }));
  });
  req.on('error', reject);
  if (body) req.write(body);
  req.end();
});
const waitForHealth = async (urlObj, maxRetry = 60) => {
  for (let i = 0; i < maxRetry; i += 1) {
    try {
      const res = await requestPath(urlObj, '/', 'GET');
      if (res.status === 200) return true;
    } catch {}
    await wait(200);
  }
  return false;
};

const loadHistoricalFailSample = () => {
  const recoveryPath = path.join(REPO_ROOT, 'data', 'crypto_binary', 'bot_runtime_recovery_53167.json');
  const body = parseJson(fs.readFileSync(recoveryPath, 'utf8'));
  const state = body?.state || {};
  const boundsReady = toFinite(state.anchor_btc) !== null
    && toFinite(state.upper_bound) !== null
    && toFinite(state.lower_bound) !== null;
  return {
    sample_source: recoveryPath,
    reason: state?.last_reason ?? null,
    window_initialized_at: state?.window_initialized_at ?? null,
    bounds_ready: boundsReady,
    intents_summary: Array.isArray(state?.last_intents) ? state.last_intents.map((x) => x?.kind || 'UNKNOWN').join(',') : null
  };
};

const main = async () => {
  const args = parseArgs();
  const baseUrl = new URL(args.baseUrl || DEFAULT_BASE_URL);
  const port = Number(baseUrl.port || 54132);
  const headers = { 'Content-Type': 'application/json' };
  const strategy = process.env.AUDIT_STRATEGY_ID || 'btc_15m';
  const latest = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'rules', 'LATEST.json'), 'utf8'));
  const historicalFail = loadHistoricalFailSample();
  const child = spawn(process.execPath, ['strategies/crypto_binary/server.mjs', `--strategy=${strategy}`, `--port=${port}`], {
    cwd: REPO_ROOT,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += String(chunk); });
  child.stderr.on('data', (chunk) => { stderr += String(chunk); });

  let passReason = null;
  let passIntentsSummary = null;
  let passWindowInitializedAt = null;
  let passHasGateWindowInitLog = false;
  let runtimeServerStarted = false;
  let passTickStatusOk = false;
  let passTickHttpStatus = 0;
  let passTickBodySnippet = '';
  try {
    runtimeServerStarted = await waitForHealth(baseUrl);
    if (!runtimeServerStarted) throw new Error('server not healthy in time');
    await requestPath(baseUrl, '/bot/stop', 'POST', JSON.stringify({}), headers);
    await requestPath(baseUrl, '/bot/config', 'POST', JSON.stringify({
      open_delay_sec: 0,
      max_spread_bps: 10000,
      ladder_prices: [0.4],
      ladder_size: 1,
      atr_multiple: 1.2,
      cancel_all_remaining_sec: 100,
      up_ladder: [{ price: 0.4, size: 2, tp_price: 0.85 }],
      down_ladder: [{ price: 0.4, size: 1, tp_price: 0.9 }],
      up_cancel: { before_end_sec: 20, formula: '' },
      down_cancel: { before_end_sec: 20, formula: '' }
    }), headers);

    const tickRes = await requestPath(baseUrl, '/bot/runner/tick', 'POST', JSON.stringify({
      state_override: {
        current_window_id: 'w-rt-032-pass',
        ladder_posted: false,
        yes_order_ids: [],
        no_order_ids: [],
        yes_cancelled: false,
        no_cancelled: false,
        up_formula_cancelled: false,
        down_formula_cancelled: false,
        anchor_btc: 65000,
        atr_5m: 90,
        upper_bound: 70000,
        lower_bound: 60000
      },
      context_override: {
        window_id: 'w-rt-032-pass',
        period: '5m',
        remaining_sec: 240,
        btc_price: 65385.2,
        atr_5m: 90,
        bid_yes: 0.4,
        ask_yes: 0.41,
        bid_no: 0.58,
        ask_no: 0.59,
        upper_bound: 70000,
        lower_bound: 60000
      }
    }), headers);
    const tickBody = parseJson(tickRes.body);
    passTickHttpStatus = tickRes.status;
    passTickStatusOk = tickRes.status === 200 && tickBody?.ok === true;
    passTickBodySnippet = String(tickRes.body || '').slice(0, 600);
    passReason = tickBody?.tick_summary?.reason ?? tickBody?.decision_preview?.reason ?? null;
    passIntentsSummary = tickBody?.tick_summary?.intents_summary ?? tickBody?.decision_preview?.intents_summary ?? null;
    passWindowInitializedAt = tickBody?.state_after?.window_initialized_at ?? null;
    const runtimeSummaryRes = await requestPath(baseUrl, '/bot/runner/last-summary', 'GET');
    const runtimeSummaryBody = parseJson(runtimeSummaryRes.body);
    passReason = passReason ?? runtimeSummaryBody?.last_tick_summary?.reason ?? null;
    passIntentsSummary = passIntentsSummary ?? runtimeSummaryBody?.last_tick_summary?.intents_summary ?? null;
    const statusRes = await requestPath(baseUrl, '/bot/status', 'GET');
    const statusBody = parseJson(statusRes.body);
    passWindowInitializedAt = passWindowInitializedAt ?? statusBody?.window_initialized_at ?? null;

    const logsRes = await requestPath(baseUrl, '/bot/logs?limit=200&window_id=w-rt-032-pass', 'GET');
    const logsBody = parseJson(logsRes.body);
    const logs = Array.isArray(logsBody) ? logsBody : [];
    passHasGateWindowInitLog = logs.some((log) => log?.event === 'BOT_DECISION_GATED' && log?.message === 'gate_context_not_ready_window_init');
  } finally {
    child.kill();
  }

  const checks = {
    runtime_fail_sample_hits_window_init_gate: historicalFail.reason === 'gate_context_not_ready_window_init',
    runtime_fail_sample_has_bounds_ready: historicalFail.bounds_ready === true,
    runtime_fail_sample_window_init_missing: historicalFail.window_initialized_at === null,
    runtime_pass_sample_not_blocked_by_window_init_gate: passReason !== 'gate_context_not_ready_window_init' && !passHasGateWindowInitLog,
    runtime_pass_tick_status_ok: passTickStatusOk,
    runtime_pass_sample_backfills_window_initialized_at: typeof passWindowInitializedAt === 'string' && passWindowInitializedAt.length > 0,
    runtime_pass_sample_has_effective_or_unblocked_intent: passIntentsSummary !== 'NOOP' || (passReason !== 'gate_context_not_ready_window_init' && !passHasGateWindowInitLog),
    runtime_fail_to_pass_chain_verified: historicalFail.reason === 'gate_context_not_ready_window_init' && passReason !== 'gate_context_not_ready_window_init',
    runtime_server_started: runtimeServerStarted,
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
          source: historicalFail.sample_source,
          reason: historicalFail.reason,
          window_initialized_at: historicalFail.window_initialized_at,
          bounds_ready: historicalFail.bounds_ready,
          intents_summary: historicalFail.intents_summary
        },
        sample_pass: {
          reason: passReason,
          intents_summary: passIntentsSummary,
          gate_window_init_log_seen: passHasGateWindowInitLog,
          window_initialized_at: passWindowInitializedAt
        },
        runtime_capture: {
          stdout_tail: stdout.slice(-400),
          stderr_tail: stderr.slice(-400),
          pass_tick_http_status: passTickHttpStatus,
          pass_tick_body_snippet: passTickBodySnippet
        },
        note: 'fail样本来自历史真实恢复快照；pass样本来自本次真实HTTP链路执行'
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
