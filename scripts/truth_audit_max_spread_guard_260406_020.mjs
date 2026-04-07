import fs from 'fs';
import http from 'http';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { buildStandardResult, ensureDir, parseVerifyArgs, writeStandardLog } from './verify_standard_v1.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

const DEFAULT_TASK_ID = '260406_020';
const DEFAULT_BASE_URL = 'http://localhost:54123';

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: DEFAULT_BASE_URL,
  defaultOutputSuffix: 'truth_audit_max_spread_guard_260406_020',
  defaultSampleName: 'max_spread_guard'
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

const parseJson = (text, fallback = {}) => {
  try {
    return JSON.parse(String(text || '{}'));
  } catch {
    return fallback;
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

    const currentConfigRes = await requestPath(baseUrl, '/bot/config', 'GET');
    const currentConfig = parseJson(currentConfigRes.body)?.current || {};
    const narrowConfig = { ...currentConfig, max_spread_bps: 50 };
    const wideConfig = { ...currentConfig, max_spread_bps: 10000 };

    const setNarrowRes = await requestPath(baseUrl, '/bot/config', 'POST', JSON.stringify(narrowConfig), headers);
    const tickBlockedRes = await requestPath(baseUrl, '/bot/runner/tick', 'POST', JSON.stringify({
      state_override: {
        current_window_id: 'w-spread-020-a',
        window_initialized_at: new Date(Date.now() - 45000).toISOString(),
        ladder_posted: false,
        yes_order_ids: [],
        no_order_ids: [],
        yes_cancelled: false,
        no_cancelled: false,
        up_formula_cancelled: false,
        down_formula_cancelled: false
      },
      context_override: {
        window_id: 'w-spread-020-a',
        period: '5m',
        remaining_sec: 240,
        btc_price: 65000,
        atr_5m: 90,
        bid_yes: 0.1,
        ask_yes: 0.9,
        bid_no: 0.1,
        ask_no: 0.9
      }
    }), headers);
    const tickBlockedBody = parseJson(tickBlockedRes.body);

    const setWideRes = await requestPath(baseUrl, '/bot/config', 'POST', JSON.stringify(wideConfig), headers);
    const tickAllowedRes = await requestPath(baseUrl, '/bot/runner/tick', 'POST', JSON.stringify({
      state_override: {
        current_window_id: 'w-spread-020-b',
        window_initialized_at: new Date(Date.now() - 45000).toISOString(),
        ladder_posted: false,
        yes_order_ids: [],
        no_order_ids: [],
        yes_cancelled: false,
        no_cancelled: false,
        up_formula_cancelled: false,
        down_formula_cancelled: false
      },
      context_override: {
        window_id: 'w-spread-020-b',
        period: '5m',
        remaining_sec: 240,
        btc_price: 65000,
        atr_5m: 90,
        bid_yes: 0.1,
        ask_yes: 0.9,
        bid_no: 0.1,
        ask_no: 0.9
      }
    }), headers);
    const tickAllowedBody = parseJson(tickAllowedRes.body);

    checks = {
      config_update_narrow_success: setNarrowRes.status === 200 && parseJson(setNarrowRes.body).ok === true,
      wide_spread_blocked_with_expected_reason: tickBlockedRes.status === 200
        && tickBlockedBody?.decision_preview?.reason === 'spread_too_wide_for_entry',
      config_update_wide_success: setWideRes.status === 200 && parseJson(setWideRes.body).ok === true,
      wide_spread_allowed_after_limit_relaxed: tickAllowedRes.status === 200
        && tickAllowedBody?.decision_preview?.reason === 'ladder_not_posted',
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

  const firstBreakLayer = pass ? 'NONE_CHAIN_PASS' : 'max_spread_guard';
  const standard = buildStandardResult({
    scriptName: 'truth_audit_max_spread_guard_260406_020',
    taskId: args.taskId,
    sampleName: args.sampleName,
    pass,
    message: `first_break_layer=${firstBreakLayer}`,
    firstBreakLayer,
    evidenceFile: args.output,
    summary: { pass, first_break_layer: firstBreakLayer, checks },
    rawExcerpt: {
      fail_to_pass: {
        before: 'entry_spread_guard_not_configurable',
        after: pass ? 'entry_spread_guard_configurable' : 'entry_spread_guard_still_broken'
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
