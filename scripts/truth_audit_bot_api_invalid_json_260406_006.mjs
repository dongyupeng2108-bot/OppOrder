import fs from 'fs';
import http from 'http';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { buildStandardResult, ensureDir, parseVerifyArgs, writeStandardLog } from './verify_standard_v1.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

const DEFAULT_TASK_ID = '260406_006';
const DEFAULT_BASE_URL = 'http://localhost:54123';

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: DEFAULT_BASE_URL,
  defaultOutputSuffix: 'truth_audit_bot_api_invalid_json_260406_006',
  defaultSampleName: 'bot_api_invalid_json'
});

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const request = (urlObj, method, body, headers = {}) => new Promise((resolve, reject) => {
  const req = http.request({
    hostname: urlObj.hostname,
    port: Number(urlObj.port),
    path: '/',
    method,
    headers
  }, (res) => {
    let data = '';
    res.on('data', (chunk) => { data += String(chunk); });
    res.on('end', () => {
      resolve({ status: res.statusCode || 0, body: data });
    });
  });
  req.on('error', reject);
  if (body) req.write(body);
  req.end();
});

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
    res.on('end', () => {
      resolve({ status: res.statusCode || 0, body: data });
    });
  });
  req.on('error', reject);
  if (body) req.write(body);
  req.end();
});

const waitForHealth = async (urlObj, maxRetry = 30) => {
  for (let i = 0; i < maxRetry; i += 1) {
    try {
      const res = await request(urlObj, 'GET');
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

    const invalidBody = '{ bad_json';
    const commonHeaders = { 'Content-Type': 'application/json' };
    const resReload = await requestPath(baseUrl, '/config/reload', 'POST', invalidBody, commonHeaders);
    const resBotConfig = await requestPath(baseUrl, '/bot/config', 'POST', invalidBody, commonHeaders);
    const resBotStart = await requestPath(baseUrl, '/bot/start', 'POST', invalidBody, commonHeaders);

    const bodyReload = parseJson(resReload.body);
    const bodyBotConfig = parseJson(resBotConfig.body);
    const bodyBotStart = parseJson(resBotStart.body);

    checks = {
      invalid_json_reload_returns_400: resReload.status === 400,
      invalid_json_bot_config_returns_400: resBotConfig.status === 400,
      invalid_json_bot_start_returns_400: resBotStart.status === 400,
      invalid_json_error_message_stable: bodyReload.error === 'invalid json payload'
        && bodyBotConfig.error === 'invalid json payload'
        && bodyBotStart.error === 'invalid json payload',
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

  const firstBreakLayer = pass ? 'NONE_CHAIN_PASS' : 'bot_api_invalid_json';
  const standard = buildStandardResult({
    scriptName: 'truth_audit_bot_api_invalid_json_260406_006',
    taskId: args.taskId,
    sampleName: args.sampleName,
    pass,
    message: `first_break_layer=${firstBreakLayer}`,
    firstBreakLayer,
    evidenceFile: args.output,
    summary: { pass, first_break_layer: firstBreakLayer, checks },
    rawExcerpt: {
      fail_to_pass: {
        before: 'invalid_json_mapped_to_500',
        after: pass ? 'invalid_json_mapped_to_400' : 'invalid_json_mapping_still_broken'
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
