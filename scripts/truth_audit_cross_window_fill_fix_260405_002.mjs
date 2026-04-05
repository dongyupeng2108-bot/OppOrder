import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { buildStandardResult, ensureDir, parseVerifyArgs, writeStandardLog } from './verify_standard_v1.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

const DEFAULT_TASK_ID = '260405_002';
const DEFAULT_BASE_URL = 'http://localhost:53124';
const SERVER_BOOT_TIMEOUT_MS = 25000;
const POLL_MS = 400;

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: DEFAULT_BASE_URL,
  defaultOutputSuffix: 'truth_audit_cross_window_fill_fix_260405_002',
  defaultSampleName: 'cross_window_fill_fail_pass'
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const parseTs = (value) => {
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

const createHttp = (baseUrl) => ({
  get: (route) => requestJson(`${baseUrl}${route}`, 'GET'),
  post: (route, body) => requestJson(`${baseUrl}${route}`, 'POST', body)
});

const findPreFailSample = () => {
  const logFile = path.join(REPO_ROOT, 'data', 'crypto_binary', 'logs', 'bot_2026-04-05.jsonl');
  if (!fs.existsSync(logFile)) return { log_file: logFile, found: false };
  const rows = fs.readFileSync(logFile, 'utf8').split('\n').map((line) => {
    const text = String(line || '').trim();
    if (!text) return null;
    try { return JSON.parse(text); } catch { return null; }
  }).filter(Boolean);
  for (let i = 0; i < rows.length; i += 1) {
    const fillRow = rows[i];
    if (fillRow?.event !== 'BOT_FILL') continue;
    const fillTs = parseTs(fillRow?.ts);
    if (fillTs == null) continue;
    const nextPlace = rows.slice(i + 1, i + 80).find((row) => (
      row?.event === 'BOT_INTENTS'
      && typeof row?.message === 'string'
      && row.message.includes('PLACE_LADDER(')
      && parseTs(row?.ts) != null
      && parseTs(row.ts) > fillTs
    )) || null;
    if (!nextPlace) continue;
    const orderId = fillRow?.data?.fills?.[0]?.order_id ?? null;
    if (!orderId) continue;
    const recoveryFile = path.join(REPO_ROOT, 'data', 'crypto_binary', 'bot_runtime_recovery_53123.json');
    let orderSnapshot = null;
    if (fs.existsSync(recoveryFile)) {
      const recovery = JSON.parse(fs.readFileSync(recoveryFile, 'utf8'));
      orderSnapshot = Array.isArray(recovery?.orders)
        ? (recovery.orders.find((item) => item?.order_id === orderId) || null)
        : null;
    }
    if (orderSnapshot?.window_id) {
      return {
        found: true,
        log_file: logFile,
        fill_row: fillRow,
        place_after_fill: nextPlace,
        order_snapshot: orderSnapshot
      };
    }
  }
  return { found: false, log_file: logFile };
};

const buildControlledRecovery = () => {
  const now = new Date();
  const nowIso = now.toISOString();
  const staleWindowId = 'btc-updown-5m-1776000000';
  const activeWindowId = 'btc-updown-5m-1776000300';
  const staleOrder = {
    order_id: 'paper_stale_260405002',
    kind: 'ENTRY',
    side: 'YES',
    price: 0.3,
    size: 1,
    tp_price: 1,
    ladder_key: 'YES:0',
    parent_order_id: null,
    window_id: staleWindowId,
    status: 'OPEN',
    fill_price: null,
    filled_at: null,
    created_at: new Date(now.getTime() - 12 * 60 * 1000).toISOString(),
    source: 'seed|window=btc-updown-5m-1776000000'
  };
  const currentOrder = {
    order_id: 'paper_current_260405002',
    kind: 'ENTRY',
    side: 'YES',
    price: 0.3,
    size: 1,
    tp_price: 1,
    ladder_key: 'YES:1',
    parent_order_id: null,
    window_id: activeWindowId,
    status: 'OPEN',
    fill_price: null,
    filled_at: null,
    created_at: new Date(now.getTime() - 60 * 1000).toISOString(),
    source: 'seed|window=btc-updown-5m-1776000300'
  };
  return {
    saved_config: { open_delay_sec: 10, cancel_all_remaining_sec: 15 },
    active_runtime_config: { open_delay_sec: 10, cancel_all_remaining_sec: 15 },
    state: {
      running: false,
      mode: 'paper-staging',
      current_window_id: activeWindowId,
      last_window_id: staleWindowId,
      window_initialized_at: nowIso,
      yes_cancelled: false,
      no_cancelled: false,
      ladder_posted: true,
      last_intents: []
    },
    orders: [staleOrder, currentOrder],
    last_run_snapshot: {
      current_window_id: activeWindowId,
      completed_at: null
    },
    today_reset_baseline_ts: now.getTime()
  };
};

const waitServerReady = async (baseUrl) => {
  const begin = Date.now();
  while (Date.now() - begin < SERVER_BOOT_TIMEOUT_MS) {
    try {
      const root = await requestJson(`${baseUrl}/`, 'GET');
      if (root.status === 200) return true;
    } catch {}
    await sleep(POLL_MS);
  }
  return false;
};

const runPassRuntime = async (baseUrl, taskId) => {
  const port = Number(new URL(baseUrl).port || 53124);
  const recoveryFile = path.join(REPO_ROOT, 'data', 'crypto_binary', `bot_runtime_recovery_${port}.json`);
  const backupFile = `${recoveryFile}.bak_${taskId}`;
  if (fs.existsSync(recoveryFile)) {
    fs.copyFileSync(recoveryFile, backupFile);
  }
  const controlledRecovery = buildControlledRecovery();
  fs.writeFileSync(recoveryFile, JSON.stringify(controlledRecovery, null, 2));

  const server = spawn('node', ['strategies/crypto_binary/server.mjs', `--port=${port}`], {
    cwd: REPO_ROOT,
    windowsHide: true
  });
  let stdoutTail = '';
  let stderrTail = '';
  server.stdout.on('data', (chunk) => { stdoutTail += String(chunk || ''); if (stdoutTail.length > 4000) stdoutTail = stdoutTail.slice(-4000); });
  server.stderr.on('data', (chunk) => { stderrTail += String(chunk || ''); if (stderrTail.length > 4000) stderrTail = stderrTail.slice(-4000); });

  const cleanup = async () => {
    if (!server.killed) {
      server.kill('SIGTERM');
      await sleep(600);
      if (!server.killed) {
        try { process.kill(server.pid, 'SIGKILL'); } catch {}
      }
    }
    if (fs.existsSync(backupFile)) {
      fs.copyFileSync(backupFile, recoveryFile);
      fs.unlinkSync(backupFile);
    } else if (fs.existsSync(recoveryFile)) {
      fs.unlinkSync(recoveryFile);
    }
  };

  try {
    const ready = await waitServerReady(baseUrl);
    if (!ready) {
      throw new Error(`ERR_SERVER_NOT_READY:${stdoutTail.slice(-500)}|${stderrTail.slice(-500)}`);
    }
    const http = createHttp(baseUrl);
    await http.post('/bot/stop', {});
    const beforeOrders = await http.get('/bot/orders');
    const beforeAll = Array.isArray(beforeOrders?.body?.all_orders) ? beforeOrders.body.all_orders : [];
    const staleBefore = beforeAll.find((item) => item?.order_id === 'paper_stale_260405002') || null;
    const currentBefore = beforeAll.find((item) => item?.order_id === 'paper_current_260405002') || null;

    const tickRes = await http.post('/bot/runner/tick', {
      context_override: {
        window_id: 'btc-updown-5m-1776000300',
        ask_yes: 0.2,
        ask_no: 0.9,
        bid_yes: 0.1,
        bid_no: 0.1,
        remaining_sec: 45,
        updated_at: new Date().toISOString()
      },
      state_override: {
        current_window_id: 'btc-updown-5m-1776000300',
        window_initialized_at: new Date().toISOString(),
        ladder_posted: true
      }
    });
    if (!tickRes.ok) throw new Error(`ERR_TICK_FAILED:${tickRes.status}:${tickRes.text?.slice(0, 300)}`);

    const afterOrders = await http.get('/bot/orders');
    const afterAll = Array.isArray(afterOrders?.body?.all_orders) ? afterOrders.body.all_orders : [];
    const staleAfter = afterAll.find((item) => item?.order_id === 'paper_stale_260405002') || null;
    const currentAfter = afterAll.find((item) => item?.order_id === 'paper_current_260405002') || null;
    const fills = Array.isArray(tickRes?.body?.fills) ? tickRes.body.fills : [];
    const blockedCross = Array.isArray(tickRes?.body?.blocked_cross_window_candidates) ? tickRes.body.blocked_cross_window_candidates : [];

    const perfToday = await http.get('/bot/performance/summary?preset=today&detail=1');
    const perf7d = await http.get('/bot/performance/summary?preset=last_7d&detail=1');
    const perf30 = await http.get('/bot/performance/summary?preset=last_30_windows&detail=1');
    return {
      before_orders: {
        stale: staleBefore,
        current: currentBefore
      },
      tick_result: {
        status: tickRes.status,
        fills,
        blocked_cross_window_candidates: blockedCross
      },
      after_orders: {
        stale: staleAfter,
        current: currentAfter
      },
      non_regression: {
        today_running_window_excluded: perfToday?.body?.summary?.running_window_excluded ?? null,
        last7d_running_window_excluded: perf7d?.body?.summary?.running_window_excluded ?? null,
        last30_running_window_excluded: perf30?.body?.summary?.running_window_excluded ?? null
      }
    };
  } finally {
    await cleanup();
  }
};

const main = async () => {
  const args = parseArgs();
  const preFail = findPreFailSample();
  const passRuntime = await runPassRuntime(args.baseUrl, args.taskId);

  const staleFilledInPass = Array.isArray(passRuntime?.tick_result?.fills)
    ? passRuntime.tick_result.fills.some((item) => item?.order_id === 'paper_stale_260405002')
    : false;
  const currentFilled = Array.isArray(passRuntime?.tick_result?.fills)
    ? passRuntime.tick_result.fills.some((item) => item?.order_id === 'paper_current_260405002')
    : false;
  const blockedHit = Array.isArray(passRuntime?.tick_result?.blocked_cross_window_candidates)
    && passRuntime.tick_result.blocked_cross_window_candidates.some((item) => item?.order_id === 'paper_stale_260405002');

  const checks = {
    pre_fail_has_cross_window_fact: preFail?.found === true,
    pass_stale_not_filled: staleFilledInPass === false,
    pass_current_window_fill_kept: currentFilled === true,
    pass_blocked_event_detected: blockedHit === true,
    non_reg_today_excluded_bool: typeof passRuntime?.non_regression?.today_running_window_excluded === 'boolean',
    non_reg_7d_excluded_bool: typeof passRuntime?.non_regression?.last7d_running_window_excluded === 'boolean',
    non_reg_30_excluded_bool: typeof passRuntime?.non_regression?.last30_running_window_excluded === 'boolean'
  };
  const pass = Object.values(checks).every(Boolean);
  const firstBreakLayer = pass ? 'NONE_CHAIN_PASS' : (
    checks.pre_fail_has_cross_window_fact !== true
      ? 'pre_fail_fact_chain'
      : (checks.pass_stale_not_filled !== true ? 'cross_window_fill_guard' : 'non_regression_chain')
  );

  const standard = buildStandardResult({
    scriptName: 'truth_audit_cross_window_fill_fix_260405_002',
    taskId: args.taskId,
    sampleName: args.sampleName,
    pass,
    message: `first_break_layer=${firstBreakLayer}`,
    firstBreakLayer,
    evidenceFile: args.output,
    summary: { pass, first_break_layer: firstBreakLayer, checks },
    rawExcerpt: {
      pre_fail_order_id: preFail?.order_snapshot?.order_id ?? null,
      pass_stale_status: passRuntime?.after_orders?.stale?.status ?? null,
      pass_current_status: passRuntime?.after_orders?.current?.status ?? null
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
    evidence_index: {
      pre_fail: preFail,
      pass_runtime: passRuntime
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
