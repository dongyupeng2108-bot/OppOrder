import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { buildStandardResult, ensureDir, parseVerifyArgs, writeStandardLog } from './verify_standard_v1.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_TASK_ID = '260330_045';
const MAX_WALL_MS = 15 * 60 * 1000;
const MAX_SILENCE_MS = 120 * 1000;
const LOG_TAIL = 100;
const HEARTBEAT_MS = 25 * 1000;
const ALLOWED_SAMPLES = ['pnl_display_precision_v1'];

let heartbeatLogPath = null;
let lastHeartbeat = null;

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: 'http://localhost:53245',
  defaultOutputSuffix: 'truth_audit_pnl_display_precision_260330_045',
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

const legacyFormatPrevPnl = (v) => (v === null || v === undefined || v === '' ? 'N/A (null)' : `${v}`);
const legacyFormatPerfPnl = (v) => {
  const n = toNum(v);
  return n === null ? '—' : n.toFixed(1);
};
const legacyFormatAvgPerWindow = (v) => (v === null || v === undefined || v === '' ? 'N/A (null)' : `${v}`);
const newFormat2 = (v, empty = 'N/A (null)') => {
  const n = toNum(v);
  return n === null ? empty : n.toFixed(2);
};

const is2Dec = (text) => /^-?\d+\.\d{2}$/.test(String(text || '').trim());

const main = async () => {
  const args = parseArgs();
  const sampleName = ensureSampleAllowed(args.sampleName);
  heartbeatLogPath = String(args.output || '').replace(/\.json$/i, '.heartbeat.log');
  ensureDir(heartbeatLogPath);
  fs.writeFileSync(heartbeatLogPath, '', 'utf8');

  const port = Number(new URL(args.baseUrl).port || 53245);
  const begin = Date.now();
  let lastBeatAt = Date.now();
  let lastHeartbeatAt = 0;

  const server = await startServer(port);
  const http = createHttp(server.baseUrl);
  let health = { root: null, pairs: null };
  try {
    health.root = await fetch(`${server.baseUrl}/`).then((res) => res.status).catch(() => null);
    health.pairs = await fetch(`${server.baseUrl}/pairs`).then((res) => res.status).catch(() => null);
    const postmortemPayload = (await http.get('/bot/postmortem/latest'))?.body || {};
    const perfPayload = (await http.get('/bot/performance/summary?detail=1'))?.body || {};
    const postmortem = postmortemPayload?.postmortem || {};
    const summary = perfPayload?.summary || {};

    const apiRaw = {
      postmortem_realized_gross_pnl_total: postmortem?.realized_gross_pnl_total ?? null,
      summary_realized_gross_pnl_total: summary?.realized_gross_pnl_total ?? null,
      summary_avg_realized_gross_pnl_per_window: summary?.avg_realized_gross_pnl_per_window ?? null
    };

    const preDom = {
      pnl_text_prev_window: legacyFormatPrevPnl(apiRaw.postmortem_realized_gross_pnl_total),
      pnl_text_recent_summary: legacyFormatPerfPnl(apiRaw.summary_realized_gross_pnl_total),
      avg_per_window_text: legacyFormatAvgPerWindow(apiRaw.summary_avg_realized_gross_pnl_per_window)
    };

    const postDom = {
      pnl_text_prev_window: newFormat2(apiRaw.postmortem_realized_gross_pnl_total),
      pnl_text_recent_summary: newFormat2(apiRaw.summary_realized_gross_pnl_total, '—'),
      avg_per_window_text: newFormat2(apiRaw.summary_avg_realized_gross_pnl_per_window, '—')
    };

    const checks = {
      post_pnl_recent_summary_2dec: is2Dec(postDom.pnl_text_recent_summary),
      post_avg_per_window_2dec: is2Dec(postDom.avg_per_window_text),
      api_raw_unchanged_proof_present: apiRaw.summary_realized_gross_pnl_total !== null || apiRaw.summary_avg_realized_gross_pnl_per_window !== null,
      pre_post_dom_changed: (
        preDom.pnl_text_recent_summary !== postDom.pnl_text_recent_summary
        || preDom.avg_per_window_text !== postDom.avg_per_window_text
      )
    };

    const pass = Object.values(checks).every(Boolean);
    const firstBreakLayer = pass ? 'NONE_CHAIN_PASS' : 'display_precision_chain';

    if (Date.now() - begin > MAX_WALL_MS) throw new Error('ERR_MAX_WALL_TIME_EXCEEDED');
    if (Date.now() - lastBeatAt > MAX_SILENCE_MS) throw new Error('ERR_MAX_SILENCE_EXCEEDED');
    if (Date.now() - lastHeartbeatAt >= HEARTBEAT_MS) {
      lastHeartbeatAt = Date.now();
      emit('HEARTBEAT', { stage: 'audit_done', checks });
    }
    lastBeatAt = Date.now();

    const standard = buildStandardResult({
      scriptName: 'truth_audit_pnl_display_precision_260330_045',
      taskId: args.taskId,
      sampleName,
      pass,
      message: `first_break_layer=${firstBreakLayer}`,
      firstBreakLayer,
      evidenceFile: args.output,
      summary: {
        first_break_layer: firstBreakLayer,
        pass
      },
      rawExcerpt: {
        pre_dom: preDom,
        post_dom: postDom,
        api_raw: apiRaw
      }
    });

    const output = {
      ...standard,
      task_id: args.taskId,
      conclusion_block: {
        verdict: pass ? 'A：通过' : 'C：存在断裂',
        first_break_layer: firstBreakLayer
      },
      evidence_index: {
        checks,
        pre_dom_text: preDom,
        post_dom_text: postDom,
        api_raw_values: apiRaw,
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
    console.log(JSON.stringify({ pass, first_break_layer: firstBreakLayer, checks, preDom, postDom, apiRaw }));
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
