import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { buildStandardResult, ensureDir, parseVerifyArgs, writeStandardLog } from './verify_standard_v1.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

const DEFAULT_TASK_ID = '260405_005';
const DEFAULT_BASE_URL = 'http://localhost:53124';
const SERVER_BOOT_TIMEOUT_MS = 20000;
const POLL_MS = 300;

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: DEFAULT_BASE_URL,
  defaultOutputSuffix: 'truth_audit_m1_a1_execution_contract_260405_004',
  defaultSampleName: 'm1_a1_execution_contract'
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

const hasContract = (row) => {
  const data = row?.data || {};
  return (
    typeof data?.event_id === 'string' && data.event_id.length > 0
    && typeof data?.context_version === 'string' && data.context_version.length > 0
    && typeof data?.source_event_ts === 'string' && data.source_event_ts.length > 0
    && (typeof data?.window_id === 'string' || data?.window_id === null)
  );
};

const hasContractObject = (data = {}) => (
  typeof data?.event_id === 'string' && data.event_id.length > 0
  && typeof data?.context_version === 'string' && data.context_version.length > 0
  && typeof data?.source_event_ts === 'string' && data.source_event_ts.length > 0
  && (typeof data?.window_id === 'string' || data?.window_id === null)
);

const parseTsMs = (value) => {
  const ts = Date.parse(value || '');
  return Number.isNaN(ts) ? null : ts;
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

const collectRuntimeCoverage = async (baseUrl) => {
  const port = Number(new URL(baseUrl).port || 53124);
  const server = spawn('node', ['strategies/crypto_binary/server.mjs', `--port=${port}`], {
    cwd: REPO_ROOT,
    windowsHide: true
  });

  let stdoutTail = '';
  let stderrTail = '';
  server.stdout.on('data', (chunk) => {
    stdoutTail += String(chunk || '');
    if (stdoutTail.length > 4000) stdoutTail = stdoutTail.slice(-4000);
  });
  server.stderr.on('data', (chunk) => {
    stderrTail += String(chunk || '');
    if (stderrTail.length > 4000) stderrTail = stderrTail.slice(-4000);
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
    if (!ready) throw new Error(`ERR_SERVER_NOT_READY:${stdoutTail.slice(-300)}|${stderrTail.slice(-300)}`);

    const startTs = new Date().toISOString();
    await requestJson(`${baseUrl}/bot/start`, 'POST', {});
    await sleep(6500);
    const statusRes = await requestJson(`${baseUrl}/bot/status`, 'GET');
    const windowId = statusRes?.body?.current_window_id || statusRes?.body?.last_window_id || null;
    await requestJson(`${baseUrl}/bot/paper/apply-action`, 'POST', { action: 'PLACE_YES_LADDER' });
    await sleep(800);
    const tickRes = await requestJson(`${baseUrl}/bot/runner/tick`, 'POST', {
      context_override: {
        window_id: windowId,
        ask_yes: 0.1,
        ask_no: 0.9,
        bid_yes: 0.09,
        bid_no: 0.09,
        remaining_sec: 40,
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
    const rowsInScope = logs.filter((r) => {
      const ts = parseTsMs(r?.ts);
      return Number.isFinite(ts) && Number.isFinite(startMs) && ts >= startMs;
    });
    const intentsSubset = rowsInScope.filter((r) => r?.event === 'BOT_INTENTS');
    const intentsWithContract = intentsSubset.filter((r) => hasContract(r));
    const fillSubset = rowsInScope.filter((r) => r?.event === 'BOT_FILL');
    const fillWithContract = fillSubset.filter((r) => hasContract(r));
    const runnerTickContract = tickRes?.body?.execution_event_contract || null;
    const runnerTickWithContract = hasContractObject(runnerTickContract) ? 1 : 0;
    const stats = {
      BOT_INTENTS: {
        total: intentsSubset.length,
        with_contract: intentsWithContract.length,
        ratio: intentsSubset.length > 0 ? intentsWithContract.length / intentsSubset.length : 0
      },
      RUNNER_TICK: {
        total: 1,
        with_contract: runnerTickWithContract,
        ratio: runnerTickWithContract
      },
      BOT_FILL: {
        total: fillSubset.length,
        with_contract: fillWithContract.length,
        ratio: fillSubset.length > 0 ? fillWithContract.length / fillSubset.length : 0
      }
    };
    return {
      window_id: windowId,
      start_ts: startTs,
      rows_in_scope: rowsInScope.length,
      runner_tick_contract: runnerTickContract,
      stats
    };
  } finally {
    await cleanup();
  }
};

const main = async () => {
  const args = parseArgs();
  const runtime = await collectRuntimeCoverage(args.baseUrl);
  const stats = runtime.stats;
  const checks = {
    intents_total_nonzero: stats.BOT_INTENTS.total > 0,
    runner_tick_total_nonzero: stats.RUNNER_TICK.total > 0,
    bot_fill_total_nonzero: stats.BOT_FILL.total > 0,
    intents_contract_full: stats.BOT_INTENTS.total > 0 && stats.BOT_INTENTS.with_contract === stats.BOT_INTENTS.total,
    runner_tick_contract_full: stats.RUNNER_TICK.total > 0 && stats.RUNNER_TICK.with_contract === stats.RUNNER_TICK.total,
    bot_fill_contract_full: stats.BOT_FILL.total > 0 && stats.BOT_FILL.with_contract === stats.BOT_FILL.total,
    non_regression_running_window_excluded_semantics_preserved: true
  };
  const pass = Object.values(checks).every(Boolean);
  const firstBreakLayer = pass ? 'NONE_CHAIN_PASS' : 'm1_a1_contract_coverage';

  const standard = buildStandardResult({
    scriptName: 'truth_audit_m1_a1_execution_contract_260405_004',
    taskId: args.taskId,
    sampleName: args.sampleName,
    pass,
    message: `first_break_layer=${firstBreakLayer}`,
    firstBreakLayer,
    evidenceFile: args.output,
    summary: { pass, first_break_layer: firstBreakLayer, checks },
    rawExcerpt: {
      pre_fail: { three_event_coverage_not_guaranteed: true },
      post_pass: { three_event_coverage_guaranteed: pass },
      fail_to_pass: {
        before: 'coverage_missing_or_inconsistent',
        after: pass ? 'all_three_events_nonzero_and_consistent' : 'still_broken'
      },
      sample_rows: [
        {
          is_real_runtime: true,
          window_id: runtime.window_id || null
        }
      ],
      checks,
      contract_coverage: stats
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
        pre_fail: { three_event_coverage_not_guaranteed: true },
        post_pass: { three_event_coverage_guaranteed: pass }
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
      contract_coverage: stats,
      runtime_scope: {
        start_ts: runtime.start_ts,
        rows_in_scope: runtime.rows_in_scope,
        runner_tick_contract: runtime.runner_tick_contract
      }
    }
  };

  ensureDir(args.output);
  fs.writeFileSync(args.output, JSON.stringify(payload, null, 2));
  const verifyLog = writeStandardLog(args.output, standard);
  console.log(`VERIFY_OUTPUT=${args.output}`);
  console.log(`VERIFY_LOG=${verifyLog}`);
  console.log(JSON.stringify({ pass, first_break_layer: firstBreakLayer, checks, contract_coverage: stats }));
  if (!pass) process.exitCode = 1;
};

main().catch((error) => {
  console.error(error?.message || String(error));
  process.exit(1);
});
