// backtest_pull_trades.mjs
// 拉取最近 90 天 Polymarket BTC Up/Down 逐笔成交数据
// 用法: node scripts/backtest_pull_trades.mjs

import { ProxyAgent, setGlobalDispatcher } from 'undici';
if (process.env.HTTPS_PROXY || process.env.HTTP_PROXY) {
  const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
  setGlobalDispatcher(new ProxyAgent(proxyUrl));
  console.log(`[proxy] Using proxy: ${proxyUrl}`);
}

import { createReadStream, createWriteStream, existsSync, appendFileSync, writeFileSync } from 'fs';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { createInterface } from 'readline';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const OUT_DIR      = path.join(PROJECT_ROOT, 'data', 'backtest');
const TRADES_CSV   = path.join(OUT_DIR, 'pm_trades_90d.csv');
const MARKETS_INDEX = path.join(OUT_DIR, 'markets_index.json');
const ERRORS_LOG   = path.join(OUT_DIR, 'pull_errors.log');

const GAMMA_API = 'https://gamma-api.polymarket.com';
const CLOB_API  = 'https://clob.polymarket.com';
const DAYS_90_MS = 90 * 24 * 60 * 60 * 1000;
const SLEEP_MS   = 50;
const RETRY_DELAYS = [1000, 2000, 4000];

const CSV_HEADER = 'market_slug,window_end_ts,period,token_side,trade_ts,price,size,outcome';

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchWithRetry(url, attempt = 0) {
  try {
    const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) {
      if (res.status === 429 && attempt < 3) {
        await sleep(RETRY_DELAYS[attempt] || 4000);
        return fetchWithRetry(url, attempt + 1);
      }
      throw new Error(`HTTP ${res.status} for ${url}`);
    }
    return res.json();
  } catch (err) {
    if (attempt < RETRY_DELAYS.length) {
      await sleep(RETRY_DELAYS[attempt]);
      return fetchWithRetry(url, attempt + 1);
    }
    throw err;
  }
}

function detectPeriod(question) {
  if (!question) return '15m';
  // Match "6:45AM-6:50AM" style (5-min window) vs "6:45AM-7:00AM" (15-min)
  const m = question.match(/(\d+):(\d+)[AP]M[- ]*(?:ET)?[- ]*(\d+):(\d+)[AP]M/i);
  if (m) {
    const startMin = parseInt(m[1]) * 60 + parseInt(m[2]);
    const endMin   = parseInt(m[3]) * 60 + parseInt(m[4]);
    const diff = Math.abs(endMin - startMin);
    if (diff <= 5) return '5m';
    if (diff <= 15) return '15m';
  }
  const q = question.toLowerCase();
  if (q.includes('5-minute') || q.includes('5 minute') || q.includes(' 5m')) return '5m';
  return '15m';
}

function marketSlug(market) {
  return market.slug || (market.conditionId || market.condition_id || '').substring(0, 16);
}

function isBtcUpDown(market) {
  const q = (market.question || '').toLowerCase();
  return q.includes('bitcoin') && q.includes('up or down');
}

// Load already-completed market slugs from existing CSV
async function loadCompletedSlugs() {
  const done = new Set();
  if (!existsSync(TRADES_CSV)) return done;
  const rl = createInterface({ input: createReadStream(TRADES_CSV), crlfDelay: Infinity });
  for await (const line of rl) {
    const parts = line.split(',');
    if (parts.length > 0 && parts[0] !== 'market_slug') done.add(parts[0]);
  }
  return done;
}

// Fetch all matching markets from Gamma API
// Sorted by id DESC (newest first), stop when all on page are older than 90d
async function fetchMarkets() {
  const cutoff = new Date(Date.now() - DAYS_90_MS).toISOString();
  const markets = [];
  const seenConditionIds = new Set();
  let offset = 0;
  let pageCount = 0;

  console.log(`[markets] Cutoff: ${cutoff}`);

  while (true) {
    const url = `${GAMMA_API}/markets?order=id&ascending=false&limit=100&offset=${offset}`;
    let page;
    try {
      page = await fetchWithRetry(url);
    } catch (err) {
      console.error(`[markets] fetch error at offset=${offset}: ${err.message}`);
      break;
    }
    if (!Array.isArray(page) || page.length === 0) break;

    pageCount++;
    let allOlderThanCutoff = true;

    for (const m of page) {
      const endDate = m.endDate || '';
      if (endDate >= cutoff) allOlderThanCutoff = false;

      if (!isBtcUpDown(m)) continue;
      if (endDate && endDate < cutoff) continue;

      const condId = m.conditionId || m.condition_id || '';
      if (seenConditionIds.has(condId)) continue;
      seenConditionIds.add(condId);

      const tokens = Array.isArray(m.tokens) ? m.tokens : [];
      // Try clobTokenIds if tokens is empty
      let tokenList = tokens;
      if (tokenList.length === 0 && m.clobTokenIds) {
        try {
          const ids = JSON.parse(m.clobTokenIds);
          // outcomes: usually ["Yes","No"] or ["UP","DOWN"]
          const outcomes = m.outcomes ? JSON.parse(m.outcomes) : ['UP', 'DOWN'];
          tokenList = ids.map((id, i) => ({ token_id: id, side: outcomes[i] || `TOKEN_${i}` }));
        } catch (_) {}
      }

      markets.push({
        condition_id: condId,
        slug: marketSlug(m),
        question: m.question || '',
        endDate,
        period: detectPeriod(m.question),
        outcome: m.outcomePrices || 'pending',
        tokens: tokenList.map(t => ({ token_id: t.token_id, side: (t.side || t.outcome || 'UNKNOWN').toUpperCase() })),
      });
    }

    if (pageCount % 50 === 0) {
      console.log(`[markets] page ${pageCount} (offset ${offset}): found ${markets.length} BTC markets so far`);
    }

    // Stop if every market on this page is older than cutoff
    if (allOlderThanCutoff) {
      console.log(`[markets] All markets on page ${pageCount} older than cutoff. Stopping.`);
      break;
    }

    offset += 100;
    await sleep(SLEEP_MS);
    if (page.length < 100) break;
  }

  return markets;
}

// Fetch all trades for a single token
async function fetchTrades(tokenId) {
  const trades = [];
  let cursor = null;
  while (true) {
    let url = `${CLOB_API}/trades?asset_id=${tokenId}&limit=500`;
    if (cursor) url += `&cursor=${encodeURIComponent(cursor)}`;
    let data;
    try {
      data = await fetchWithRetry(url);
    } catch (err) {
      throw err;
    }
    const batch = Array.isArray(data) ? data : (data.data || []);
    trades.push(...batch);
    cursor = data.next_cursor || null;
    if (!cursor || batch.length === 0) break;
    await sleep(SLEEP_MS);
  }
  return trades;
}

function tradeToRow(market, side, trade) {
  const ts = trade.timestamp
    ? new Date(Number(trade.timestamp) * 1000).toISOString()
    : (trade.created_at || '');
  const price = trade.price ?? trade.outcome_price ?? '';
  const size  = trade.size  ?? trade.amount ?? '';
  let outcome = 'pending';
  try {
    const prices = typeof market.outcome === 'string' ? JSON.parse(market.outcome) : market.outcome;
    if (Array.isArray(prices) && prices.length === 2) {
      outcome = parseFloat(prices[0]) > parseFloat(prices[1]) ? 'YES' : 'NO';
    }
  } catch (_) {}
  return [market.slug, market.endDate, market.period, side, ts, price, size, outcome].join(',');
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  if (!existsSync(TRADES_CSV)) {
    writeFileSync(TRADES_CSV, CSV_HEADER + '\n', 'utf8');
  }

  console.log('[trades] Loading completed markets...');
  const completed = await loadCompletedSlugs();
  console.log(`[trades] Already completed: ${completed.size} markets`);

  let markets;
  if (existsSync(MARKETS_INDEX) && completed.size > 0) {
    markets = JSON.parse(await readFile(MARKETS_INDEX, 'utf8'));
    console.log(`[trades] Loaded ${markets.length} markets from index cache`);
  } else {
    console.log('[trades] Fetching market list from Gamma API (newest first)...');
    markets = await fetchMarkets();
    await writeFile(MARKETS_INDEX, JSON.stringify(markets, null, 2), 'utf8');
    console.log(`[trades] Found ${markets.length} BTC Up/Down markets, saved to index`);
  }

  const pending = markets.filter(m => !completed.has(m.slug));
  console.log(`[trades] Pending: ${pending.length} markets`);

  let totalTrades = 0;
  let count5m = 0;
  let count15m = 0;
  let minTs = Infinity;
  let maxTs = -Infinity;

  for (let i = 0; i < pending.length; i++) {
    const market = pending[i];
    let marketTradeCount = 0;
    const rows = [];

    for (const token of market.tokens) {
      const side = (token.side || 'UNKNOWN').toUpperCase();
      let trades = [];
      try {
        trades = await fetchTrades(token.token_id);
      } catch (err) {
        const msg = `[${new Date().toISOString()}] market=${market.slug} token=${token.token_id} side=${side} error: ${err.message}\n`;
        appendFileSync(ERRORS_LOG, msg, 'utf8');
        console.warn(`  ⚠ skip token ${token.token_id}: ${err.message}`);
        continue;
      }

      for (const t of trades) {
        rows.push(tradeToRow(market, side, t));
        marketTradeCount++;
        const ts = t.timestamp ? Number(t.timestamp) * 1000 : 0;
        if (ts > 0) { minTs = Math.min(minTs, ts); maxTs = Math.max(maxTs, ts); }
      }
    }

    if (rows.length > 0) {
      appendFileSync(TRADES_CSV, rows.join('\n') + '\n', 'utf8');
    }

    totalTrades += marketTradeCount;
    if (market.period === '5m') count5m++;
    else count15m++;

    if ((i + 1) % 100 === 0 || i === pending.length - 1) {
      process.stdout.write(`[${i + 1}/${pending.length}] ${market.slug.substring(0,40)} done, ${marketTradeCount} trades | total=${totalTrades}\n`);
    }
  }

  console.log('\n=== SUMMARY ===');
  console.log(`Total markets processed : ${pending.length}`);
  console.log(`Total trades            : ${totalTrades}`);
  console.log(`5m markets              : ${count5m}`);
  console.log(`15m markets             : ${count15m}`);
  if (minTs !== Infinity) {
    console.log(`Trade time span         : ${new Date(minTs).toISOString()} → ${new Date(maxTs).toISOString()}`);
  }
  console.log(`Output                  : ${TRADES_CSV}`);
}

main().catch(err => { console.error('[trades] Fatal:', err); process.exit(1); });
