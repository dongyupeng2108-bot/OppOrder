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
const DEFAULT_TASK_ID = '260324_025';

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: DEFAULT_BASE_URL,
  defaultOutputSuffix: 'context_truth',
  defaultSampleName: 'debug_main_path_v1+debug_fill_yes_path_v1'
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

const uiEquivalent = (context, status) => {
  const running = status?.running === true;
  const btc = context?.btc_price;
  const runtimeBtcDisplay = !running
    ? '—'
    : (btc === null || btc === undefined || btc === '' ? '数据未就绪' : String(btc));
  return {
    status_text: running ? '运行中' : '已停止',
    runtime_btc_display: runtimeBtcDisplay,
    runtime_current_window: running ? (status?.current_window_id ?? '等待窗口初始化') : '—'
  };
};

const ensureServer = async ({ baseUrl, spawnServer }) => {
  const http = createHttp(baseUrl);
  try {
    const status = await http.get('/bot/status');
    if (status.status === 200) return { spawned: null };
  } catch {}
  if (!spawnServer) {
    throw new Error(`server unreachable: ${baseUrl}`);
  }
  const child = spawn('node', ['strategies/crypto_binary/server.mjs', '--port=53123'], {
    cwd: REPO_ROOT,
    stdio: 'ignore',
    detached: false
  });
  for (let i = 0; i < 30; i += 1) {
    await sleep(500);
    try {
      const status = await http.get('/bot/status');
      if (status.status === 200) return { spawned: child };
    } catch {}
  }
  child.kill();
  throw new Error(`failed to boot server: ${baseUrl}`);
};

const captureStage = async (http, label) => {
  const [context, status, config] = await Promise.all([
    http.get('/bot/context'),
    http.get('/bot/status'),
    http.get('/bot/config')
  ]);
  const ctx = context?.body || {};
  const st = status?.body || {};
  const cfg = config?.body?.current || {};
  return {
    label,
    captured_at: new Date().toISOString(),
    context,
    status,
    ui_equivalent: uiEquivalent(ctx, st),
    derived: {
      running: st?.running === true,
      current_window_id: st?.current_window_id ?? null,
      btc_price: ctx?.btc_price ?? null,
      anchor_btc: st?.anchor_btc ?? ctx?.anchor_btc ?? null,
      upper_bound: st?.upper_bound ?? ctx?.upper_bound ?? null,
      lower_bound: st?.lower_bound ?? ctx?.lower_bound ?? null,
      atr_5m: st?.atr_5m ?? ctx?.atr_5m ?? null,
      atr_multiple: cfg?.atr_multiple ?? null,
      remaining_sec: ctx?.remaining_sec ?? st?.remaining_sec ?? null,
      active_runtime_snapshot: st?.active_runtime_snapshot ?? null
    }
  };
};

const evaluateBounds = (stage) => {
  const d = stage?.derived || {};
  const anchor = toFinite(d.anchor_btc);
  const atr = toFinite(d.atr_5m);
  const mult = toFinite(d.atr_multiple);
  const up = toFinite(d.upper_bound);
  const down = toFinite(d.lower_bound);
  if (anchor === null || atr === null || mult === null || up === null || down === null) {
    return {
      status: 'SKIP',
      reason: 'anchor_btc / atr_5m / atr_multiple / bounds 至少一项缺失，本样本无法验证',
      expected_upper_bound: null,
      expected_lower_bound: null
    };
  }
  const expectedUp = anchor + (atr * mult);
  const expectedDown = anchor - (atr * mult);
  const pass = Math.abs(up - expectedUp) < 1e-9 && Math.abs(down - expectedDown) < 1e-9;
  return {
    status: pass ? 'PASS' : 'FAIL',
    reason: pass ? 'bounds 与 anchor/atr/mult 公式一致' : 'bounds 与公式不一致',
    expected_upper_bound: expectedUp,
    expected_lower_bound: expectedDown,
    actual_upper_bound: up,
    actual_lower_bound: down
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
    await sleep(500);
    const stopped = await captureStage(http, 'stopped');

    const startMain = await http.post('/bot/start', { tick_interval_ms: 1000, debugScenario: 'main_path_v1' });
    await sleep(120);
    const runningEarly = await captureStage(http, 'running_early');

    let runningNormal = null;
    for (let i = 0; i < 24; i += 1) {
      await sleep(500);
      const sample = await captureStage(http, `running_normal_probe_${i + 1}`);
      const d = sample.derived;
      if (d.running === true && d.current_window_id && d.btc_price !== null && d.btc_price !== undefined && toFinite(d.remaining_sec) !== null) {
        runningNormal = sample;
        break;
      }
    }
    if (!runningNormal) {
      await http.post('/bot/stop', {});
      await sleep(400);
      await http.post('/bot/start', { tick_interval_ms: 1000, debugScenario: 'fill_yes_path_v1' });
      for (let i = 0; i < 18; i += 1) {
        await sleep(500);
        const sample = await captureStage(http, `running_normal_fill_probe_${i + 1}`);
        const d = sample.derived;
        if (d.running === true && d.current_window_id && d.btc_price !== null && d.btc_price !== undefined && toFinite(d.remaining_sec) !== null) {
          runningNormal = sample;
          break;
        }
      }
    }
    if (!runningNormal) {
      runningNormal = await captureStage(http, 'running_normal_fallback');
    }
    await http.post('/bot/stop', {});

    const stoppedPass = stopped.derived.running === false
      && (stopped.derived.current_window_id === null || stopped.derived.current_window_id === undefined)
      && (stopped.derived.active_runtime_snapshot === null);

    const earlyD = runningEarly.derived;
    const earlyEmptyAllowed = (earlyD.current_window_id == null) || (toFinite(earlyD.anchor_btc) == null);
    const runningEarlyPass = earlyD.btc_price != null || earlyEmptyAllowed;

    const normalD = runningNormal.derived;
    const normalRunning = normalD.running === true && normalD.current_window_id != null;
    const normalBtcPresent = normalD.btc_price != null;
    const normalRemainingValid = toFinite(normalD.remaining_sec) !== null;
    const normalUiAligned = runningNormal.ui_equivalent.runtime_btc_display === String(normalD.btc_price);
    const runningNormalPass = normalRunning && normalBtcPresent && normalRemainingValid && normalUiAligned;

    const bounds = evaluateBounds(runningNormal);
    const boundsConsistencyPass = bounds.status === 'PASS' ? true : (bounds.status === 'SKIP' ? 'SKIP' : false);

    const pass = stoppedPass && runningEarlyPass && runningNormalPass && boundsConsistencyPass !== false;
    const firstBreakLayer = pass ? null : (!runningNormalPass ? 'context truth / btc 链未达标' : 'bounds formula');
    const standard = buildStandardResult({
      scriptName: 'verify_context_truth',
      taskId: args.taskId,
      sampleName: args.sampleName,
      pass,
      message: pass ? 'context truth 校验通过' : 'context truth 校验失败',
      firstBreakLayer,
      evidenceFile: args.output,
      summary: {
        context_truth_pass: stoppedPass && runningEarlyPass && runningNormalPass,
        btc_price_chain_pass: runningNormalPass,
        bounds_consistency_pass: boundsConsistencyPass
      },
      rawExcerpt: {
        running_normal_label: runningNormal?.label ?? null,
        running_normal_reason: runningNormal?.status?.body?.reason ?? null,
        bounds_status: bounds.status
      }
    });
    const output = {
      ...standard,
      task_id: args.taskId,
      command: `node scripts/verify_context_truth.mjs --task_id=${args.taskId}`,
      boundary_conditions: {
        allowed_empty_when: [
          'running_early 且 current_window_id 未就绪',
          'running_early 且首次拉价/初始化尚未完成（anchor_btc 为空）'
        ],
        must_be_non_empty_when: [
          'running=true 且 current_window_id 已存在（running_normal）时 btc_price 必须有效',
          'running_normal 时 remaining_sec 必须为有效数值'
        ]
      },
      stages: {
        stopped,
        running_early: runningEarly,
        running_normal: runningNormal
      },
      truth_table: {
        stopped_pass: stoppedPass,
        running_early_pass: runningEarlyPass,
        running_normal_pass: runningNormalPass,
        bounds_consistency: bounds
      },
      result: {
        context_truth_pass: stoppedPass && runningEarlyPass && runningNormalPass,
        btc_price_chain_pass: runningNormalPass,
        bounds_consistency_pass: boundsConsistencyPass
      },
      meta: {
        start_main_response: startMain
      }
    };

    ensureDir(args.output);
    fs.writeFileSync(args.output, JSON.stringify(output, null, 2));
    const logPath = writeStandardLog(args.output, standard);
    console.log(`VERIFY_OUTPUT=${args.output}`);
    console.log(`VERIFY_LOG=${logPath}`);
    console.log(JSON.stringify(output.result));

    if (!output.result.context_truth_pass || !output.result.btc_price_chain_pass || output.result.bounds_consistency_pass === false) {
      process.exitCode = 1;
    }
  } finally {
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
