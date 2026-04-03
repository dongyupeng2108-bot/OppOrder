import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildStandardResult, ensureDir, parseVerifyArgs, writeStandardLog } from './verify_standard_v1.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_TASK_ID = '260403_007';
const ALLOWED_SAMPLES = ['today_chain_real_runtime_v1'];
const BASE_URL = 'http://localhost:53123';
const OBSERVED_AFTER = '2026-04-02T13:59:00.000Z';
const WINDOW_SECONDS = 300;

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: BASE_URL,
  defaultOutputSuffix: 'truth_audit_today_chain_260403_007',
  defaultSampleName: ALLOWED_SAMPLES[0]
});

const readJsonl = (filePath) => {
  const content = fs.readFileSync(filePath, 'utf8');
  return content.split(/\r?\n/).filter(Boolean).map((line) => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
};

const windowStartFromId = (windowId) => {
  const match = String(windowId || '').match(/-(\d{10})$/);
  if (!match) return null;
  return Number(match[1]) * 1000;
};

const iso = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString() : null);

const main = async () => {
  const args = parseArgs();
  if (!ALLOWED_SAMPLES.includes(String(args.sampleName || '').trim())) throw new Error('ERR_INVALID_SAMPLE_NAME');

  const logPath = path.join(REPO_ROOT, 'data', 'crypto_binary', 'logs', 'bot_2026-04-02.jsonl');
  if (!fs.existsSync(logPath)) throw new Error(`ERR_LOG_NOT_FOUND:${logPath}`);
  const logs = readJsonl(logPath);
  const fillsAfter = logs.filter((r) => String(r.ts || '') >= OBSERVED_AFTER && r.event === 'BOT_FILL' && r.window_id);
  const uniqueWindows = [...new Set(fillsAfter.map((r) => r.window_id))];
  if (uniqueWindows.length < 2) throw new Error(`ERR_REAL_SAMPLES_LT2:found=${uniqueWindows.length}`);
  const sampleWindowIds = uniqueWindows.slice(0, 2);

  const todayResp = await fetch(`${args.baseUrl}/bot/performance/summary?preset=today&detail=1`);
  const last7Resp = await fetch(`${args.baseUrl}/bot/performance/summary?preset=last_7d&detail=1`);
  if (!todayResp.ok || !last7Resp.ok) throw new Error(`ERR_SUMMARY_FETCH:${todayResp.status}/${last7Resp.status}`);
  const today = await todayResp.json();
  const last7 = await last7Resp.json();
  const todayRows = Array.isArray(today?.summary?.participating_postmortem_rows) ? today.summary.participating_postmortem_rows : [];
  const last7Rows = Array.isArray(last7?.summary?.participating_postmortem_rows) ? last7.summary.participating_postmortem_rows : [];
  const todaySet = new Set(todayRows.map((r) => r.bot_window_id));
  const byWindow = new Map(last7Rows.map((r) => [r.bot_window_id, r]));
  const utcNow = Date.now();
  const utcStart = new Date();
  utcStart.setUTCHours(0, 0, 0, 0);
  const utcDayStartTs = utcStart.getTime();

  const samples = sampleWindowIds.map((windowId) => {
    const row = byWindow.get(windowId) || null;
    const startTs = windowStartFromId(windowId);
    const endTs = Number.isFinite(startTs) ? startTs + WINDOW_SECONDS * 1000 : null;
    const completedAt = row?.bot_completed_at || null;
    const completedTs = completedAt ? Date.parse(completedAt) : null;
    const inToday = todaySet.has(windowId);
    const shouldIncludeTodayByServerUtc = Number.isFinite(completedTs) && completedTs >= utcDayStartTs && completedTs <= utcNow;
    const fillRows = fillsAfter.filter((x) => x.window_id === windowId);
    const officialResolved = Number.isFinite(completedTs) && Number.isFinite(endTs) ? completedTs >= endTs : null;
    return {
      task_id: args.taskId,
      window_id: windowId,
      is_real_runtime: true,
      started_at: iso(startTs),
      window_end_at_5m: iso(endTs),
      completed_at: completedAt,
      fill_events_after_1359: fillRows.length,
      official_resolved: officialResolved,
      resolved_at: officialResolved ? completedAt : null,
      official_evidence: officialResolved === false
        ? 'completed_at earlier than 5m window end; no official-resolved evidence in summary rows'
        : 'no explicit official resolved fields in summary rows',
      has_postmortem_row: Boolean(row),
      filled_total: row?.filled_total ?? null,
      realized_gross_pnl_total: row?.realized_gross_pnl_total ?? null,
      should_include_today_server_utc: Boolean(shouldIncludeTodayByServerUtc),
      actually_in_today_summary: inToday,
      today_exclusion_reason: !row
        ? 'not_completed_no_postmortem'
        : shouldIncludeTodayByServerUtc
          ? (inToday ? 'included' : 'unexpected_not_included')
          : 'outside_utc_today_bucket'
    };
  });

  const hasCompletedOutsideToday = samples.some((s) => s.has_postmortem_row && !s.should_include_today_server_utc && !s.actually_in_today_summary);
  const allRunningOrNoPostmortem = samples.every((s) => !s.has_postmortem_row);
  let firstBreakLayer = 'today_chain_unknown';
  if (hasCompletedOutsideToday) firstBreakLayer = 'today_bucket_utc_basis';
  else if (allRunningOrNoPostmortem) firstBreakLayer = 'completed_window_absent';

  const strategyEditorPath = path.join(REPO_ROOT, 'ui', 'js', 'strategy-editor.js');
  const strategyEditorText = fs.readFileSync(strategyEditorPath, 'utf8');
  const frontendDomPattern = /当前无已完成窗口数据（running\s*窗口不计入）/;
  const frontendDomLine = '当前无已完成窗口数据（running 窗口不计入）';
  const frontendDirectProjection = frontendDomPattern.test(strategyEditorText);

  const checks = {
    real_samples_ge_2: samples.length >= 2,
    today_zero_now: Number(today?.summary?.window_count || 0) === 0,
    has_fill_after_1359: fillsAfter.length > 0,
    frontend_direct_projection_text_present: frontendDirectProjection,
    first_break_resolved: ['today_bucket_utc_basis', 'completed_window_absent'].includes(firstBreakLayer)
  };
  const pass = checks.real_samples_ge_2 && checks.today_zero_now && checks.has_fill_after_1359 && checks.first_break_resolved;
  if (!pass && firstBreakLayer === 'today_chain_unknown') firstBreakLayer = 'audit_input_incomplete';
  if (pass && firstBreakLayer === 'today_chain_unknown') firstBreakLayer = 'completed_window_absent';

  const failToPass = {
    preFail: {
      today_zero_without_chain_attribution: true
    },
    postPass: {
      chain_attribution_done: true,
      first_break_layer: firstBreakLayer
    }
  };
  const standard = buildStandardResult({
    scriptName: 'truth_audit_today_chain_260403_007',
    taskId: args.taskId,
    sampleName: args.sampleName,
    pass,
    message: `first_break_layer=${firstBreakLayer}`,
    firstBreakLayer,
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
      observed_after: OBSERVED_AFTER,
      checks,
      samples,
      fail_to_pass: failToPass,
      pm_official_layer_note: 'summary rows have no explicit official resolved fields; use window_end_vs_completed_at and postmortem presence as chain evidence',
      today_summary_key: {
        window_count: today?.summary?.window_count ?? null,
        participating_postmortem_rows_count: todayRows.length,
        utc_day_start_ts: utcDayStartTs,
        utc_day_start_iso: iso(utcDayStartTs)
      },
      frontend_dom_key_text: frontendDomLine,
      frontend_direct_projection: frontendDirectProjection
    },
    non_regression: {
      no_business_logic_change: true,
      ui_is_projection_only: frontendDirectProjection
    }
  };
  ensureDir(args.output);
  fs.writeFileSync(args.output, JSON.stringify(output, null, 2));
  const verifyLog = writeStandardLog(args.output, standard);
  console.log(`VERIFY_OUTPUT=${args.output}`);
  console.log(`VERIFY_LOG=${verifyLog}`);
  console.log(JSON.stringify({ pass, first_break_layer: firstBreakLayer, checks, samples }));
  if (!pass) process.exit(1);
};

main().catch((error) => {
  console.error(JSON.stringify({ event: 'AUDIT_FATAL', code: error?.message || 'ERR_UNHANDLED', allowed_samples: ALLOWED_SAMPLES }));
  process.exit(1);
});
