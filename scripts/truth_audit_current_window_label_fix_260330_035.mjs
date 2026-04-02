import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { buildStandardResult, ensureDir, parseVerifyArgs, writeStandardLog } from './verify_standard_v1.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_TASK_ID = '260330_035';
const MAX_WALL_MS = 15 * 60 * 1000;
const MAX_SILENCE_MS = 120 * 1000;
const LOG_TAIL = 100;
const HEARTBEAT_MS = 25 * 1000;
const ALLOWED_SAMPLES = ['current_window_label_fix_v1'];
const PREFIX_JSON = path.join(REPO_ROOT, 'rules', 'task-reports', '2026-03', '260330_034_truth_audit_current_window_label_projection.json');

let heartbeatLogPath = null;
let lastHeartbeat = null;

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: 'http://localhost:53235',
  defaultOutputSuffix: 'truth_audit_current_window_label_fix_260330_035',
  defaultSampleName: ALLOWED_SAMPLES[0]
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const nowIso = () => new Date().toISOString();
const toJson = async (res) => { try { return await res.json(); } catch { return null; } };

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

const readJsonSafe = (filePath) => {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
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

const parseIsoMs = (value) => {
  const t = Date.parse(String(value || ''));
  return Number.isFinite(t) ? t : null;
};

const formatWindowDisplayName = (windowId) => {
  const raw = windowId == null ? '' : String(windowId).trim();
  if (!raw) return 'N/A (null)';
  const match = raw.match(/-(\d+)m-(\d{10})$/);
  if (!match) return raw;
  const minutes = Number(match[1]);
  const startSec = Number(match[2]);
  if (!Number.isFinite(minutes) || !Number.isFinite(startSec) || minutes <= 0) return raw;
  const start = new Date(startSec * 1000);
  const end = new Date((startSec + minutes * 60) * 1000);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return raw;
  const tz = 'America/New_York';
  const dateText = new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'long', day: 'numeric' }).format(start);
  const toPart = (date) => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    }).formatToParts(date);
    const map = {};
    for (const p of parts) map[p.type] = p.value;
    return `${map.hour || ''}:${map.minute || ''}${String(map.dayPeriod || '').toLowerCase()}`;
  };
  return `${dateText} ${toPart(start)} - ${toPart(end)}`;
};

const readLabelSourceMeta = () => {
  const filePath = path.join(REPO_ROOT, 'ui', 'js', 'strategy-editor.js');
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/);
  const sourceLine = lines.findIndex((line) => line.includes("se_setText('se-log-current-window'"));
  const sourceExpr = sourceLine >= 0 ? lines[sourceLine].trim() : null;
  const sourceUsesCurrent = content.includes('const currentWindowLabelSource = status?.current_window_id')
    || String(sourceExpr || '').includes('current_window_id');
  return {
    source_file: filePath.replace(/\\/g, '/'),
    label_source_line: sourceLine >= 0 ? sourceLine + 1 : null,
    label_source_expr: sourceExpr,
    source_uses_current_window_id_priority: sourceUsesCurrent
  };
};

const buildDomProjection = (status, postmortem) => {
  const activeRuntimeId = status?.active_runtime_snapshot?.current_window_id ?? null;
  const lastRunId = status?.last_run_snapshot?.current_window_id ?? null;
  const fallback = activeRuntimeId || lastRunId || postmortem?.window_id || null;
  const sourceId = status?.current_window_id || fallback;
  const labelText = formatWindowDisplayName(sourceId);
  return {
    dom_label_text: labelText,
    dom_source_window_id: sourceId,
    api_current_window_id: status?.current_window_id ?? null,
    api_last_window_id: status?.last_window_id ?? null
  };
};

const runAudit = async (http) => {
  const begin = Date.now();
  let lastBeatAt = Date.now();
  let lastHeartbeatAt = 0;
  let exitCode = null;
  const uiMeta = readLabelSourceMeta();

  emit('HEARTBEAT', { stage: 'audit_begin' });
  await http.post('/bot/stop', {});
  await sleep(300);
  await http.post('/bot/config', {
    open_delay_sec: 0,
    ladder_prices: [0.3],
    ladder_size: 5,
    atr_multiple: 1.2,
    cancel_all_remaining_sec: 30,
    up_ladder: [{ price: 0.3, size: 5, tp_price: 1 }],
    down_ladder: [{ price: 0.3, size: 5, tp_price: 1 }]
  });
  await http.post('/bot/start', { tick_interval_ms: 1000 });

  const startedAtMs = Date.now();
  let startupSnapshot = null;
  let firstFillSnapshot = null;
  let switchedSnapshot = null;
  let firstFillLog = null;
  let windowChangedLog = null;
  const reconcileRows = [];
  let latestStatus = null;
  let latestPostmortem = null;
  let latestLogs = [];

  for (let i = 0; i < 2200; i += 1) {
    if (Date.now() - begin > MAX_WALL_MS) {
      exitCode = 'ERR_MAX_WALL_TIME_EXCEEDED';
      throw new Error(exitCode);
    }
    if (Date.now() - lastBeatAt > MAX_SILENCE_MS) {
      exitCode = 'ERR_MAX_SILENCE_EXCEEDED';
      throw new Error(exitCode);
    }
    const [statusRes, postmortemRes, logsRes] = await Promise.all([
      http.get('/bot/status'),
      http.get('/bot/postmortem/latest'),
      http.get('/bot/logs?limit=500')
    ]);
    const status = statusRes.body || {};
    const postmortem = postmortemRes.body?.postmortem || null;
    const logs = Array.isArray(logsRes.body) ? logsRes.body : [];
    latestStatus = status;
    latestPostmortem = postmortem;
    latestLogs = logs;
    const row = {
      timestamp: nowIso(),
      ...buildDomProjection(status, postmortem),
      api_postmortem_window_id: postmortem?.window_id ?? null
    };
    reconcileRows.push(row);
    if (!startupSnapshot) startupSnapshot = row;

    if (Date.now() - lastHeartbeatAt >= HEARTBEAT_MS) {
      lastHeartbeatAt = Date.now();
      emit('HEARTBEAT', {
        stage: 'audit_running',
        iteration: i,
        startup_collected: Boolean(startupSnapshot),
        first_fill_collected: Boolean(firstFillSnapshot),
        switched_collected: Boolean(switchedSnapshot),
        dom_label_text: row.dom_label_text,
        api_current_window_id: row.api_current_window_id
      });
    }

    const logsAfterStart = logs.filter((item) => {
      const t = parseIsoMs(item?.time || item?.ts || item?.timestamp);
      return t === null || t >= startedAtMs - 1000;
    });
    if (!firstFillLog) firstFillLog = logsAfterStart.find((item) => item?.event === 'BOT_FILL') || null;
    if (firstFillLog && !firstFillSnapshot) firstFillSnapshot = row;
    if (!windowChangedLog) windowChangedLog = logsAfterStart.find((item) => item?.event === 'BOT_WINDOW_CHANGED') || null;
    if (windowChangedLog && !switchedSnapshot) switchedSnapshot = row;

    if (startupSnapshot && firstFillSnapshot && switchedSnapshot) {
      exitCode = 'EARLY_EXIT_FIX_EVIDENCE_READY';
      emit('HEARTBEAT', { stage: 'audit_early_exit', exit_code: exitCode });
      break;
    }

    lastBeatAt = Date.now();
    await sleep(1000);
  }
  if (!exitCode) exitCode = 'EARLY_EXIT_PARTIAL_CHAIN_READY';
  await http.post('/bot/stop', {});

  const finalProjection = buildDomProjection(latestStatus || {}, latestPostmortem || null);
  const labelsMatchCurrent = [startupSnapshot, firstFillSnapshot, switchedSnapshot]
    .filter(Boolean)
    .every((item) => {
      if (!item.api_current_window_id) return true;
      return item.dom_label_text === formatWindowDisplayName(item.api_current_window_id);
    });
  const sourceFixed = uiMeta.source_uses_current_window_id_priority === true;

  const firstBreakLayer = sourceFixed && labelsMatchCurrent
    ? 'NONE_CHAIN_PASS'
    : 'current_window_label_source';

  return {
    exit_code: exitCode,
    first_break_layer: firstBreakLayer,
    ui_meta: uiMeta,
    startup_snapshot: startupSnapshot,
    first_fill_snapshot: firstFillSnapshot,
    switched_snapshot: switchedSnapshot,
    first_fill_log: firstFillLog,
    window_changed_log: windowChangedLog,
    final_projection: finalProjection,
    checks: {
      source_uses_current_window_id_priority: sourceFixed,
      labels_match_api_current_window_id: labelsMatchCurrent
    },
    reconcile_head: reconcileRows.slice(0, 20),
    reconcile_tail: reconcileRows.slice(-LOG_TAIL),
    logs_tail: latestLogs.slice(-80)
  };
};

const buildFailToPass = (postAudit) => {
  const pre = readJsonSafe(PREFIX_JSON);
  const preBreak = pre?.first_break_layer || pre?.conclusion_block?.first_break_layer || null;
  const preMismatch = preBreak === 'current_window_label_source'
    || pre?.evidence_index?.checks?.api_dom_projection_mismatch === true;
  const postPass = postAudit.first_break_layer === 'NONE_CHAIN_PASS'
    && postAudit.checks.source_uses_current_window_id_priority
    && postAudit.checks.labels_match_api_current_window_id;
  return {
    prefix_file: PREFIX_JSON,
    pre_first_break_layer: preBreak,
    pre_mismatch_observed: preMismatch,
    post_first_break_layer: postAudit.first_break_layer,
    post_labels_match_api_current_window_id: postAudit.checks.labels_match_api_current_window_id,
    pass: preMismatch && postPass
  };
};

const main = async () => {
  const args = parseArgs();
  const sampleName = ensureSampleAllowed(args.sampleName);
  heartbeatLogPath = String(args.output || '').replace(/\.json$/i, '.heartbeat.log');
  ensureDir(heartbeatLogPath);
  fs.writeFileSync(heartbeatLogPath, '', 'utf8');

  const port = Number(new URL(args.baseUrl).port || 53235);
  const server = await startServer(port);
  const http = createHttp(server.baseUrl);
  let health = { root: null, pairs: null };
  try {
    health.root = await fetch(`${server.baseUrl}/`).then((res) => res.status).catch(() => null);
    health.pairs = await fetch(`${server.baseUrl}/pairs`).then((res) => res.status).catch(() => null);
    const audit = await runAudit(http);
    const failToPass = buildFailToPass(audit);
    const pass = audit.first_break_layer === 'NONE_CHAIN_PASS' && failToPass.pass;
    const standard = buildStandardResult({
      scriptName: 'truth_audit_current_window_label_fix_260330_035',
      taskId: args.taskId,
      sampleName,
      pass,
      message: pass ? 'current window label source fix pass' : 'current window label source fix fail',
      firstBreakLayer: audit.first_break_layer,
      evidenceFile: args.output,
      summary: {
        exit_code: audit.exit_code,
        first_break_layer: audit.first_break_layer,
        fail_to_pass: failToPass.pass
      },
      rawExcerpt: {
        startup_dom_label: audit.startup_snapshot?.dom_label_text ?? null,
        startup_api_current_window_id: audit.startup_snapshot?.api_current_window_id ?? null,
        switched_dom_label: audit.switched_snapshot?.dom_label_text ?? null,
        switched_api_current_window_id: audit.switched_snapshot?.api_current_window_id ?? null
      }
    });
    const output = {
      ...standard,
      task_id: args.taskId,
      conclusion_block: {
        verdict: pass ? 'A：通过' : 'C：存在断裂',
        first_break_layer: audit.first_break_layer,
        exit_code: audit.exit_code
      },
      fail_to_pass: failToPass,
      evidence_index: {
        ui_meta: audit.ui_meta,
        startup_snapshot: audit.startup_snapshot,
        first_fill_snapshot: audit.first_fill_snapshot,
        switched_snapshot: audit.switched_snapshot,
        first_fill_log: audit.first_fill_log,
        window_changed_log: audit.window_changed_log,
        final_projection: audit.final_projection,
        checks: audit.checks,
        dom_api_log_reconcile_head: audit.reconcile_head,
        dom_api_log_reconcile_tail: audit.reconcile_tail,
        logs_tail: audit.logs_tail,
        heartbeat_log: heartbeatLogPath,
        last_heartbeat: lastHeartbeat,
        healthcheck: health,
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
      pass,
      first_break_layer: audit.first_break_layer,
      fail_to_pass: failToPass.pass,
      startup_dom_label: audit.startup_snapshot?.dom_label_text ?? null,
      startup_api_current_window_id: audit.startup_snapshot?.api_current_window_id ?? null,
      switched_dom_label: audit.switched_snapshot?.dom_label_text ?? null,
      switched_api_current_window_id: audit.switched_snapshot?.api_current_window_id ?? null
    }));
    if (!pass) process.exitCode = 1;
  } finally {
    await stopServer(server.child);
  }
};

main().catch((error) => {
  console.error(JSON.stringify({
    event: 'AUDIT_FATAL',
    code: error?.message || 'ERR_UNHANDLED',
    allowed_samples: ALLOWED_SAMPLES
  }));
  process.exit(1);
});
