import fs from 'fs';
import http from 'http';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { buildStandardResult, ensureDir, parseVerifyArgs, writeStandardLog } from './verify_standard_v1.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

const DEFAULT_TASK_ID = '260406_018';
const DEFAULT_BASE_URL = 'http://localhost:54123';

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: DEFAULT_BASE_URL,
  defaultOutputSuffix: 'truth_audit_bot_logs_filters_260406_018',
  defaultSampleName: 'bot_logs_filters'
});

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const requestPath = (urlObj, pathName, method, body, headers = {}) => new Promise((resolve, reject) => {
  const req = http.request({
    hostname: urlObj.hostname,
    port: Number(urlObj.port),
    path: pathName,
    method,
    headers
  }, (res) => {
    let data = '';
    res.on('data', (chunk) => { data += String(chunk); });
    res.on('end', () => resolve({ status: res.statusCode || 0, body: data }));
  });
  req.on('error', reject);
  if (body) req.write(body);
  req.end();
});

const waitForHealth = async (urlObj, maxRetry = 30) => {
  for (let i = 0; i < maxRetry; i += 1) {
    try {
      const res = await requestPath(urlObj, '/', 'GET');
      if (res.status === 200) return true;
    } catch {}
    await wait(200);
  }
  return false;
};

const parseJson = (text) => {
  try {
    return JSON.parse(String(text || '[]'));
  } catch {
    return [];
  }
};

const main = async () => {
  const args = parseArgs();
  const baseUrl = new URL(args.baseUrl || DEFAULT_BASE_URL);
  const port = Number(baseUrl.port || 54123);
  const strategy = process.env.AUDIT_STRATEGY_ID || 'btc_15m';
  const headers = { 'Content-Type': 'application/json' };

  const child = spawn(process.execPath, ['strategies/crypto_binary/server.mjs', `--strategy=${strategy}`, `--port=${port}`], {
    cwd: REPO_ROOT,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += String(chunk); });
  child.stderr.on('data', (chunk) => { stderr += String(chunk); });

  let checks = {};
  let pass = false;
  try {
    const healthy = await waitForHealth(baseUrl);
    if (!healthy) throw new Error('server not healthy in time');

    const targetWindow = 'w-filter-018';
    await requestPath(baseUrl, '/bot/runner/tick', 'POST', JSON.stringify({
      context_override: {
        window_id: targetWindow,
        period: '5m',
        remaining_sec: 220,
        btc_price: 63000,
        atr_5m: 70,
        bid_yes: 0.2,
        ask_yes: 0.21,
        bid_no: 0.7,
        ask_no: 0.71
      }
    }), headers);

    const byEventRes = await requestPath(baseUrl, '/bot/logs?limit=200&event=BOT_RUNNER_TICK_API_SUMMARY', 'GET');
    const byEvent = parseJson(byEventRes.body);
    const byWindowRes = await requestPath(baseUrl, `/bot/logs?limit=200&window_id=${encodeURIComponent(targetWindow)}`, 'GET');
    const byWindow = parseJson(byWindowRes.body);
    const byBothRes = await requestPath(baseUrl, `/bot/logs?limit=200&event=BOT_RUNNER_TICK_API_SUMMARY&window_id=${encodeURIComponent(targetWindow)}`, 'GET');
    const byBoth = parseJson(byBothRes.body);

    checks = {
      event_filter_returns_only_target_event: byEventRes.status === 200 && Array.isArray(byEvent) && byEvent.length > 0
        && byEvent.every((row) => row?.event === 'BOT_RUNNER_TICK_API_SUMMARY'),
      window_id_filter_returns_only_target_window: byWindowRes.status === 200 && Array.isArray(byWindow) && byWindow.length > 0
        && byWindow.every((row) => row?.window_id === targetWindow),
      combined_filters_return_rows: byBothRes.status === 200 && Array.isArray(byBoth) && byBoth.length > 0
        && byBoth.every((row) => row?.event === 'BOT_RUNNER_TICK_API_SUMMARY' && row?.window_id === targetWindow),
      server_runtime_started: healthy,
      governance_substitute_pass: false
    };
    checks.governance_substitute_pass = Object.entries(checks)
      .filter(([k]) => k !== 'governance_substitute_pass')
      .every(([, v]) => Boolean(v));
    pass = checks.governance_substitute_pass;
  } finally {
    child.kill();
  }

  const firstBreakLayer = pass ? 'NONE_CHAIN_PASS' : 'bot_logs_filters';
  const standard = buildStandardResult({
    scriptName: 'truth_audit_bot_logs_filters_260406_018',
    taskId: args.taskId,
    sampleName: args.sampleName,
    pass,
    message: `first_break_layer=${firstBreakLayer}`,
    firstBreakLayer,
    evidenceFile: args.output,
    summary: { pass, first_break_layer: firstBreakLayer, checks },
    rawExcerpt: {
      fail_to_pass: {
        before: 'bot_logs_filter_not_supported',
        after: pass ? 'bot_logs_filter_supported' : 'bot_logs_filter_still_broken'
      },
      governance_substitute: {
        pass: checks.governance_substitute_pass
      },
      checks,
      runtime_capture: {
        stdout_tail: stdout.slice(-400),
        stderr_tail: stderr.slice(-400)
      }
    }
  });

  ensureDir(args.output);
  const outputJson = { ...standard, task_id: args.taskId, task_type: 'business_implementation', checks };
  fs.writeFileSync(args.output, JSON.stringify(outputJson, null, 2));
  const verifyLog = writeStandardLog(args.output, standard);
  console.log(`VERIFY_OUTPUT=${args.output}`);
  console.log(`VERIFY_LOG=${verifyLog}`);
  console.log(JSON.stringify({ pass, first_break_layer: firstBreakLayer, checks }));
  if (!pass) process.exitCode = 1;
};

main().catch((error) => {
  console.error(error?.message || String(error));
  process.exit(1);
});
