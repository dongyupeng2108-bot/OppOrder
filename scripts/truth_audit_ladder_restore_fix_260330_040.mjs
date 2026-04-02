import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { buildStandardResult, ensureDir, parseVerifyArgs, writeStandardLog } from './verify_standard_v1.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_TASK_ID = '260330_040';
const MAX_WALL_MS = 25 * 60 * 1000;
const MAX_SILENCE_MS = 120 * 1000;
const LOG_TAIL = 120;
const HEARTBEAT_MS = 25 * 1000;
const ALLOWED_SAMPLES = ['ladder_restore_fix_v1'];
const PREFIX_FAIL_JSON = path.join(REPO_ROOT, 'rules', 'task-reports', '2026-03', '260330_039_truth_audit_ladder_point_hypothesis_chain.json');

let heartbeatLogPath = null;
let lastHeartbeat = null;

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: 'http://localhost:53240',
  defaultOutputSuffix: 'truth_audit_ladder_restore_fix_260330_040',
  defaultSampleName: ALLOWED_SAMPLES[0]
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const nowIso = () => new Date().toISOString();
const toJson = async (res) => { try { return await res.json(); } catch { return null; } };
const toNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const emit = (event, data = {}) => {
  const row = { ts: nowIso(), event, ...data };
  if (event === 'HEARTBEAT') lastHeartbeat = row;
  if (heartbeatLogPath) {
    ensureDir(heartbeatLogPath);
    fs.appendFileSync(heartbeatLogPath, `${JSON.stringify(row)}\n`, 'utf8');
  }
  console.log(JSON.stringify(row));
};

const ensureSampleAllowed = (sampleName) => {
  const normalized = String(sampleName || '').trim();
  if (ALLOWED_SAMPLES.includes(normalized)) return normalized;
  throw new Error(`ERR_INVALID_SAMPLE_NAME: sample=${normalized || '<empty>'}; allowed=${ALLOWED_SAMPLES.join(',')}`);
};

const createHttp = (baseUrl) => {
  const withRetry = async (fn) => {
    let last = null;
    for (let i = 0; i < 4; i += 1) {
      try { return await fn(); } catch (error) { last = error; await sleep(250); }
    }
    throw last || new Error('http_retry_failed');
  };
  return {
    get: (endpoint) => withRetry(async () => {
      const res = await fetch(`${baseUrl}${endpoint}`);
      return { status: res.status, body: await toJson(res) };
    }),
    post: (endpoint, body = {}) => withRetry(async () => {
      const res = await fetch(`${baseUrl}${endpoint}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });
      return { status: res.status, body: await toJson(res) };
    })
  };
};

const waitServerReady = async (baseUrl, timeoutMs = 45000) => {
  const begin = Date.now();
  while (Date.now() - begin < timeoutMs) {
    try {
      const res = await fetch(`${baseUrl}/bot/status`);
      if (res.status === 200) return true;
    } catch {}
    await sleep(250);
  }
  return false;
};

const startServer = async (port) => {
  emit('HEARTBEAT', { stage: 'start_server_begin', port });
  const child = spawn(process.execPath, ['strategies/crypto_binary/server.mjs', `--port=${port}`], {
    cwd: REPO_ROOT,
    stdio: 'ignore'
  });
  const baseUrl = `http://localhost:${port}`;
  if (!(await waitServerReady(baseUrl))) {
    child.kill();
    throw new Error('ERR_SERVER_START_TIMEOUT');
  }
  emit('HEARTBEAT', { stage: 'start_server_ready', port });
  return { child, baseUrl };
};

const stopServer = async (child) => {
  if (!child || child.killed) return;
  child.kill();
  await sleep(600);
};

const parseIsoMs = (v) => {
  const t = Date.parse(String(v || ''));
  return Number.isFinite(t) ? t : null;
};

const normalizeLadder = (rows = []) => (Array.isArray(rows) ? rows : []).map((r) => ({
  price: toNum(r?.price),
  size: toNum(r?.size),
  tp_price: toNum(r?.tp_price)
})).filter((r) => r.price !== null && r.size !== null && r.tp_price !== null);

const configToSides = (cfg = {}) => ({
  YES: normalizeLadder(cfg?.up_ladder),
  NO: normalizeLadder(cfg?.down_ladder)
});

const orderToSides = (orders = [], windowId = null) => {
  const all = Array.isArray(orders) ? orders : [];
  const inWindow = windowId
    ? all.filter((o) => o?.window_id === windowId)
    : all;
  const openEntry = inWindow.filter((o) => o?.kind === 'ENTRY' && o?.status === 'OPEN');
  const picked = openEntry.length > 0
    ? openEntry
    : inWindow
      .filter((o) => o?.kind === 'ENTRY')
      .sort((a, b) => String(b?.created_at || '').localeCompare(String(a?.created_at || '')))
      .slice(0, 12);
  const mapRows = (side) => picked.filter((o) => o?.side === side).map((o) => ({
    price: toNum(o?.price),
    size: toNum(o?.size),
    tp_price: toNum(o?.tp_price),
    order_id: o?.order_id ?? null,
    status: o?.status ?? null,
    window_id: o?.window_id ?? null
  })).filter((r) => r.price !== null && r.size !== null && r.tp_price !== null);
  return { YES: mapRows('YES'), NO: mapRows('NO') };
};

const toSignature = (sides = {}) => {
  const side = (rows = []) => rows.map((r) => `${r.price}:${r.size}:${r.tp_price}`).join(',');
  return `YES[${side(sides.YES || [])}]|NO[${side(sides.NO || [])}]`;
};

const parsePlaceFromMessage = (message) => {
  const text = String(message || '');
  const matches = [...text.matchAll(/PLACE_LADDER\((YES|NO)\|([^)]+)\)/g)];
  const out = { YES: [], NO: [] };
  for (const m of matches) {
    const side = m[1];
    out[side] = String(m[2] || '').split(',').map((x) => x.trim()).filter(Boolean).map((seg) => {
      const [price, size, tp] = seg.split(':');
      return { price: toNum(price), size: toNum(size), tp_price: toNum(tp) };
    }).filter((r) => r.price !== null && r.size !== null && r.tp_price !== null);
  }
  return out;
};

const findLatestPlaceAfter = (logs = [], atMs = 0) => {
  const arr = (Array.isArray(logs) ? logs : []).filter((l) => l?.event === 'BOT_INTENTS' && String(l?.message || '').includes('PLACE_LADDER'));
  const filtered = arr.filter((l) => {
    const t = parseIsoMs(l?.ts || l?.time || l?.timestamp);
    return t === null || t >= atMs;
  });
  if (filtered.length === 0) return null;
  const row = filtered[filtered.length - 1];
  return {
    ts: row?.ts || row?.time || row?.timestamp || null,
    message: row?.message || '',
    reason: row?.data?.reason ?? null,
    parsed: parsePlaceFromMessage(row?.message || '')
  };
};

const captureTickFourWay = async (http, scenarioKey) => {
  const logsBefore = await http.get('/bot/logs?limit=5000');
  const anchorMs = Date.now();
  const beforeMaxTs = (Array.isArray(logsBefore?.body) ? logsBefore.body : []).reduce((acc, row) => {
    const t = parseIsoMs(row?.ts || row?.time || row?.timestamp);
    return t && t > acc ? t : acc;
  }, anchorMs);
  const w = `audit-040-${scenarioKey}-${Date.now()}`;
  await http.post('/bot/paper/apply-action', { action: 'CANCEL_ALL_OPEN' });
  await http.post('/bot/runner/tick', {
    state_override: {
      current_window_id: w,
      window_initialized_at: new Date(Date.now() - 8000).toISOString(),
      ladder_posted: false,
      yes_order_ids: [],
      no_order_ids: [],
      yes_cancelled: false,
      no_cancelled: false,
      up_formula_cancelled: false,
      down_formula_cancelled: false,
      anchor_btc: 65000,
      atr_5m: 100,
      upper_bound: 70000,
      lower_bound: 60000
    },
    context_override: {
      window_id: w,
      period: '5m',
      remaining_sec: 240,
      btc_price: 65000,
      atr_5m: 100,
      bid_yes: 0.11,
      ask_yes: 0.12,
      bid_no: 0.11,
      ask_no: 0.12,
      upper_bound: 70000,
      lower_bound: 60000
    }
  });
  await sleep(320);
  const [statusRes, logsRes, ordersRes] = await Promise.all([
    http.get('/bot/status'),
    http.get('/bot/logs?limit=5000'),
    http.get('/bot/orders')
  ]);
  const status = statusRes?.body || {};
  const logs = Array.isArray(logsRes?.body) ? logsRes.body : [];
  const ordersBody = ordersRes?.body || {};
  const place = findLatestPlaceAfter(logs, beforeMaxTs);
  const placeSig = place ? toSignature(place.parsed) : null;
  const savedSig = toSignature(configToSides(status?.saved_config || {}));
  const activeSig = toSignature(configToSides(status?.active_runtime_snapshot?.config || {}));
  const orderSig = toSignature(orderToSides(
    Array.isArray(ordersBody?.all_orders) ? ordersBody.all_orders : (Array.isArray(ordersBody?.orders) ? ordersBody.orders : []),
    w
  ));
  return {
    scenario: scenarioKey,
    window_id: w,
    saved_signature: savedSig,
    active_signature: activeSig,
    place_signature: placeSig,
    order_signature: orderSig,
    place_log: place
  };
};

const readJsonSafe = (filePath) => {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
};

const runAudit = async (port) => {
  const begin = Date.now();
  let lastBeatAt = Date.now();
  let lastHeartbeatAt = 0;

  const oldCfg = {
    open_delay_sec: 0,
    ladder_prices: [0.21, 0.23],
    ladder_size: 5,
    atr_multiple: 1.2,
    cancel_all_remaining_sec: 100,
    up_ladder: [{ price: 0.21, size: 5, tp_price: 0.31 }, { price: 0.23, size: 5, tp_price: 0.33 }],
    down_ladder: [{ price: 0.25, size: 6, tp_price: 0.35 }, { price: 0.27, size: 6, tp_price: 0.37 }],
    up_cancel: { before_end_sec: 120, formula: '' },
    down_cancel: { before_end_sec: 120, formula: '' }
  };
  const newCfg = {
    open_delay_sec: 0,
    ladder_prices: [0.88, 0.89],
    ladder_size: 11,
    atr_multiple: 1.2,
    cancel_all_remaining_sec: 100,
    up_ladder: [{ price: 0.88, size: 11, tp_price: 0.96 }, { price: 0.89, size: 11, tp_price: 0.97 }],
    down_ladder: [{ price: 0.9, size: 12, tp_price: 0.98 }, { price: 0.91, size: 12, tp_price: 0.99 }],
    up_cancel: { before_end_sec: 120, formula: '' },
    down_cancel: { before_end_sec: 120, formula: '' }
  };
  const oldSig = toSignature(configToSides(oldCfg));
  const newSig = toSignature(configToSides(newCfg));
  const preFail = readJsonSafe(PREFIX_FAIL_JSON);
  const preTiming = preFail?.evidence_index?.key_facts?.case_timing_after || null;
  const preFailOk = Boolean(
    preFail?.first_break_layer === 'startup_active_snapshot_restore'
    && preTiming?.saved_signature === newSig
    && preTiming?.active_signature === oldSig
    && preTiming?.place_signature === oldSig
  );

  const timeline = [];
  const beat = (stage, data = {}) => {
    if (Date.now() - lastHeartbeatAt >= HEARTBEAT_MS) {
      lastHeartbeatAt = Date.now();
      emit('HEARTBEAT', { stage, ...data });
    }
    lastBeatAt = Date.now();
    if (Date.now() - begin > MAX_WALL_MS) throw new Error('ERR_MAX_WALL_TIME_EXCEEDED');
    if (Date.now() - lastBeatAt > MAX_SILENCE_MS) throw new Error('ERR_MAX_SILENCE_EXCEEDED');
  };

  let server = await startServer(port);
  try {
    const http = createHttp(server.baseUrl);
    emit('HEARTBEAT', { stage: 'audit_begin' });
    await http.post('/bot/stop', {});
    await sleep(250);

    await http.post('/bot/config', oldCfg);
    await http.post('/bot/start', { tick_interval_ms: 1000 });
    const beforeUpdate = await captureTickFourWay(http, 'before_update_old');
    await http.post('/bot/config', newCfg);
    const afterUpdate = await captureTickFourWay(http, 'after_update_running');
    timeline.push(beforeUpdate, afterUpdate);
    await http.post('/bot/stop', {});
    beat('case_running_update', { before_place: beforeUpdate.place_signature, after_place: afterUpdate.place_signature });

    await stopServer(server.child);
    server = await startServer(port);
    const http2 = createHttp(server.baseUrl);
    const statusAfterRestart = (await http2.get('/bot/status'))?.body || {};
    const restartProbe = {
      saved_signature: toSignature(configToSides(statusAfterRestart?.saved_config || {})),
      active_signature: toSignature(configToSides(statusAfterRestart?.active_runtime_snapshot?.config || {}))
    };
    await http2.post('/bot/start', { tick_interval_ms: 1000 });
    const afterRestart = await captureTickFourWay(http2, 'after_restart');
    await http2.post('/bot/stop', {});
    timeline.push({
      scenario: 'restart_probe',
      ...restartProbe,
      place_signature: null,
      order_signature: null
    }, afterRestart);
    beat('case_restart_path', { restart_saved: restartProbe.saved_signature, restart_active: restartProbe.active_signature });

    await http2.post('/bot/config', newCfg);
    await http2.post('/bot/start', { tick_interval_ms: 1000 });
    const noRecoveryCase = await captureTickFourWay(http2, 'no_recovery_new_only');
    await http2.post('/bot/stop', {});
    timeline.push(noRecoveryCase);
    beat('case_non_regression', { no_recovery_place: noRecoveryCase.place_signature });

    const postFourWayPass = (
      afterUpdate.saved_signature === newSig
      && afterUpdate.active_signature === newSig
      && afterUpdate.place_signature === newSig
      && afterUpdate.order_signature === afterUpdate.place_signature
    );
    const restartPathPass = (
      restartProbe.saved_signature === newSig
      && restartProbe.active_signature === newSig
      && afterRestart.place_signature === newSig
    );
    const nonRegressionNoRecovery = (
      noRecoveryCase.saved_signature === newSig
      && noRecoveryCase.active_signature === newSig
      && noRecoveryCase.place_signature === newSig
    );
    const oldNotResurrected = (
      afterUpdate.place_signature !== oldSig
      && afterRestart.place_signature !== oldSig
      && noRecoveryCase.place_signature !== oldSig
    );
    const hasRealPlaceLog = Boolean(afterUpdate.place_log?.message && String(afterUpdate.place_log.message).includes('PLACE_LADDER'));

    const checks = {
      pre_fail_evidence_ok: preFailOk,
      post_four_way_pass: postFourWayPass,
      restart_path_pass: restartPathPass,
      non_regression_no_recovery: nonRegressionNoRecovery,
      non_regression_old_not_resurrected: oldNotResurrected,
      has_real_place_ladder_log: hasRealPlaceLog
    };
    const pass = Object.values(checks).every(Boolean);

    return {
      pass,
      first_break_layer: pass ? 'NONE_CHAIN_PASS' : 'startup_active_snapshot_restore',
      old_signature: oldSig,
      new_signature: newSig,
      checks,
      fail_to_pass: {
        pre: {
          source_file: PREFIX_FAIL_JSON,
          first_break_layer: preFail?.first_break_layer || null,
          timing_after_saved_signature: preTiming?.saved_signature || null,
          timing_after_active_signature: preTiming?.active_signature || null,
          timing_after_place_signature: preTiming?.place_signature || null
        },
        post: {
          after_update: afterUpdate,
          after_restart: afterRestart
        }
      },
      four_way_table: {
        strategy_setting: afterUpdate.saved_signature,
        active: afterUpdate.active_signature,
        place_ladder: afterUpdate.place_signature,
        order_table: afterUpdate.order_signature
      },
      no_regression: {
        no_recovery_new_only: noRecoveryCase,
        old_not_resurrected: {
          old_signature: oldSig,
          after_update_place_signature: afterUpdate.place_signature,
          after_restart_place_signature: afterRestart.place_signature
        }
      },
      real_place_log_line: afterUpdate.place_log?.message || null,
      timeline
    };
  } finally {
    await stopServer(server.child);
  }
};

const main = async () => {
  const args = parseArgs();
  const sampleName = ensureSampleAllowed(args.sampleName);
  heartbeatLogPath = String(args.output || '').replace(/\.json$/i, '.heartbeat.log');
  ensureDir(heartbeatLogPath);
  fs.writeFileSync(heartbeatLogPath, '', 'utf8');

  const port = Number(new URL(args.baseUrl).port || 53240);
  const serverHealth = await startServer(port);
  let health = { root: null, pairs: null };
  try {
    health.root = await fetch(`${serverHealth.baseUrl}/`).then((res) => res.status).catch(() => null);
    health.pairs = await fetch(`${serverHealth.baseUrl}/pairs`).then((res) => res.status).catch(() => null);
  } finally {
    await stopServer(serverHealth.child);
  }

  const audit = await runAudit(port);
  const standard = buildStandardResult({
    scriptName: 'truth_audit_ladder_restore_fix_260330_040',
    taskId: args.taskId,
    sampleName,
    pass: audit.pass,
    message: audit.pass ? 'startup_active_snapshot_restore fixed' : 'startup_active_snapshot_restore still failing',
    firstBreakLayer: audit.first_break_layer,
    evidenceFile: args.output,
    summary: {
      first_break_layer: audit.first_break_layer,
      pass: audit.pass
    },
    rawExcerpt: {
      pre_fail_active_signature: audit.fail_to_pass.pre.timing_after_active_signature,
      post_active_signature: audit.fail_to_pass.post.after_update.active_signature,
      post_place_signature: audit.fail_to_pass.post.after_update.place_signature
    }
  });
  const output = {
    ...standard,
    task_id: args.taskId,
    conclusion_block: {
      verdict: audit.pass ? 'A：通过' : 'C：存在断裂',
      first_break_layer: audit.first_break_layer,
      pass: audit.pass
    },
    evidence_index: {
      fail_to_pass: audit.fail_to_pass,
      four_way_table: audit.four_way_table,
      checks: audit.checks,
      no_regression: audit.no_regression,
      real_place_ladder_log_line: audit.real_place_log_line,
      timeline_head: audit.timeline.slice(0, 20),
      timeline_tail: audit.timeline.slice(-LOG_TAIL),
      healthcheck: health,
      heartbeat_log: heartbeatLogPath,
      last_heartbeat: lastHeartbeat,
      guardrails: {
        max_wall_time_ms: MAX_WALL_MS,
        max_silence_ms: MAX_SILENCE_MS,
        log_tail: LOG_TAIL
      }
    }
  };
  ensureDir(args.output);
  fs.writeFileSync(args.output, JSON.stringify(output, null, 2));
  const logPath = writeStandardLog(args.output, standard);
  console.log(`VERIFY_OUTPUT=${args.output}`);
  console.log(`VERIFY_LOG=${logPath}`);
  console.log(JSON.stringify({
    pass: audit.pass,
    first_break_layer: audit.first_break_layer,
    checks: audit.checks,
    healthcheck: health
  }));
  if (!audit.pass) process.exitCode = 1;
};

main().catch((error) => {
  console.error(JSON.stringify({
    event: 'AUDIT_FATAL',
    code: error?.message || 'ERR_UNHANDLED',
    allowed_samples: ALLOWED_SAMPLES
  }));
  process.exit(1);
});
