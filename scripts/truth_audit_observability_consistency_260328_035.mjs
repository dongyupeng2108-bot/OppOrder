import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { buildStandardResult, ensureDir, parseVerifyArgs, writeStandardLog } from './verify_standard_v1.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_TASK_ID = '260328_035';

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: 'http://localhost:53139',
  defaultOutputSuffix: 'truth_audit_observability_consistency',
  defaultSampleName: 'reason_intents_summary_evidence_consistency_v1'
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const toJson = async (response) => {
  try {
    return await response.json();
  } catch {
    return null;
  }
};

const createHttp = (baseUrl) => ({
  async get(endpoint) {
    const response = await fetch(`${baseUrl}${endpoint}`);
    return { status: response.status, body: await toJson(response) };
  },
  async post(endpoint, body = {}) {
    const response = await fetch(`${baseUrl}${endpoint}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    return { status: response.status, body: await toJson(response) };
  }
});

const waitServerReady = async (baseUrl, timeoutMs = 35000) => {
  const http = createHttp(baseUrl);
  const begin = Date.now();
  while (Date.now() - begin < timeoutMs) {
    try {
      const status = await http.get('/bot/status');
      const config = await http.get('/bot/config');
      if (status.status === 200 && config.status === 200) return true;
    } catch {}
    await sleep(300);
  }
  return false;
};

const startServerOnPort = async (port) => {
  const baseUrl = `http://localhost:${port}`;
  const child = spawn('node', ['strategies/crypto_binary/server.mjs', `--port=${port}`], {
    cwd: REPO_ROOT,
    stdio: 'ignore',
    detached: false
  });
  const ready = await waitServerReady(baseUrl, 40000);
  if (!ready) {
    child.kill();
    return null;
  }
  return { child, baseUrl, port };
};

const acquireServer = async () => {
  const ports = [53139, 53140, 53141, 53142];
  for (const port of ports) {
    const server = await startServerOnPort(port);
    if (server) return server;
  }
  throw new Error('unable to boot dedicated audit server on candidate ports');
};

const stopServer = async (child) => {
  if (!child || child.killed) return;
  child.kill();
  await sleep(800);
};

const withConfig = (cfg) => ({
  open_delay_sec: cfg.open_delay_sec,
  ladder_prices: [0.27, 0.24, 0.21, 0.18],
  ladder_size: 5,
  atr_multiple: 1.2,
  cancel_all_remaining_sec: cfg.cancel_all_remaining_sec ?? 0,
  up_ladder: cfg.up_ladder,
  down_ladder: cfg.down_ladder,
  up_cancel: cfg.up_cancel,
  down_cancel: cfg.down_cancel
});

const summaryFromOrders = (orders = []) => {
  const rows = Array.isArray(orders) ? orders : [];
  return {
    total: rows.length,
    open_yes: rows.filter((o) => o?.status === 'OPEN' && o?.side === 'YES').length,
    open_no: rows.filter((o) => o?.status === 'OPEN' && o?.side === 'NO').length,
    filled_total: rows.filter((o) => o?.status === 'FILLED').length,
    cancelled_total: rows.filter((o) => o?.status === 'CANCELLED').length
  };
};

const isCancelReason = (reason) => {
  if (typeof reason !== 'string') return false;
  return reason.includes('cancel')
    || reason.startsWith('btc_price>=')
    || reason.startsWith('btc_price<=')
    || reason.startsWith('remaining_sec<=');
};

const isPlaceReason = (reason) => reason === 'ladder_not_posted';

const isNoopReason = (reason) => {
  if (typeof reason !== 'string') return false;
  return reason.includes('within_bounds')
    || reason.includes('price_or_bounds_null')
    || reason.includes('pre_open')
    || reason.startsWith('gate_context_not_ready')
    || reason === 'wait_runner_tick_result';
};

const classifyActionByDelta = (curr, prev) => {
  if (!prev) return 'INIT';
  const totalDiff = Number(curr?.total || 0) - Number(prev?.total || 0);
  const openDiff = (Number(curr?.open_yes || 0) + Number(curr?.open_no || 0))
    - (Number(prev?.open_yes || 0) + Number(prev?.open_no || 0));
  const cancelledDiff = Number(curr?.cancelled_total || 0) - Number(prev?.cancelled_total || 0);
  if (totalDiff > 0 && openDiff >= 0) return 'PLACE';
  if (cancelledDiff > 0 || openDiff < 0) return 'CANCEL_OR_CLOSE';
  if (totalDiff === 0 && cancelledDiff === 0 && openDiff === 0) return 'NO_CHANGE';
  return 'MIXED';
};

const main = async () => {
  const args = parseArgs();
  const server = await acquireServer();
  const http = createHttp(server.baseUrl);
  let originalConfig = null;
  try {
    const healthRoot = await fetch(`${server.baseUrl}/`).then((r) => r.status).catch(() => null);
    let healthPairs = null;
    try {
      healthPairs = await fetch(`${server.baseUrl}/pairs`).then((r) => r.status);
    } catch {
      healthPairs = 'ERR';
    }

    await http.post('/bot/stop', {});
    const cfg = await http.get('/bot/config');
    originalConfig = cfg?.body?.current || null;

    const baseCfg = withConfig({
      open_delay_sec: 0,
      cancel_all_remaining_sec: 0,
      up_ladder: [{ price: 0.31, size: 2, tp_price: 0.35 }, { price: 0.29, size: 1, tp_price: 0.33 }],
      down_ladder: [{ price: 0.02, size: 3, tp_price: 0.03 }, { price: 0.015, size: 1, tp_price: 0.025 }],
      up_cancel: { before_end_sec: 0, formula: 'false' },
      down_cancel: { before_end_sec: 0, formula: 'false' }
    });
    await http.post('/bot/config', baseCfg);

    await http.post('/bot/start', { tick_interval_ms: 1000, debugScenario: 'main_path_v1' });
    const runtimeRows = [];
    const seenTicks = new Set();
    for (let i = 0; i < 46; i += 1) {
      await sleep(350);
      const status = await http.get('/bot/status');
      const ordersResp = await http.get('/bot/orders');
      const preview = await http.get('/bot/decision-preview');
      const tickKey = status?.body?.last_tick_at || `i:${i}`;
      const summary = ordersResp?.body?.summary || {};
      if (seenTicks.has(tickKey)) continue;
      seenTicks.add(tickKey);
      runtimeRows.push({
        i,
        last_tick_at: status?.body?.last_tick_at || null,
        last_reason: status?.body?.last_reason || null,
        preview_reason: preview?.body?.reason || null,
        intents: Array.isArray(preview?.body?.intents) ? preview.body.intents : [],
        summary: {
          total: Number(summary?.total || 0),
          open_yes: Number(summary?.open_yes || 0),
          open_no: Number(summary?.open_no || 0),
          cancelled_total: Number(summary?.cancelled_total || 0),
          filled_total: Number(summary?.filled_total || 0)
        }
      });
    }
    await http.post('/bot/stop', {});

    const runtimeWithDelta = runtimeRows.map((row, idx) => ({
      ...row,
      action_by_delta: classifyActionByDelta(row.summary, idx > 0 ? runtimeRows[idx - 1].summary : null),
      intents_kinds: row.intents.map((it) => it?.kind).filter(Boolean)
    }));
    const reasonPreviewMismatch = runtimeWithDelta.filter((r) => {
      if (r.last_reason == null || r.preview_reason == null) return false;
      return String(r.last_reason) !== String(r.preview_reason);
    });
    const reasonActionMismatch = runtimeWithDelta.filter((r) => {
      const kinds = r.intents_kinds;
      if (!r.last_reason) return false;
      if (isCancelReason(r.last_reason) && kinds.includes('PLACE_LADDER')) return true;
      if (isPlaceReason(r.last_reason) && kinds.includes('CANCEL_OPEN')) return true;
      if (isNoopReason(r.last_reason) && r.action_by_delta === 'PLACE') return true;
      return false;
    });
    const hasCancelTick = runtimeWithDelta.some((r) => isCancelReason(r.last_reason));
    const hasPlaceTick = runtimeWithDelta.some((r) => isPlaceReason(r.last_reason));
    const hasNoopTick = runtimeWithDelta.some((r) => isNoopReason(r.last_reason));
    const caseA = {
      unique_tick_count: runtimeWithDelta.length,
      sample: runtimeWithDelta.slice(0, 14),
      mismatch_reason_vs_preview_count: reasonPreviewMismatch.length,
      mismatch_reason_vs_action_count: reasonActionMismatch.length,
      has_cancel_tick: hasCancelTick,
      has_place_tick: hasPlaceTick,
      has_noop_tick: hasNoopTick,
      pass: runtimeWithDelta.length >= 6 && reasonPreviewMismatch.length === 0 && reasonActionMismatch.length === 0
    };

    const triadNoop = await http.post('/bot/runner/tick', {
      context_override: {
        window_id: 'audit-035-triad',
        period: '5m',
        remaining_sec: 220,
        btc_price: 65000,
        atr_5m: 90,
        upper_bound: 70000,
        lower_bound: 60000,
        ask_yes: 0.42,
        bid_yes: 0.41,
        ask_no: 0.59,
        bid_no: 0.58
      },
      state_override: {
        current_window_id: 'audit-035-triad',
        window_initialized_at: new Date(Date.now() - 4000).toISOString(),
        ladder_posted: true,
        yes_order_ids: ['yes_open_1'],
        no_order_ids: ['no_open_1'],
        yes_cancelled: false,
        no_cancelled: false,
        up_formula_cancelled: false,
        down_formula_cancelled: false,
        anchor_btc: 65000,
        atr_5m: 90,
        upper_bound: 70000,
        lower_bound: 60000
      }
    });
    const triadPlace = await http.post('/bot/runner/tick', {
      context_override: {
        window_id: 'audit-035-triad',
        period: '5m',
        remaining_sec: 220,
        btc_price: 65000,
        atr_5m: 90,
        upper_bound: 70000,
        lower_bound: 60000,
        ask_yes: 0.42,
        bid_yes: 0.41,
        ask_no: 0.59,
        bid_no: 0.58
      },
      state_override: {
        current_window_id: 'audit-035-triad',
        window_initialized_at: new Date(Date.now() - 4000).toISOString(),
        ladder_posted: false,
        yes_order_ids: [],
        no_order_ids: [],
        yes_cancelled: false,
        no_cancelled: false,
        up_formula_cancelled: false,
        down_formula_cancelled: false,
        anchor_btc: 65000,
        atr_5m: 90,
        upper_bound: 70000,
        lower_bound: 60000
      }
    });
    const triadCancel = await http.post('/bot/runner/tick', {
      context_override: {
        window_id: 'audit-035-triad',
        period: '5m',
        remaining_sec: 220,
        btc_price: 71000,
        atr_5m: 90,
        upper_bound: 70000,
        lower_bound: 60000,
        ask_yes: 0.42,
        bid_yes: 0.41,
        ask_no: 0.59,
        bid_no: 0.58
      },
      state_override: {
        current_window_id: 'audit-035-triad',
        window_initialized_at: new Date(Date.now() - 4000).toISOString(),
        ladder_posted: true,
        yes_order_ids: ['yes_open_1'],
        no_order_ids: ['no_open_1'],
        yes_cancelled: false,
        no_cancelled: false,
        up_formula_cancelled: false,
        down_formula_cancelled: false,
        anchor_btc: 65000,
        atr_5m: 90,
        upper_bound: 70000,
        lower_bound: 60000
      }
    });
    const triad = {
      noop_reason: triadNoop?.body?.decision_preview?.reason || null,
      noop_intents: triadNoop?.body?.decision_preview?.intents || [],
      place_reason: triadPlace?.body?.decision_preview?.reason || null,
      place_intents: triadPlace?.body?.decision_preview?.intents || [],
      cancel_reason: triadCancel?.body?.decision_preview?.reason || null,
      cancel_intents: triadCancel?.body?.decision_preview?.intents || []
    };
    const caseB = {
      triad,
      pass: triad.noop_reason !== 'ladder_not_posted'
        && triad.noop_reason !== 'up_cancel_formula'
        && Array.isArray(triad.noop_intents) && triad.noop_intents.every((i) => i?.kind === 'NOOP')
        && triad.place_reason === 'ladder_not_posted'
        && Array.isArray(triad.place_intents) && triad.place_intents.some((i) => i?.kind === 'PLACE_LADDER')
        && isCancelReason(triad.cancel_reason)
        && Array.isArray(triad.cancel_intents) && triad.cancel_intents.some((i) => i?.kind === 'CANCEL_OPEN')
    };

    await http.post('/bot/config', withConfig({
      open_delay_sec: 0,
      cancel_all_remaining_sec: 0,
      up_ladder: [{ price: 0.99, size: 2, tp_price: 0.97 }],
      down_ladder: [{ price: 0.01, size: 2, tp_price: 0.02 }],
      up_cancel: { before_end_sec: 0, formula: 'false' },
      down_cancel: { before_end_sec: 0, formula: 'false' }
    }));
    await http.post('/bot/start', { tick_interval_ms: 1000, debugScenario: 'fill_yes_path_v1' });
    await sleep(6500);
    await http.post('/bot/stop', {});
    const cOrdersResp = await http.get('/bot/orders');
    const cSummary = cOrdersResp?.body?.summary || {};
    const cRows = Array.isArray(cOrdersResp?.body?.all_orders)
      ? cOrdersResp.body.all_orders
      : (Array.isArray(cOrdersResp?.body?.orders) ? cOrdersResp.body.orders : []);
    const agg = summaryFromOrders(cRows);
    const caseC = {
      summary: {
        total: Number(cSummary?.total || 0),
        open_yes: Number(cSummary?.open_yes || 0),
        open_no: Number(cSummary?.open_no || 0),
        filled_total: Number(cSummary?.filled_total || 0),
        cancelled_total: Number(cSummary?.cancelled_total || 0)
      },
      aggregated_from_orders: agg,
      pass: Number(cSummary?.total || 0) === agg.total
        && Number(cSummary?.open_yes || 0) === agg.open_yes
        && Number(cSummary?.open_no || 0) === agg.open_no
        && Number(cSummary?.filled_total || 0) === agg.filled_total
        && Number(cSummary?.cancelled_total || 0) === agg.cancelled_total
    };

    const checkKeys = [
      '035-A_reason_action_continuous_ticks',
      '035-B_place_cancel_noop_triad_consistency',
      '035-C_summary_orders_reconcile',
      '035-D_evidence_structure_complete'
    ];
    const checks = {
      '035-A_reason_action_continuous_ticks': caseA.pass,
      '035-B_place_cancel_noop_triad_consistency': caseB.pass,
      '035-C_summary_orders_reconcile': caseC.pass,
      '035-D_evidence_structure_complete': true
    };

    const passChecks = checkKeys.filter((k) => checks[k]).length;
    const failChecks = checkKeys.length - passChecks;
    const pass = failChecks === 0;
    let conclusion = 'A：观测与证据一致';
    let firstBreakLayer = null;
    if (!caseA.pass) firstBreakLayer = 'A reason 与 action 一致性层';
    else if (!caseB.pass) firstBreakLayer = 'B 三类动作对照层';
    else if (!caseC.pass) firstBreakLayer = 'C summary 与 orders 对账层';
    if (firstBreakLayer) conclusion = 'C：存在业务语义断裂';

    const standard = buildStandardResult({
      scriptName: 'truth_audit_observability_consistency_260328_035',
      taskId: args.taskId,
      sampleName: args.sampleName,
      pass,
      message: pass ? '观测与证据一致性审计通过' : '观测与证据一致性审计失败',
      firstBreakLayer,
      evidenceFile: args.output,
      summary: {
        conclusion,
        total_checks: checkKeys.length,
        pass_checks: passChecks,
        fail_checks: failChecks,
        checks
      },
      rawExcerpt: {
        health_root: healthRoot,
        health_pairs: healthPairs,
        runtime_unique_ticks: caseA.unique_tick_count,
        runtime_reason_preview_mismatch: caseA.mismatch_reason_vs_preview_count,
        runtime_reason_action_mismatch: caseA.mismatch_reason_vs_action_count,
        has_cancel_tick: caseA.has_cancel_tick,
        has_place_tick: caseA.has_place_tick,
        has_noop_tick: caseA.has_noop_tick,
        reconcile_pass: caseC.pass
      }
    });

    const output = {
      ...standard,
      task_id: args.taskId,
      command: `node scripts/truth_audit_observability_consistency_260328_035.mjs --task_id=${args.taskId} --sample=${args.sampleName}`,
      conclusion_block: {
        verdict: conclusion,
        first_break_layer: firstBreakLayer
      },
      key_counters: {
        total_checks: checkKeys.length,
        pass_checks: passChecks,
        fail_checks: failChecks
      },
      evidence_index: {
        healthcheck: { root: healthRoot, pairs: healthPairs },
        case_035A: caseA,
        case_035B: caseB,
        case_035C: caseC
      },
      result: checks
    };

    const caseD = {
      has_conclusion_block: !!output.conclusion_block,
      has_key_counters: !!output.key_counters,
      has_first_break_layer: Object.prototype.hasOwnProperty.call(output, 'first_break_layer'),
      has_evidence_index: !!output.evidence_index
    };
    checks['035-D_evidence_structure_complete'] = caseD.has_conclusion_block
      && caseD.has_key_counters
      && caseD.has_first_break_layer
      && caseD.has_evidence_index;
    output.result = checks;
    output.evidence_index.case_035D = caseD;
    output.summary.checks = checks;

    ensureDir(args.output);
    fs.writeFileSync(args.output, JSON.stringify(output, null, 2));
    const logPath = writeStandardLog(args.output, standard);
    console.log(`VERIFY_OUTPUT=${args.output}`);
    console.log(`VERIFY_LOG=${logPath}`);
    console.log(JSON.stringify({
      pass,
      conclusion,
      first_break_layer: firstBreakLayer,
      pass_checks: passChecks,
      fail_checks: failChecks
    }));
    if (!pass) process.exitCode = 1;
  } finally {
    await http.post('/bot/stop', {}).catch(() => null);
    if (originalConfig) await http.post('/bot/config', originalConfig).catch(() => null);
    await stopServer(server.child);
  }
};

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
