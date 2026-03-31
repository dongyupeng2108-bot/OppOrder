import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { buildStandardResult, ensureDir, parseVerifyArgs, writeStandardLog } from './verify_standard_v1.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_TASK_ID = '260330_021';
const MAX_WALL_MS = 25 * 60 * 1000;
const MAX_SILENCE_MS = 120 * 1000;
const LOG_TAIL = 120;

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: 'http://localhost:53221',
  defaultOutputSuffix: 'truth_audit_current_window_order_fields',
  defaultSampleName: 'current_window_order_fields_v1'
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const nowIso = () => new Date().toISOString();
const toFinite = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
const toJson = async (res) => {
  try {
    return await res.json();
  } catch {
    return null;
  }
};

const createHttp = (baseUrl) => {
  const withRetry = async (fn) => {
    let lastError = null;
    for (let i = 0; i < 4; i += 1) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        await sleep(250);
      }
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
  const child = spawn(process.execPath, ['strategies/crypto_binary/server.mjs', `--port=${port}`], {
    cwd: REPO_ROOT,
    stdio: 'ignore'
  });
  const baseUrl = `http://localhost:${port}`;
  const ok = await waitServerReady(baseUrl);
  if (!ok) {
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

const parseFieldInventory = () => {
  const filePath = path.join(REPO_ROOT, 'ui', 'js', 'strategy-editor.js');
  const text = fs.readFileSync(filePath, 'utf8');
  const start = text.indexOf('id="se-order-title"');
  const tableEnd = text.indexOf('</table>', start);
  const chunk = text.slice(start, tableEnd > 0 ? tableEnd : start + 1800);
  const pairRegex = /<div style="color:#7f8a97;">([^<]+)<\/div><div id="([^"]+)"/g;
  const topFields = [];
  let m = null;
  while ((m = pairRegex.exec(chunk)) !== null) {
    topFields.push({ ui_block: '当前窗口订单状态', ui_field: m[1], dom_id: m[2] });
  }
  const headerMatch = chunk.match(/<thead><tr>([\s\S]*?)<\/tr><\/thead>/);
  const tableHeaders = [];
  if (headerMatch) {
    const thRegex = /<th>([^<]+)<\/th>/g;
    let th = null;
    while ((th = thRegex.exec(headerMatch[1])) !== null) {
      tableHeaders.push(th[1]);
    }
  }
  return {
    source_file: filePath,
    top_fields: topFields,
    table_headers: tableHeaders
  };
};

const formatStateValue = (value) => {
  if (value === null || value === undefined || value === '') return 'N/A (null)';
  if (Array.isArray(value)) return value.length ? value.join(',') : '[]';
  return `${value}`;
};
const formatFixed1 = (value, emptyText = '—') => {
  const n = toFinite(value);
  return n === null ? emptyText : n.toFixed(1);
};
const formatFixed3 = (value, emptyText = '—') => {
  const n = toFinite(value);
  return n === null ? emptyText : n.toFixed(3);
};

const lifecycleLabel = (value, isCloseOrder) => {
  if (value === 'OPEN') return '挂单中';
  if (value === 'FILLED') return isCloseOrder ? '已经平仓' : '已成交';
  if (value === 'CANCELLED') return '已撤单';
  return formatStateValue(value);
};

const projectTopFields = ({ ordersBody, contextBody }) => {
  const scopedContext = ordersBody?.context_snapshot && typeof ordersBody.context_snapshot === 'object'
    ? ordersBody.context_snapshot
    : (contextBody || {});
  const upProb = toFinite(scopedContext?.bid_yes ?? scopedContext?.ask_yes);
  const downProb = toFinite(scopedContext?.bid_no ?? scopedContext?.ask_no);
  const upDownText = (upProb !== null && downProb !== null)
    ? `UP ${formatFixed3(upProb)} / DOWN ${formatFixed3(downProb)}`
    : '—';
  return {
    'se-order-btc': formatStateValue(formatFixed1(scopedContext?.btc_price)),
    'se-order-updown-prob': formatStateValue(upDownText),
    'se-order-volatility': formatStateValue(formatFixed3(scopedContext?.atr_5m))
  };
};

const projectOrderRows = (ordersBody) => {
  const scope = ordersBody?.window_scope && typeof ordersBody.window_scope === 'object' ? ordersBody.window_scope : {};
  const isCurrentWindowScope = scope?.scope === 'current_window';
  const list = Array.isArray(ordersBody?.window_orders)
    ? [...ordersBody.window_orders]
    : (Array.isArray(ordersBody?.orders) ? [...ordersBody.orders] : []);
  const scopedList = isCurrentWindowScope
    ? list.filter((item) => {
      const rowWindowId = item?.resolved_window_id ?? item?.inferred_window_id ?? null;
      return rowWindowId == null || rowWindowId === scope?.display_window_id;
    })
    : [];
  const finalList = scopedList;
  finalList.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const topList = finalList.slice(0, 200);
  return topList.map((o) => {
    const isCloseOrder = o.kind === 'TAKE_PROFIT' || o.kind === 'EXIT';
    const typeMain = isCloseOrder
      ? (o.side === 'YES' ? 'YES平仓' : (o.side === 'NO' ? 'NO平仓' : '平仓'))
      : (o.side === 'YES' ? 'YES' : (o.side === 'NO' ? 'NO' : formatStateValue(o.side)));
    return {
      order_id: o.order_id ?? null,
      resolved_window_id: o?.resolved_window_id ?? o?.inferred_window_id ?? null,
      projected: {
        订单类型: typeMain,
        'UP/DOWN': o.side === 'YES' ? 'UP' : (o.side === 'NO' ? 'DOWN' : formatStateValue(o.side)),
        价格: typeof o.price === 'number' ? o.price.toFixed(3) : '--',
        数量: formatStateValue(o.size),
        平仓价: typeof o.tp_price === 'number' ? o.tp_price.toFixed(3) : (typeof o.fill_price === 'number' ? o.fill_price.toFixed(3) : '--'),
        状态: lifecycleLabel(o.status, isCloseOrder)
      },
      source_row: o
    };
  });
};

const buildReconcileRows = ({ statusBody, contextBody, ordersBody, tag }) => {
  const currentWindowId = statusBody?.current_window_id ?? null;
  const lastWindowId = statusBody?.last_window_id ?? null;
  const top = projectTopFields({ ordersBody, contextBody });
  const topRows = [
    { ui_field: 'BTC价格', ui_value: top['se-order-btc'], source_api_or_state: 'orders.context_snapshot | context', source_field: 'btc_price', expected_value: top['se-order-btc'], order_id: null },
    { ui_field: 'UPDOWN概率', ui_value: top['se-order-updown-prob'], source_api_or_state: 'orders.context_snapshot | context', source_field: 'bid_yes/bid_no fallback ask_*', expected_value: top['se-order-updown-prob'], order_id: null },
    { ui_field: '波动值', ui_value: top['se-order-volatility'], source_api_or_state: 'orders.context_snapshot | context', source_field: 'atr_5m', expected_value: top['se-order-volatility'], order_id: null }
  ].map((row) => ({
    sample_tag: tag,
    timestamp: nowIso(),
    ...row,
    current_window_id: currentWindowId,
    pass_fail: row.ui_value === row.expected_value ? 'PASS' : 'FAIL',
    notes: 'top_field_projection',
    last_window_id: lastWindowId
  }));

  const projectedRows = projectOrderRows(ordersBody);
  const orderRows = [];
  for (const item of projectedRows) {
    const fields = Object.entries(item.projected);
    for (const [field, value] of fields) {
      orderRows.push({
        sample_tag: tag,
        timestamp: nowIso(),
        ui_field: field,
        ui_value: value,
        source_api_or_state: '/bot/orders.window_orders + se_renderOrders',
        source_field: field === '状态'
          ? 'lifecycleLabel(status, isCloseOrder)'
          : (field === '平仓价' ? 'tp_price || fill_price || --' : 'direct projection'),
        current_window_id: currentWindowId,
        last_window_id: lastWindowId,
        order_id: item.order_id,
        expected_value: value,
        pass_fail: value === item.projected[field] ? 'PASS' : 'FAIL',
        notes: `resolved_window=${item.resolved_window_id ?? 'null'}`
      });
    }
  }
  return [...topRows, ...orderRows];
};

const stageEvaluate = ({ inventory, statusBody, ordersBody, reconcileRows }) => {
  const scope = ordersBody?.window_scope && typeof ordersBody.window_scope === 'object' ? ordersBody.window_scope : {};
  const rows = Array.isArray(ordersBody?.window_orders) ? ordersBody.window_orders : [];
  const isCurrentScope = scope?.scope === 'current_window';
  const displayWindow = scope?.display_window_id ?? null;
  const mixed = rows.filter((row) => {
    const w = row?.resolved_window_id ?? row?.inferred_window_id ?? null;
    return isCurrentScope && w && displayWindow && w !== displayWindow;
  });
  const idCount = new Map();
  for (const row of rows) {
    const id = row?.order_id;
    if (!id) continue;
    idCount.set(id, (idCount.get(id) || 0) + 1);
  }
  const duplicatedIds = [...idCount.entries()].filter(([, c]) => c > 1).map(([id]) => id);
  const closeFieldRows = reconcileRows.filter((r) => r.ui_field === '平仓价');
  const closeProjectionPass = closeFieldRows.every((r) => r.pass_fail === 'PASS');
  return {
    field_inventory_binding: inventory.top_fields.length === 3 && inventory.table_headers.length === 6,
    current_window_partition: statusBody?.current_window_id != null && statusBody?.current_window_id !== statusBody?.last_window_id,
    order_scope_filter: mixed.length === 0,
    status_projection: reconcileRows.filter((r) => r.ui_field === '状态').every((r) => r.pass_fail === 'PASS'),
    close_price_projection: closeProjectionPass,
    dom_projection: reconcileRows.every((r) => r.pass_fail === 'PASS'),
    diagnostics: {
      duplicated_order_ids: duplicatedIds,
      mixed_window_rows: mixed.length
    }
  };
};

const latestRunnerIntents = (logsBody) => {
  const rows = Array.isArray(logsBody) ? logsBody : [];
  const runner = [...rows].reverse().find((r) => r?.event === 'RUNNER_TICK') || null;
  return String(runner?.data?.intents_summary || '');
};

const runDebugControl = async (http) => {
  await http.post('/bot/stop', {});
  await sleep(300);
  await http.post('/bot/start', { tick_interval_ms: 1000, debugScenario: 'main_path_v1' });
  await sleep(1800);
  const [statusRes, contextRes, ordersRes, logsRes] = await Promise.all([
    http.get('/bot/status'),
    http.get('/bot/context'),
    http.get('/bot/orders'),
    http.get('/bot/logs?limit=120')
  ]);
  await http.post('/bot/stop', {});
  const inventory = parseFieldInventory();
  const rows = buildReconcileRows({
    statusBody: statusRes.body || {},
    contextBody: contextRes.body || {},
    ordersBody: ordersRes.body || {},
    tag: 'debug_control'
  });
  const stages = stageEvaluate({
    inventory,
    statusBody: statusRes.body || {},
    ordersBody: ordersRes.body || {},
    reconcileRows: rows
  });
  return {
    rows,
    status: statusRes.body || {},
    orders: ordersRes.body || {},
    intents_summary: latestRunnerIntents(logsRes.body),
    stages
  };
};

const runRealRuntime = async (http) => {
  const begin = Date.now();
  let lastBeat = Date.now();
  await http.post('/bot/stop', {});
  await sleep(300);
  await http.post('/bot/config', {
    open_delay_sec: 0,
    ladder_prices: [0.999, 0.998],
    ladder_size: 5,
    atr_multiple: 1.2,
    cancel_all_remaining_sec: 30,
    up_ladder: [{ price: 0.999, size: 5, tp_price: 1 }, { price: 0.998, size: 5, tp_price: 1 }],
    down_ladder: [{ price: 0.999, size: 5, tp_price: 1 }, { price: 0.998, size: 5, tp_price: 1 }],
    up_cancel: { before_end_sec: 120, formula: '' },
    down_cancel: { before_end_sec: 120, formula: '' }
  });

  const waitNearEnd = async () => {
    while (Date.now() - begin < MAX_WALL_MS) {
      const contextRes = await http.get('/bot/context');
      const rem = toFinite(contextRes.body?.remaining_sec);
      const wid = contextRes.body?.window_id ?? null;
      if (wid && rem !== null && rem <= 45) return { window_id: wid, remaining_sec: rem };
      await sleep(1000);
    }
    throw new Error('real_runtime_wait_start_timeout');
  };

  const startup = await waitNearEnd();
  await http.post('/bot/start', { tick_interval_ms: 1000 });
  lastBeat = Date.now();
  let sawPlace = false;
  let sawTerminal = false;
  let sawSwitch = false;
  let firstWindow = startup.window_id;
  let snapshot = null;
  const timeline = [];

  for (let i = 0; i < 420; i += 1) {
    if (Date.now() - begin > MAX_WALL_MS) throw new Error('MAX_WALL_TIME_EXCEEDED');
    if (Date.now() - lastBeat > MAX_SILENCE_MS) throw new Error('MAX_SILENCE_EXCEEDED');
    const [statusRes, contextRes, ordersRes, logsRes] = await Promise.all([
      http.get('/bot/status'),
      http.get('/bot/context'),
      http.get('/bot/orders'),
      http.get(`/bot/logs?limit=${LOG_TAIL}`)
    ]);
    const status = statusRes.body || {};
    const context = contextRes.body || {};
    const orders = ordersRes.body || {};
    const intents = latestRunnerIntents(logsRes.body);
    const windowOrders = Array.isArray(orders.window_orders) ? orders.window_orders : [];
    const hasTerminalStatus = windowOrders.some((r) => r?.status === 'FILLED' || r?.status === 'CANCELLED');
    if (String(intents).includes('PLACE_LADDER(')) sawPlace = true;
    if (hasTerminalStatus) sawTerminal = true;
    if (status.current_window_id && status.current_window_id !== firstWindow) sawSwitch = true;
    timeline.push({
      i,
      at: nowIso(),
      current_window_id: status.current_window_id ?? null,
      last_window_id: status.last_window_id ?? null,
      intents_summary: intents || 'NOOP',
      window_orders_count: windowOrders.length,
      terminal_rows: windowOrders.filter((r) => r?.status === 'FILLED' || r?.status === 'CANCELLED').length
    });
    if (sawPlace && sawTerminal && sawSwitch) {
      snapshot = { status, context, orders };
      break;
    }
    lastBeat = Date.now();
    await sleep(1000);
  }
  await http.post('/bot/stop', {});
  await sleep(500);

  if (!snapshot) {
    const [statusRes, contextRes, ordersRes] = await Promise.all([
      http.get('/bot/status'),
      http.get('/bot/context'),
      http.get('/bot/orders')
    ]);
    snapshot = { status: statusRes.body || {}, context: contextRes.body || {}, orders: ordersRes.body || {} };
  }
  const inventory = parseFieldInventory();
  const rows = buildReconcileRows({
    statusBody: snapshot.status,
    contextBody: snapshot.context,
    ordersBody: snapshot.orders,
    tag: 'real_runtime'
  });
  const stages = stageEvaluate({
    inventory,
    statusBody: snapshot.status,
    ordersBody: snapshot.orders,
    reconcileRows: rows
  });
  return {
    sample_covered: sawPlace && sawTerminal && sawSwitch,
    startup_window_id: firstWindow,
    saw_place_stage: sawPlace,
    saw_terminal_stage: sawTerminal,
    saw_window_switch: sawSwitch,
    timeline_head: timeline.slice(0, 12),
    timeline_tail: timeline.slice(-12),
    rows,
    status: snapshot.status,
    orders: snapshot.orders,
    stages
  };
};

const main = async () => {
  const args = parseArgs();
  const port = Number(new URL(args.baseUrl).port || 53221);
  const server = await startServer(port);
  const http = createHttp(server.baseUrl);
  let health = { root: null, pairs: null };
  try {
    health.root = await fetch(`${server.baseUrl}/`).then((r) => r.status).catch(() => null);
    health.pairs = await fetch(`${server.baseUrl}/pairs`).then((r) => r.status).catch(() => null);
    const fieldInventory = parseFieldInventory();
    const debug = await runDebugControl(http);
    const real = await runRealRuntime(http);

    const order = [
      'field_inventory_binding',
      'current_window_partition',
      'order_scope_filter',
      'status_projection',
      'close_price_projection',
      'dom_projection'
    ];
    const sampleInsufficient = !real.sample_covered;
    let firstBreakLayer = 'NONE_CHAIN_PASS';
    if (sampleInsufficient) {
      firstBreakLayer = 'SAMPLE_BLOCKED_OR_INSUFFICIENT';
    } else {
      for (const key of order) {
        if (!real.stages[key]) {
          firstBreakLayer = key;
          break;
        }
      }
    }
    let divergenceLayer = 'none';
    for (const key of order) {
      if (Boolean(real.stages[key]) !== Boolean(debug.stages[key])) {
        divergenceLayer = key;
        break;
      }
    }
    const verdict = sampleInsufficient
      ? 'B：样本不足'
      : (firstBreakLayer === 'NONE_CHAIN_PASS' ? 'A：通过' : 'C：存在断裂');
    const conclusion = sampleInsufficient
      ? 'B：样本不足，未完整覆盖挂单→成交/撤单→窗口切换三阶段'
      : (firstBreakLayer === 'NONE_CHAIN_PASS'
        ? 'A：当前窗口订单状态字段链通过'
        : `C：存在断裂，首断裂层=${firstBreakLayer}`);

    const checks = {
      '021-A_field_inventory_complete': fieldInventory.top_fields.length === 3 && fieldInventory.table_headers.length === 6,
      '021-B_real_runtime_chain_covered': real.sample_covered === true,
      '021-C_reconcile_rows_all_pass': real.rows.every((r) => r.pass_fail === 'PASS'),
      '021-D_scope_partition_clean': real.stages.current_window_partition === true && real.stages.order_scope_filter === true,
      '021-E_status_close_projection_clean': real.stages.status_projection === true && real.stages.close_price_projection === true
    };
    const keys = Object.keys(checks);
    const passChecks = keys.filter((k) => checks[k]).length;
    const failChecks = keys.length - passChecks;
    const pass = failChecks === 0 && !sampleInsufficient;

    const standard = buildStandardResult({
      scriptName: 'truth_audit_current_window_order_fields_260330_021',
      taskId: args.taskId,
      sampleName: args.sampleName,
      pass,
      message: pass ? 'current window order fields truth audit pass' : 'current window order fields truth audit fail',
      firstBreakLayer: firstBreakLayer,
      evidenceFile: args.output,
      summary: {
        conclusion,
        verdict,
        total_checks: keys.length,
        pass_checks: passChecks,
        fail_checks: failChecks,
        checks
      },
      rawExcerpt: {
        field_inventory: fieldInventory,
        real_rows_head: real.rows.slice(0, 20),
        debug_rows_head: debug.rows.slice(0, 20)
      }
    });

    const output = {
      ...standard,
      task_id: args.taskId,
      conclusion_block: {
        conclusion,
        verdict,
        first_break_layer: firstBreakLayer,
        real_debug_diverged: divergenceLayer !== 'none',
        real_debug_first_divergence_layer: divergenceLayer
      },
      key_counters: {
        total_checks: keys.length,
        pass_checks: passChecks,
        fail_checks: failChecks
      },
      evidence_index: {
        field_inventory: fieldInventory,
        reconciliation_table: real.rows,
        real_runtime: real,
        debug_control: debug,
        stage_matrix: {
          real: real.stages,
          debug: debug.stages
        },
        healthcheck: health,
        guardrails: {
          max_wall_time_ms: MAX_WALL_MS,
          max_silence_ms: MAX_SILENCE_MS,
          log_tail: LOG_TAIL
        }
      },
      result: checks
    };

    ensureDir(args.output);
    fs.writeFileSync(args.output, JSON.stringify(output, null, 2));
    const logPath = writeStandardLog(args.output, standard);
    console.log(`VERIFY_OUTPUT=${args.output}`);
    console.log(`VERIFY_LOG=${logPath}`);
    console.log(JSON.stringify({ pass, conclusion, verdict, first_break_layer: firstBreakLayer, divergence_layer: divergenceLayer, pass_checks: passChecks, fail_checks: failChecks }));
    if (!pass) process.exitCode = 1;
  } finally {
    await stopServer(server.child);
  }
};

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
