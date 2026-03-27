/**
 * Task2（source chain）：轮询 GET /bot/context，摘录 `_btc_source_trace`（含 price_resolution / atr_resolution），写 JSONL。
 * 不改业务语义；仅 RUNTIME 证据采集。
 *
 * 用法：
 *   node scripts/collect_source_chain_runtime.mjs [--base_url=http://localhost:53123] [--ticks=8] [--interval_ms=600] [--out=path]
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
    ticks: Math.max(1, parseInt(raw.ticks || '8', 10) || 8),
    intervalMs: Math.max(200, parseInt(raw.interval_ms || '600', 10) || 600),
    out: raw.out || null
  };
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const main = async () => {
  const args = parseArgs();
  const outDir = path.join(REPO_ROOT, 'data', 'crypto_binary', 'runtime_samples');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outFile = args.out || path.join(outDir, `source_chain_${Date.now()}.jsonl`);

  for (let i = 0; i < args.ticks; i += 1) {
    const res = await fetch(`${args.baseUrl}/bot/context`);
    const text = await res.text();
    let body = {};
    try {
      body = JSON.parse(text);
    } catch {
      body = { _parse_error: true };
    }
    const row = {
      ts: new Date().toISOString(),
      tick_index: i,
      http_status: res.status,
      btc_price: body?.btc_price ?? null,
      trace: body?._btc_source_trace ?? null
    };
    fs.appendFileSync(outFile, `${JSON.stringify(row)}\n`);
    if (i < args.ticks - 1) await sleep(args.intervalMs);
  }

  console.log(`collect_source_chain_runtime: wrote ${args.ticks} lines to ${path.relative(REPO_ROOT, outFile)}`);
  console.log(JSON.stringify({ ok: true, outFile: path.relative(REPO_ROOT, outFile) }));
};

main().catch((e) => {
  console.error('collect_source_chain_runtime: FAIL', e.message);
  process.exit(1);
});
