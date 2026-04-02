import fs from 'fs';
import path from 'path';
import { execSync, spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { buildStandardResult, ensureDir, parseVerifyArgs, writeStandardLog } from './verify_standard_v1.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_TASK_ID = '260402_001';
const MAX_WALL_MS = 45 * 60 * 1000;
const MAX_SILENCE_MS = 5 * 60 * 1000;
const LOG_TAIL = 150;
const HEARTBEAT_MS = 25 * 1000;
const ALLOWED_SAMPLES = ['remove_prev_result_module_v1'];
const BASELINE_REF = '011f8556:ui/js/strategy-editor.js';

let heartbeatLogPath = null;
let lastHeartbeat = null;

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: 'http://localhost:53246',
  defaultOutputSuffix: 'truth_audit_remove_prev_result_module_260402_001',
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

const formatPnl2 = (v) => {
  const n = toNum(v);
  return n == null ? '—' : n.toFixed(2);
};

const readBaselineUi = () => {
  try {
    return execSync(`git show ${BASELINE_REF}`, { cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString('utf8');
  } catch {
    return '';
  }
};

const extractExpression = (source, marker) => {
  const idx = source.indexOf(marker);
  if (idx < 0) return null;
  const tail = source.slice(idx);
  const line = tail.split(/\r?\n/)[0] || null;
  return line;
};

const main = async () => {
  const args = parseArgs();
  const sampleName = ensureSampleAllowed(args.sampleName);
  heartbeatLogPath = String(args.output || '').replace(/\.json$/i, '.heartbeat.log');
  ensureDir(heartbeatLogPath);
  fs.writeFileSync(heartbeatLogPath, '', 'utf8');

  const begin = Date.now();
  let lastBeatAt = Date.now();
  let lastHeartbeatAt = 0;
  const uiPath = path.join(REPO_ROOT, 'ui', 'js', 'strategy-editor.js');
  const serverPath = path.join(REPO_ROOT, 'strategies', 'crypto_binary', 'server.mjs');
  const uiPost = fs.readFileSync(uiPath, 'utf8');
  const serverPost = fs.readFileSync(serverPath, 'utf8');
  const uiPre = readBaselineUi();

  const pre = {
    has_prev_module_title: uiPre.includes('上一窗口结果'),
    has_prev_dom_fields: ['se-prev-filled-total', 'se-prev-cancelled-total', 'se-prev-pnl'].every((id) => uiPre.includes(id)),
    has_prev_api_fetch: uiPre.includes('/bot/postmortem/latest'),
    perf_title_count: (uiPre.match(/近期表现摘要/g) || []).length,
    perf_realized_expr: extractExpression(uiPre, "document.getElementById('se-perf-realized-total').textContent"),
    perf_avg_expr: extractExpression(uiPre, "document.getElementById('se-perf-avg-realized').textContent")
  };

  const post = {
    has_prev_module_title: uiPost.includes('上一窗口结果'),
    has_prev_dom_fields: ['se-prev-filled-total', 'se-prev-cancelled-total', 'se-prev-pnl'].some((id) => uiPost.includes(id)),
    has_prev_api_fetch: uiPost.includes('/bot/postmortem/latest'),
    perf_title_count: (uiPost.match(/近期表现摘要/g) || []).length,
    perf_moved_to_prev_position: /se-pm-account-card[\s\S]{0,1800}近期表现摘要/.test(uiPost),
    perf_realized_expr: extractExpression(uiPost, "document.getElementById('se-perf-realized-total').textContent"),
    perf_avg_expr: extractExpression(uiPost, "document.getElementById('se-perf-avg-realized').textContent")
  };

  const dependencyAudit = {
    previous_result_frontend_consumption: {
      api: '/bot/postmortem/latest',
      fields: ['filled_total', 'cancelled_total', 'realized_gross_pnl_total'],
      producer: 'server.mjs queryLatestBotPostmortem + /bot/postmortem/latest route'
    },
    recent_summary_frontend_consumption: {
      api: '/bot/performance/summary?detail=1',
      fields: ['window_count', 'filled_total', 'realized_gross_pnl_total', 'avg_realized_gross_pnl_per_window', 'participating_postmortem_rows'],
      producer: 'server.mjs queryBotPerformanceSummary + /bot/performance/summary route'
    },
    chain_shared: false,
    chain_shared_reason: '近期表现摘要仅依赖 performance summary，不依赖 postmortem/latest 选择链'
  };

  const port = Number(new URL(args.baseUrl).port || 53246);
  const server = await startServer(port);
  const http = createHttp(server.baseUrl);
  let health = { root: null, pairs: null };
  let runtime = {};
  try {
    health.root = await fetch(`${server.baseUrl}/`).then((res) => res.status).catch(() => null);
    health.pairs = await fetch(`${server.baseUrl}/pairs`).then((res) => res.status).catch(() => null);
    const perfRes = await http.get('/bot/performance/summary?detail=1');
    const latestRes = await http.get('/bot/postmortem/latest');
    const summary = perfRes?.body?.summary || {};
    runtime = {
      perf_status: perfRes?.status ?? null,
      latest_status: latestRes?.status ?? null,
      summary_values: {
        window_count: summary?.window_count ?? null,
        filled_total: summary?.filled_total ?? null,
        realized_gross_pnl_total: summary?.realized_gross_pnl_total ?? null,
        avg_realized_gross_pnl_per_window: summary?.avg_realized_gross_pnl_per_window ?? null
      },
      dom_text_simulated_post: {
        pnl_total_text: formatPnl2(summary?.realized_gross_pnl_total),
        avg_per_window_text: formatPnl2(summary?.avg_realized_gross_pnl_per_window)
      }
    };
  } finally {
    await stopServer(server.child);
  }

  const checks = {
    pre_has_prev_module: pre.has_prev_module_title && pre.has_prev_dom_fields && pre.has_prev_api_fetch,
    post_prev_module_removed: !post.has_prev_module_title && !post.has_prev_dom_fields,
    post_no_prev_api_consumption: !post.has_prev_api_fetch,
    post_perf_moved_to_prev_position: post.perf_moved_to_prev_position && post.perf_title_count === 1,
    perf_expression_unchanged: pre.perf_realized_expr === post.perf_realized_expr && pre.perf_avg_expr === post.perf_avg_expr,
    backend_prev_route_removed: !serverPost.includes("/bot/postmortem/latest"),
    backend_perf_route_kept: serverPost.includes("/bot/performance/summary"),
    runtime_perf_available: runtime.perf_status === 200,
    runtime_prev_route_removed: runtime.latest_status === 404
  };

  const pass = Object.values(checks).every(Boolean);
  const firstBreakLayer = pass ? 'NONE_CHAIN_PASS' : (dependencyAudit.chain_shared ? 'current_last_window_binding' : 'previous_result_projection');

  if (Date.now() - begin > MAX_WALL_MS) throw new Error('ERR_MAX_WALL_TIME_EXCEEDED');
  if (Date.now() - lastBeatAt > MAX_SILENCE_MS) throw new Error('ERR_MAX_SILENCE_EXCEEDED');
  if (Date.now() - lastHeartbeatAt >= HEARTBEAT_MS) {
    lastHeartbeatAt = Date.now();
    emit('HEARTBEAT', { stage: 'audit_done', checks, first_break_layer: firstBreakLayer });
  }
  lastBeatAt = Date.now();

  const standard = buildStandardResult({
    scriptName: 'truth_audit_remove_prev_result_module_260402_001',
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
      checks,
      dependency_audit: dependencyAudit
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
      baseline_ref: BASELINE_REF,
      dependency_audit: dependencyAudit,
      checks,
      pre_dom_evidence: pre,
      post_dom_evidence: post,
      runtime_evidence: runtime,
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
  console.log(JSON.stringify({ pass, first_break_layer: firstBreakLayer, checks, dependencyAudit, runtime }));
  if (!pass) process.exitCode = 1;
};

main().catch((error) => {
  console.error(JSON.stringify({
    event: 'AUDIT_FATAL',
    code: error?.message || 'ERR_UNHANDLED',
    allowed_samples: ALLOWED_SAMPLES
  }));
  process.exit(1);
});
