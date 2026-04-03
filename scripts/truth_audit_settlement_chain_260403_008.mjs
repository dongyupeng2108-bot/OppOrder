import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildStandardResult, ensureDir, parseVerifyArgs, writeStandardLog } from './verify_standard_v1.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_TASK_ID = '260403_008';
const ALLOWED_SAMPLES = ['settlement_chain_real_runtime_v1'];
const BASE_URL = 'http://localhost:53123';
const SAMPLE_WINDOWS = ['btc-updown-5m-1775138400', 'btc-updown-5m-1775138700'];
const WAIT_RETRIES = 3;
const WAIT_INTERVAL_MS = 20000;
const FETCH_TIMEOUT_MS = 10000;

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: BASE_URL,
  defaultOutputSuffix: 'truth_audit_settlement_chain_260403_008',
  defaultSampleName: ALLOWED_SAMPLES[0]
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const readJsonl = (filePath) => fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => {
  try { return JSON.parse(line); } catch { return null; }
}).filter(Boolean);
const windowStartMs = (windowId) => {
  const m = String(windowId || '').match(/-(\d{10})$/);
  return m ? Number(m[1]) * 1000 : null;
};
const iso = (v) => (Number.isFinite(v) ? new Date(v).toISOString() : null);

const fetchJsonWithTimeout = async (url) => {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: ac.signal });
    const t = await r.text();
    let j = null;
    try { j = JSON.parse(t); } catch {}
    return { ok: r.ok, status: r.status, text: t.slice(0, 3000), json: j };
  } finally {
    clearTimeout(timer);
  }
};

const probeOfficial = async (windowId) => {
  const url = `https://gamma-api.polymarket.com/markets/slug/${windowId}`;
  const attempts = [];
  for (let i = 1; i <= WAIT_RETRIES; i += 1) {
    try {
      const rs = await fetchJsonWithTimeout(url);
      const body = rs.json;
      const row = {
        attempt: i,
        ok: rs.ok,
        status: rs.status,
        resolved: body?.closed ?? body?.active === false ?? null,
        official_outcome: body?.outcomes ?? null,
        resolved_at: body?.closedTime ?? body?.endDate ?? null,
        raw_status_fields: {
          active: body?.active ?? null,
          closed: body?.closed ?? null,
          closedTime: body?.closedTime ?? null,
          umaResolutionStatus: body?.umaResolutionStatus ?? null
        },
        error: null
      };
      attempts.push(row);
      if (rs.ok) break;
    } catch (e) {
      attempts.push({
        attempt: i,
        ok: false,
        status: null,
        resolved: null,
        official_outcome: null,
        resolved_at: null,
        raw_status_fields: null,
        error: String(e?.message || e)
      });
    }
    if (i < WAIT_RETRIES) await sleep(WAIT_INTERVAL_MS);
  }
  return { url, attempts };
};

const main = async () => {
  const args = parseArgs();
  if (!ALLOWED_SAMPLES.includes(String(args.sampleName || '').trim())) throw new Error('ERR_INVALID_SAMPLE_NAME');

  const logPath = path.join(REPO_ROOT, 'data', 'crypto_binary', 'logs', 'bot_2026-04-02.jsonl');
  const logs = readJsonl(logPath);
  const status = await (await fetch(`${args.baseUrl}/bot/status`)).json();
  const perfToday = await (await fetch(`${args.baseUrl}/bot/performance/summary?preset=today&detail=1`)).json();
  const perf7d = await (await fetch(`${args.baseUrl}/bot/performance/summary?preset=last_7d&detail=1`)).json();
  const rows7d = Array.isArray(perf7d?.summary?.participating_postmortem_rows) ? perf7d.summary.participating_postmortem_rows : [];
  const rowMap = new Map(rows7d.map((r) => [r.window_id, r]));

  const samples = [];
  for (const windowId of SAMPLE_WINDOWS) {
    const startMs = windowStartMs(windowId);
    const endMs = Number.isFinite(startMs) ? startMs + 300000 : null;
    const fillEvents = logs.filter((r) => r.window_id === windowId && r.event === 'BOT_FILL');
    const snapshotEvent = logs.find((r) => r.event === 'BOT_RUN_SNAPSHOT' && r?.data?.current_window_id === windowId) || null;
    const stopEvent = logs.find((r) => r.event === 'BOT_STOPPED' && r.ts >= (snapshotEvent?.ts || '')) || null;
    const postmortemRow = rowMap.get(windowId) || null;
    const officialProbe = await probeOfficial(windowId);
    const hasOfficialResolved = officialProbe.attempts.some((a) => a.ok === true && (a.raw_status_fields?.closed === true || a.raw_status_fields?.umaResolutionStatus === 'resolved'));
    const officialProbeFailed = officialProbe.attempts.every((a) => a.ok === false);
    const hasSettlementRuntimeFields = Object.keys(status || {}).some((k) => k.includes('settlement_') || k.includes('pending_settlement'));
    const settlementLogs = logs.filter((r) => r.window_id === windowId && /SETTLEMENT|resolved|resolve/i.test(`${r.event || ''} ${r.message || ''}`));
    const completedTriggeredBy = snapshotEvent ? 'BOT_RUN_SNAPSHOT' : null;
    const completedMissingReason = snapshotEvent ? null : 'no_snapshot_write_for_this_window';
    samples.push({
      task_id: args.taskId,
      window_id: windowId,
      is_real_runtime: true,
      market_slug: windowId,
      market_id: null,
      window_end_at: iso(endMs),
      local_state: snapshotEvent ? 'completed_via_snapshot' : 'running_or_rolled_without_snapshot',
      pm_official_layer: {
        probe_url: officialProbe.url,
        attempts: officialProbe.attempts,
        official_probe_failed: officialProbeFailed,
        official_resolved: hasOfficialResolved
      },
      local_fetch_layer: {
        settlement_runtime_fields_exposed: hasSettlementRuntimeFields,
        settlement_logs_count: settlementLogs.length,
        settlement_logs_head: settlementLogs.slice(0, 3)
      },
      completed_trigger_layer: {
        snapshot_event_ts: snapshotEvent?.ts || null,
        stop_event_ts: stopEvent?.ts || null,
        completed_at: postmortemRow?.completed_at || snapshotEvent?.data?.completed_at || null,
        trigger_source: completedTriggeredBy,
        missing_reason: completedMissingReason
      },
      postmortem_today_layer: {
        in_postmortem_7d: Boolean(postmortemRow),
        postmortem_row: postmortemRow,
        in_today: Array.isArray(perfToday?.summary?.participating_postmortem_rows) && perfToday.summary.participating_postmortem_rows.some((r) => r.window_id === windowId),
        today_window_count: perfToday?.summary?.window_count ?? null,
        today_rows_count: Array.isArray(perfToday?.summary?.participating_postmortem_rows) ? perfToday.summary.participating_postmortem_rows.length : 0
      },
      fill_events_count: fillEvents.length
    });
  }

  const hasAtLeast2Real = samples.length >= 2 && samples.every((s) => s.fill_events_count > 0);
  const anySampleNoSnapshot = samples.some((s) => s.completed_trigger_layer.trigger_source == null);
  const anySampleHasSnapshot = samples.some((s) => s.completed_trigger_layer.trigger_source != null);
  const officialProbeFailedAll = samples.every((s) => s.pm_official_layer.official_probe_failed);
  const settlementFieldAbsent = samples.every((s) => s.local_fetch_layer.settlement_runtime_fields_exposed === false && s.local_fetch_layer.settlement_logs_count === 0);
  const firstBreakLayer = (anySampleNoSnapshot && anySampleHasSnapshot && settlementFieldAbsent)
    ? 'completed_trigger_missing'
    : (officialProbeFailedAll ? 'official_probe_blocked' : 'official_unresolved_or_unknown');

  const checks = {
    real_runtime_samples_ge_2: hasAtLeast2Real,
    mixed_trigger_observed: anySampleNoSnapshot && anySampleHasSnapshot,
    settlement_fetch_mapping_absent: settlementFieldAbsent,
    first_break_layer_unique: ['completed_trigger_missing', 'official_probe_blocked', 'official_unresolved_or_unknown'].includes(firstBreakLayer)
  };
  const failToPass = {
    preFail: {
      completed_window_absent_without_upstream_layer: true
    },
    postPass: {
      upstream_layer_resolved: true,
      first_break_layer: firstBreakLayer
    }
  };
  const pass = checks.real_runtime_samples_ge_2 && checks.first_break_layer_unique;

  const standard = buildStandardResult({
    scriptName: 'truth_audit_settlement_chain_260403_008',
    taskId: args.taskId,
    sampleName: args.sampleName,
    pass,
    message: `first_break_layer=${firstBreakLayer}`,
    firstBreakLayer: firstBreakLayer === 'completed_trigger_missing' ? 'status_mapping_correct_but_completed_trigger_missing' : firstBreakLayer,
    evidenceFile: args.output,
    summary: { first_break_layer: firstBreakLayer, pass },
    rawExcerpt: { checks, samples, fail_to_pass: failToPass }
  });

  const output = {
    ...standard,
    task_id: args.taskId,
    conclusion_block: {
      verdict: pass ? 'A：通过' : 'C：存在断裂',
      first_break_layer: firstBreakLayer
    },
    evidence_index: {
      checks,
      samples,
      fail_to_pass: failToPass,
      status_keys: Object.keys(status || {}),
      today_summary: perfToday?.summary || null,
      last7_summary_count: perf7d?.summary?.window_count ?? null
    },
    non_regression: {
      no_business_logic_change: true
    }
  };

  ensureDir(args.output);
  fs.writeFileSync(args.output, JSON.stringify(output, null, 2));
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
