import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

const DEFAULT_PORT = 53123;
const DEFAULT_BASE_URL = `http://localhost:${DEFAULT_PORT}`;
const DEFAULT_TASK_ID = '260324_028';
const MAX_TICKS = 40;
const TICK_WAIT_MS = 700;

const parseArgs = () => {
  const args = Object.fromEntries(
    process.argv
      .slice(2)
      .filter((item) => item.startsWith('--'))
      .map((item) => {
        const [k, ...rest] = item.slice(2).split('=');
        return [k, rest.join('=') || 'true'];
      })
  );
  const taskId = args.task_id || DEFAULT_TASK_ID;
  const baseUrl = args.base_url || DEFAULT_BASE_URL;
  const output = args.output
    || path.join(REPO_ROOT, 'rules', 'task-reports', new Date().toISOString().slice(0, 7), `${taskId}_ready_reachability.json`);
  const spawnServer = args.spawn_server !== 'false';
  return { taskId, baseUrl, output, spawnServer };
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const ensureDir = (filePath) => {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
};

const toJson = async (response) => {
  try {
    return await response.json();
  } catch {
    return null;
  }
};

const toFinite = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const httpClient = (baseUrl) => ({
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
  const http = httpClient(baseUrl);
  try {
    const res = await http.get('/bot/status');
    if (res.status === 200) return { spawned: null };
  } catch {}
  if (!spawnServer) throw new Error(`server unreachable: ${baseUrl}`);
  const child = spawn('node', ['strategies/crypto_binary/server.mjs', '--port=53123'], {
    cwd: REPO_ROOT,
    stdio: 'ignore',
    detached: false
  });
  for (let i = 0; i < 40; i += 1) {
    await sleep(500);
    try {
      const res = await http.get('/bot/status');
      if (res.status === 200) return { spawned: child };
    } catch {}
  }
  child.kill();
  throw new Error(`failed to boot server: ${baseUrl}`);
};

const findLatestLog = (logsBody, windowId = null) => {
  const rows = Array.isArray(logsBody?.logs) ? logsBody.logs : [];
  const candidates = rows
    .filter((row) => ['RUNNER_TICK', 'BOT_DECISION_GATED', 'BOT_INTENTS'].includes(String(row?.event || '')))
    .filter((row) => (windowId ? row?.window_id === windowId : true));
  const chosen = candidates.length > 0 ? candidates[candidates.length - 1] : (rows[rows.length - 1] || null);
  return chosen
    ? {
        ts: chosen.ts ?? chosen.timestamp ?? null,
        event: chosen.event ?? null,
        message: chosen.message ?? null,
        reason: chosen.data?.reason ?? null
      }
    : null;
};

const isReady = (row) => {
  const summary = String(row.intents_summary || '');
  const requiresBounds = /(CANCEL_OPEN\(YES\)|CANCEL_OPEN\(NO\)|PLACE_|FLATTEN_POSITION|OPEN_POSITION)/.test(summary);
  return row.running === true
    && row.current_window_id != null
    && row.btc_price != null
    && row.anchor_btc != null
    && row.remaining_sec != null
    && (!requiresBounds || (row.upper_bound != null && row.lower_bound != null))
    && !String(row.reason || '').startsWith('gate_context_not_ready');
};

const captureTick = async (http, source, seq, startedAtMs) => {
  const [status, context, preview, logs] = await Promise.all([
    http.get('/bot/status'),
    http.get('/bot/context'),
    http.get('/bot/decision-preview'),
    http.get('/bot/logs?limit=200')
  ]);
  const s = status.body || {};
  const c = context.body || {};
  const p = preview.body || {};
  const logsRows = Array.isArray(logs.body?.logs) ? logs.body.logs : [];
  const windowId = s?.current_window_id ?? c?.window_id ?? null;
  const logTail = findLatestLog(logs.body, windowId);
  const row = {
    source,
    seq,
    elapsed_ms: Date.now() - startedAtMs,
    captured_at: new Date().toISOString(),
    running: s?.running === true,
    current_window_id: s?.current_window_id ?? null,
    phase: s?.phase ?? null,
    btc_price: toFinite(c?.btc_price),
    anchor_btc: toFinite(c?.anchor_btc ?? s?.anchor_btc),
    upper_bound: toFinite(c?.upper_bound ?? s?.upper_bound),
    lower_bound: toFinite(c?.lower_bound ?? s?.lower_bound),
    remaining_sec: toFinite(c?.remaining_sec ?? s?.remaining_sec),
    intents_summary: p?.intents_summary ?? null,
    reason: p?.reason ?? null,
    gate_reason: p?.diagnostics?.gate_reason ?? null,
    logs_status: logs.status,
    logs_count: logsRows.length,
    status_raw: status,
    context_raw: context,
    decision_preview_raw: preview,
    log_tail: logTail
  };
  row.ready = isReady(row);
  return row;
};

const auditSample = async (http, source, startPayload) => {
  await http.post('/bot/stop', {});
  await sleep(350);
  await http.post('/bot/start', startPayload);
  const startedAtMs = Date.now();
  const rows = [];
  let tracking = false;
  for (let i = 1; i <= MAX_TICKS; i += 1) {
    await sleep(TICK_WAIT_MS);
    const tick = await captureTick(http, source, i, startedAtMs);
    if (!tracking && tick.running && tick.current_window_id) tracking = true;
    if (tracking) rows.push(tick);
    if (tracking && tick.ready) break;
  }
  await http.post('/bot/stop', {});
  await sleep(400);
  const finalStatus = await http.get('/bot/status');
  return {
    source,
    start_payload: startPayload,
    rows,
    final_status: finalStatus
  };
};

const inferFirstBreakLayer = (rows) => {
  if (!rows || rows.length === 0) return 'source';
  const anyBtc = rows.some((r) => r.btc_price != null);
  const anyAnchor = rows.some((r) => r.anchor_btc != null);
  const anyBounds = rows.some((r) => r.upper_bound != null && r.lower_bound != null);
  const gateOnly = rows.every((r) => String(r.reason || '').startsWith('gate_context_not_ready'));
  if (!anyBtc) return 'source';
  if (anyBtc && !anyAnchor) return 'lifecycle';
  if (anyAnchor && !anyBounds) return 'lifecycle';
  if (anyBounds && gateOnly) return 'decision gating';
  return 'context assembly';
};

const normalizeTable = (rows) => rows.map((r) => ({
  seq: r.seq,
  captured_at: r.captured_at,
  running: r.running,
  current_window_id: r.current_window_id,
  phase: r.phase,
  btc_price: r.btc_price,
  anchor_btc: r.anchor_btc,
  upper_bound: r.upper_bound,
  lower_bound: r.lower_bound,
  remaining_sec: r.remaining_sec,
  intents_summary: r.intents_summary,
  reason: r.reason,
  log_event: r.log_tail?.event ?? null,
  log_message: r.log_tail?.message ?? null
}));

const toTsv = (rows) => {
  const header = [
    'seq',
    'captured_at',
    'running',
    'current_window_id',
    'phase',
    'btc_price',
    'anchor_btc',
    'upper_bound',
    'lower_bound',
    'remaining_sec',
    'intents_summary',
    'reason',
    'log_event',
    'log_message'
  ].join('\t');
  const lines = rows.map((r) => [
    r.seq,
    r.captured_at,
    r.running,
    r.current_window_id ?? '',
    r.phase ?? '',
    r.btc_price ?? '',
    r.anchor_btc ?? '',
    r.upper_bound ?? '',
    r.lower_bound ?? '',
    r.remaining_sec ?? '',
    r.intents_summary ?? '',
    r.reason ?? '',
    r.log_event ?? '',
    String(r.log_message ?? '').replaceAll('\n', ' ')
  ].join('\t'));
  return [header, ...lines].join('\n');
};

const main = async () => {
  const args = parseArgs();
  const boot = await ensureServer(args);
  const http = httpClient(args.baseUrl);
  try {
    const realSample = await auditSample(http, 'real_no_debug', { tick_interval_ms: 1000 });
    const debugSample = await auditSample(http, 'debug_main_path_v1', { tick_interval_ms: 1000, debugScenario: 'main_path_v1' });
    const realReadyReached = realSample.rows.some((r) => r.ready === true);
    const debugReadyReached = debugSample.rows.some((r) => r.ready === true);
    const firstBreakLayer = realReadyReached ? null : inferFirstBreakLayer(realSample.rows);
    const output = {
      task_id: args.taskId,
      command: `node scripts/audit_ready_reachability.mjs --task_id=${args.taskId}`,
      ready_condition: {
        running: true,
        current_window_id_non_null: true,
        btc_price_valid: true,
        anchor_btc_valid: true,
        bounds_valid_if_required: true,
        remaining_sec_valid: true,
        no_gate_reason: true
      },
      samples: {
        real_runtime: {
          source: realSample.source,
          row_count: realSample.rows.length,
          ready_reached: realReadyReached,
          rows: normalizeTable(realSample.rows),
          raw_rows: realSample.rows
        },
        debug_control: {
          source: debugSample.source,
          row_count: debugSample.rows.length,
          ready_reached: debugReadyReached,
          rows: normalizeTable(debugSample.rows),
          raw_rows: debugSample.rows
        }
      },
      result: {
        ready_reached: realReadyReached,
        ready_reachability_pass: realReadyReached,
        first_break_layer: firstBreakLayer || null
      },
      artifacts: {
        real_table_tsv: args.output.replace('.json', '_real_table.tsv'),
        debug_table_tsv: args.output.replace('.json', '_debug_table.tsv')
      }
    };
    const realTableRows = normalizeTable(realSample.rows);
    const debugTableRows = normalizeTable(debugSample.rows);
    const realTablePath = args.output.replace('.json', '_real_table.tsv');
    const debugTablePath = args.output.replace('.json', '_debug_table.tsv');
    ensureDir(args.output);
    fs.writeFileSync(realTablePath, toTsv(realTableRows));
    fs.writeFileSync(debugTablePath, toTsv(debugTableRows));
    fs.writeFileSync(args.output, JSON.stringify(output, null, 2));
    console.log(`AUDIT_OUTPUT=${args.output}`);
    console.log(JSON.stringify(output.result));
    if (!output.result.ready_reachability_pass) process.exitCode = 1;
  } finally {
    await http.post('/bot/stop', {}).catch(() => null);
    if (boot.spawned && !boot.spawned.killed) boot.spawned.kill();
  }
};

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
