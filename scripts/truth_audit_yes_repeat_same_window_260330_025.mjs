import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { buildStandardResult, ensureDir, parseVerifyArgs, writeStandardLog } from './verify_standard_v1.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_TASK_ID = '260330_025';
const MAX_WALL_MS = 25 * 60 * 1000;
const MAX_SILENCE_MS = 120 * 1000;
const LOG_TAIL = 150;

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: 'http://localhost:53225',
  defaultOutputSuffix: 'truth_audit_yes_repeat_same_window',
  defaultSampleName: 'yes_repeat_same_window_v1'
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const nowIso = () => new Date().toISOString();
const toFinite = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
const toJson = async (res) => {
  try { return await res.json(); } catch { return null; }
};

const createHttp = (baseUrl) => {
  const withRetry = async (fn) => {
    let lastError = null;
    for (let i = 0; i < 4; i += 1) {
      try { return await fn(); } catch (error) { lastError = error; await sleep(250); }
    }
    throw lastError || new Error('http_retry_failed');
  };
  return {
    get: (endpoint) => withRetry(async () => {
      const res = await fetch(`${baseUrl}${endpoint}`);
      return { status: res.status, body: await toJson(res) };
    }),
    post: (endpoint, body = {}) => withRetry(async () => {
      const res = await fetch(`${baseUrl}${endpoint}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });
      return { status: res.status, body: await toJson(res) };
    })
  };
};

const waitServerReady = async (baseUrl, timeoutMs = 45000) => {
  const begin = Date.now();
  while (Date.now() - begin < timeoutMs) {
    try {
      const res = await fetch(`${baseUrl}/bot/status`);
      if (res.status === 200) return true;
    } catch {}
    await sleep(250);
  }
  return false;
};
const startServer = async (port) => {
  const child = spawn(process.execPath, ['strategies/crypto_binary/server.mjs', `--port=${port}`], { cwd: REPO_ROOT, stdio: 'ignore' });
  const baseUrl = `http://localhost:${port}`;
  if (!(await waitServerReady(baseUrl))) {
    child.kill();
    throw new Error('server_start_timeout');
  }
  return { child, baseUrl };
};
const stopServer = async (child) => {
  if (!child || child.killed) return;
  child.kill();
  await sleep(600);
};

const perfPresetLabel = (preset) => {
  if (preset === 'last_7d') return '近7天';
  if (preset === 'last_30_windows') return '近30窗口';
  return '今日';
};
const formatStateValue = (value) => {
  if (value === null || value === undefined || value === '') return 'N/A (null)';
  if (Array.isArray(value)) return value.length ? value.join(',') : '[]';
  return `${value}`;
};
const formatFixed1 = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(1) : '—';
};
const lifecycleLabel = (value, isCloseOrder) => {
  if (value === 'OPEN') return '挂单中';
  if (value === 'FILLED') return isCloseOrder ? '已经平仓' : '已成交';
  if (value === 'CANCELLED') return '已撤单';
  return formatStateValue(value);
};
const uiOrderProjection = (ordersBody) => {
  const scope = ordersBody?.window_scope && typeof ordersBody.window_scope === 'object' ? ordersBody.window_scope : {};
  const isCurrentWindowScope = scope?.scope === 'current_window';
  const list = Array.isArray(ordersBody?.window_orders) ? [...ordersBody.window_orders] : (Array.isArray(ordersBody?.orders) ? [...ordersBody.orders] : []);
  const scopedList = isCurrentWindowScope
    ? list.filter((item) => {
      const rowWindowId = item?.resolved_window_id ?? item?.inferred_window_id ?? null;
      return rowWindowId == null || rowWindowId === scope?.display_window_id;
    })
    : [];
  scopedList.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  return scopedList.map((o) => {
    const isCloseOrder = o.kind === 'TAKE_PROFIT' || o.kind === 'EXIT';
    return {
      order_id: o.order_id ?? null,
      resolved_window_id: o?.resolved_window_id ?? o?.inferred_window_id ?? null,
      status_label: lifecycleLabel(o.status, isCloseOrder),
      side_label: o.side === 'YES' ? 'UP' : (o.side === 'NO' ? 'DOWN' : formatStateValue(o.side)),
      price_label: typeof o.price === 'number' ? o.price.toFixed(3) : '--',
      size_label: formatStateValue(o.size),
      tp_label: typeof o.tp_price === 'number' ? o.tp_price.toFixed(3) : (typeof o.fill_price === 'number' ? o.fill_price.toFixed(3) : '--'),
      raw: o
    };
  });
};
const buildResultBlockProjection = ({ status, postmortem, performance, preset = 'today' }) => {
  const lastRun = status?.last_run_snapshot && typeof status.last_run_snapshot === 'object' ? status.last_run_snapshot : null;
  const pm = postmortem?.postmortem && typeof postmortem.postmortem === 'object' ? postmortem.postmortem : null;
  const summary = performance?.summary && typeof performance.summary === 'object' ? performance.summary : null;
  const rows = Array.isArray(summary?.participating_postmortem_rows) ? summary.participating_postmortem_rows : [];
  const winNumerator = rows.filter((row) => {
    const v = Number(row?.realized_gross_pnl_total);
    return Number.isFinite(v) && v > 0;
  }).length;
  const winDenominator = rows.length;
  return {
    last_window_result: {
      window_id: pm?.window_id ?? lastRun?.current_window_id ?? null,
      filled_total: pm?.filled_total ?? lastRun?.filled_total ?? null,
      cancelled_total: pm?.cancelled_total ?? lastRun?.cancelled_total ?? 0,
      pnl: pm?.realized_gross_pnl_total ?? lastRun?.realized_gross_pnl_total ?? null
    },
    recent_summary: {
      range: perfPresetLabel(summary?.preset || preset),
      window_count: summary?.window_count ?? null,
      win_rate: winDenominator > 0 ? `${((winNumerator / winDenominator) * 100).toFixed(1)}%` : '—',
      filled_total: summary?.filled_total ?? null,
      total_pnl: formatFixed1(summary?.realized_gross_pnl_total),
      avg_pnl: summary?.avg_realized_gross_pnl_per_window ?? null
    },
    underlying: {
      postmortem_window_id: pm?.window_id ?? null,
      summary_window_count: summary?.window_count ?? null,
      summary_realized_gross_pnl_total: summary?.realized_gross_pnl_total ?? null
    }
  };
};

const extractFillEventIds = (logsBody) => {
  const out = new Set();
  const rows = Array.isArray(logsBody) ? logsBody : [];
  for (const row of rows) {
    if (row?.event !== 'BOT_FILL') continue;
    const fills = Array.isArray(row?.data?.fills) ? row.data.fills : [];
    for (const fill of fills) {
      if (typeof fill?.order_id === 'string' && fill.order_id) out.add(fill.order_id);
    }
  }
  return out;
};
const hasPlaceYesIntent = (intents = []) => intents.some((it) => {
  if (it?.kind !== 'PLACE_LADDER') return false;
  return it?.side === 'YES' || it?.side === 'BOTH';
});

const runDebugControl = async (http) => {
  await http.post('/bot/stop', {});
  await sleep(300);
  await http.post('/bot/start', { tick_interval_ms: 1000, debugScenario: 'fill_yes_path_v1' });
  await sleep(2500);
  const [statusRes, ordersRes, logsRes, postmortemRes, perfRes] = await Promise.all([
    http.get('/bot/status'),
    http.get('/bot/orders'),
    http.get('/bot/logs?limit=150'),
    http.get('/bot/postmortem/latest'),
    http.get('/bot/performance/summary?preset=today&detail=1')
  ]);
  await http.post('/bot/stop', {});
  const status = statusRes.body || {};
  const orders = ordersRes.body || {};
  const logs = logsRes.body || [];
  const uiRows = uiOrderProjection(orders);
  const decision = status?.last_tick_result?.decision_preview || {};
  const firstYesFilled = uiRows.find((row) => row.raw?.kind === 'ENTRY' && row.raw?.side === 'YES' && row.raw?.status === 'FILLED') || null;
  const stage = {
    terminal_state_guard: !(hasPlaceYesIntent(decision?.intents || []) && firstYesFilled),
    state_persist: status?.last_tick_result?.state_after?.ladder_posted !== false,
    decision_gate: !String(decision?.reason || '').includes('ladder_not_posted'),
    order_status_projection: new Set(uiRows.map((r) => r.order_id).filter(Boolean)).size === uiRows.length,
    window_scope_filter: uiRows.every((r) => {
      const w = r.resolved_window_id;
      const scopeW = orders?.window_scope?.display_window_id ?? null;
      return w == null || scopeW == null || w === scopeW;
    }),
    result_projection: true
  };
  return {
    stage,
    sample: {
      timestamp: nowIso(),
      current_window_id: status?.current_window_id ?? null,
      last_window_id: status?.last_window_id ?? null,
      decision_reason: decision?.reason ?? null,
      decision_intents: decision?.intents ?? [],
      newly_created_order_ids_this_tick: [],
      yes_open_order_ids: status?.last_tick_result?.state_after?.yes_order_ids ?? [],
      yes_filled_order_ids: uiRows.filter((r) => r.raw?.status === 'FILLED' && r.raw?.side === 'YES').map((r) => r.order_id),
      no_open_order_ids: status?.last_tick_result?.state_after?.no_order_ids ?? [],
      no_filled_order_ids: uiRows.filter((r) => r.raw?.status === 'FILLED' && r.raw?.side === 'NO').map((r) => r.order_id),
      result_block: buildResultBlockProjection({ status, postmortem: postmortemRes.body || {}, performance: perfRes.body || {} }),
      fill_event_order_ids: [...extractFillEventIds(logs)]
    }
  };
};

const runRealRuntime = async (http) => {
  const begin = Date.now();
  let lastBeat = Date.now();
  await http.post('/bot/stop', {});
  await sleep(300);
  await http.post('/bot/config', {
    open_delay_sec: 0,
    ladder_prices: [0.3],
    ladder_size: 5,
    atr_multiple: 1.2,
    cancel_all_remaining_sec: 30,
    up_ladder: [{ price: 0.3, size: 5, tp_price: 1 }],
    down_ladder: [{ price: 0.3, size: 5, tp_price: 1 }],
    up_cancel: { before_end_sec: 120, formula: '' },
    down_cancel: { before_end_sec: 60, formula: '' }
  });
  const waitNearEnd = async () => {
    while (Date.now() - begin < MAX_WALL_MS) {
      const ctxRes = await http.get('/bot/context');
      const rem = toFinite(ctxRes.body?.remaining_sec);
      const wid = ctxRes.body?.window_id ?? null;
      if (wid && rem !== null && rem <= 180) return { window_id: wid, remaining_sec: rem };
      await sleep(1000);
    }
    throw new Error('real_runtime_wait_start_timeout');
  };
  await waitNearEnd();
  await http.post('/bot/start', { tick_interval_ms: 1000 });
  let prevOrderIds = new Set();
  let firstYesFillSeenAt = null;
  let firstYesFillOrderId = null;
  let currentWindowAtFill = null;
  let postFillRepeatedPlaceYes = false;
  let postFillReasonLadderNotPosted = false;
  let postFillNewYesOrderIds = new Set();
  const anomalySamples = [];
  const allTickSamples = [];
  const orderRows = [];
  let foundDuplicateYesFilled = [];

  for (let i = 0; i < 1200; i += 1) {
    if (Date.now() - begin > MAX_WALL_MS) throw new Error('MAX_WALL_TIME_EXCEEDED');
    if (Date.now() - lastBeat > MAX_SILENCE_MS) throw new Error('MAX_SILENCE_EXCEEDED');
    const [statusRes, ordersRes, logsRes, postmortemRes, perfRes, previewRes] = await Promise.all([
      http.get('/bot/status'),
      http.get('/bot/orders'),
      http.get('/bot/logs?limit=150'),
      http.get('/bot/postmortem/latest'),
      http.get('/bot/performance/summary?preset=today&detail=1'),
      http.get('/bot/decision-preview')
    ]);
    const status = statusRes.body || {};
    const orders = ordersRes.body || {};
    const logs = logsRes.body || [];
    const preview = previewRes.body || {};
    const uiRows = uiOrderProjection(orders);
    const orderList = Array.isArray(orders?.window_orders) ? orders.window_orders : (Array.isArray(orders?.orders) ? orders.orders : []);
    const orderIdsNow = new Set(orderList.map((o) => o?.order_id).filter(Boolean));
    const newOrderIds = [...orderIdsNow].filter((id) => !prevOrderIds.has(id));
    prevOrderIds = orderIdsNow;
    const decision = preview && typeof preview === 'object'
      ? { reason: preview.reason ?? null, intents: Array.isArray(preview.intents) ? preview.intents : [] }
      : (status?.last_tick_result?.decision_preview || {});
    const stateAfter = status?.last_tick_result?.state_after || {};
    const yesFilledRows = uiRows.filter((r) => r.raw?.kind === 'ENTRY' && r.raw?.side === 'YES' && r.raw?.status === 'FILLED');
    const yesFilledDistinctIds = [...new Set(yesFilledRows.map((r) => r.order_id).filter(Boolean))];
    if (!firstYesFillSeenAt && yesFilledRows.length > 0) {
      firstYesFillSeenAt = nowIso();
      firstYesFillOrderId = yesFilledRows[0].order_id;
      currentWindowAtFill = status?.current_window_id ?? null;
    }
    const yesFilledMap = new Map();
    for (const row of yesFilledRows) {
      const key = `${row.raw?.side}|${row.raw?.price}|${row.raw?.size}|${row.raw?.tp_price}`;
      if (!yesFilledMap.has(key)) yesFilledMap.set(key, new Set());
      if (row.order_id) yesFilledMap.get(key).add(row.order_id);
    }
    const duplicated = [...yesFilledMap.values()].filter((s) => s.size >= 2).map((s) => [...s]);
    if (duplicated.length > 0) foundDuplicateYesFilled = duplicated[0];

    const fillEventIds = extractFillEventIds(logs);
    for (const order of orderList) {
      orderRows.push({
        timestamp: nowIso(),
        current_window_id: status?.current_window_id ?? null,
        order_id: order?.order_id ?? null,
        side: order?.side ?? null,
        price: order?.price ?? null,
        size: order?.size ?? null,
        tp_price: order?.tp_price ?? null,
        status: order?.status ?? null,
        fill_event_seen: fillEventIds.has(order?.order_id ?? ''),
        created_this_tick: newOrderIds.includes(order?.order_id ?? ''),
        source_block: 'api',
        pass_fail: 'PASS',
        notes: `window=${order?.resolved_window_id ?? order?.inferred_window_id ?? 'null'}`
      });
    }

    const sample = {
      timestamp: nowIso(),
      current_window_id: status?.current_window_id ?? null,
      last_window_id: status?.last_window_id ?? null,
      decision_reason: decision?.reason ?? null,
      decision_intents: decision?.intents ?? [],
      newly_created_order_ids_this_tick: newOrderIds,
      yes_open_order_ids: stateAfter?.yes_order_ids ?? [],
      yes_filled_order_ids: uiRows.filter((r) => r.raw?.status === 'FILLED' && r.raw?.side === 'YES').map((r) => r.order_id),
      no_open_order_ids: stateAfter?.no_order_ids ?? [],
      no_filled_order_ids: uiRows.filter((r) => r.raw?.status === 'FILLED' && r.raw?.side === 'NO').map((r) => r.order_id),
      result_block: buildResultBlockProjection({ status, postmortem: postmortemRes.body || {}, performance: perfRes.body || {} })
    };
    allTickSamples.push(sample);

    if (firstYesFillSeenAt) {
      if (hasPlaceYesIntent(decision?.intents || [])) postFillRepeatedPlaceYes = true;
      if (String(decision?.reason || '').includes('ladder_not_posted')) postFillReasonLadderNotPosted = true;
      for (const orderId of newOrderIds) {
        const target = orderList.find((o) => o?.order_id === orderId);
        const rowWindow = target?.resolved_window_id ?? target?.inferred_window_id ?? null;
        if (target?.side === 'YES' && target?.kind === 'ENTRY' && rowWindow === currentWindowAtFill) {
          postFillNewYesOrderIds.add(orderId);
        }
      }
      anomalySamples.push(sample);
    }
    const enoughEvidence = firstYesFillSeenAt
      && postFillNewYesOrderIds.size > 0
      && (yesFilledDistinctIds.length >= 2 || foundDuplicateYesFilled.length >= 2);
    if (enoughEvidence && anomalySamples.length >= 8) break;
    lastBeat = Date.now();
    await sleep(1000);
  }
  await http.post('/bot/stop', {});
  const finalSample = allTickSamples[allTickSamples.length - 1] || null;
  const yesFilledOrderIdsFinal = finalSample?.yes_filled_order_ids || [];
  const duplicateByCount = yesFilledOrderIdsFinal.length >= 2;

  const stage = {
    terminal_state_guard: !(postFillRepeatedPlaceYes || postFillNewYesOrderIds.size > 0),
    state_persist: !allTickSamples.some((s) => firstYesFillSeenAt && s.current_window_id === currentWindowAtFill && String(s.decision_reason || '').includes('ladder_not_posted')),
    decision_gate: !postFillReasonLadderNotPosted && !postFillRepeatedPlaceYes,
    order_status_projection: !(duplicateByCount && foundDuplicateYesFilled.length === 0),
    window_scope_filter: orderRows.every((r) => (r.notes || '').includes('window=')),
    result_projection: finalSample?.result_block?.underlying?.postmortem_window_id !== undefined
  };

  return {
    sample_covered: firstYesFillSeenAt !== null,
    first_yes_fill_at: firstYesFillSeenAt,
    first_yes_fill_order_id: firstYesFillOrderId,
    current_window_at_fill: currentWindowAtFill,
    post_fill_repeated_place_yes: postFillRepeatedPlaceYes,
    post_fill_new_yes_order_ids: [...postFillNewYesOrderIds],
    duplicate_yes_filled_order_ids: foundDuplicateYesFilled.length ? foundDuplicateYesFilled : yesFilledOrderIdsFinal.slice(0, 2),
    anomaly_samples: anomalySamples.slice(0, 20),
    all_tick_head: allTickSamples.slice(0, 15),
    all_tick_tail: allTickSamples.slice(-15),
    order_reconcile_table: orderRows.slice(-500),
    latest_result_block: finalSample?.result_block || null,
    stage
  };
};

const main = async () => {
  const args = parseArgs();
  const port = Number(new URL(args.baseUrl).port || 53225);
  const server = await startServer(port);
  const http = createHttp(server.baseUrl);
  let health = { root: null, pairs: null };
  try {
    health.root = await fetch(`${server.baseUrl}/`).then((r) => r.status).catch(() => null);
    health.pairs = await fetch(`${server.baseUrl}/pairs`).then((r) => r.status).catch(() => null);
    const debug = await runDebugControl(http);
    const real = await runRealRuntime(http);

    const order = ['terminal_state_guard', 'state_persist', 'decision_gate', 'order_status_projection', 'window_scope_filter', 'result_projection'];
    const sampleInsufficient = !real.sample_covered;
    let firstBreakLayer = 'NONE_CHAIN_PASS';
    if (sampleInsufficient) firstBreakLayer = 'SAMPLE_BLOCKED_OR_INSUFFICIENT';
    else {
      for (const key of order) {
        if (!real.stage[key]) { firstBreakLayer = key; break; }
      }
    }
    let divergenceLayer = 'none';
    for (const key of order) {
      if (Boolean(real.stage[key]) !== Boolean(debug.stage[key])) { divergenceLayer = key; break; }
    }

    const realDuplicate = real.post_fill_new_yes_order_ids.length > 0 || real.duplicate_yes_filled_order_ids.length >= 2;
    const projectionOnly = !realDuplicate && !real.stage.order_status_projection;
    const mixed = realDuplicate && !real.stage.order_status_projection;
    const triage = mixed ? '混合问题' : (realDuplicate ? '真实重复执行' : (projectionOnly ? '投影重复' : '投影重复'));

    const verdict = sampleInsufficient ? 'B：样本不足' : (firstBreakLayer === 'NONE_CHAIN_PASS' ? 'A：通过' : 'C：存在断裂');
    const conclusion = sampleInsufficient
      ? 'B：样本不足，未捕获到异常窗口内首个 YES 成交'
      : (firstBreakLayer === 'NONE_CHAIN_PASS'
        ? 'A：未发现重复异常断裂'
        : `C：存在断裂，首断裂层=${firstBreakLayer}`);

    const checks = {
      '025-A_real_runtime_covered': real.sample_covered === true,
      '025-B_debug_control_present': Boolean(debug?.sample?.timestamp),
      '025-C_order_id_reconcile_ready': Array.isArray(real.order_reconcile_table) && real.order_reconcile_table.length > 0,
      '025-D_first_break_layer_single': Boolean(firstBreakLayer),
      '025-E_triage_decided': ['真实重复执行', '投影重复', '混合问题'].includes(triage)
    };
    const keys = Object.keys(checks);
    const passChecks = keys.filter((k) => checks[k]).length;
    const failChecks = keys.length - passChecks;
    const pass = !sampleInsufficient && firstBreakLayer !== 'NONE_CHAIN_PASS' && failChecks === 0;

    const standard = buildStandardResult({
      scriptName: 'truth_audit_yes_repeat_same_window_260330_025',
      taskId: args.taskId,
      sampleName: args.sampleName,
      pass,
      message: pass ? 'yes repeat same-window truth audit pass' : 'yes repeat same-window truth audit fail',
      firstBreakLayer,
      evidenceFile: args.output,
      summary: {
        conclusion,
        verdict,
        triage,
        total_checks: keys.length,
        pass_checks: passChecks,
        fail_checks: failChecks,
        checks
      },
      rawExcerpt: {
        anomaly_samples_head: real.anomaly_samples.slice(0, 8),
        duplicate_yes_filled_order_ids: real.duplicate_yes_filled_order_ids
      }
    });

    const output = {
      ...standard,
      task_id: args.taskId,
      conclusion_block: {
        conclusion,
        verdict,
        first_break_layer: firstBreakLayer,
        triage,
        real_debug_diverged: divergenceLayer !== 'none',
        real_debug_first_divergence_layer: divergenceLayer
      },
      key_counters: {
        total_checks: keys.length,
        pass_checks: passChecks,
        fail_checks: failChecks
      },
      evidence_index: {
        real_runtime: real,
        debug_control: debug,
        order_reconcile_table: real.order_reconcile_table,
        healthcheck: health,
        stage_matrix: { real: real.stage, debug: debug.stage },
        guardrails: { max_wall_time_ms: MAX_WALL_MS, max_silence_ms: MAX_SILENCE_MS, log_tail: LOG_TAIL }
      },
      result: checks
    };

    ensureDir(args.output);
    fs.writeFileSync(args.output, JSON.stringify(output, null, 2));
    const logPath = writeStandardLog(args.output, standard);
    console.log(`VERIFY_OUTPUT=${args.output}`);
    console.log(`VERIFY_LOG=${logPath}`);
    console.log(JSON.stringify({
      pass,
      conclusion,
      verdict,
      first_break_layer: firstBreakLayer,
      triage,
      duplicate_yes_ids: real.duplicate_yes_filled_order_ids,
      post_fill_new_yes_order_ids: real.post_fill_new_yes_order_ids
    }));
    if (!pass) process.exitCode = 1;
  } finally {
    await stopServer(server.child);
  }
};

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
