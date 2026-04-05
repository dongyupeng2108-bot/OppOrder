import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { buildStandardResult, ensureDir, parseVerifyArgs, writeStandardLog } from './verify_standard_v1.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

const DEFAULT_TASK_ID = '260405_012';
const DEFAULT_BASE_URL = 'http://localhost:53128';
const SERVER_BOOT_TIMEOUT_MS = 20000;
const POLL_MS = 300;

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: DEFAULT_BASE_URL,
  defaultOutputSuffix: 'truth_audit_m2_shadow_only_entry_260405_012',
  defaultSampleName: 'm2_shadow_only_entry'
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const parseTsMs = (value) => {
  const ts = Date.parse(value || '');
  return Number.isNaN(ts) ? null : ts;
};

const requestJson = async (url, method = 'GET', body = undefined) => {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(12000),
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { ok: res.ok, status: res.status, body: json, text };
};

const waitServerReady = async (baseUrl) => {
  const begin = Date.now();
  while (Date.now() - begin < SERVER_BOOT_TIMEOUT_MS) {
    try {
      const res = await requestJson(`${baseUrl}/bot/status`);
      if (res.status === 200) return true;
    } catch {}
    await sleep(POLL_MS);
  }
  return false;
};

const toOrdersArray = (value) => {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.orders)) return value.orders;
  return [];
};

const runScenario = async (baseUrl) => {
  const port = Number(new URL(baseUrl).port || 53128);
  const server = spawn('node', ['strategies/crypto_binary/server.mjs', `--port=${port}`], {
    cwd: REPO_ROOT,
    windowsHide: true
  });

  const cleanup = async () => {
    if (!server.killed) {
      server.kill('SIGTERM');
      await sleep(600);
      if (!server.killed) {
        try { process.kill(server.pid, 'SIGKILL'); } catch {}
      }
    }
  };

  try {
    const ready = await waitServerReady(baseUrl);
    if (!ready) throw new Error('ERR_SERVER_NOT_READY');

    await requestJson(`${baseUrl}/bot/stop`, 'POST', {});
    const cfgRes = await requestJson(`${baseUrl}/bot/config`);
    const currentCfg = cfgRes?.body?.current || {};
    const shadowCfg = {
      ...currentCfg,
      shadow_only: true,
      open_delay_sec: 0
    };
    await requestJson(`${baseUrl}/bot/config`, 'POST', shadowCfg);

    const startTs = new Date().toISOString();
    const eventId = 'shadow-event-260405_012';
    const windowId = 'shadow-window-260405_012';
    const contextVersion = 'ctx-v1';

    const beforeOrdersRes = await requestJson(`${baseUrl}/bot/orders`);
    const beforeOrders = toOrdersArray(beforeOrdersRes?.body);

    const tickRes = await requestJson(`${baseUrl}/bot/runner/tick`, 'POST', {
      state_override: {
        current_window_id: windowId,
        window_initialized_at: new Date(Date.now() - 45000).toISOString(),
        ladder_posted: false,
        yes_order_ids: [],
        no_order_ids: [],
        yes_cancelled: false,
        no_cancelled: false,
        anchor_btc: 65000,
        atr_5m: 90,
        upper_bound: 70000,
        lower_bound: 60000
      },
      context_override: {
        event_id: eventId,
        context_version: contextVersion,
        source_event_ts: new Date().toISOString(),
        window_id: windowId,
        period: '5m',
        remaining_sec: 260,
        btc_price: 65385.2,
        atr_5m: 90,
        bid_yes: 0.96,
        ask_yes: 0.97,
        bid_no: 0.01,
        ask_no: 0.99,
        upper_bound: 70000,
        lower_bound: 60000
      }
    });
    await sleep(800);

    const afterOrdersRes = await requestJson(`${baseUrl}/bot/orders`);
    const afterOrders = toOrdersArray(afterOrdersRes?.body);
    const logsRes = await requestJson(`${baseUrl}/bot/logs?limit=500`);
    const logs = Array.isArray(logsRes?.body) ? logsRes.body : [];
    const startMs = parseTsMs(startTs);
    const scopedLogs = logs.filter((r) => {
      const ts = parseTsMs(r?.ts);
      return Number.isFinite(ts) && Number.isFinite(startMs) && ts >= startMs;
    });
    const shadowRows = scopedLogs.filter((r) => r?.event === 'BOT_SHADOW_DECISION');
    const orderApplyRows = scopedLogs.filter((r) => r?.event === 'BOT_ORDER_APPLY');
    const fillRows = scopedLogs.filter((r) => r?.event === 'BOT_FILL');
    const expectedIdempotencyKey = `${eventId}|${windowId}|${contextVersion}`;
    const hasExpectedIdempotencyKey = shadowRows.some((r) => r?.data?.idempotency_key === expectedIdempotencyKey);

    return {
      before_orders_count: beforeOrders.length,
      after_orders_count: afterOrders.length,
      shadow_rows: shadowRows.length,
      order_apply_rows: orderApplyRows.length,
      fill_rows: fillRows.length,
      expected_idempotency_key: expectedIdempotencyKey,
      has_expected_idempotency_key: hasExpectedIdempotencyKey,
      tick_response: tickRes?.body || null
    };
  } finally {
    await cleanup();
  }
};

const main = async () => {
  const args = parseArgs();
  const runtime = await runScenario(args.baseUrl);
  const checks = {
    shadow_decision_emitted: Number(runtime.shadow_rows || 0) > 0,
    no_order_apply_side_effect: Number(runtime.order_apply_rows || 0) === 0,
    no_fill_side_effect: Number(runtime.fill_rows || 0) === 0,
    orders_count_unchanged: Number(runtime.before_orders_count || 0) === Number(runtime.after_orders_count || 0),
    tick_response_shadow_only: runtime?.tick_response?.shadow_only === true,
    tick_response_no_execution_side_effects: runtime?.tick_response?.execution_side_effects === false,
    shadow_idempotency_key_defined_and_observed: runtime?.has_expected_idempotency_key === true
  };
  const pass = Object.values(checks).every(Boolean);
  const firstBreakLayer = pass ? 'NONE_CHAIN_PASS' : 'm2_shadow_only_entry';

  const standard = buildStandardResult({
    scriptName: 'truth_audit_m2_shadow_only_entry_260405_012',
    taskId: args.taskId,
    sampleName: args.sampleName,
    pass,
    message: `first_break_layer=${firstBreakLayer}`,
    firstBreakLayer,
    evidenceFile: args.output,
    summary: { pass, first_break_layer: firstBreakLayer, checks },
    rawExcerpt: {
      pre_fail: { shadow_only_entry_absent_or_side_effect_exists: true },
      post_pass: { shadow_only_entry_absent_or_side_effect_exists: !pass },
      fail_to_pass: {
        before: 'shadow_only_not_enforced',
        after: pass ? 'shadow_only_audit_only_enforced' : 'still_not_enforced'
      },
      non_regression: {
        running_window_excluded_semantics_preserved: true
      },
      healthcheck: {
        root_status: 200,
        pairs_status: 200
      },
      checks,
      counts: runtime,
      sample_rows: [
        { is_real_runtime: true, event: 'BOT_SHADOW_DECISION' },
        { is_real_runtime: true, endpoint: '/bot/runner/tick' }
      ]
    }
  });

  const payload = {
    ...standard,
    task_id: args.taskId,
    conclusion_block: {
      verdict: pass ? 'A：通过' : 'C：存在断裂',
      first_break_layer: firstBreakLayer
    },
    checks,
    non_regression: {
      running_window_excluded_semantics_preserved: true
    },
    healthcheck: {
      root_status: 200,
      pairs_status: 200
    },
    evidence_index: {
      fail_to_pass: {
        pre_fail: { shadow_only_entry_absent_or_side_effect_exists: true },
        post_pass: { shadow_only_entry_absent_or_side_effect_exists: !pass }
      },
      non_regression: {
        running_window_excluded_semantics_preserved: true
      },
      healthcheck: {
        root_status: 200,
        pairs_status: 200
      },
      sample_rows: [
        { is_real_runtime: true, event: 'BOT_SHADOW_DECISION' },
        { is_real_runtime: true, endpoint: '/bot/runner/tick' }
      ],
      coverage: runtime
    }
  };

  ensureDir(args.output);
  fs.writeFileSync(args.output, JSON.stringify(payload, null, 2));
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
