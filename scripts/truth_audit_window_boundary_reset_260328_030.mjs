import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { buildStandardResult, ensureDir, parseVerifyArgs, writeStandardLog } from './verify_standard_v1.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

const DEFAULT_PORT = 53124;
const DEFAULT_BASE_URL = `http://localhost:${DEFAULT_PORT}`;
const DEFAULT_TASK_ID = '260328_030';

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: DEFAULT_BASE_URL,
  defaultOutputSuffix: 'truth_audit_window_boundary_reset',
  defaultSampleName: 'controlled_window_switch+real_runtime_boundary'
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

const ensureServer = async ({ baseUrl, spawnServer }) => {
  const http = createHttp(baseUrl);
  try {
    const status = await http.get('/bot/status');
    const config = await http.get('/bot/config');
    if (status.status === 200 && config.status === 200) return { spawned: null };
  } catch {}
  if (!spawnServer) throw new Error(`server unreachable: ${baseUrl}`);
  const child = spawn('node', ['strategies/crypto_binary/server.mjs', `--port=${DEFAULT_PORT}`], {
    cwd: REPO_ROOT,
    stdio: 'ignore',
    detached: false
  });
  for (let i = 0; i < 40; i += 1) {
    await sleep(400);
    try {
      const status = await http.get('/bot/status');
      const config = await http.get('/bot/config');
      if (status.status === 200 && config.status === 200) return { spawned: child };
    } catch {}
  }
  child.kill();
  throw new Error(`failed to boot server: ${baseUrl}`);
};

const toNum = (v) => Number(v);

const withLegacy = (cfg) => ({
  open_delay_sec: cfg.open_delay_sec,
  ladder_prices: [0.27, 0.24, 0.21, 0.18],
  ladder_size: 5,
  atr_multiple: 1.2,
  cancel_all_remaining_sec: 0,
  up_ladder: cfg.up_ladder,
  down_ladder: cfg.down_ladder,
  up_cancel: cfg.up_cancel,
  down_cancel: cfg.down_cancel
});

const pickTickBrief = (label, tickResp) => {
  const body = tickResp?.body || {};
  const before = body?.state_before || {};
  const after = body?.state_after || {};
  const summary = body?.order_summary || {};
  const preview = body?.decision_preview || {};
  return {
    label,
    reason: preview?.reason || null,
    intents_summary: preview?.intents_summary || null,
    state_before: {
      current_window_id: before?.current_window_id ?? null,
      last_window_id: before?.last_window_id ?? null,
      yes_cancelled: before?.yes_cancelled === true,
      no_cancelled: before?.no_cancelled === true,
      up_formula_cancelled: before?.up_formula_cancelled === true,
      down_formula_cancelled: before?.down_formula_cancelled === true,
      yes_order_ids_len: Array.isArray(before?.yes_order_ids) ? before.yes_order_ids.length : 0,
      no_order_ids_len: Array.isArray(before?.no_order_ids) ? before.no_order_ids.length : 0
    },
    state_after: {
      current_window_id: after?.current_window_id ?? null,
      last_window_id: after?.last_window_id ?? null,
      yes_cancelled: after?.yes_cancelled === true,
      no_cancelled: after?.no_cancelled === true,
      up_formula_cancelled: after?.up_formula_cancelled === true,
      down_formula_cancelled: after?.down_formula_cancelled === true,
      yes_order_ids_len: Array.isArray(after?.yes_order_ids) ? after.yes_order_ids.length : 0,
      no_order_ids_len: Array.isArray(after?.no_order_ids) ? after.no_order_ids.length : 0
    },
    order_summary: {
      open_total: toNum(summary?.open_total || 0),
      open_yes: toNum(summary?.open_yes || 0),
      open_no: toNum(summary?.open_no || 0),
      cancelled_total: toNum(summary?.cancelled_total || 0)
    }
  };
};

const uniqueByTickAt = (rows) => {
  const seen = new Set();
  const output = [];
  for (const row of rows) {
    const key = row?.last_tick_at ? String(row.last_tick_at) : `idx:${row.i}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(row);
  }
  return output;
};

const main = async () => {
  const args = parseArgs();
  const http = createHttp(args.baseUrl);
  const boot = await ensureServer(args);
  let originalConfig = null;
  try {
    const healthRoot = await fetch(`${args.baseUrl}/`).then((r) => r.status).catch(() => null);
    let healthPairs = null;
    try {
      healthPairs = await fetch(`${args.baseUrl}/pairs`).then((r) => r.status);
    } catch {
      healthPairs = 'ERR';
    }

    await http.post('/bot/stop', {});
    const initCfg = await http.get('/bot/config');
    originalConfig = initCfg?.body?.current || null;

    const cfg = withLegacy({
      open_delay_sec: 0,
      up_ladder: [{ price: 0.31, size: 2, tp_price: 0.35 }, { price: 0.29, size: 1, tp_price: 0.33 }],
      down_ladder: [{ price: 0.02, size: 3, tp_price: 0.03 }, { price: 0.015, size: 1, tp_price: 0.025 }],
      up_cancel: { before_end_sec: 1000, formula: 'has_open_up_orders' },
      down_cancel: { before_end_sec: 0, formula: 'false' }
    });
    await http.post('/bot/config', cfg);

    const baseCtx = {
      period: '5m',
      slug: 'audit-window-boundary',
      btc_price: 100,
      atr_5m: 2,
      bid_yes: 0.55,
      ask_yes: 0.56,
      bid_no: 0.44,
      ask_no: 0.45
    };
    const tick = async (label, ctx) => {
      const resp = await http.post('/bot/runner/tick', { context_override: ctx });
      return pickTickBrief(label, resp);
    };

    const a1 = await tick('A1_place', { ...baseCtx, window_id: 'audit-wA', remaining_sec: 299 });
    const a2 = await tick('A2_formula_cancel', { ...baseCtx, window_id: 'audit-wA', remaining_sec: 250 });
    const a3 = await tick('A3_same_window_no_retrigger', { ...baseCtx, window_id: 'audit-wA', remaining_sec: 220 });
    const b1 = await tick('B1_new_window_first_decision', { ...baseCtx, window_id: 'audit-wB', remaining_sec: 299 });
    const b2 = await tick('B2_new_window_formula_cancel', { ...baseCtx, window_id: 'audit-wB', remaining_sec: 250 });

    const case030A = {
      ticks: [a1, a2, a3, b1, b2],
      pass: a2.reason === 'up_cancel_formula'
        && a3.reason !== 'up_cancel_formula'
        && b2.reason === 'up_cancel_formula'
    };

    const case030B = {
      windowA_residual_open_no_len: a3.state_after.no_order_ids_len,
      windowB_state_before_no_order_ids_len: b1.state_before.no_order_ids_len,
      windowB_first_reason: b1.reason,
      pass: a3.state_after.no_order_ids_len > 0
        && b1.state_before.no_order_ids_len === 0
        && b1.reason === 'ladder_not_posted'
    };

    const case030D = {
      windowA_after_formula_state: {
        yes_cancelled: a2.state_after.yes_cancelled,
        up_formula_cancelled: a2.state_after.up_formula_cancelled
      },
      windowB_first_state_before: {
        yes_cancelled: b1.state_before.yes_cancelled,
        up_formula_cancelled: b1.state_before.up_formula_cancelled
      },
      pass: a2.state_after.yes_cancelled === true
        && a2.state_after.up_formula_cancelled === true
        && b1.state_before.yes_cancelled === false
        && b1.state_before.up_formula_cancelled === false
    };

    await http.post('/bot/stop', {});
    await sleep(300);
    await http.post('/bot/start', { tick_interval_ms: 1000 });

    const rows = [];
    const tickWindowMap = new Map();
    let oldWindowId = null;
    let armedAtRemaining = null;
    let switched = false;
    let newWindowId = null;
    const started = Date.now();
    const maxWaitMs = 420000;
    while (Date.now() - started < maxWaitMs) {
      await sleep(450);
      const s = await http.get('/bot/status');
      const state = s?.body || {};
      const row = {
        i: rows.length,
        sampled_at: new Date().toISOString(),
        last_tick_at: state?.last_tick_at || null,
        current_window_id: state?.current_window_id || null,
        remaining_sec: state?.remaining_sec ?? null,
        last_reason: state?.last_reason || null
      };
      rows.push(row);
      if (!oldWindowId && row.current_window_id) oldWindowId = row.current_window_id;
      if (row.last_tick_at && row.current_window_id) {
        const key = String(row.last_tick_at);
        if (!tickWindowMap.has(key)) tickWindowMap.set(key, new Set());
        tickWindowMap.get(key).add(String(row.current_window_id));
      }
      if (!armedAtRemaining && oldWindowId && row.current_window_id === oldWindowId && toNum(row.remaining_sec) <= 2) {
        armedAtRemaining = toNum(row.remaining_sec);
      }
      if (armedAtRemaining !== null && oldWindowId && row.current_window_id && row.current_window_id !== oldWindowId) {
        switched = true;
        newWindowId = row.current_window_id;
      }
      if (switched) {
        const uniq = uniqueByTickAt(rows).filter((x) => x.last_tick_at && x.current_window_id === newWindowId);
        if (uniq.length >= 3) break;
      }
    }
    await http.post('/bot/stop', {});

    let dualTickAction = false;
    for (const [, set] of tickWindowMap.entries()) {
      if (set.size > 1) {
        dualTickAction = true;
        break;
      }
    }
    const uniqueRows = uniqueByTickAt(rows);
    const boundaryRows = uniqueRows.slice(-12);
    const case030C = {
      old_window_id: oldWindowId,
      new_window_id: newWindowId,
      armed_remaining_sec: armedAtRemaining,
      switched,
      dual_tick_window_action: dualTickAction,
      runtime_boundary_sample: boundaryRows,
      pass: armedAtRemaining !== null && switched && !dualTickAction
    };

    const checks = {
      '030-A_formula_debounce_reset_after_window_change': case030A.pass,
      '030-B_old_window_order_state_no_pollution': case030B.pass,
      '030-C_boundary_critical_seconds_no_double_action': case030C.pass,
      '030-D_old_cancel_state_not_pollute_new_window_first_decision': case030D.pass
    };
    const checkKeys = Object.keys(checks);
    const passCount = checkKeys.filter((k) => checks[k]).length;
    const failCount = checkKeys.length - passCount;

    let conclusion = 'A：窗口边界与状态重置可靠';
    let firstBreakLayer = null;
    if (!case030C.pass && (case030C.armed_remaining_sec === null || case030C.switched === false)) {
      conclusion = 'B：测试资产误判';
      firstBreakLayer = 'C real runtime 窗口边界连续样本缺失';
    } else if (failCount > 0) {
      conclusion = 'C：存在业务语义断裂';
      firstBreakLayer = !case030A.pass
        ? 'A 防抖重置层'
        : (!case030B.pass
          ? 'B 旧窗口串扰层'
          : (!case030C.pass
            ? 'C 临界秒双重动作层'
            : 'D 新窗口首次决策污染层'));
    }
    const pass = conclusion.startsWith('A：');

    const standard = buildStandardResult({
      scriptName: 'truth_audit_window_boundary_reset_260328_030',
      taskId: args.taskId,
      sampleName: args.sampleName,
      pass,
      message: pass ? '窗口边界与状态重置审计通过' : '窗口边界与状态重置审计未通过',
      firstBreakLayer,
      evidenceFile: args.output,
      summary: {
        conclusion,
        total_checks: checkKeys.length,
        pass_checks: passCount,
        fail_checks: failCount,
        checks
      },
      rawExcerpt: {
        health_root: healthRoot,
        health_pairs: healthPairs,
        case030A_formula_hits: [a2.reason, a3.reason, b2.reason],
        case030C_armed_remaining_sec: case030C.armed_remaining_sec,
        case030C_switched: case030C.switched,
        case030C_dual_tick_window_action: case030C.dual_tick_window_action
      }
    });

    const output = {
      ...standard,
      task_id: args.taskId,
      command: `node scripts/truth_audit_window_boundary_reset_260328_030.mjs --task_id=${args.taskId} --sample=${args.sampleName}`,
      conclusion_block: {
        verdict: conclusion,
        first_break_layer: firstBreakLayer
      },
      key_counters: {
        total_checks: checkKeys.length,
        pass_checks: passCount,
        fail_checks: failCount
      },
      evidence_index: {
        healthcheck: { root: healthRoot, pairs: healthPairs },
        case_030A: case030A,
        case_030B: case030B,
        case_030C: case030C,
        case_030D: case030D
      },
      result: checks
    };

    ensureDir(args.output);
    fs.writeFileSync(args.output, JSON.stringify(output, null, 2));
    const logPath = writeStandardLog(args.output, standard);
    console.log(`VERIFY_OUTPUT=${args.output}`);
    console.log(`VERIFY_LOG=${logPath}`);
    console.log(JSON.stringify({
      pass,
      conclusion,
      first_break_layer: firstBreakLayer,
      pass_checks: passCount,
      fail_checks: failCount
    }));
    if (!pass) process.exitCode = 1;
  } finally {
    await http.post('/bot/stop', {}).catch(() => null);
    if (originalConfig) await http.post('/bot/config', originalConfig).catch(() => null);
    if (boot.spawned && !boot.spawned.killed) boot.spawned.kill();
  }
};

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
