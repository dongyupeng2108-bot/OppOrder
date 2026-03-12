// backtest_pull_klines.mjs
// 拉取最近 90 天 BTC/USDT 1 分钟 K 线数据
// 用法: node scripts/backtest_pull_klines.mjs

import { ProxyAgent, setGlobalDispatcher } from 'undici';
if (process.env.HTTPS_PROXY || process.env.HTTP_PROXY) {
  const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
  setGlobalDispatcher(new ProxyAgent(proxyUrl));
  console.log(`[proxy] Using proxy: ${proxyUrl}`);
}

import { createReadStream, createWriteStream, existsSync, statSync } from 'fs';
import { mkdir, appendFile, writeFile } from 'fs/promises';
import { createInterface } from 'readline';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const OUT_DIR  = path.join(PROJECT_ROOT, 'data', 'backtest');
const OUT_FILE = path.join(OUT_DIR, 'binance_klines_1m_90d.csv');

const BINANCE_API = 'https://api.binance.com/api/v3/klines';
const SYMBOL      = 'BTCUSDT';
const INTERVAL    = '1m';
const LIMIT       = 1000;
const SLEEP_MS    = 200;
const DAYS_90_MS  = 90 * 24 * 60 * 60 * 1000;

const CSV_HEADER = 'open_time,open,high,low,close,volume,close_time';

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Read the close_time of the last row to resume
async function getLastCloseTime() {
  if (!existsSync(OUT_FILE)) return null;
  let lastLine = '';
  const rl = createInterface({ input: createReadStream(OUT_FILE), crlfDelay: Infinity });
  for await (const line of rl) {
    if (line && line !== CSV_HEADER) lastLine = line;
  }
  if (!lastLine) return null;
  const parts = lastLine.split(',');
  // close_time is the 7th column (index 6)
  const closeTimeIso = parts[6];
  if (!closeTimeIso) return null;
  return new Date(closeTimeIso).getTime();
}

async function fetchKlines(startTime, endTime) {
  const url = `${BINANCE_API}?symbol=${SYMBOL}&interval=${INTERVAL}&startTime=${startTime}&endTime=${endTime}&limit=${LIMIT}`;
  const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function klineToRow(k) {
  // Binance kline: [openTime, open, high, low, close, volume, closeTime, ...]
  const openTime  = new Date(k[0]).toISOString();
  const open      = k[1];
  const high      = k[2];
  const low       = k[3];
  const close     = k[4];
  const volume    = k[5];
  const closeTime = new Date(k[6]).toISOString();
  return `${openTime},${open},${high},${low},${close},${volume},${closeTime}`;
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const now = Date.now();
  const start90d = now - DAYS_90_MS;

  let resumeFrom = null;
  const isResume = existsSync(OUT_FILE);

  if (isResume) {
    const lastClose = await getLastCloseTime();
    if (lastClose) {
      resumeFrom = lastClose + 1; // start from next minute
      console.log(`[klines] Resuming from ${new Date(resumeFrom).toISOString()}`);
    }
  }

  if (!isResume) {
    await writeFile(OUT_FILE, CSV_HEADER + '\n', 'utf8');
  }

  let startTime = resumeFrom || start90d;
  const endTime = now;

  if (startTime >= endTime) {
    console.log('[klines] Already up to date, nothing to fetch.');
    return;
  }

  let totalRows = 0;
  let batchCount = 0;
  let firstTs = null;
  let lastTs = null;

  console.log(`[klines] Fetching ${SYMBOL} 1m klines from ${new Date(startTime).toISOString()} to ${new Date(endTime).toISOString()}`);

  while (startTime < endTime) {
    const batchEnd = Math.min(startTime + LIMIT * 60 * 1000, endTime);
    let data;
    try {
      data = await fetchKlines(startTime, batchEnd);
    } catch (err) {
      console.error(`[klines] fetch error at ${new Date(startTime).toISOString()}: ${err.message}`);
      // retry once after delay
      await sleep(2000);
      try {
        data = await fetchKlines(startTime, batchEnd);
      } catch (err2) {
        console.error(`[klines] retry failed: ${err2.message}, skipping batch`);
        startTime = batchEnd + 1;
        continue;
      }
    }

    if (!Array.isArray(data) || data.length === 0) break;

    const rows = data.map(klineToRow);
    await appendFile(OUT_FILE, rows.join('\n') + '\n', 'utf8');

    totalRows += rows.length;
    batchCount++;
    if (!firstTs) firstTs = data[0][0];
    lastTs = data[data.length - 1][6];

    // Next batch starts after last closeTime
    startTime = data[data.length - 1][6] + 1;

    if (batchCount % 10 === 0) {
      console.log(`[klines] batch ${batchCount}: ${totalRows} rows so far, up to ${new Date(lastTs).toISOString()}`);
    }

    await sleep(SLEEP_MS);
    if (data.length < LIMIT) break;
  }

  const fileSize = existsSync(OUT_FILE) ? (statSync(OUT_FILE).size / 1024 / 1024).toFixed(2) : '?';

  console.log('\n=== SUMMARY ===');
  console.log(`Total rows fetched : ${totalRows}`);
  console.log(`Time span          : ${firstTs ? new Date(firstTs).toISOString() : 'n/a'} → ${lastTs ? new Date(lastTs).toISOString() : 'n/a'}`);
  console.log(`File size          : ${fileSize} MB`);
  console.log(`Output             : ${OUT_FILE}`);
}

main().catch(err => { console.error('[klines] Fatal:', err); process.exit(1); });
