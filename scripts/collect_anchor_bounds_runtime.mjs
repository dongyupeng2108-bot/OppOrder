/**
 * RUNTIME 辅助：轮询 GET /bot/status + GET /bot/context，写入 JSONL，供 anchor/bounds 样本表复核。
 * 不修改 bot_runner/bot_state；仅采集证据。
 *
 * 用法：
 *   node scripts/collect_anchor_bounds_runtime.mjs [--base_url=http://localhost:53123] [--ticks=12] [--interval_ms=2000] [--out=path]
 *   [--start_bot=1] [--tick_interval_ms=2000] [--warmup_ms=3000] [--stop_after=1] [--stop_before_start=1]
 *
 * 完成类型：CODE（工具）；业务闭环需 Owner 结合真实窗口与「启动」后判定。
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

const truthy = (v) => v === '1' || v === 'true' || v === 'yes';

const parseArgs = () => {
  const raw = Object.fromEntries(
    process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => {
      const [k, ...rest] = a.slice(2).split('=');
      return [k, rest.join('=') || 'true'];
    })
  );
  return {
    baseUrl: raw.base_url || 'http://localhost:53123',
    ticks: Math.max(1, parseInt(raw.ticks || '10', 10) || 10),
    intervalMs: Math.max(200, parseInt(raw.interval_ms || '2000', 10) || 2000),
    out: raw.out || null,
    startBot: truthy(raw.start_bot),
    stopBeforeStart: truthy(raw.stop_before_start),
    stopAfter: raw.stop_after === undefined ? true : truthy(raw.stop_after),
    warmupMs: Math.max(0, parseInt(raw.warmup_ms || '0', 10) || 0),
    tickIntervalMs: Math.max(1000, Math.min(5000, parseInt(raw.tick_interval_ms || '2000', 10) || 2000))
  };
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const postJson = async (baseUrl, endpoint, payload = {}) => {
  const res = await fetch(`${baseUrl}${endpoint}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const text = await res.text();
  let body = {};
  try {
    body = JSON.parse(text);
  } catch {
    body = { _parse_error: true, raw: text.slice(0, 500) };
  }
  return { status: res.status, body };
};

const fetchJson = async (baseUrl, endpoint) => {
  const res = await fetch(`${baseUrl}${endpoint}`);
  const text = await res.text();
  let body = {};
  try {
    body = JSON.parse(text);
  } catch {
    body = { _parse_error: true, raw: text.slice(0, 500) };
  }
  return { status: res.status, body };
};

const mergeStatusBounds = (body) => {
  if (!body || typeof body !== 'object') return {};
  const ar = body.active_runtime_snapshot;
  return {
    anchor_btc: body.anchor_btc ?? ar?.anchor_btc ?? null,
    upper_bound: body.upper_bound ?? ar?.upper_bound ?? null,
    lower_bound: body.lower_bound ?? ar?.lower_bound ?? null
  };
};

const pickAnchorBounds = (status, context) => {
  const sb = mergeStatusBounds(status?.body);
  return {
    ts: new Date().toISOString(),
    status_http: status?.status,
    context_http: context?.status,
    running: status?.body?.running ?? null,
    phase: status?.body?.phase ?? null,
    current_window_id: status?.body?.current_window_id ?? null,
    window_initialized_at: status?.body?.window_initialized_at ?? null,
    anchor_btc: sb.anchor_btc,
    atr_5m: context?.body?.atr_5m ?? status?.body?.atr_5m ?? null,
    upper_bound: sb.upper_bound,
    lower_bound: sb.lower_bound,
    btc_price: context?.body?.btc_price ?? null,
    context_window_id: context?.body?.window_id ?? context?.body?.slug ?? null,
    trace: context?.body?._btc_source_trace ?? null
  };
};

const main = async () => {
  const args = parseArgs();
  const outDir = path.join(REPO_ROOT, 'data', 'crypto_binary', 'runtime_samples');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outFile = args.out || path.join(outDir, `anchor_bounds_${Date.now()}.jsonl`);

  if (args.startBot) {
    if (args.stopBeforeStart) {
      await postJson(args.baseUrl, '/bot/stop', {});
      await sleep(400);
    }
    const started = await postJson(args.baseUrl, '/bot/start', { tick_interval_ms: args.tickIntervalMs });
    if (started.status !== 200 || started.body?.ok === false) {
      console.error('collect_anchor_bounds_runtime: /bot/start failed', started.status, started.body);
      process.exit(1);
    }
    if (args.warmupMs > 0) await sleep(args.warmupMs);
  }

  for (let i = 0; i < args.ticks; i += 1) {
    const st = await fetchJson(args.baseUrl, '/bot/status');
    const ctx = await fetchJson(args.baseUrl, '/bot/context');
    const row = pickAnchorBounds(st, ctx);
    row.tick_index = i;
    fs.appendFileSync(outFile, `${JSON.stringify(row)}\n`);
    if (i < args.ticks - 1) {
      await sleep(args.intervalMs);
    }
  }

  if (args.startBot && args.stopAfter) {
    await postJson(args.baseUrl, '/bot/stop', {});
  }

  console.log(`collect_anchor_bounds_runtime: wrote ${args.ticks} lines to ${path.relative(REPO_ROOT, outFile)}`);
  console.log(JSON.stringify({
    ok: true,
    outFile: path.relative(REPO_ROOT, outFile),
    ticks: args.ticks,
    startBot: args.startBot,
    warmupMs: args.warmupMs
  }));
};

main().catch((e) => {
  console.error('collect_anchor_bounds_runtime: FAIL', e.message);
  process.exit(1);
});
