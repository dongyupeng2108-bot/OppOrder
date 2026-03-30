import fs from 'fs';
import path from 'path';
import { spawn, spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { buildStandardResult, ensureDir, parseVerifyArgs, writeStandardLog } from './verify_standard_v1.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_TASK_ID = '260330_014';

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: 'http://localhost:53214',
  defaultOutputSuffix: 'p0_runtime_fixes_guard',
  defaultSampleName: 'p0_runtime_fixes_guard_v1'
});

const toFinite = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const toJson = async (res) => {
  try {
    return await res.json();
  } catch {
    return null;
  }
};

const createHttp = (baseUrl) => {
  const withRetry = async (fn) => {
    let lastError = null;
    for (let i = 0; i < 4; i += 1) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        await sleep(250);
      }
    }
    throw lastError || new Error('http_retry_failed');
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
  const child = spawn(process.execPath, ['strategies/crypto_binary/server.mjs', `--port=${port}`], {
    cwd: REPO_ROOT,
    stdio: 'ignore'
  });
  const baseUrl = `http://localhost:${port}`;
  const ok = await waitServerReady(baseUrl);
  if (!ok) {
    child.kill();
    throw new Error('server_start_timeout');
  }
  return { child, baseUrl };
};

const stopServer = async (child) => {
  if (!child || child.killed) return;
  child.kill();
  await sleep(600);
};

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'));

const runChildAudit = ({ script, args = [], outputPath }) => {
  const commandArgs = [path.join('scripts', script), ...args, `--output=${outputPath}`];
  const run = spawnSync(process.execPath, commandArgs, { cwd: REPO_ROOT, encoding: 'utf8' });
  const parsed = fs.existsSync(outputPath) ? readJson(outputPath) : null;
  return {
    script,
    exit_code: run.status ?? 1,
    ok: run.status === 0 && parsed?.pass === true,
    output_path: outputPath,
    parsed,
    stdout_tail: String(run.stdout || '').trim().split('\n').slice(-8),
    stderr_tail: String(run.stderr || '').trim().split('\n').slice(-8)
  };
};

const detectStartupWaitHistoricalFail = (j) => {
  const firstLayer = String(j?.conclusion_block?.first_break_layer || '');
  const verdict = String(j?.conclusion_block?.verdict || '');
  const realReady = j?.evidence_index?.stage_matrix?.real?.ready;
  const debugReady = j?.evidence_index?.stage_matrix?.debug?.ready;
  return firstLayer === 'context'
    && verdict.includes('存在断裂')
    && realReady === false
    && debugReady === true;
};

const detectAtrHistoricalFail = (j) => {
  const firstLayer = String(j?.conclusion_block?.first_break_layer || '');
  const rows = Array.isArray(j?.evidence_index?.timing_reconcile_table) ? j.evidence_index.timing_reconcile_table : [];
  const hit = rows.some((r) =>
    toFinite(r?.atr_5m) === null
    && toFinite(r?.upper) === null
    && toFinite(r?.lower) === null
    && String(r?.decision_reason || '') === 'price_or_bounds_null'
  );
  return firstLayer === 'atr_input' && hit;
};

const runStartupWaitReleaseCheck = async (http) => {
  const begin = Date.now();
  await http.post('/bot/stop', {});
  await http.post('/bot/config', {
    open_delay_sec: 0,
    ladder_prices: [0.01],
    ladder_size: 1,
    atr_multiple: 1.2,
    cancel_all_remaining_sec: 100,
    up_ladder: [{ price: 0.01, size: 1, tp_price: 0.5 }],
    down_ladder: [{ price: 0.01, size: 1, tp_price: 0.5 }],
    up_cancel: { before_end_sec: 120, formula: '' },
    down_cancel: { before_end_sec: 60, formula: '' }
  });
  const waitNearEnd = async () => {
    while (Date.now() - begin < 25 * 60 * 1000) {
      const contextRes = await http.get('/bot/context');
      const wid = contextRes.body?.window_id ?? null;
      const rem = toFinite(contextRes.body?.remaining_sec);
      if (wid && rem !== null && rem <= 35) return { window_id: wid, remaining_sec: rem };
      await sleep(1000);
    }
    throw new Error('startup_wait_check_timeout_before_start');
  };
  const startupWindow = await waitNearEnd();
  await http.post('/bot/start', { tick_interval_ms: 1000 });
  const rows = [];
  let seenWaitReason = false;
  let seenNextWindow = false;
  let seenPlaceAfterNext = false;
  for (let i = 0; i < 220; i += 1) {
    const statusRes = await http.get('/bot/status');
    const logsRes = await http.get('/bot/logs?limit=120');
    const logs = Array.isArray(logsRes.body) ? logsRes.body : [];
    const lastRunner = [...logs].reverse().find((r) => r?.event === 'RUNNER_TICK') || null;
    const currentWindow = statusRes.body?.current_window_id ?? null;
    const reason = typeof lastRunner?.message === 'string' && lastRunner.message.startsWith('tick ')
      ? lastRunner.message.slice(5)
      : null;
    const intents = typeof lastRunner?.data?.intents_summary === 'string' ? lastRunner.data.intents_summary : 'NOOP';
    rows.push({
      i,
      current_window_id: currentWindow,
      reason,
      intents_summary: intents
    });
    if (reason === 'wait_next_window_after_start') seenWaitReason = true;
    if (currentWindow && currentWindow !== startupWindow.window_id) seenNextWindow = true;
    if (seenNextWindow && intents.includes('PLACE_LADDER(')) seenPlaceAfterNext = true;
    if (seenNextWindow && seenPlaceAfterNext) break;
    await sleep(1000);
  }
  await http.post('/bot/stop', {});
  const startupRows = rows.filter((r) => r.current_window_id === startupWindow.window_id);
  const startupNoPlace = startupRows.length > 0 && startupRows.every((r) => !String(r.intents_summary || '').includes('PLACE_LADDER('));
  return {
    pass: startupNoPlace && seenWaitReason && seenNextWindow && seenPlaceAfterNext,
    startup_window_id: startupWindow.window_id,
    seen_wait_next_window_after_start: seenWaitReason,
    seen_next_window: seenNextWindow,
    seen_place_after_next_window: seenPlaceAfterNext,
    startup_no_place: startupNoPlace,
    timeline_head: rows.slice(0, 12),
    timeline_tail: rows.slice(-12)
  };
};

const main = async () => {
  const args = parseArgs();
  ensureDir(args.output);
  const reportsDir = path.dirname(args.output);
  const atrOut = path.join(reportsDir, `${args.taskId}_current_atr_input_bounds_ready_guard.json`);
  const port = Number(new URL(args.baseUrl).port || 53214);
  const server = await startServer(port);
  const http = createHttp(server.baseUrl);
  let startupCurrent = null;
  try {
    startupCurrent = await runStartupWaitReleaseCheck(http);
  } finally {
    await stopServer(server.child);
  }
  const atrCurrent = runChildAudit({
    script: 'truth_audit_atr_input_recovery_260330_013.mjs',
    args: [`--task_id=${args.taskId}`, '--sample=guard_atr_input_bounds_ready_v1'],
    outputPath: atrOut
  });

  const hist010Path = path.join(REPO_ROOT, 'rules', 'task-reports', '2026-03', '260330_010_truth_audit_ready_chain_locate.json');
  const hist011Path = path.join(REPO_ROOT, 'rules', 'task-reports', '2026-03', '260330_011_truth_audit_anchor_bounds_timing.json');
  const hist010 = readJson(hist010Path);
  const hist011 = readJson(hist011Path);
  const startupHistoricalFailDetected = detectStartupWaitHistoricalFail(hist010);
  const atrHistoricalFailDetected = detectAtrHistoricalFail(hist011);

  const checks = {
    current_startup_wait_release_pass: startupCurrent.pass,
    current_atr_input_bounds_ready_pass: atrCurrent.ok,
    negative_startup_wait_stuck_detected_fail: startupHistoricalFailDetected,
    negative_atr_input_null_detected_fail: atrHistoricalFailDetected
  };
  const keys = Object.keys(checks);
  const passChecks = keys.filter((k) => checks[k]).length;
  const failChecks = keys.length - passChecks;
  const pass = failChecks === 0;
  const conclusion = pass
    ? 'A：P0 修复回归包通过（startup_wait_release + atr_input_bounds_ready）'
    : 'C：P0 修复回归包未通过';

  const standard = buildStandardResult({
    scriptName: 'verify_p0_runtime_fixes_guard',
    taskId: args.taskId,
    sampleName: args.sampleName,
    pass,
    message: pass ? 'p0 runtime fixes guard pass' : 'p0 runtime fixes guard fail',
    firstBreakLayer: pass ? 'NONE_CHAIN_PASS' : 'regression_guard',
    evidenceFile: args.output,
    summary: {
      conclusion,
      total_checks: keys.length,
      pass_checks: passChecks,
      fail_checks: failChecks,
      checks
    },
    rawExcerpt: {
      startup_wait_release: {
        pass: startupCurrent.pass,
        evidence_file: null,
        conclusion: {
          startup_window_id: startupCurrent.startup_window_id,
          seen_wait_next_window_after_start: startupCurrent.seen_wait_next_window_after_start,
          seen_next_window: startupCurrent.seen_next_window,
          seen_place_after_next_window: startupCurrent.seen_place_after_next_window,
          startup_no_place: startupCurrent.startup_no_place
        }
      },
      atr_input_bounds_ready: {
        pass: atrCurrent.ok,
        evidence_file: atrCurrent.parsed?.evidence_file || atrOut,
        conclusion: atrCurrent.parsed?.conclusion_block || null
      },
      negative_detection: {
        startup_wait_stuck_from_260330_010: startupHistoricalFailDetected,
        atr_input_null_from_260330_011: atrHistoricalFailDetected
      }
    }
  });

  const output = {
    ...standard,
    task_id: args.taskId,
    conclusion_block: {
      verdict: conclusion,
      sub_conclusions: {
        startup_wait_release: startupCurrent.pass ? 'PASS' : 'FAIL',
        atr_input_bounds_ready: atrCurrent.ok ? 'PASS' : 'FAIL'
      },
      negative_detection: {
        startup_wait_stuck: startupHistoricalFailDetected ? 'FAIL_DETECTED' : 'NOT_DETECTED',
        atr_input_null: atrHistoricalFailDetected ? 'FAIL_DETECTED' : 'NOT_DETECTED'
      }
    },
    key_counters: {
      total_checks: keys.length,
      pass_checks: passChecks,
      fail_checks: failChecks
    },
    evidence_index: {
      current_startup_wait_release: {
        script: 'inline_runtime_startup_wait_release_check',
        output_path: null,
        exit_code: startupCurrent.pass ? 0 : 1,
        timeline_head: startupCurrent.timeline_head,
        timeline_tail: startupCurrent.timeline_tail
      },
      current_atr_input_bounds_ready: {
        script: atrCurrent.script,
        output_path: atrOut,
        exit_code: atrCurrent.exit_code
      },
      negative_fixtures: {
        startup_wait_stuck_hist_file: hist010Path,
        atr_input_null_hist_file: hist011Path
      }
    },
    result: checks
  };

  fs.writeFileSync(args.output, JSON.stringify(output, null, 2));
  const logPath = writeStandardLog(args.output, standard);
  console.log(`VERIFY_OUTPUT=${args.output}`);
  console.log(`VERIFY_LOG=${logPath}`);
  console.log(JSON.stringify({ pass, conclusion, pass_checks: passChecks, fail_checks: failChecks }));
  if (!pass) process.exitCode = 1;
};

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
