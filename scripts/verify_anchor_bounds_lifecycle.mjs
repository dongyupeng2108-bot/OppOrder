import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { buildStandardResult, ensureDir, parseVerifyArgs, writeStandardLog } from './verify_standard_v1.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_PORT = 53123;
const DEFAULT_BASE_URL = `http://localhost:${DEFAULT_PORT}`;
const DEFAULT_TASK_ID = '260326_048';
const DEFAULT_SAMPLE = 'controlled+real_no_debug';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: DEFAULT_BASE_URL,
  defaultOutputSuffix: 'anchor_bounds_lifecycle',
  defaultSampleName: DEFAULT_SAMPLE
});

const toFinite = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const numberEq = (a, b, eps = 1e-9) => {
  if (a == null || b == null) return false;
  return Math.abs(Number(a) - Number(b)) <= eps;
};

const createHttp = (baseUrl) => ({
  async get(endpoint) {
    const res = await fetch(`${baseUrl}${endpoint}`);
    const body = await res.json().catch(() => ({}));
    return { status: res.status, body };
  },
  async post(endpoint, payload = {}) {
    const res = await fetch(`${baseUrl}${endpoint}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const body = await res.json().catch(() => ({}));
    return { status: res.status, body };
  }
});

const parsePort = (baseUrl) => {
  try {
    const u = new URL(baseUrl);
    return Number(u.port || 53123);
  } catch {
    return 53123;
  }
};

const ensureServer = async (args) => {
  const http = createHttp(args.baseUrl);
  try {
    const status = await http.get('/bot/status');
    if (status.status === 200) return { spawned: null };
  } catch {}
  if (!args.spawnServer) throw new Error('server unavailable and spawn_server=false');
  const port = parsePort(args.baseUrl);
  const spawned = spawn(process.execPath, ['strategies/crypto_binary/server.mjs', `--port=${port}`], {
    cwd: REPO_ROOT,
    stdio: 'ignore'
  });
  for (let i = 0; i < 40; i += 1) {
    await sleep(300);
    try {
      const status = await http.get('/bot/status');
      if (status.status === 200) return { spawned };
    } catch {}
  }
  spawned.kill();
  throw new Error('server boot timeout');
};

const runControlledAudit = async (http) => {
  await http.post('/bot/stop', {});
  await sleep(250);
  const cfg = await http.get('/bot/config');
  const atrMultiple = toFinite(cfg?.body?.current?.atr_multiple) ?? 1.2;
  const w1 = `audit-anchor-${Date.now()}-w1`;
  const tick1 = await http.post('/bot/runner/tick', {
    context_override: { window_id: w1, period: '5m', remaining_sec: 250, btc_price: 100, atr_5m: null }
  });
  const tick2 = await http.post('/bot/runner/tick', {
    context_override: { window_id: w1, period: '5m', remaining_sec: 230, btc_price: 130, atr_5m: null }
  });
  const tick3 = await http.post('/bot/runner/tick', {
    context_override: { window_id: w1, period: '5m', remaining_sec: 210, btc_price: 160, atr_5m: 2 }
  });

  const s1 = tick1?.body?.state_after || {};
  const s2 = tick2?.body?.state_after || {};
  const s3 = tick3?.body?.state_after || {};
  const anchor1 = toFinite(s1.anchor_btc);
  const anchor2 = toFinite(s2.anchor_btc);
  const anchor3 = toFinite(s3.anchor_btc);
  const up3 = toFinite(s3.upper_bound);
  const down3 = toFinite(s3.lower_bound);

  const frozenPass = anchor1 !== null && numberEq(anchor1, anchor2) && numberEq(anchor1, anchor3);
  const boundsLatePass = up3 !== null
    && down3 !== null
    && numberEq(up3, anchor1 + (2 * atrMultiple))
    && numberEq(down3, anchor1 - (2 * atrMultiple));
  const decoupledPass = typeof s1.window_initialized_at === 'string'
    && s1.window_initialized_at.length > 0
    && toFinite(s1.upper_bound) === null
    && toFinite(s1.lower_bound) === null
    && s1.window_initialized_at === s2.window_initialized_at;

  const w2 = `audit-anchor-${Date.now()}-w2`;
  const tickA = await http.post('/bot/runner/tick', {
    context_override: { window_id: w2, period: '5m', remaining_sec: 240, btc_price: 101, atr_5m: null }
  });
  const tickB = await http.post('/bot/runner/tick', {
    context_override: { window_id: w2, period: '5m', remaining_sec: 200, btc_price: 140, atr_5m: null },
    state_override: { ladder_posted: true }
  });
  const aA = toFinite(tickA?.body?.state_after?.anchor_btc);
  const aB = toFinite(tickB?.body?.state_after?.anchor_btc);
  const noDriftWhenUnreadyPass = aA !== null && numberEq(aA, aB);
  const noActionWhenUnreadyPass = String(tickB?.body?.decision_preview?.intents_summary || '') === 'NOOP';

  return {
    pass: frozenPass && boundsLatePass && decoupledPass && noDriftWhenUnreadyPass && noActionWhenUnreadyPass,
    atr_multiple: atrMultiple,
    checks: {
      anchor_frozen_once_pass: frozenPass,
      atr_arrive_compute_from_frozen_anchor_pass: boundsLatePass,
      window_init_decoupled_from_bounds_ready_pass: decoupledPass,
      unready_anchor_not_drifting_pass: noDriftWhenUnreadyPass,
      unready_action_blocked_pass: noActionWhenUnreadyPass
    },
    evidence: {
      window1: {
        tick1: { anchor: anchor1, upper: toFinite(s1.upper_bound), lower: toFinite(s1.lower_bound), window_initialized_at: s1.window_initialized_at || null },
        tick2: { anchor: anchor2, upper: toFinite(s2.upper_bound), lower: toFinite(s2.lower_bound), window_initialized_at: s2.window_initialized_at || null },
        tick3: { anchor: anchor3, upper: up3, lower: down3, window_initialized_at: s3.window_initialized_at || null }
      },
      window2: {
        tickA: { anchor: aA, upper: toFinite(tickA?.body?.state_after?.upper_bound), lower: toFinite(tickA?.body?.state_after?.lower_bound) },
        tickB: {
          anchor: aB,
          upper: toFinite(tickB?.body?.state_after?.upper_bound),
          lower: toFinite(tickB?.body?.state_after?.lower_bound),
          intents_summary: tickB?.body?.decision_preview?.intents_summary || null,
          reason: tickB?.body?.decision_preview?.reason || null
        }
      }
    }
  };
};

const runRealMinimalAudit = async (http) => {
  await http.post('/bot/stop', {});
  await sleep(300);
  await http.post('/bot/start', { tick_interval_ms: 1000 });
  const rows = [];
  for (let i = 1; i <= 30; i += 1) {
    await sleep(650);
    const [status, context, preview] = await Promise.all([
      http.get('/bot/status'),
      http.get('/bot/context'),
      http.get('/bot/decision-preview')
    ]);
    const st = status?.body || {};
    const ctx = context?.body || {};
    if (st?.running !== true || !st?.current_window_id) continue;
    rows.push({
      seq: i,
      window_id: st.current_window_id,
      running: true,
      btc_price: toFinite(ctx.btc_price),
      atr_5m: toFinite(ctx.atr_5m ?? st.atr_5m),
      anchor_btc: toFinite(ctx.anchor_btc ?? st.anchor_btc),
      upper_bound: toFinite(ctx.upper_bound ?? st.upper_bound),
      lower_bound: toFinite(ctx.lower_bound ?? st.lower_bound),
      reason: preview?.body?.reason ?? null
    });
  }
  await http.post('/bot/stop', {});
  const grouped = new Map();
  for (const row of rows) {
    if (row.atr_5m !== null) continue;
    const list = grouped.get(row.window_id) || [];
    list.push(row);
    grouped.set(row.window_id, list);
  }
  let targetWindowRows = [];
  for (const list of grouped.values()) {
    if (list.length > targetWindowRows.length) targetWindowRows = list;
  }
  const anchors = [...new Set(targetWindowRows.map((r) => r.anchor_btc).filter((v) => v !== null))];
  const realPass = targetWindowRows.length >= 2 && anchors.length <= 1;
  return {
    pass: realPass,
    summary: {
      total_rows: rows.length,
      atr_missing_rows_in_same_window: targetWindowRows.length,
      unique_anchor_count_when_atr_missing: anchors.length
    },
    sample_rows: targetWindowRows.slice(0, 8),
    all_rows: rows
  };
};

const main = async () => {
  const args = parseArgs();
  const http = createHttp(args.baseUrl);
  const boot = await ensureServer(args);
  try {
    const controlled = await runControlledAudit(http);
    const realRuntime = await runRealMinimalAudit(http);
    const pass = controlled.pass && realRuntime.pass;
    const firstBreakLayer = pass
      ? null
      : (!controlled.checks.anchor_frozen_once_pass
        ? 'anchor freeze'
        : (!controlled.checks.atr_arrive_compute_from_frozen_anchor_pass
          ? 'atr arrive -> bounds compute'
          : (!controlled.checks.window_init_decoupled_from_bounds_ready_pass
            ? 'window init/bounds decouple'
            : (!realRuntime.pass ? 'real runtime anchor drift check' : 'unknown'))));
    const standard = buildStandardResult({
      scriptName: 'verify_anchor_bounds_lifecycle',
      taskId: args.taskId,
      sampleName: args.sampleName,
      pass,
      message: pass ? 'anchor freeze 与 bounds-ready 解耦通过' : 'anchor freeze 与 bounds-ready 解耦未通过',
      firstBreakLayer,
      evidenceFile: args.output,
      summary: {
        anchor_frozen_once_pass: controlled.checks.anchor_frozen_once_pass,
        atr_arrive_compute_from_frozen_anchor_pass: controlled.checks.atr_arrive_compute_from_frozen_anchor_pass,
        window_init_decoupled_from_bounds_ready_pass: controlled.checks.window_init_decoupled_from_bounds_ready_pass,
        unready_anchor_not_drifting_pass: controlled.checks.unready_anchor_not_drifting_pass,
        unready_action_blocked_pass: controlled.checks.unready_action_blocked_pass,
        real_runtime_anchor_not_drifting_pass: realRuntime.pass
      },
      rawExcerpt: {
        real_runtime_atr_missing_rows: realRuntime.summary.atr_missing_rows_in_same_window,
        real_runtime_unique_anchor_count: realRuntime.summary.unique_anchor_count_when_atr_missing
      }
    });
    const output = {
      ...standard,
      task_id: args.taskId,
      command: `node scripts/verify_anchor_bounds_lifecycle.mjs --task_id=${args.taskId}`,
      controlled,
      real_runtime: realRuntime,
      result: {
        anchor_frozen_once_pass: controlled.checks.anchor_frozen_once_pass,
        atr_arrive_compute_from_frozen_anchor_pass: controlled.checks.atr_arrive_compute_from_frozen_anchor_pass,
        window_init_decoupled_from_bounds_ready_pass: controlled.checks.window_init_decoupled_from_bounds_ready_pass,
        unready_anchor_not_drifting_pass: controlled.checks.unready_anchor_not_drifting_pass,
        unready_action_blocked_pass: controlled.checks.unready_action_blocked_pass,
        real_runtime_anchor_not_drifting_pass: realRuntime.pass
      }
    };
    ensureDir(args.output);
    fs.writeFileSync(args.output, JSON.stringify(output, null, 2));
    const logPath = writeStandardLog(args.output, standard);
    console.log(`VERIFY_OUTPUT=${args.output}`);
    console.log(`VERIFY_LOG=${logPath}`);
    console.log(JSON.stringify(output.result));
    if (!pass) process.exitCode = 1;
  } finally {
    await http.post('/bot/stop', {}).catch(() => null);
    if (boot.spawned && !boot.spawned.killed) boot.spawned.kill();
  }
};

main();
