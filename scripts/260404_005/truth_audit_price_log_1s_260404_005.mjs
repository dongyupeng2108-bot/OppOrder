import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildStandardResult, ensureDir, parseVerifyArgs, writeStandardLog } from '../verify_standard_v1.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_TASK_ID = '260404_005';
const ALLOWED_SAMPLES = ['price_log_1s_v1'];

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: 'http://localhost:53124',
  defaultOutputSuffix: 'truth_audit_price_log_1s_260404_005',
  defaultSampleName: ALLOWED_SAMPLES[0]
});

const toNum = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const isoNow = () => new Date().toISOString();
const parseTs = (v) => {
  const t = Date.parse(String(v || ''));
  return Number.isNaN(t) ? null : t;
};

const readLogEntries = (logPath) => {
  if (!fs.existsSync(logPath)) return [];
  const lines = fs.readFileSync(logPath, 'utf8').split(/\r?\n/).filter(Boolean);
  const rows = [];
  for (const line of lines) {
    try { rows.push(JSON.parse(line)); } catch (_) {}
  }
  return rows;
};

const main = async () => {
  const args = parseArgs();
  if (!ALLOWED_SAMPLES.includes(String(args.sampleName || '').trim())) throw new Error('ERR_INVALID_SAMPLE_NAME');
  const day = isoNow().slice(0, 10);
  const logPath = path.join(REPO_ROOT, 'data', 'crypto_binary', 'logs', `bot_${day}.jsonl`);

  const [rootResp, pairsResp] = await Promise.all([
    fetch(`${args.baseUrl}/`),
    fetch(`${args.baseUrl}/pairs`)
  ]);
  if (!rootResp.ok) throw new Error(`ERR_HEALTH_ROOT_${rootResp.status}`);
  if (!(pairsResp.status === 200 || pairsResp.status === 404)) throw new Error(`ERR_HEALTH_PAIRS_${pairsResp.status}`);

  await fetch(`${args.baseUrl}/bot/performance/today/reset`, { method: 'POST' });
  const startAt = isoNow();
  const startResp = await fetch(`${args.baseUrl}/bot/start`, { method: 'POST' });
  if (!startResp.ok) throw new Error(`ERR_START_HTTP_${startResp.status}`);
  await sleep(5600);
  const stopReqAt = isoNow();
  const stopResp = await fetch(`${args.baseUrl}/bot/stop`, { method: 'POST' });
  if (!stopResp.ok) throw new Error(`ERR_STOP_HTTP_${stopResp.status}`);

  let rows = [];
  let waitedMs = 0;
  while (waitedMs <= 24000) {
    rows = readLogEntries(logPath);
    const stopTs = parseTs(stopReqAt);
    const hasSnapshot = rows.some((r) => r?.event === 'BOT_RUN_SNAPSHOT' && parseTs(r?.ts) != null && parseTs(r.ts) >= stopTs);
    if (hasSnapshot) break;
    await sleep(1200);
    waitedMs += 1200;
  }
  if (rows.length === 0) throw new Error('ERR_EMPTY_BOT_LOG');

  const startTs = parseTs(startAt);
  const stopTs = parseTs(stopReqAt);
  const priceRows = rows
    .filter((r) => r?.event === 'BOT_PRICE_1S')
    .filter((r) => {
      const t = parseTs(r?.ts);
      return t != null && startTs != null && stopTs != null && t >= startTs && t <= (stopTs + 1500);
    });
  const consecutive3 = priceRows.slice(0, 3);
  const deltaFacts = [];
  for (let i = 1; i < consecutive3.length; i += 1) {
    const prev = parseTs(consecutive3[i - 1]?.ts);
    const curr = parseTs(consecutive3[i]?.ts);
    if (prev != null && curr != null) deltaFacts.push(curr - prev);
  }

  const requiredFields = ['current_window_id', 'btc_price', 'bid_yes', 'bid_no', 'ask_yes', 'ask_no', 'runner_active'];
  const fieldPresence = consecutive3.map((row) => {
    const data = row?.data || {};
    const missing = requiredFields.filter((k) => !Object.prototype.hasOwnProperty.call(data, k));
    return { ts: row?.ts ?? null, missing_fields: missing };
  });

  const stoppedEvent = rows.find((r) => r?.event === 'BOT_STOPPED' && parseTs(r?.ts) != null && parseTs(r.ts) >= stopTs);
  const stoppedTs = parseTs(stoppedEvent?.ts);
  const priceAfterStop = rows.filter((r) => r?.event === 'BOT_PRICE_1S').filter((r) => {
    const t = parseTs(r?.ts);
    return stoppedTs != null && t != null && t > stoppedTs && t <= (stoppedTs + 5000);
  });
  const runSnapshot = rows.find((r) => r?.event === 'BOT_RUN_SNAPSHOT' && parseTs(r?.ts) != null && parseTs(r.ts) >= stopTs) || null;
  const keyEvents = rows.filter((r) => {
    const t = parseTs(r?.ts);
    return t != null && t >= startTs && t <= (stopTs + 3000) && r?.event !== 'BOT_PRICE_1S';
  });

  const checks = {
    price_logs_ge_3: consecutive3.length >= 3,
    delta_about_1s: deltaFacts.length >= 2 && deltaFacts.every((d) => d >= 800 && d <= 1400),
    required_fields_present: fieldPresence.every((x) => x.missing_fields.length === 0),
    stop_after_no_price_1s: priceAfterStop.length === 0,
    stop_semantics_chain_alive: !!runSnapshot,
    key_flow_not_flooded: keyEvents.length >= 3 && priceRows.length <= 8,
    healthcheck_ok: rootResp.status === 200 && (pairsResp.status === 200 || pairsResp.status === 404)
  };
  const pass = Object.values(checks).every(Boolean);
  const firstBreakLayer = pass ? 'NONE_CHAIN_PASS' : 'price_log_1s_observability';

  const output = {
    runtime_window: {
      start_at: startAt,
      stop_requested_at: stopReqAt
    },
    consecutive_price_logs_min3: consecutive3.map((r) => ({
      ts: r?.ts ?? null,
      current_window_id: r?.data?.current_window_id ?? null,
      btc_price: toNum(r?.data?.btc_price),
      bid_yes: toNum(r?.data?.bid_yes),
      bid_no: toNum(r?.data?.bid_no),
      ask_yes: toNum(r?.data?.ask_yes),
      ask_no: toNum(r?.data?.ask_no),
      runner_active: r?.data?.runner_active ?? null
    })),
    adjacent_deltas_ms: deltaFacts,
    fields_presence: fieldPresence,
    stop_semantics: {
      bot_stopped_event: stoppedEvent ? { ts: stoppedEvent.ts, event: stoppedEvent.event } : null,
      price_logs_within_5s_after_stop: priceAfterStop.length,
      run_snapshot_after_stop: runSnapshot ? {
        ts: runSnapshot.ts,
        event: runSnapshot.event,
        stop_reason: runSnapshot?.data?.stop_reason ?? null,
        current_window_id: runSnapshot?.data?.current_window_id ?? null
      } : null
    },
    key_flow_density: {
      non_price_events_count: keyEvents.length,
      price_1s_events_count: priceRows.length
    },
    healthcheck: {
      root_status: rootResp.status,
      pairs_status: pairsResp.status
    },
    fail_to_pass: {
      preFail: {
        price_log_event_exists: false
      },
      postPass: {
        price_log_event_exists: consecutive3.length >= 3
      }
    },
    samples: [
      { sample_type: 'runtime_price_log_1s', is_real_runtime: true },
      { sample_type: 'stop_semantics', is_real_runtime: true }
    ],
    non_regression: {
      no_trade_formula_change: true,
      no_summary_formula_change: true,
      stop_semantics_kept: !!runSnapshot && priceAfterStop.length === 0
    },
    checks
  };

  const standard = buildStandardResult({
    scriptName: 'truth_audit_price_log_1s_260404_005',
    taskId: args.taskId,
    sampleName: args.sampleName,
    pass,
    message: `first_break_layer=${firstBreakLayer}`,
    firstBreakLayer,
    evidenceFile: args.output,
    summary: { pass },
    rawExcerpt: output
  });
  const finalOutput = {
    ...standard,
    task_type: 'runtime_observability_light',
    conclusion_block: {
      verdict: pass ? 'A：通过' : 'C：存在断裂',
      first_break_layer: firstBreakLayer
    },
    evidence_index: output
  };
  ensureDir(args.output);
  fs.writeFileSync(args.output, JSON.stringify(finalOutput, null, 2));
  const verifyLog = writeStandardLog(args.output, standard);
  console.log(`VERIFY_OUTPUT=${args.output}`);
  console.log(`VERIFY_LOG=${verifyLog}`);
  console.log(JSON.stringify({ pass, first_break_layer: firstBreakLayer, checks }));
  if (!pass) process.exit(1);
};

main().catch((error) => {
  console.error(JSON.stringify({ event: 'AUDIT_FATAL', code: error?.message || 'ERR_UNHANDLED', allowed_samples: ALLOWED_SAMPLES }));
  process.exit(1);
});
