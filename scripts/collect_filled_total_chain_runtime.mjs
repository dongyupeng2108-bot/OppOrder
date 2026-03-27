/**
 * Task3 / P1：在**已运行的** 53123 服务上，对 `filled_total` 真值链做一次 **GET 对账**
 *（与 `verify_executor_idempotency.mjs` 中 `captureFillPath` 表字段一致），写入 JSON。
 *
 * **严格**与 fill 场景后五端对齐：请用 `collect_filled_total_runtime_reconcile.mjs`（同源 `captureFillPath`）。
 *
 * 典型用法（二选一）：
 * 1）在 `verify_executor_idempotency.mjs` **成功结束后的同一 server 进程**上立即执行（只读快照）；
 * 2）在任意时刻对**当前** bot 状态做诊断（链可能未对齐，脚本会标明）。
 *
 * 不把本脚本 PASS 单独当业务闭环（见 VERIFY_PLAYBOOK、truth_audit_p1）。
 *
 * 用法：
 *   node scripts/collect_filled_total_chain_runtime.mjs [--base_url=http://localhost:53123] [--out=path]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

const parseArgs = () => {
  const raw = Object.fromEntries(
    process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => {
      const [k, ...rest] = a.slice(2).split('=');
      return [k, rest.join('=') || 'true'];
    })
  );
  return {
    baseUrl: raw.base_url || 'http://localhost:53123',
    out: raw.out || null
  };
};

const uniqueCount = (arr, fn) => new Set((arr || []).map(fn).filter((v) => v !== null && v !== undefined && v !== '')).size;

const fetchJson = async (baseUrl, endpoint) => {
  const res = await fetch(`${baseUrl}${endpoint}`);
  let body = {};
  try {
    body = await res.json();
  } catch {
    body = {};
  }
  return { status: res.status, body };
};

const main = async () => {
  const args = parseArgs();
  const outDir = path.join(REPO_ROOT, 'data', 'crypto_binary', 'runtime_samples');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outFile = args.out || path.join(outDir, `filled_total_chain_snapshot_${Date.now()}.json`);

  const [orders, status, postmortem, summary, performance] = await Promise.all([
    fetchJson(args.baseUrl, '/bot/orders'),
    fetchJson(args.baseUrl, '/bot/status'),
    fetchJson(args.baseUrl, '/bot/postmortem/latest'),
    fetchJson(args.baseUrl, '/bot/paper/summary'),
    fetchJson(args.baseUrl, '/bot/performance/summary?preset=today&detail=1')
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

  const perfVal = perfTarget == null ? null : Number(perfTarget.filled_total || 0);
  const chainAlignedStrict = uniqueFilled >= 1
    && table.summary_filled_total === uniqueFilled
    && table.last_run_filled_total === uniqueFilled
    && table.postmortem_filled_total === uniqueFilled
    && perfVal !== null
    && table.performance_target_window_filled_total === uniqueFilled;
  const chainAlignedLoose = table.summary_filled_total === uniqueFilled
    && table.last_run_filled_total === uniqueFilled
    && table.postmortem_filled_total === uniqueFilled
    && (perfVal === null ? table.performance_target_window_filled_total === null || table.performance_target_window_filled_total === uniqueFilled : table.performance_target_window_filled_total === uniqueFilled);

  const payload = {
    ts: new Date().toISOString(),
    base_url: args.baseUrl,
    kind: 'GET snapshot / filled_total reconcile',
    note: 'Diagnostic only. After full verify_executor_idempotency (multi-scenario), state may not match end of fill path — primary evidence is verify JSON. loose=counts match; strict=same as verify filled_total_chain_pass preconditions.',
    table,
    filled_total_chain_aligned_strict: chainAlignedStrict,
    filled_total_chain_aligned_loose: chainAlignedLoose,
    http_ok: [orders, status, postmortem, summary, performance].every((r) => r.status === 200)
  };

  fs.writeFileSync(outFile, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`collect_filled_total_chain_runtime: wrote ${path.relative(REPO_ROOT, outFile)}`);
  console.log(JSON.stringify({
    ok: true,
    filled_total_chain_aligned_strict: chainAlignedStrict,
    filled_total_chain_aligned_loose: chainAlignedLoose,
    outFile: path.relative(REPO_ROOT, outFile)
  }));
};

main().catch((e) => {
  console.error('collect_filled_total_chain_runtime: FAIL', e.message);
  process.exit(1);
});
