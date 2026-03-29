import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { spawn, spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { buildStandardResult, ensureDir, parseVerifyArgs, writeStandardLog } from './verify_standard_v1.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_TASK_ID = '260329_005';

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: 'http://localhost:53160',
  defaultOutputSuffix: 'truth_audit_tp1_save_and_close_price_table',
  defaultSampleName: 'tp1_save_backfill_and_close_price_display_v1'
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

const waitServerReady = async (baseUrl, timeoutMs = 45000) => {
  const begin = Date.now();
  while (Date.now() - begin < timeoutMs) {
    try {
      const res = await fetch(`${baseUrl}/`);
      if (res.status === 200) return true;
    } catch {}
    await sleep(300);
  }
  return false;
};

const startServer = async (port) => {
  const baseUrl = `http://localhost:${port}`;
  const child = spawn('node', ['strategies/crypto_binary/server.mjs', `--port=${port}`], {
    cwd: REPO_ROOT,
    stdio: 'ignore',
    detached: false
  });
  const ready = await waitServerReady(baseUrl);
  if (!ready) {
    child.kill();
    return null;
  }
  return { child, baseUrl, port };
};

const stopServer = async (child) => {
  if (!child || child.killed) return;
  child.kill();
  await sleep(700);
};

const rowsEq = (a = [], b = []) => {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i] || {};
    const y = b[i] || {};
    if (Number(x.price) !== Number(y.price)) return false;
    if (Number(x.size) !== Number(y.size)) return false;
    if (Number(x.tp_price) !== Number(y.tp_price)) return false;
  }
  return true;
};

const getPreFixFacts = () => {
  const prevUi = spawnSync('git', ['show', 'HEAD~1:ui/js/strategy-editor.js'], { cwd: REPO_ROOT, encoding: 'utf8' }).stdout || '';
  const prevServer = spawnSync('git', ['show', 'HEAD~1:strategies/crypto_binary/server.mjs'], { cwd: REPO_ROOT, encoding: 'utf8' }).stdout || '';
  return {
    unique_first_break_layer: 'server 校验/归一化层',
    header_was_pnl: prevUi.includes('<th>PnL</th>'),
    add_row_default_tp_not_1: prevUi.includes("tp_price: 0.2"),
    server_silent_drop_filter: prevServer.includes('}).filter(Boolean);'),
    server_silent_fallback_legacy: prevServer.includes('const resolvedUpLadder = upLadder || legacyLadder;')
      && prevServer.includes('const resolvedDownLadder = downLadder || legacyLadder;')
  };
};

const extractFunctionSource = (text, fnName) => {
  const start = text.indexOf(`function ${fnName}(`);
  if (start < 0) return null;
  let idx = text.indexOf('{', start);
  if (idx < 0) return null;
  let depth = 0;
  for (let i = idx; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '{') depth += 1;
    if (ch === '}') depth -= 1;
    if (depth === 0) return text.slice(start, i + 1);
  }
  return null;
};

const inspectUiAddRowDefault = () => {
  const uiPath = path.join(REPO_ROOT, 'ui', 'js', 'strategy-editor.js');
  const uiText = fs.readFileSync(uiPath, 'utf8');
  const fnSource = extractFunctionSource(uiText, 'se_addLadderRow');
  if (!fnSource) return { ok: false };
  const sandbox = {
    _seParamDraft: { up_ladder: [{ price: 0.3, size: 2, tp_price: 0.5 }] },
    _seParamActiveTab: 'up',
    se_syncActiveTabFromForm: () => {},
    se_renderActiveTabPanel: () => {}
  };
  vm.createContext(sandbox);
  vm.runInContext(`${fnSource}; globalThis.run = se_addLadderRow;`, sandbox);
  sandbox.run();
  const rows = sandbox._seParamDraft?.up_ladder || [];
  const last = rows[rows.length - 1] || null;
  return {
    ok: true,
    last_row: last
  };
};

const runTpLt1BindingCase = async (http) => {
  await http.post('/bot/stop', {});
  await http.post('/bot/config', {
    open_delay_sec: 0,
    ladder_prices: [0.27],
    ladder_size: 2,
    atr_multiple: 1.2,
    cancel_all_remaining_sec: 0,
    up_ladder: [{ price: 0.99, size: 2, tp_price: 0.97 }],
    down_ladder: [{ price: 0.01, size: 2, tp_price: 0.02 }],
    up_cancel: { before_end_sec: 0, formula: 'false' },
    down_cancel: { before_end_sec: 0, formula: 'false' }
  });
  await http.post('/bot/paper/apply-action', { action: 'CANCEL_ALL_OPEN' });
  await http.post('/bot/runner/tick', {
    state_override: {
      current_window_id: 'audit-260329005-tp097',
      window_initialized_at: new Date(Date.now() - 5000).toISOString(),
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
    },
    context_override: {
      window_id: 'audit-260329005-tp097',
      period: '5m',
      remaining_sec: 220,
      btc_price: 65000,
      atr_5m: 90,
      ask_yes: 0.27,
      bid_yes: 0.26,
      ask_no: 0.58,
      bid_no: 0.57,
      upper_bound: 70000,
      lower_bound: 60000
    }
  });
  const orders = await http.get('/bot/orders');
  const rows = Array.isArray(orders?.body?.all_orders)
    ? orders.body.all_orders
    : (Array.isArray(orders?.body?.orders) ? orders.body.orders : []);
  const filledEntry = rows.find((r) => r?.kind === 'ENTRY' && r?.status === 'FILLED' && r?.side === 'YES' && Number(r?.tp_price) < 1);
  const linkedTp = filledEntry
    ? rows.find((r) => r?.kind === 'TAKE_PROFIT' && r?.parent_order_id === filledEntry.order_id)
    : null;
  return {
    filled_entry: filledEntry || null,
    linked_tp: linkedTp || null
  };
};

const main = async () => {
  const args = parseArgs();
  const preFix = getPreFixFacts();
  const uiInspect = inspectUiAddRowDefault();
  const uiPath = path.join(REPO_ROOT, 'ui', 'js', 'strategy-editor.js');
  const uiText = fs.readFileSync(uiPath, 'utf8');

  const server = await startServer(53160);
  if (!server) throw new Error('server boot failed for 260329_005');
  const http = createHttp(server.baseUrl);
  try {
    const healthRoot = await fetch(`${server.baseUrl}/`).then((r) => r.status).catch(() => null);
    let healthPairs = null;
    try {
      healthPairs = await fetch(`${server.baseUrl}/pairs`).then((r) => r.status);
    } catch {
      healthPairs = 'ERR';
    }

    const savePayload = {
      open_delay_sec: 0,
      ladder_prices: [0.31, 0.27, 0.24],
      ladder_size: 5,
      atr_multiple: 1.2,
      cancel_all_remaining_sec: 0,
      up_ladder: [
        { price: 0.31, size: 2, tp_price: 1 },
        { price: 0.27, size: 2, tp_price: 0.97 },
        { price: 0.24, size: 1, tp_price: 1 }
      ],
      down_ladder: [
        { price: 0.03, size: 3, tp_price: 1 },
        { price: 0.02, size: 1, tp_price: 0.04 }
      ],
      up_cancel: { before_end_sec: 0, formula: 'false' },
      down_cancel: { before_end_sec: 0, formula: 'false' }
    };

    await http.post('/bot/stop', {});
    const saveResp = await http.post('/bot/config', savePayload);
    const getAfterSave = await http.get('/bot/config');
    const afterSaveCfg = getAfterSave?.body?.current || {};
    const saveFact = {
      save_http: saveResp.status,
      save_ok: saveResp?.body?.ok === true,
      up_len_expected: savePayload.up_ladder.length,
      up_len_actual: (afterSaveCfg?.up_ladder || []).length,
      down_len_expected: savePayload.down_ladder.length,
      down_len_actual: (afterSaveCfg?.down_ladder || []).length,
      up_rows_preserved: rowsEq(afterSaveCfg?.up_ladder || [], savePayload.up_ladder),
      down_rows_preserved: rowsEq(afterSaveCfg?.down_ladder || [], savePayload.down_ladder)
    };

    await stopServer(server.child);
    const restarted = await startServer(53160);
    if (!restarted) throw new Error('server restart failed for backfill verify');
    server.child = restarted.child;
    const http2 = createHttp(restarted.baseUrl);
    const getAfterReload = await http2.get('/bot/config');
    const reloadedCfg = getAfterReload?.body?.current || {};
    const reloadFact = {
      up_rows_preserved_after_reload: rowsEq(reloadedCfg?.up_ladder || [], savePayload.up_ladder),
      down_rows_preserved_after_reload: rowsEq(reloadedCfg?.down_ladder || [], savePayload.down_ladder),
      up_len_after_reload: (reloadedCfg?.up_ladder || []).length,
      down_len_after_reload: (reloadedCfg?.down_ladder || []).length
    };

    const tpLt1Fact = await runTpLt1BindingCase(http2);
    await http2.post('/bot/stop', {});

    const checks = {
      '005-A_pre_fix_break_layer_server_normalize': preFix.server_silent_drop_filter && preFix.server_silent_fallback_legacy,
      '005-B_tp1_save_keeps_all_rows': saveFact.save_http === 200
        && saveFact.save_ok
        && saveFact.up_rows_preserved
        && saveFact.down_rows_preserved,
      '005-C_reload_backfill_keeps_all_rows': reloadFact.up_rows_preserved_after_reload && reloadFact.down_rows_preserved_after_reload,
      '005-D_new_row_default_tp_is_1': uiInspect.ok && Number(uiInspect?.last_row?.tp_price) === 1,
      '005-E_order_table_header_and_cell_close_price': uiText.includes('<th>平仓价</th>')
        && uiText.includes('tp:')
        && !uiText.includes('<th>PnL</th>'),
      '005-F_tplt1_binding_still_works': Boolean(tpLt1Fact?.filled_entry && tpLt1Fact?.linked_tp)
        && Number(tpLt1Fact?.filled_entry?.tp_price || 0) < 1
        && Number(tpLt1Fact?.linked_tp?.price || 0) < 1
    };

    const checkKeys = Object.keys(checks);
    const passChecks = checkKeys.filter((k) => checks[k]).length;
    const failChecks = checkKeys.length - passChecks;
    const pass = failChecks === 0;
    const conclusion = pass ? 'A：tp_price=1 保存与回填、平仓价展示已收口' : 'C：存在业务语义断裂';
    const firstBreakLayer = pass ? null : 'server 校验/归一化层';

    const standard = buildStandardResult({
      scriptName: 'truth_audit_tp1_save_and_close_price_table_260329_005',
      taskId: args.taskId,
      sampleName: args.sampleName,
      pass,
      message: pass ? 'tp_price=1 保存链与平仓价展示修复通过' : 'tp_price=1 保存链与平仓价展示修复失败',
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
        unique_first_break_layer: preFix.unique_first_break_layer,
        save_preserve_rows: saveFact.up_rows_preserved && saveFact.down_rows_preserved,
        reload_preserve_rows: reloadFact.up_rows_preserved_after_reload && reloadFact.down_rows_preserved_after_reload,
        add_row_default_tp: uiInspect?.last_row?.tp_price ?? null,
        header_close_price: uiText.includes('<th>平仓价</th>'),
        tp_lt1_linked_tp: tpLt1Fact?.linked_tp || null,
        health_root: healthRoot,
        health_pairs: healthPairs
      }
    });

    const output = {
      ...standard,
      task_id: args.taskId,
      command: `node scripts/truth_audit_tp1_save_and_close_price_table_260329_005.mjs --task_id=${args.taskId} --sample=${args.sampleName}`,
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
        pre_fix_fact: preFix,
        post_fix_save_fact: saveFact,
        post_fix_reload_fact: reloadFact,
        post_fix_ui_default_fact: uiInspect,
        post_fix_table_display_fact: {
          header_close_price: uiText.includes('<th>平仓价</th>'),
          cell_has_tp_subline: uiText.includes('tp:'),
          old_header_removed: !uiText.includes('<th>PnL</th>')
        },
        post_fix_tplt1_fact: tpLt1Fact,
        healthcheck: { root: healthRoot, pairs: healthPairs }
      },
      result: checks
    };

    ensureDir(args.output);
    fs.writeFileSync(args.output, JSON.stringify(output, null, 2));
    const logPath = writeStandardLog(args.output, standard);
    console.log(`VERIFY_OUTPUT=${args.output}`);
    console.log(`VERIFY_LOG=${logPath}`);
    console.log(JSON.stringify({ pass, conclusion, first_break_layer: firstBreakLayer, pass_checks: passChecks, fail_checks: failChecks }));
    if (!pass) process.exitCode = 1;
  } finally {
    await stopServer(server.child);
  }
};

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
