/**
 * Task3 补充：filled_total **运行态 / API 对账事实块**（单命令、可复核）
 *
 * 与 `verify_executor_idempotency.mjs` 中 `captureFillPath` **同源序列**：
 *   POST /bot/stop → POST /bot/start (debugScenario=fill_yes_path_v1) → 轮询至出现 FILLED
 *   → POST /bot/stop → 五端 GET → 校验 `filled_total` 链与 unique FILLED 数一致
 *
 * 输出：`data/crypto_binary/runtime_samples/filled_total_runtime_reconcile_<ts>.json`
 * 退出码：链对齐则 0，否则 1（事实仍写入，便于排障）
 *
 * 用法：
 *   node scripts/collect_filled_total_runtime_reconcile.mjs [--base_url=http://localhost:53123] [--spawn_server=true|false]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

const parseArgs = () => {
  const raw = Object.fromEntries(
    process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => {
      const [k, ...rest] = a.slice(2).split('=');
      return [k, rest.join('=') || 'true'];
    })
  );
  const baseUrl = raw.base_url || 'http://localhost:53123';
  const spawnServer = raw.spawn_server !== 'false';
  const out = raw.out || null;
  return { baseUrl, spawnServer, out };
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

const parsePort = (baseUrl) => {
  try {
    const u = new URL(baseUrl);
    return Number(u.port || 53123);
  } catch {
    return 53123;
  }
};

const ensureServer = async (baseUrl, spawnServer) => {
  const http = createHttp(baseUrl);
  try {
    const status = await http.get('/bot/status');
    if (status.status === 200) return { spawned: null };
  } catch {}
  if (!spawnServer) throw new Error(`server unreachable: ${baseUrl}`);
  const port = parsePort(baseUrl);
  const child = spawn('node', ['strategies/crypto_binary/server.mjs', `--port=${port}`], {
    cwd: REPO_ROOT,
    stdio: 'ignore'
  });
  for (let i = 0; i < 30; i += 1) {
    await sleep(500);
    try {
      const status = await http.get('/bot/status');
      if (status.status === 200) return { spawned: child };
    } catch {}
  }
  child.kill();
  throw new Error(`failed to boot server: ${baseUrl}`);
};

const uniqueCount = (arr, fn) => new Set((arr || []).map(fn).filter((v) => v !== null && v !== undefined && v !== '')).size;

const runFillPathReconcile = async (http) => {
  await http.post('/bot/stop', {});
  await sleep(350);
  await http.post('/bot/start', { tick_interval_ms: 1000, debugScenario: 'fill_yes_path_v1' });

  let sawFilled = false;
  for (let i = 0; i < 28; i += 1) {
    await sleep(650);
    const orders = await http.get('/bot/orders');
    const rows = orders?.body?.window_orders || [];
    if (rows.some((item) => item.status === 'FILLED')) {
      sawFilled = true;
      break;
    }
  }
  await http.post('/bot/stop', {});
  await sleep(800);

  const [orders, status, postmortem, summary, performance] = await Promise.all([
    http.get('/bot/orders'),
    http.get('/bot/status'),
    http.get('/bot/postmortem/latest'),
    http.get('/bot/paper/summary'),
    http.get('/bot/performance/summary?preset=today&detail=1')
  ]);

  const rows = orders?.body?.window_orders || [];
  const state = status?.body || {};
  const pm = postmortem?.body?.postmortem || {};
  const windowId = state?.last_run_snapshot?.current_window_id || pm?.window_id || null;
  const perfRows = performance?.body?.summary?.participating_postmortem_rows || [];
  const perfTarget = perfRows
    .filter((row) => row.window_id === windowId)
    .sort((a, b) => String(b.completed_at).localeCompare(String(a.completed_at)))[0] || null;

  const uniqueFilled = uniqueCount(rows.filter((item) => item.status === 'FILLED'), (item) => item.order_id);
  const table = {
    window_id: windowId,
    unique_filled_order_id_count: uniqueFilled,
    summary_filled_total: summary?.body?.filled_total ?? null,
    last_run_filled_total: state?.last_run_snapshot?.filled_total ?? null,
    postmortem_filled_total: pm?.filled_total ?? null,
    performance_target_window_filled_total: perfTarget ? Number(perfTarget.filled_total || 0) : null
  };

  const filledTotalChainPass = uniqueFilled >= 1
    && table.summary_filled_total === uniqueFilled
    && table.last_run_filled_total === uniqueFilled
    && table.postmortem_filled_total === uniqueFilled
    && table.performance_target_window_filled_total === uniqueFilled;

  return {
    saw_filled: sawFilled,
    table,
    filled_total_chain_pass: filledTotalChainPass,
    http_meta: {
      orders_status: orders.status,
      status_status: status.status,
      postmortem_status: postmortem.status,
      summary_status: summary.status,
      performance_status: performance.status
    }
  };
};

const main = async () => {
  const args = parseArgs();
  const http = createHttp(args.baseUrl);
  const boot = await ensureServer(args.baseUrl, args.spawnServer);
  const outDir = path.join(REPO_ROOT, 'data', 'crypto_binary', 'runtime_samples');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outFile = args.out || path.join(outDir, `filled_total_runtime_reconcile_${Date.now()}.json`);

  try {
    const result = await runFillPathReconcile(http);
    const payload = {
      ts: new Date().toISOString(),
      kind: 'filled_total_runtime_api_reconcile',
      base_url: args.baseUrl,
      scenario: 'fill_yes_path_v1_then_stop_then_GET',
      ...result
    };
    fs.writeFileSync(outFile, `${JSON.stringify(payload, null, 2)}\n`);
    const rel = path.relative(REPO_ROOT, outFile);
    console.log(`collect_filled_total_runtime_reconcile: wrote ${rel}`);
    console.log(JSON.stringify({
      ok: result.filled_total_chain_pass,
      filled_total_chain_pass: result.filled_total_chain_pass,
      saw_filled: result.saw_filled,
      outFile: rel
    }));
    if (!result.filled_total_chain_pass) process.exitCode = 1;
  } finally {
    if (boot.spawned && !boot.spawned.killed) {
      boot.spawned.kill();
    }
  }
};

main().catch((e) => {
  console.error('collect_filled_total_runtime_reconcile: FAIL', e.message);
  process.exit(1);
});
