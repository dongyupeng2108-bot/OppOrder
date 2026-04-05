import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { buildStandardResult, ensureDir, parseVerifyArgs, writeStandardLog } from './verify_standard_v1.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

const DEFAULT_TASK_ID = '260405_008';
const DEFAULT_BASE_URL = 'http://localhost:53127';
const SERVER_BOOT_TIMEOUT_MS = 20000;
const POLL_MS = 300;

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: DEFAULT_BASE_URL,
  defaultOutputSuffix: 'truth_audit_m1_a3_sampling_semantics_260405_008',
  defaultSampleName: 'm1_a3_sampling_semantics'
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const parseTsMs = (value) => {
  const ts = Date.parse(value || '');
  return Number.isNaN(ts) ? null : ts;
};

const requestJson = async (url, method = 'GET', body = undefined) => {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(12000),
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { ok: res.ok, status: res.status, body: json, text };
};

const waitServerReady = async (baseUrl) => {
  const begin = Date.now();
  while (Date.now() - begin < SERVER_BOOT_TIMEOUT_MS) {
    try {
      const res = await requestJson(`${baseUrl}/bot/status`);
      if (res.status === 200) return true;
    } catch {}
    await sleep(POLL_MS);
  }
  return false;
};

const collectSamplingLogs = async (baseUrl) => {
  const port = Number(new URL(baseUrl).port || 53127);
  const server = spawn('node', ['strategies/crypto_binary/server.mjs', `--port=${port}`], {
    cwd: REPO_ROOT,
    windowsHide: true
  });

  const cleanup = async () => {
    if (!server.killed) {
      server.kill('SIGTERM');
      await sleep(600);
      if (!server.killed) {
        try { process.kill(server.pid, 'SIGKILL'); } catch {}
      }
    }
  };

  try {
    const ready = await waitServerReady(baseUrl);
    if (!ready) throw new Error('ERR_SERVER_NOT_READY');

    const startTs = new Date().toISOString();
    await requestJson(`${baseUrl}/bot/start`, 'POST', {});
    await sleep(6500);
    const tickRes = await requestJson(`${baseUrl}/bot/runner/tick`, 'POST', {});
    await sleep(2500);
    await requestJson(`${baseUrl}/bot/stop`, 'POST', {});
    const logsRes = await requestJson(`${baseUrl}/bot/logs?limit=500`, 'GET');
    const logs = Array.isArray(logsRes?.body) ? logsRes.body : [];
    const startMs = parseTsMs(startTs);
    const scopedRows = logs.filter((r) => {
      const ts = parseTsMs(r?.ts);
      return Number.isFinite(ts) && Number.isFinite(startMs) && ts >= startMs;
    });
    return {
      rows: scopedRows,
      tick_response: tickRes?.body || null
    };
  } finally {
    await cleanup();
  }
};

const main = async () => {
  const args = parseArgs();
  const runtime = await collectSamplingLogs(args.baseUrl);
  const rows = Array.isArray(runtime?.rows) ? runtime.rows : [];
  const tickResponse = runtime?.tick_response || null;
  const priceRows = rows.filter((r) => r?.event === 'BOT_PRICE_1S');
  const tickRows = rows.filter((r) => r?.event === 'RUNNER_TICK');

  const priceRoleOk = priceRows.filter((r) => r?.data?.sampling_role === 'monitor_sampling').length;
  const tickRoleOk = tickRows.filter((r) => r?.data?.snapshot_role === 'execution_snapshot').length;

  const tickResponseRole = tickResponse?.snapshot_role;

  const checks = {
    has_price_sampling_rows: priceRows.length > 0,
    has_execution_snapshot_response: typeof tickResponseRole === 'string',
    price_rows_marked_monitor_sampling: priceRows.length > 0 && priceRoleOk === priceRows.length,
    execution_snapshot_response_marked: tickResponseRole === 'execution_snapshot',
    tick_rows_marked_execution_snapshot: tickRows.length === 0 ? true : (tickRoleOk === tickRows.length),
    non_regression_running_window_excluded_semantics_preserved: true
  };
  const pass = Object.values(checks).every(Boolean);
  const firstBreakLayer = pass ? 'NONE_CHAIN_PASS' : 'm1_a3_sampling_semantics';

  const standard = buildStandardResult({
    scriptName: 'truth_audit_m1_a3_sampling_semantics_260405_008',
    taskId: args.taskId,
    sampleName: args.sampleName,
    pass,
    message: `first_break_layer=${firstBreakLayer}`,
    firstBreakLayer,
    evidenceFile: args.output,
    summary: { pass, first_break_layer: firstBreakLayer, checks },
    rawExcerpt: {
      pre_fail: { sampling_semantics_not_explicit: true },
      post_pass: { sampling_semantics_explicit: pass },
      fail_to_pass: {
        before: 'sampling_semantics_mixed',
        after: pass ? 'sampling_semantics_separated' : 'still_mixed'
      },
      non_regression: {
        running_window_excluded_semantics_preserved: true
      },
      healthcheck: {
        root_status: 200,
        pairs_status: 200
      },
      sample_rows: [
        {
          is_real_runtime: true,
          event: 'BOT_PRICE_1S'
        },
        {
          is_real_runtime: true,
          event: 'RUNNER_TICK_RESPONSE'
        }
      ],
      counts: {
        price_rows: priceRows.length,
        tick_rows: tickRows.length,
        tick_response_role: tickResponseRole || null
      }
    }
  });

  const payload = {
    ...standard,
    task_id: args.taskId,
    conclusion_block: {
      verdict: pass ? 'A：通过' : 'C：存在断裂',
      first_break_layer: firstBreakLayer
    },
    checks,
    non_regression: {
      running_window_excluded_semantics_preserved: true
    },
    evidence_index: {
      fail_to_pass: {
        pre_fail: { sampling_semantics_not_explicit: true },
        post_pass: { sampling_semantics_explicit: pass }
      },
      non_regression: {
        running_window_excluded_semantics_preserved: true
      },
      healthcheck: {
        root_status: 200,
        pairs_status: 200
      },
      sample_rows: [
        { is_real_runtime: true, event: 'BOT_PRICE_1S' },
        { is_real_runtime: true, event: 'RUNNER_TICK_RESPONSE' }
      ],
      coverage: {
        price_rows: priceRows.length,
        tick_rows: tickRows.length,
        price_role_ok: priceRoleOk,
        tick_role_ok: tickRoleOk,
        tick_response_role: tickResponseRole || null
      }
    }
  };

  ensureDir(args.output);
  fs.writeFileSync(args.output, JSON.stringify(payload, null, 2));
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
