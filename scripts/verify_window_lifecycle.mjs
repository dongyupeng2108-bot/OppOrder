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
const DEFAULT_TASK_ID = '260324_026';
const NOT_READY_MAX_MS = 30000;

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: DEFAULT_BASE_URL,
  defaultOutputSuffix: 'window_lifecycle',
  defaultSampleName: 'debug_main_path_v1+real_no_debug'
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

const ensureDir = (filePath) => {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
};

const toFinite = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const toPositive = (value) => {
  const num = toFinite(value);
  if (num === null) return null;
  return num > 0 ? num : null;
};

const uiEquivalent = (statusBody, contextBody, perfSummary) => {
  const running = statusBody?.running === true;
  const btc = toPositive(contextBody?.btc_price);
  return {
    status_text: running ? '运行中' : '已停止',
    runtime_window: running ? (statusBody?.current_window_id ?? '等待窗口初始化') : '—',
    runtime_btc_display: !running ? '—' : (btc === null ? '数据未就绪' : String(btc)),
    runtime_snapshot_mode: running ? 'active_runtime_snapshot' : 'last_run_snapshot',
    stop_reason_display: statusBody?.last_run_snapshot?.stop_reason ?? null,
    recent_window_count: perfSummary?.window_count ?? null
  };
};

const ensureServer = async ({ baseUrl, spawnServer }) => {
  const http = createHttp(baseUrl);
  try {
    const status = await http.get('/bot/status');
    if (status.status === 200) return { spawned: null };
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
      const status = await http.get('/bot/status');
      if (status.status === 200) return { spawned: child };
    } catch {}
  }
  child.kill();
  throw new Error(`failed to boot server: ${baseUrl}`);
};

const captureFrame = async (http, source, label, tick) => {
  const [status, context, decisionPreview, performance] = await Promise.all([
    http.get('/bot/status'),
    http.get('/bot/context'),
    http.get('/bot/decision-preview'),
    http.get('/bot/performance/summary?preset=today&detail=1')
  ]);
  const st = status?.body || {};
  const ctx = context?.body || {};
  const dp = decisionPreview?.body || {};
  const perfSummary = performance?.body?.summary || {};
  const running = st?.running === true;
  const currentWindowId = st?.current_window_id ?? null;
  const previewContext = dp?.context_snapshot || {};
  const btcPrice = toPositive(ctx?.btc_price) ?? toPositive(previewContext?.btc_price);
  const anchor = toFinite(ctx?.anchor_btc ?? st?.anchor_btc);
  const upper = toFinite(ctx?.upper_bound ?? st?.upper_bound);
  const lower = toFinite(ctx?.lower_bound ?? st?.lower_bound);
  const remainingSec = toFinite(ctx?.remaining_sec ?? st?.remaining_sec);
  const boundsReady = anchor !== null && upper !== null && lower !== null;
  const initialized = typeof st?.window_initialized_at === 'string' && st.window_initialized_at.length > 0;
  const criticalReady = btcPrice !== null && initialized && remainingSec !== null;
  let stage = 'unknown';
  if (!running) {
    stage = 'stopped';
  } else if (currentWindowId == null) {
    stage = 'running_early';
  } else if (!criticalReady) {
    stage = 'running_window_present_but_not_ready';
  } else if (remainingSec !== null) {
    stage = 'running_ready';
  } else {
    stage = 'running_window_present_but_not_ready';
  }
  const intentsSummary = String(dp?.intents_summary || '');
  const intents = Array.isArray(dp?.intents) ? dp.intents : [];
  const actionIntents = intents.filter((intent) => intent?.kind && intent.kind !== 'NOOP');
  const requiresBounds = actionIntents.some((intent) => (
    intent?.kind === 'CANCEL_OPEN'
    && (String(intent?.side || 'ALL').toUpperCase() === 'YES' || String(intent?.side || 'ALL').toUpperCase() === 'NO')
  ));
  const dependentActionTriggered = (actionIntents.length > 0 && btcPrice === null)
    || (requiresBounds && !boundsReady);
  return {
    source,
    tick,
    label,
    captured_at: new Date().toISOString(),
    status,
    context,
    decision_preview: decisionPreview,
    performance_summary: performance,
    ui_equivalent: uiEquivalent(st, ctx, perfSummary),
    derived: {
      stage,
      running,
      current_window_id: currentWindowId,
      btc_price: btcPrice,
      anchor_btc: anchor,
      upper_bound: upper,
      lower_bound: lower,
      remaining_sec: remainingSec,
      bounds_ready: boundsReady,
      window_initialized_at: st?.window_initialized_at ?? null,
      critical_ready: criticalReady,
      dependent_action_triggered: dependentActionTriggered,
      intents_summary: intentsSummary,
      decision_reason: dp?.reason ?? null,
      active_runtime_snapshot: st?.active_runtime_snapshot ?? null,
      last_run_snapshot: st?.last_run_snapshot ?? null,
      last_run_stop_reason: st?.last_run_snapshot?.stop_reason ?? null,
      last_run_window_id: st?.last_run_snapshot?.window_id ?? st?.last_run_snapshot?.current_window_id ?? null,
      perf_window_count: perfSummary?.window_count ?? null,
      perf_filled_total: perfSummary?.filled_total ?? null,
      perf_realized_gross_pnl_total: perfSummary?.realized_gross_pnl_total ?? null,
      perf_participating_rows: perfSummary?.participating_postmortem_rows || []
    }
  };
};

const captureTimeline = async (http, source, startPayload, maxTicks = 26, intervalMs = 600) => {
  await http.post('/bot/stop', {});
  await sleep(350);
  const pre = await captureFrame(http, source, `${source}_pre`, 0);
  const start = await http.post('/bot/start', startPayload);
  const frames = [];
  for (let i = 1; i <= maxTicks; i += 1) {
    await sleep(intervalMs);
    const frame = await captureFrame(http, source, `${source}_tick_${i}`, i);
    frames.push(frame);
    if (frame.derived.stage === 'running_ready' && i >= 4) {
      break;
    }
  }
  await http.post('/bot/stop', {});
  await sleep(450);
  const post = await captureFrame(http, source, `${source}_post`, maxTicks + 1);
  return { source, start, pre, post, frames };
};

const waitManualStopSample = async (http) => {
  await http.post('/bot/stop', {});
  await sleep(350);
  const start = await http.post('/bot/start', { tick_interval_ms: 1000, debugScenario: 'main_path_v1' });
  let runningFrame = null;
  for (let i = 1; i <= 40; i += 1) {
    await sleep(500);
    const frame = await captureFrame(http, 'debug_manual_stop', `debug_manual_running_${i}`, i);
    if (frame.derived.running === true && frame.derived.current_window_id) {
      runningFrame = frame;
      break;
    }
  }
  await http.post('/bot/stop', {});
  await sleep(500);
  const stoppedFrame = await captureFrame(http, 'debug_manual_stop', 'debug_manual_stop', 999);
  return { start, runningFrame, stoppedFrame };
};

const waitAutoCompletedSample = async (http, timeoutTicks = 170) => {
  await http.post('/bot/stop', {});
  await sleep(350);
  const start = await http.post('/bot/start', { tick_interval_ms: 1000, debugScenario: 'main_path_v1' });
  let runningWindowId = null;
  const frames = [];
  for (let i = 0; i < timeoutTicks; i += 1) {
    await sleep(500);
    const sample = await captureFrame(http, 'debug_auto_completed', `auto_probe_${i + 1}`, i + 1);
    frames.push(sample);
    if (!runningWindowId && sample.derived.current_window_id) {
      runningWindowId = sample.derived.current_window_id;
    }
    if (sample.derived.running === false && sample.derived.last_run_stop_reason === 'AUTO_COMPLETED') {
      await http.post('/bot/stop', {});
      await sleep(300);
      return { start, sample, runningWindowId, frames };
    }
  }
  await http.post('/bot/stop', {});
  await sleep(300);
  return {
    start,
    sample: await captureFrame(http, 'debug_auto_completed', 'auto_probe_fallback', timeoutTicks + 1),
    runningWindowId,
    frames
  };
};

const pickFirstStage = (timeline, stage) => {
  const frame = (timeline?.frames || []).find((item) => item.derived.stage === stage);
  return frame || null;
};

const evaluateTimelineReadiness = (timeline, source) => {
  const notReadyFrames = (timeline?.frames || []).filter((f) => f.derived.stage === 'running_window_present_but_not_ready');
  let maxDurationMs = 0;
  if (notReadyFrames.length > 0) {
    const ts = notReadyFrames.map((f) => new Date(f.captured_at).getTime()).filter((v) => Number.isFinite(v));
    if (ts.length > 1) {
      maxDurationMs = Math.max(0, ts[ts.length - 1] - ts[0]);
    }
  }
  const hasRunningReady = (timeline?.frames || []).some((f) => f.derived.stage === 'running_ready');
  const dependentActionsOnNotReady = notReadyFrames.filter((f) => f.derived.dependent_action_triggered);
  const baseline = {
    window_count: timeline?.pre?.derived?.perf_window_count ?? null,
    filled_total: timeline?.pre?.derived?.perf_filled_total ?? null,
    realized_gross_pnl_total: timeline?.pre?.derived?.perf_realized_gross_pnl_total ?? null
  };
  const changedDuringRunning = (timeline?.frames || [])
    .filter((f) => f.derived.running === true)
    .some((f) => f.derived.perf_window_count !== baseline.window_count
      || f.derived.perf_filled_total !== baseline.filled_total
      || f.derived.perf_realized_gross_pnl_total !== baseline.realized_gross_pnl_total);
  return {
    source,
    has_running_ready: hasRunningReady,
    not_ready_frame_count: notReadyFrames.length,
    not_ready_max_duration_ms: maxDurationMs,
    not_ready_within_boundary: maxDurationMs <= NOT_READY_MAX_MS,
    dependent_action_on_not_ready_count: dependentActionsOnNotReady.length,
    dependent_action_on_not_ready_ticks: dependentActionsOnNotReady.map((f) => f.tick),
    running_window_exclusion_pass: !changedDuringRunning,
    baseline_performance: baseline
  };
};

const main = async () => {
  const args = parseArgs();
  const http = createHttp(args.baseUrl);
  const boot = await ensureServer(args);
  const todayLogPath = path.join(REPO_ROOT, 'data', 'crypto_binary', 'logs', `bot_${new Date().toISOString().slice(0, 10)}.jsonl`);
  const runtimeLogExistedBefore = fs.existsSync(todayLogPath);

  try {
    await http.post('/bot/stop', {});
    await sleep(450);
    const stopped = await captureFrame(http, 'global', 'stopped', 0);
    const debugTimeline = await captureTimeline(http, 'debug_main_path_v1', { tick_interval_ms: 1000, debugScenario: 'main_path_v1' }, 26, 650);
    const realTimeline = await captureTimeline(http, 'real_no_debug', { tick_interval_ms: 1000 }, 26, 650);
    const manualStopInfo = await waitManualStopSample(http);
    const manualStop = manualStopInfo.stoppedFrame;
    const autoInfo = await waitAutoCompletedSample(http, 170);
    const autoCompleted = autoInfo.sample;
    const autoWindowId = autoInfo.runningWindowId;

    const debugRunning = pickFirstStage(debugTimeline, 'running_ready')
      || pickFirstStage(debugTimeline, 'running_window_present_but_not_ready')
      || pickFirstStage(debugTimeline, 'running_early');
    const realRunning = pickFirstStage(realTimeline, 'running_ready')
      || pickFirstStage(realTimeline, 'running_window_present_but_not_ready')
      || pickFirstStage(realTimeline, 'running_early');
    const runningState = debugRunning || realRunning;
    const runningEarly = pickFirstStage(debugTimeline, 'running_early') || pickFirstStage(realTimeline, 'running_early');
    const runningNotReady = pickFirstStage(debugTimeline, 'running_window_present_but_not_ready')
      || pickFirstStage(realTimeline, 'running_window_present_but_not_ready');
    const runningReady = pickFirstStage(debugTimeline, 'running_ready') || pickFirstStage(realTimeline, 'running_ready');

    const debugEval = evaluateTimelineReadiness(debugTimeline, 'debug_main_path_v1');
    const realEval = evaluateTimelineReadiness(realTimeline, 'real_no_debug');

    const stoppedPass = stopped.derived.running === false
      && stopped.derived.active_runtime_snapshot == null
      && (stopped.derived.current_window_id == null
        || stopped.derived.last_run_snapshot != null);
    const runningPass = runningState?.derived?.running === true
      && runningState?.derived?.current_window_id != null
      && runningState?.derived?.active_runtime_snapshot != null;
    const manualStopPass = manualStop?.derived?.running === false
      && manualStop?.derived?.last_run_stop_reason === 'MANUAL_STOP'
      && manualStop?.derived?.active_runtime_snapshot == null;
    const autoStopPass = autoCompleted?.derived?.running === false
      && autoCompleted?.derived?.last_run_stop_reason === 'AUTO_COMPLETED'
      && autoCompleted?.derived?.last_run_window_id != null
      && (autoWindowId == null || autoCompleted?.derived?.last_run_window_id === autoWindowId);
    const runningWindowExclusionPass = debugEval.running_window_exclusion_pass && realEval.running_window_exclusion_pass;
    const readinessConsistencyPass = realEval.has_running_ready
      ? (debugEval.not_ready_within_boundary
        && realEval.not_ready_within_boundary
        && (runningReady != null))
      : (debugEval.not_ready_within_boundary
        && realEval.not_ready_within_boundary
        && realEval.dependent_action_on_not_ready_count === 0);
    const decisionGatingPass = debugEval.dependent_action_on_not_ready_count === 0
      && realEval.dependent_action_on_not_ready_count === 0;
    const debugConclusion = {
      has_running_ready: debugEval.has_running_ready,
      not_ready_within_boundary: debugEval.not_ready_within_boundary,
      dependent_action_on_not_ready_count: debugEval.dependent_action_on_not_ready_count,
      running_window_exclusion_pass: debugEval.running_window_exclusion_pass,
      pass: debugEval.not_ready_within_boundary
        && debugEval.dependent_action_on_not_ready_count === 0
        && debugEval.running_window_exclusion_pass
    };
    const realConclusion = {
      has_running_ready: realEval.has_running_ready,
      not_ready_within_boundary: realEval.not_ready_within_boundary,
      dependent_action_on_not_ready_count: realEval.dependent_action_on_not_ready_count,
      running_window_exclusion_pass: realEval.running_window_exclusion_pass,
      pass: realEval.not_ready_within_boundary
        && realEval.dependent_action_on_not_ready_count === 0
        && realEval.running_window_exclusion_pass
    };
    const firstBreakLayer = !(stoppedPass && runningPass && manualStopPass && autoStopPass)
      ? 'window lifecycle / current-last 语义断裂'
      : (!readinessConsistencyPass
        ? 'context readiness 一致性断裂'
        : (!decisionGatingPass ? 'decision gating 门控断裂' : null));

    const pass = stoppedPass
      && runningPass
      && manualStopPass
      && autoStopPass
      && runningWindowExclusionPass
      && readinessConsistencyPass
      && decisionGatingPass;
    const standard = buildStandardResult({
      scriptName: 'verify_window_lifecycle',
      taskId: args.taskId,
      sampleName: args.sampleName,
      pass,
      message: pass ? 'window lifecycle 校验通过' : 'window lifecycle 校验失败',
      firstBreakLayer,
      evidenceFile: args.output,
      summary: {
        window_state_semantics_pass: stoppedPass && runningPass && manualStopPass && autoStopPass,
        stop_reason_pass: manualStopPass && autoStopPass,
        running_window_exclusion_pass: runningWindowExclusionPass,
        readiness_consistency_pass: readinessConsistencyPass,
        decision_gating_pass: decisionGatingPass
      },
      rawExcerpt: {
        debug_not_ready_max_duration_ms: debugEval.not_ready_max_duration_ms,
        real_not_ready_max_duration_ms: realEval.not_ready_max_duration_ms,
        real_dependent_action_on_not_ready_count: realEval.dependent_action_on_not_ready_count
      }
    });
    const output = {
      ...standard,
      task_id: args.taskId,
      command: `node scripts/verify_window_lifecycle.mjs --task_id=${args.taskId}`,
      sample_conclusions: {
        debug_main_path_v1: debugConclusion,
        real_no_debug: realConclusion
      },
      boundary_conditions: {
        current_window_id: {
          allowed_empty_when: ['stopped', 'running_early'],
          must_be_non_empty_when: ['running=true 且窗口已初始化']
        },
        active_runtime_snapshot: {
          allowed_empty_when: ['stopped'],
          must_be_non_empty_when: ['running=true']
        },
        last_run_snapshot: {
          allowed_empty_when: ['首次运行前 stopped'],
          must_be_non_empty_when: ['任一轮结束后 stopped']
        },
        readiness: {
          allowed_empty_when: [
            'running_early',
            `running_window_present_but_not_ready 且持续时间 <= ${NOT_READY_MAX_MS}ms`
          ],
          must_be_non_empty_when: [
            'running_ready：running=true 且 current_window_id 已存在'
          ]
        }
      },
      states: {
        stopped,
        running: runningState,
        running_early: runningEarly,
        running_window_present_but_not_ready: runningNotReady,
        running_ready: runningReady,
        manual_stop: manualStop,
        auto_completed: autoCompleted
      },
      timelines: {
        debug_main_path_v1: debugTimeline,
        real_no_debug: realTimeline
      },
      truth_table: {
        stopped_pass: stoppedPass,
        running_pass: runningPass,
        manual_stop_pass: manualStopPass,
        auto_completed_pass: autoStopPass,
        running_window_exclusion: {
          debug: debugEval,
          real: realEval,
          pass: runningWindowExclusionPass
        },
        readiness_consistency: {
          debug: {
            not_ready_max_duration_ms: debugEval.not_ready_max_duration_ms,
            has_running_ready: debugEval.has_running_ready,
            pass: debugEval.not_ready_within_boundary
          },
          real: {
            not_ready_max_duration_ms: realEval.not_ready_max_duration_ms,
            has_running_ready: realEval.has_running_ready,
            pass: realEval.not_ready_within_boundary && realEval.dependent_action_on_not_ready_count === 0
          },
          pass: readinessConsistencyPass
        },
        decision_gating: {
          debug_dependent_action_on_not_ready_ticks: debugEval.dependent_action_on_not_ready_ticks,
          real_dependent_action_on_not_ready_ticks: realEval.dependent_action_on_not_ready_ticks,
          pass: decisionGatingPass
        }
      },
      result: {
        window_state_semantics_pass: stoppedPass && runningPass && manualStopPass && autoStopPass,
        stop_reason_pass: manualStopPass && autoStopPass,
        running_window_exclusion_pass: runningWindowExclusionPass,
        readiness_consistency_pass: readinessConsistencyPass,
        decision_gating_pass: decisionGatingPass
      },
      meta: {
        debug_start_response: debugTimeline.start,
        real_start_response: realTimeline.start,
        manual_start_response: manualStopInfo.start,
        auto_start_response: autoInfo.start,
        auto_expected_window_id: autoWindowId,
        first_break_layer: firstBreakLayer
      }
    };

    ensureDir(args.output);
    fs.writeFileSync(args.output, JSON.stringify(output, null, 2));
    const logPath = writeStandardLog(args.output, standard);
    console.log(`VERIFY_OUTPUT=${args.output}`);
    console.log(`VERIFY_LOG=${logPath}`);
    console.log(JSON.stringify(output.result));

    if (
      !output.result.window_state_semantics_pass
      || !output.result.stop_reason_pass
      || !output.result.running_window_exclusion_pass
      || !output.result.readiness_consistency_pass
      || !output.result.decision_gating_pass
    ) {
      process.exitCode = 1;
    }
  } finally {
    await http.post('/bot/stop', {}).catch(() => null);
    if (boot.spawned && !boot.spawned.killed) {
      boot.spawned.kill();
    }
    if (!runtimeLogExistedBefore && fs.existsSync(todayLogPath)) {
      fs.unlinkSync(todayLogPath);
    }
  }
};

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
