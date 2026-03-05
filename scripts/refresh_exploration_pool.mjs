/**
 * refresh_exploration_pool.mjs
 * Re-fetch live yes_price for all markets in exploration_pool_v1_260302.json,
 * exclude settled markets (yes_price === 0 or === 1), write new pool.
 *
 * Usage: node scripts/refresh_exploration_pool.mjs
 * Proxy: HTTPS_PROXY via HttpsProxyAgent (http://127.0.0.1:51081)
 * Delay: 1s between Gamma API calls
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import nodeFetch from 'node-fetch';
import httpsProxyAgentPkg from 'https-proxy-agent';
const { HttpsProxyAgent } = httpsProxyAgentPkg;

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const PROXY_URL = 'http://127.0.0.1:51081';
const proxyAgent = new HttpsProxyAgent(PROXY_URL);
const DELAY_MS = 1000;

const INPUT  = path.join(ROOT, 'data/exploration_pool_v1_260302.json');
const OUTPUT = path.join(ROOT, 'data/exploration_pool_v1_260304.json');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchYesPrice(slug) {
  const url = `https://gamma-api.polymarket.com/markets?slug=${encodeURIComponent(slug)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  let resp;
  try {
    resp = await nodeFetch(url, { agent: proxyAgent, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = await resp.json();
  const market = Array.isArray(data) ? data[0] : data;
  if (!market || !market.outcomePrices) throw new Error('No outcomePrices');
  const prices = typeof market.outcomePrices === 'string'
    ? JSON.parse(market.outcomePrices) : market.outcomePrices;
  const yp = parseFloat(prices[0]);
  if (isNaN(yp)) throw new Error(`Invalid price: ${prices[0]}`);
  return yp;
}

async function main() {
  const pool = JSON.parse(fs.readFileSync(INPUT, 'utf8'));
  const oldMarkets = pool.markets;
  const oldCount = oldMarkets.length;
  console.log(`旧池子：${oldCount} 条`);
  console.log(`[refresh] Fetching live prices (proxy: ${PROXY_URL}, delay: ${DELAY_MS}ms)...`);

  const active = [];
  let settled = 0;
  let fetchFailed = 0;
  const t0 = Date.now();

  for (let i = 0; i < oldMarkets.length; i++) {
    const m = oldMarkets[i];
    const short = (m.question || m.slug || '').slice(0, 55);
    const tag = `[${i + 1}/${oldCount}]`;

    let yp = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        yp = await fetchYesPrice(m.slug);
        break;
      } catch (err) {
        if (attempt === 0) {
          await sleep(3000); // wait 3s before retry
        } else {
          fetchFailed++;
          if (fetchFailed <= 10) console.warn(`${tag} SKIP (${err.message}) — ${short}`);
        }
      }
    }
    if (yp === null) continue;

    m.yes_price = yp;
    if (yp === 0 || yp === 1) {
      settled++;
      if (settled <= 20) console.log(`${tag} [settled] yes_price=${yp} — ${short}`);
      else if (settled === 21) console.log(`  ... (more settled markets hidden)`);
    } else {
      active.push(m);
      if (active.length <= 5 || active.length % 50 === 0) {
        console.log(`${tag} yes_price=${yp.toFixed(4)} — ${short}`);
      }
    }

    if (i < oldMarkets.length - 1) await sleep(DELAY_MS);

    // progress every 50
    if ((i + 1) % 50 === 0) {
      const elapsed = ((Date.now() - t0) / 60000).toFixed(1);
      console.log(`  --- progress: ${i + 1}/${oldCount} done, ${active.length} active, ${settled} settled, ${fetchFailed} failed, ${elapsed}min ---`);
    }
  }

  const elapsed = ((Date.now() - t0) / 60000).toFixed(1);

  // Build category distribution
  const catDist = {};
  for (const m of active) {
    for (const cat of (m.categories || [])) {
      catDist[cat] = (catDist[cat] || 0) + 1;
    }
  }

  const output = {
    source: 'data/exploration_pool_v1_260302.json (refreshed)',
    filter: 'volume_24h >= 1000 + yes_price != 0 and != 1',
    created_at: new Date().toISOString(),
    summary: {
      old_total: oldCount,
      new_total: active.length,
      settled_excluded: settled,
      fetch_failed: fetchFailed,
      category_distribution: catDist,
    },
    markets: active,
  };

  fs.writeFileSync(OUTPUT, JSON.stringify(output, null, 2) + '\n', 'utf8');

  console.log('');
  console.log('=== Exploration Pool Refresh ===');
  console.log(`旧池子：${oldCount} 条`);
  console.log(`新池子：${active.length} 条（排除 ${settled} 条已结算, ${fetchFailed} 条拉取失败）`);
  console.log(`输出：${OUTPUT}`);
  console.log(`耗时：${elapsed} 分钟`);
  console.log(`分类分布：${JSON.stringify(catDist)}`);
}

main().catch(err => {
  console.error(`[refresh] Fatal: ${err.message}`);
  process.exit(1);
});
