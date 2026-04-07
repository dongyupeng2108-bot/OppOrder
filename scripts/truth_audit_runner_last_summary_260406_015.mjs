import fs from 'fs';
import http from 'http';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { buildStandardResult, ensureDir, parseVerifyArgs, writeStandardLog } from './verify_standard_v1.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

const DEFAULT_TASK_ID = '260406_015';
const DEFAULT_BASE_URL = 'http://localhost:54123';

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: DEFAULT_BASE_URL,
  defaultOutputSuffix: 'truth_audit_runner_last_summary_260406_015',
  defaultSampleName: 'runner_last_summary'
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
        window_id: 'w-last-015',
        period: '5m',
        remaining_sec: 180,
        btc_price: 64000,
        atr_5m: 80,
        bid_yes: 0.2,
        ask_yes: 0.22,
        bid_no: 0.72,
        ask_no: 0.74
      }
    }), headers);
    const tickBody = parseJson(tickRes.body);

    const lastRes = await requestPath(baseUrl, '/bot/runner/last-summary', 'GET');
    const lastBody = parseJson(lastRes.body);

    const statusRes = await requestPath(baseUrl, '/bot/status', 'GET');
    const statusBody = parseJson(statusRes.body);
    const statusRuntimeSnapshot = statusBody?.active_runtime_snapshot || {};

    checks = {
      tick_call_success: tickRes.status === 200 && tickBody.ok === true && !!tickBody.tick_summary,
      last_summary_endpoint_success: lastRes.status === 200 && lastBody.ok === true,
      last_summary_contains_required_fields: !!lastBody?.last_tick_summary && ['reason', 'intents_summary', 'window_id', 'mode']
        .every((k) => Object.prototype.hasOwnProperty.call(lastBody.last_tick_summary || {}, k)),
      last_summary_has_timestamp: typeof lastBody?.last_tick_at === 'string' && lastBody.last_tick_at.length > 0,
      status_snapshot_contains_last_summary_field: Object.prototype.hasOwnProperty.call(statusRuntimeSnapshot, 'last_tick_summary'),
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

  const firstBreakLayer = pass ? 'NONE_CHAIN_PASS' : 'runner_last_summary';
  const standard = buildStandardResult({
    scriptName: 'truth_audit_runner_last_summary_260406_015',
    taskId: args.taskId,
    sampleName: args.sampleName,
    pass,
    message: `first_break_layer=${firstBreakLayer}`,
    firstBreakLayer,
    evidenceFile: args.output,
    summary: { pass, first_break_layer: firstBreakLayer, checks },
    rawExcerpt: {
      fail_to_pass: {
        before: 'runner_last_summary_not_available',
        after: pass ? 'runner_last_summary_available' : 'runner_last_summary_still_broken'
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
