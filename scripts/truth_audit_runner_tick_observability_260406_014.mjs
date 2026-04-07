import fs from 'fs';
import http from 'http';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { buildStandardResult, ensureDir, parseVerifyArgs, writeStandardLog } from './verify_standard_v1.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

const DEFAULT_TASK_ID = '260406_014';
const DEFAULT_BASE_URL = 'http://localhost:54123';

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: DEFAULT_BASE_URL,
  defaultOutputSuffix: 'truth_audit_runner_tick_observability_260406_014',
  defaultSampleName: 'runner_tick_observability'
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
    return JSON.parse(String(text || '{}'));
  } catch {
    return {};
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

    const tickRes = await requestPath(baseUrl, '/bot/runner/tick', 'POST', JSON.stringify({
      context_override: {
        window_id: 'w-ob-014',
        period: '5m',
        remaining_sec: 240,
        btc_price: 65000,
        atr_5m: 90,
        bid_yes: 0.2,
        ask_yes: 0.21,
        bid_no: 0.7,
        ask_no: 0.71
      }
    }), headers);
    const tickBody = parseJson(tickRes.body);

    const logsRes = await requestPath(baseUrl, '/bot/logs?limit=100', 'GET');
    const logsBody = parseJson(logsRes.body);
    const logs = Array.isArray(logsBody) ? logsBody : [];
    const summaryLog = [...logs].reverse().find((x) => x?.event === 'BOT_RUNNER_TICK_API_SUMMARY') || null;

    checks = {
      tick_status_ok: tickRes.status === 200 && tickBody.ok === true,
      tick_summary_exists: !!tickBody.tick_summary && typeof tickBody.tick_summary === 'object',
      tick_summary_fields_exist: ['reason', 'intents_summary', 'window_id', 'mode'].every((k) => Object.prototype.hasOwnProperty.call(tickBody.tick_summary || {}, k)),
      summary_log_event_exists: !!summaryLog,
      summary_log_fields_exist: !!summaryLog && summaryLog?.data && ['reason', 'intents_summary', 'window_id', 'mode'].every((k) => Object.prototype.hasOwnProperty.call(summaryLog.data || {}, k)),
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

  const firstBreakLayer = pass ? 'NONE_CHAIN_PASS' : 'runner_tick_observability';
  const standard = buildStandardResult({
    scriptName: 'truth_audit_runner_tick_observability_260406_014',
    taskId: args.taskId,
    sampleName: args.sampleName,
    pass,
    message: `first_break_layer=${firstBreakLayer}`,
    firstBreakLayer,
    evidenceFile: args.output,
    summary: { pass, first_break_layer: firstBreakLayer, checks },
    rawExcerpt: {
      fail_to_pass: {
        before: 'runner_tick_observability_missing',
        after: pass ? 'runner_tick_observability_ready' : 'runner_tick_observability_still_broken'
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
