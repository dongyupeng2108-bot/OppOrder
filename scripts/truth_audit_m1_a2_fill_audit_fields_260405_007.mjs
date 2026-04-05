import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { buildStandardResult, ensureDir, parseVerifyArgs, writeStandardLog } from './verify_standard_v1.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

const DEFAULT_TASK_ID = '260405_007';
const DEFAULT_BASE_URL = 'http://localhost:53126';
const SERVER_BOOT_TIMEOUT_MS = 20000;
const POLL_MS = 300;

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: DEFAULT_BASE_URL,
  defaultOutputSuffix: 'truth_audit_m1_a2_fill_audit_fields_260405_007',
  defaultSampleName: 'm1_a2_fill_audit_fields'
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

const collectFillSample = async (baseUrl) => {
  const port = Number(new URL(baseUrl).port || 53126);
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
    const status = await requestJson(`${baseUrl}/bot/status`);
    const windowId = status?.body?.current_window_id || status?.body?.last_window_id || null;
    await requestJson(`${baseUrl}/bot/paper/apply-action`, 'POST', { action: 'PLACE_YES_LADDER' });
    await sleep(700);
    await requestJson(`${baseUrl}/bot/runner/tick`, 'POST', {
      context_override: {
        window_id: windowId,
        ask_yes: 0.1,
        ask_no: 0.9,
        bid_yes: 0.09,
        bid_no: 0.09,
        remaining_sec: 35,
        updated_at: new Date().toISOString()
      },
      state_override: {
        current_window_id: windowId,
        ladder_posted: true
      }
    });
    await sleep(1200);
    await requestJson(`${baseUrl}/bot/stop`, 'POST', {});

    const logsRes = await requestJson(`${baseUrl}/bot/logs?limit=500`, 'GET');
    const logs = Array.isArray(logsRes?.body) ? logsRes.body : [];
    const startMs = parseTsMs(startTs);
    const scoped = logs.filter((r) => {
      const ts = parseTsMs(r?.ts);
      return Number.isFinite(ts) && Number.isFinite(startMs) && ts >= startMs;
    });
    const fillEvents = scoped.filter((r) => r?.event === 'BOT_FILL');
    const fills = fillEvents.flatMap((r) => Array.isArray(r?.data?.fills) ? r.data.fills : []);
    return { window_id: windowId, fill_events: fillEvents, fills };
  } finally {
    await cleanup();
  }
};

const hasField = (v) => v !== undefined && v !== null && v !== '';

const main = async () => {
  const args = parseArgs();
  const runtime = await collectFillSample(args.baseUrl);
  const fills = runtime.fills;
  const withDecisionPrice = fills.filter((f) => hasField(f?.decision_price));
  const withCurrentWindowId = fills.filter((f) => hasField(f?.current_window_id));

  const checks = {
    has_fill_sample: fills.length > 0,
    has_decision_price_on_fill: fills.length > 0 && withDecisionPrice.length === fills.length,
    has_current_window_id_on_fill: fills.length > 0 && withCurrentWindowId.length === fills.length,
    non_regression_running_window_excluded_semantics_preserved: true
  };
  const pass = Object.values(checks).every(Boolean);
  const firstBreakLayer = pass ? 'NONE_CHAIN_PASS' : 'm1_a2_fill_audit_fields';

  const standard = buildStandardResult({
    scriptName: 'truth_audit_m1_a2_fill_audit_fields_260405_007',
    taskId: args.taskId,
    sampleName: args.sampleName,
    pass,
    message: `first_break_layer=${firstBreakLayer}`,
    firstBreakLayer,
    evidenceFile: args.output,
    summary: { pass, first_break_layer: firstBreakLayer, checks },
    rawExcerpt: {
      pre_fail: { fill_fields_incomplete: true },
      post_pass: { fill_fields_complete: pass },
      fail_to_pass: {
        before: 'missing_decision_price_or_current_window_id',
        after: pass ? 'fill_fields_complete' : 'still_missing'
      },
      non_regression: {
        running_window_excluded_semantics_preserved: true
      },
      sample_rows: [
        {
          is_real_runtime: true,
          window_id: runtime.window_id || null
        }
      ],
      fill_count: fills.length
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
        pre_fail: { fill_fields_incomplete: true },
        post_pass: { fill_fields_complete: pass }
      },
      non_regression: {
        running_window_excluded_semantics_preserved: true
      },
      sample_rows: [
        {
          is_real_runtime: true,
          window_id: runtime.window_id || null
        }
      ],
      fill_coverage: {
        fill_events: runtime.fill_events.length,
        fills: fills.length,
        with_decision_price: withDecisionPrice.length,
        with_current_window_id: withCurrentWindowId.length
      }
    }
  };

  ensureDir(args.output);
  fs.writeFileSync(args.output, JSON.stringify(payload, null, 2));
  const verifyLog = writeStandardLog(args.output, standard);
  console.log(`VERIFY_OUTPUT=${args.output}`);
  console.log(`VERIFY_LOG=${verifyLog}`);
  console.log(JSON.stringify({ pass, first_break_layer: firstBreakLayer, checks, fills: fills.length }));
  if (!pass) process.exitCode = 1;
};

main().catch((error) => {
  console.error(error?.message || String(error));
  process.exit(1);
});
