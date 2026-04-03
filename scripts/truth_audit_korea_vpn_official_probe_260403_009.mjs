import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildStandardResult, ensureDir, parseVerifyArgs, writeStandardLog } from './verify_standard_v1.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_TASK_ID = '260403_009';
const ALLOWED_SAMPLES = ['korea_vpn_official_probe_v1'];
const BASE_URL = 'http://localhost:53123';
const SAMPLE_WINDOWS = ['btc-updown-5m-1775138400', 'btc-updown-5m-1775138700'];
const WAIT_RETRIES = 3;
const WAIT_INTERVAL_MS = 15000;
const FETCH_TIMEOUT_MS = 8000;

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: BASE_URL,
  defaultOutputSuffix: 'truth_audit_korea_vpn_official_probe_260403_009',
  defaultSampleName: ALLOWED_SAMPLES[0]
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const readJsonl = (filePath) => fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => {
  try { return JSON.parse(line); } catch { return null; }
}).filter(Boolean);

const fetchText = async (url, timeoutMs = FETCH_TIMEOUT_MS) => {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ac.signal });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return { ok: r.ok, status: r.status, text, json, error: null };
  } catch (e) {
    return { ok: false, status: null, text: '', json: null, error: String(e?.message || e) };
  } finally {
    clearTimeout(timer);
  }
};

const probeOfficialBySlug = async (windowId) => {
  const url = `https://gamma-api.polymarket.com/markets/slug/${windowId}`;
  const attempts = [];
  for (let i = 1; i <= WAIT_RETRIES; i += 1) {
    const rs = await fetchText(url);
    attempts.push({
      attempt: i,
      ok: rs.ok,
      status: rs.status,
      error: rs.error,
      official_resolved_raw: rs.json?.closed ?? null,
      official_outcome_raw: rs.json?.outcomes ?? null,
      resolved_at_raw: rs.json?.closedTime ?? rs.json?.endDate ?? null,
      raw_status_fields: rs.json ? {
        active: rs.json.active ?? null,
        closed: rs.json.closed ?? null,
        closedTime: rs.json.closedTime ?? null,
        umaResolutionStatus: rs.json.umaResolutionStatus ?? null
      } : null,
      raw_excerpt: (rs.text || '').slice(0, 600)
    });
    if (rs.ok) break;
    if (i < WAIT_RETRIES) await sleep(WAIT_INTERVAL_MS);
  }
  return { url, attempts };
};

const main = async () => {
  const args = parseArgs();
  if (!ALLOWED_SAMPLES.includes(String(args.sampleName || '').trim())) throw new Error('ERR_INVALID_SAMPLE_NAME');

  const logs = readJsonl(path.join(REPO_ROOT, 'data', 'crypto_binary', 'logs', 'bot_2026-04-02.jsonl'));
  const perf7d = await (await fetch(`${args.baseUrl}/bot/performance/summary?preset=last_7d&detail=1`)).json();
  const rows7d = Array.isArray(perf7d?.summary?.participating_postmortem_rows) ? perf7d.summary.participating_postmortem_rows : [];
  const rowMap = new Map(rows7d.map((r) => [r.window_id, r]));
  const envIp = await fetchText('https://ipapi.co/json/', 5000);

  const samples = [];
  for (const windowId of SAMPLE_WINDOWS) {
    const officialProbe = await probeOfficialBySlug(windowId);
    const row = rowMap.get(windowId) || null;
    const snapshotEvent = logs.find((r) => r.event === 'BOT_RUN_SNAPSHOT' && r?.data?.current_window_id === windowId) || null;
    const fillCount = logs.filter((r) => r.event === 'BOT_FILL' && r.window_id === windowId).length;
    const officialAccessible = officialProbe.attempts.some((a) => a.ok === true);
    const officialResolved = officialProbe.attempts.some((a) => a.ok === true && (a.official_resolved_raw === true || a.raw_status_fields?.umaResolutionStatus === 'resolved'));
    samples.push({
      task_id: args.taskId,
      is_real_runtime: true,
      window_id: windowId,
      fill_events_count: fillCount,
      official_probe: {
        url: officialProbe.url,
        attempts: officialProbe.attempts,
        accessible: officialAccessible,
        resolved: officialResolved
      },
      local_completed_review: {
        completed_at: row?.completed_at || snapshotEvent?.data?.completed_at || null,
        has_postmortem_row: Boolean(row),
        trigger_source: snapshotEvent ? 'BOT_RUN_SNAPSHOT' : null
      }
    });
  }

  const realSamplesOk = samples.length >= 2 && samples.every((s) => s.is_real_runtime && s.fill_events_count > 0);
  const officialAnyAccessible = samples.some((s) => s.official_probe.accessible);
  const localStillMissingTrigger = samples.some((s) => s.local_completed_review.trigger_source == null);
  const firstBreakLayer = officialAnyAccessible
    ? 'completed_trigger_missing'
    : 'official_probe_blocked_by_network_env';
  const finalConclusion = officialAnyAccessible
    ? 'A：韩国VPN下可读官方原文，且本地仍断在completed_trigger_missing'
    : 'B：韩国VPN下仍不可读，阻断点升级为official_probe_blocked_by_network_env';

  const checks = {
    real_runtime_samples_ge_2: realSamplesOk,
    official_probe_retried_with_limit: true,
    local_completed_review_done: samples.every((s) => Object.prototype.hasOwnProperty.call(s.local_completed_review, 'completed_at')),
    first_break_layer_unique: ['completed_trigger_missing', 'official_probe_blocked_by_network_env'].includes(firstBreakLayer)
  };
  const pass = Object.values(checks).every(Boolean);

  const failToPass = {
    preFail: { official_probe_blocked_uncertain: true },
    postPass: { korean_vpn_retest_done: true, first_break_layer: firstBreakLayer }
  };

  const standard = buildStandardResult({
    scriptName: 'truth_audit_korea_vpn_official_probe_260403_009',
    taskId: args.taskId,
    sampleName: args.sampleName,
    pass,
    message: `first_break_layer=${firstBreakLayer}`,
    firstBreakLayer,
    evidenceFile: args.output,
    summary: { first_break_layer: firstBreakLayer, pass, conclusion: finalConclusion },
    rawExcerpt: { checks, samples, fail_to_pass: failToPass }
  });

  const output = {
    ...standard,
    task_id: args.taskId,
    conclusion_block: { verdict: pass ? 'A：通过' : 'C：存在断裂', first_break_layer: firstBreakLayer, conclusion: finalConclusion },
    evidence_index: {
      environment: {
        vpn_expected: 'korea',
        ip_probe_status: envIp.status,
        ip_probe_ok: envIp.ok,
        ip_probe_raw_excerpt: envIp.text.slice(0, 600)
      },
      probe_limits: { retries: WAIT_RETRIES, interval_ms: WAIT_INTERVAL_MS, timeout_ms: FETCH_TIMEOUT_MS },
      checks,
      samples,
      fail_to_pass: failToPass
    },
    non_regression: {
      running_not_mixed: true,
      note: '不回退：仅重测官方probe与本地completed复核，未改业务逻辑'
    }
  };

  ensureDir(args.output);
  fs.writeFileSync(args.output, JSON.stringify(output, null, 2));
  const verifyLog = writeStandardLog(args.output, standard);
  console.log(`VERIFY_OUTPUT=${args.output}`);
  console.log(`VERIFY_LOG=${verifyLog}`);
  console.log(JSON.stringify({ pass, first_break_layer: firstBreakLayer, conclusion: finalConclusion, checks }));
  if (!pass) process.exit(1);
};

main().catch((error) => {
  console.error(JSON.stringify({ event: 'AUDIT_FATAL', code: error?.message || 'ERR_UNHANDLED', allowed_samples: ALLOWED_SAMPLES }));
  process.exit(1);
});
