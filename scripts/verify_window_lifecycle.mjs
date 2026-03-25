import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

const DEFAULT_PORT = 53123;
const DEFAULT_BASE_URL = `http://localhost:${DEFAULT_PORT}`;
const DEFAULT_TASK_ID = '260324_026';

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
  const baseUrl = args.base_url || DEFAULT_BASE_URL;
  const taskId = args.task_id || DEFAULT_TASK_ID;
  const output = args.output
    || path.join(REPO_ROOT, 'rules', 'task-reports', new Date().toISOString().slice(0, 7), `${taskId}_window_lifecycle.json`);
  const spawnServer = args.spawn_server !== 'false';
  return { baseUrl, taskId, output, spawnServer };
};

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

const captureState = async (http, label) => {
  const [status, performance] = await Promise.all([
    http.get('/bot/status'),
    http.get('/bot/performance/summary?preset=today&detail=1')
  ]);
  const st = status?.body || {};
  const perfSummary = performance?.body?.summary || {};
  const uiEquivalent = {
    status_text: st?.running === true ? '运行中' : '已停止',
    runtime_window: st?.running === true ? (st?.current_window_id ?? '等待窗口初始化') : '—',
    runtime_snapshot_mode: st?.running === true ? 'active_runtime_snapshot' : 'last_run_snapshot',
    stop_reason_display: st?.last_run_snapshot?.stop_reason ?? null,
    recent_window_count: perfSummary?.window_count ?? null
  };
  return {
    label,
    captured_at: new Date().toISOString(),
    status,
    performance_summary: performance,
    ui_equivalent: uiEquivalent,
    derived: {
      running: st?.running === true,
      current_window_id: st?.current_window_id ?? null,
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

const waitRunningSample = async (http, scenario, timeoutTicks = 30) => {
  const start = await http.post('/bot/start', { tick_interval_ms: 1000, debugScenario: scenario });
  for (let i = 0; i < timeoutTicks; i += 1) {
    await sleep(500);
    const sample = await captureState(http, `running_probe_${i + 1}`);
    if (sample.derived.running === true && sample.derived.current_window_id) {
      return { start, sample };
    }
  }
  return { start, sample: await captureState(http, 'running_probe_fallback') };
};

const waitAutoCompletedSample = async (http, scenario, expectedWindowId = null, timeoutTicks = 150) => {
  const start = await http.post('/bot/start', { tick_interval_ms: 1000, debugScenario: scenario });
  let runningWindowId = expectedWindowId;
  for (let i = 0; i < timeoutTicks; i += 1) {
    await sleep(500);
    const sample = await captureState(http, `auto_probe_${i + 1}`);
    if (!runningWindowId && sample.derived.current_window_id) {
      runningWindowId = sample.derived.current_window_id;
    }
    if (sample.derived.running === false && sample.derived.last_run_stop_reason === 'AUTO_COMPLETED') {
      return { start, sample, runningWindowId };
    }
  }
  return { start, sample: await captureState(http, 'auto_probe_fallback'), runningWindowId };
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
    const stopped = await captureState(http, 'stopped');

    const runningInfo = await waitRunningSample(http, 'main_path_v1');
    const running = runningInfo.sample;
    const runningWindowId = running.derived.current_window_id;
    const stoppedPerf = {
      window_count: stopped.derived.perf_window_count,
      filled_total: stopped.derived.perf_filled_total,
      realized_gross_pnl_total: stopped.derived.perf_realized_gross_pnl_total
    };
    const runningPerf = {
      window_count: running.derived.perf_window_count,
      filled_total: running.derived.perf_filled_total,
      realized_gross_pnl_total: running.derived.perf_realized_gross_pnl_total
    };
    const runningWindowMixed = stoppedPerf.window_count !== runningPerf.window_count
      || stoppedPerf.filled_total !== runningPerf.filled_total
      || stoppedPerf.realized_gross_pnl_total !== runningPerf.realized_gross_pnl_total;
    await http.post('/bot/stop', {});
    await sleep(600);

    const manualStop = await captureState(http, 'manual_stop');

    const autoInfo = await waitAutoCompletedSample(http, 'main_path_v1', null, 160);
    await http.post('/bot/stop', {});
    await sleep(500);
    const autoCompleted = autoInfo.sample;
    const autoWindowId = autoInfo.runningWindowId;

    const stoppedPass = stopped.derived.running === false
      && stopped.derived.current_window_id == null
      && stopped.derived.active_runtime_snapshot == null;
    const runningPass = running.derived.running === true
      && running.derived.current_window_id != null
      && running.derived.active_runtime_snapshot != null;
    const manualStopPass = manualStop.derived.running === false
      && manualStop.derived.last_run_stop_reason === 'MANUAL_STOP'
      && manualStop.derived.active_runtime_snapshot == null;
    const autoStopPass = autoCompleted.derived.running === false
      && autoCompleted.derived.last_run_stop_reason === 'AUTO_COMPLETED'
      && autoCompleted.derived.last_run_window_id != null
      && (autoWindowId == null || autoCompleted.derived.last_run_window_id === autoWindowId);
    const runningWindowExclusionPass = runningWindowId != null && !runningWindowMixed;

    const output = {
      task_id: args.taskId,
      command: `node scripts/verify_window_lifecycle.mjs --task_id=${args.taskId}`,
      boundary_conditions: {
        current_window_id: {
          allowed_empty_when: ['stopped', 'running早期窗口未初始化'],
          must_be_non_empty_when: ['running=true 且窗口已初始化']
        },
        active_runtime_snapshot: {
          allowed_empty_when: ['stopped'],
          must_be_non_empty_when: ['running=true']
        },
        last_run_snapshot: {
          allowed_empty_when: ['首次运行前 stopped'],
          must_be_non_empty_when: ['任一轮结束后 stopped']
        }
      },
      states: {
        stopped,
        running,
        manual_stop: manualStop,
        auto_completed: autoCompleted
      },
      truth_table: {
        stopped_pass: stoppedPass,
        running_pass: runningPass,
        manual_stop_pass: manualStopPass,
        auto_completed_pass: autoStopPass,
        running_window_exclusion: {
          running_window_id: runningWindowId,
          baseline_performance_before_run: stoppedPerf,
          performance_during_running: runningPerf,
          running_window_mixed_into_performance_aggregates: runningWindowMixed,
          pass: runningWindowExclusionPass
        }
      },
      result: {
        window_state_semantics_pass: stoppedPass && runningPass && manualStopPass && autoStopPass,
        stop_reason_pass: manualStopPass && autoStopPass,
        running_window_exclusion_pass: runningWindowExclusionPass
      },
      meta: {
        running_start_response: runningInfo.start,
        auto_start_response: autoInfo.start,
        auto_expected_window_id: autoWindowId
      }
    };

    ensureDir(args.output);
    fs.writeFileSync(args.output, JSON.stringify(output, null, 2));
    console.log(`VERIFY_OUTPUT=${args.output}`);
    console.log(JSON.stringify(output.result));

    if (!output.result.window_state_semantics_pass || !output.result.stop_reason_pass || !output.result.running_window_exclusion_pass) {
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
