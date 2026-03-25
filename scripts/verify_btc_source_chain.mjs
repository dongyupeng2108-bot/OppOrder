import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { buildStandardResult, parseVerifyArgs, writeStandardLog } from './verify_standard_v1.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

const DEFAULT_PORT = 53123;
const DEFAULT_BASE_URL = `http://localhost:${DEFAULT_PORT}`;
const DEFAULT_TASK_ID = '260324_029';
const MAX_TICKS = 26;
const TICK_WAIT_MS = 700;

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: DEFAULT_BASE_URL,
  defaultOutputSuffix: 'btc_source_chain',
  defaultSampleName: 'real_no_debug+debug_main_path_v1'
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const ensureDir = (filePath) => {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
};
const toFinite = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const toJson = async (res) => {
  try {
    return await res.json();
  } catch {
    return null;
  }
};
const httpClient = (baseUrl) => ({
  async get(endpoint) {
    const res = await fetch(`${baseUrl}${endpoint}`);
    return { status: res.status, body: await toJson(res) };
  },
  async post(endpoint, body = {}) {
    const res = await fetch(`${baseUrl}${endpoint}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    return { status: res.status, body: await toJson(res) };
  }
});

const ensureServer = async ({ baseUrl, spawnServer }) => {
  const http = httpClient(baseUrl);
  try {
    const status = await http.get('/bot/status');
    if (status.status === 200) return { spawned: null };
  } catch {}
  if (!spawnServer) throw new Error(`server unreachable: ${baseUrl}`);
  const spawned = spawn('node', ['strategies/crypto_binary/server.mjs', '--port=53123'], {
    cwd: REPO_ROOT,
    stdio: 'ignore',
    detached: false
  });
  for (let i = 0; i < 40; i += 1) {
    await sleep(500);
    try {
      const status = await http.get('/bot/status');
      if (status.status === 200) return { spawned };
    } catch {}
  }
  spawned.kill();
  throw new Error(`failed to boot server: ${baseUrl}`);
};

const rowReady = (row) => {
  const summary = String(row.intents_summary || '');
  const requiresBounds = /(CANCEL_OPEN\(YES\)|CANCEL_OPEN\(NO\)|PLACE_|FLATTEN_POSITION|OPEN_POSITION)/.test(summary);
  return row.running
    && row.current_window_id != null
    && row.btc_price != null
    && row.anchor_btc != null
    && row.remaining_sec != null
    && (!requiresBounds || (row.upper_bound != null && row.lower_bound != null))
    && !String(row.reason || '').startsWith('gate_context_not_ready');
};

const capture = async (http, source, tick, startedMs) => {
  const [status, context, preview] = await Promise.all([
    http.get('/bot/status'),
    http.get('/bot/context'),
    http.get('/bot/decision-preview')
  ]);
  const s = status.body || {};
  const c = context.body || {};
  const p = preview.body || {};
  const trace = c?._btc_source_trace || {};
  const row = {
    source,
    tick,
    elapsed_ms: Date.now() - startedMs,
    captured_at: new Date().toISOString(),
    running: s.running === true,
    current_window_id: s.current_window_id ?? null,
    phase: s.phase ?? null,
    btc_price: toFinite(c.btc_price),
    anchor_btc: toFinite(c.anchor_btc ?? s.anchor_btc),
    upper_bound: toFinite(c.upper_bound ?? s.upper_bound),
    lower_bound: toFinite(c.lower_bound ?? s.lower_bound),
    remaining_sec: toFinite(c.remaining_sec ?? s.remaining_sec),
    intents_summary: p.intents_summary ?? null,
    reason: p.reason ?? null,
    source_init_started: trace.source_init_started === true,
    source_init_error: trace.source_init_error ?? null,
    source_feed_seen: trace.source_feed_seen === true,
    source_feed_count: Number(trace.source_feed_count || 0),
    source_last_feed_at: trace.source_last_feed_at ?? null,
    latest_cache_price: toFinite(trace.latest_cache_price),
    latest_cache_at: trace.latest_cache_at ?? null,
    latest_cache_source: trace.latest_cache_source ?? null,
    context_raw: context,
    status_raw: status,
    decision_preview_raw: preview
  };
  row.ready = rowReady(row);
  return row;
};

const captureSample = async (http, source, startPayload) => {
  await http.post('/bot/stop', {});
  await sleep(350);
  await http.post('/bot/start', startPayload);
  const startedMs = Date.now();
  const rows = [];
  let tracking = false;
  for (let i = 1; i <= MAX_TICKS; i += 1) {
    await sleep(TICK_WAIT_MS);
    const row = await capture(http, source, i, startedMs);
    if (!tracking && row.running && row.current_window_id) tracking = true;
    if (tracking) rows.push(row);
    if (tracking && row.ready) break;
  }
  await http.post('/bot/stop', {});
  await sleep(350);
  return rows;
};

const normalizeRows = (rows) => rows.map((r) => ({
  tick: r.tick,
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
  source_init_started: r.source_init_started,
  source_feed_seen: r.source_feed_seen,
  source_feed_count: r.source_feed_count,
  latest_cache_price: r.latest_cache_price,
  latest_cache_source: r.latest_cache_source
}));

const makeChainSummary = (rows) => {
  const sourceInit = rows.some((r) => r.source_init_started && !r.source_init_error);
  const sourceFeed = rows.some((r) => r.source_feed_seen && r.source_feed_count > 0 && r.source_last_feed_at);
  const latestCache = rows.some((r) => r.latest_cache_price != null && r.latest_cache_at != null);
  const contextRead = rows.some((r) => r.btc_price != null);
  const readyReached = rows.some((r) => r.ready);
  return {
    source_init_pass: sourceInit,
    source_feed_pass: sourceFeed,
    latest_cache_pass: latestCache,
    context_read_pass: contextRead,
    source_chain_pass: sourceInit && sourceFeed && latestCache && contextRead,
    real_runtime_ready_reached: readyReached,
    btc_price_chain_pass: sourceInit && sourceFeed && latestCache && contextRead && readyReached
  };
};

const main = async () => {
  const args = parseArgs();
  const boot = await ensureServer(args);
  const http = httpClient(args.baseUrl);
  try {
    const realRows = await captureSample(http, 'real_no_debug', { tick_interval_ms: 1000 });
    const debugRows = await captureSample(http, 'debug_main_path_v1', { tick_interval_ms: 1000, debugScenario: 'main_path_v1' });
    const realSummary = makeChainSummary(realRows);
    const debugSummary = makeChainSummary(debugRows);
    const pass = realSummary.btc_price_chain_pass === true;
    const firstBreakLayer = pass ? null : (!realSummary.source_init_pass
      ? 'source 未启动'
      : (!realSummary.source_feed_pass
        ? 'source feed 未到达'
        : (!realSummary.latest_cache_pass
          ? 'latest cache 未更新'
          : (!realSummary.context_read_pass ? 'context 读取失败' : 'unknown'))));
    const standard = buildStandardResult({
      scriptName: 'verify_btc_source_chain',
      taskId: args.taskId,
      sampleName: args.sampleName,
      pass,
      message: pass ? 'BTC source 链路通过' : 'BTC source 链路未通过',
      firstBreakLayer,
      evidenceFile: args.output,
      summary: {
        source_chain_pass: realSummary.source_chain_pass,
        real_runtime_ready_reached: realSummary.real_runtime_ready_reached,
        btc_price_chain_pass: realSummary.btc_price_chain_pass
      },
      rawExcerpt: {
        real_row_count: realRows.length,
        debug_row_count: debugRows.length,
        real_source_feed_count_max: Math.max(0, ...realRows.map((r) => Number(r.source_feed_count || 0)))
      }
    });
    const output = {
      ...standard,
      task_id: args.taskId,
      command: `node scripts/verify_btc_source_chain.mjs --task_id=${args.taskId}`,
      real_runtime: {
        summary: realSummary,
        rows: normalizeRows(realRows),
        raw_rows: realRows
      },
      debug_control: {
        summary: debugSummary,
        rows: normalizeRows(debugRows),
        raw_rows: debugRows
      },
      result: {
        source_chain_pass: realSummary.source_chain_pass,
        real_runtime_ready_reached: realSummary.real_runtime_ready_reached,
        btc_price_chain_pass: realSummary.btc_price_chain_pass
      }
    };
    ensureDir(args.output);
    fs.writeFileSync(args.output, JSON.stringify(output, null, 2));
    const logPath = writeStandardLog(args.output, standard);
    console.log(`VERIFY_OUTPUT=${args.output}`);
    console.log(`VERIFY_LOG=${logPath}`);
    console.log(JSON.stringify(output.result));
    if (!output.result.btc_price_chain_pass) process.exitCode = 1;
  } finally {
    await http.post('/bot/stop', {}).catch(() => null);
    if (boot.spawned && !boot.spawned.killed) boot.spawned.kill();
  }
};

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
