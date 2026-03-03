/**
 * scan_pool_260301_002.mjs
 * Pool Scanner — fetches Polymarket markets, applies hard exclusion + liquidity filter,
 * outputs data/pool_scan_260301_002.json + terminal summary.
 *
 * P4: No category inclusion filter. All markets pass unless hit by hard exclusion or low liquidity.
 *
 * Task ID: 260301_002
 * Usage:   node scripts/scan_pool_260301_002.mjs
 * Proxy:   $env:HTTPS_PROXY="http://127.0.0.1:51081"; node scripts/scan_pool_260301_002.mjs
 */

import fs from 'fs';
import path from 'path';
import { fetch as undiciFetch, ProxyAgent } from 'undici';

const TASK_ID = '260301_002';
const GAMMA_API_BASE = 'https://gamma-api.polymarket.com/markets';
const PAGE_SIZE = 100;
const MAX_PAGES = 5;

// --- Proxy-aware fetch ---
const PROXY_URL = process.env.HTTPS_PROXY || process.env.https_proxy || '';
const proxyDispatcher = PROXY_URL ? new ProxyAgent(PROXY_URL) : undefined;
if (PROXY_URL) console.log(`[PoolScan] Using proxy: ${PROXY_URL}`);

function pfetch(url, opts = {}) {
  if (proxyDispatcher) opts.dispatcher = proxyDispatcher;
  return undiciFetch(url, opts);
}

// --- Hard exclusion keywords (case-insensitive) ---
// Three groups: price prediction, gambling outcomes, noise
const HARD_EXCLUDE_KEYWORDS = [
  // Pure price prediction
  'price', '\\$1m', '\\$100k', 'airdrop', 'all-time high', '\\bath\\b', 'market cap',
  // Pure gambling outcomes
  'win the', 'beat', 'defeat', '\\bscore\\b', '\\bvs\\b', 'versus', '\\bmvp\\b', 'championship',
  // Noise
  'polling', 'mentions', '\\bindex\\b', '\\bCPI\\b', 'Federal Reserve',
];
const EXCLUDE_RES = HARD_EXCLUDE_KEYWORDS.map(
  kw => new RegExp(kw, 'i')
);

// --- Liquidity threshold ---
const VOLUME_24H_MIN = 100;  // min $100 24h volume

// ===================== helpers =====================

async function fetchJson(url, label) {
  const resp = await pfetch(url, { headers: { Accept: 'application/json' } });
  if (!resp.ok) throw new Error(`${label}: HTTP ${resp.status}`);
  return resp.json();
}

// ===================== main =====================

async function main() {
  const scannedAt = new Date().toISOString();
  const result = {
    task_id: TASK_ID,
    scanned_at: scannedAt,
    total_fetched: 0,
    total_after_exclusion_filter: 0,
    total_after_liquidity_filter: 0,
    liquidity_data_available: true,
    markets: [],
  };

  // === Step 1: Fetch from Gamma API ===
  console.log('[PoolScan] Fetching markets from Gamma API...');
  let allRaw = [];
  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      const url = `${GAMMA_API_BASE}?limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}&active=true&closed=false`;
      const data = await fetchJson(url, 'Gamma API');
      const records = Array.isArray(data) ? data : (Array.isArray(data.data) ? data.data : []);
      if (records.length === 0) break;
      allRaw.push(...records);
      if (records.length < PAGE_SIZE) break;
    }
  } catch (err) {
    console.error(`[PoolScan] Gamma API error: ${err.message}`);
    result.liquidity_data_available = false;
    writeOutput(result);
    return;
  }
  result.total_fetched = allRaw.length;
  console.log(`[PoolScan] Fetched ${allRaw.length} markets`);

  // === Step 2: Hard exclusion filter ===
  const afterExclusion = [];
  const excludedByKeyword = []; // sample up to 1
  const kwHitCounts = {};
  for (const raw of allRaw) {
    const question = raw.question || raw.title || '';
    const hitKw = HARD_EXCLUDE_KEYWORDS.find(kw => new RegExp(kw, 'i').test(question));
    if (hitKw) {
      kwHitCounts[hitKw] = (kwHitCounts[hitKw] || 0) + 1;
      if (excludedByKeyword.length < 1) {
        excludedByKeyword.push({ question, reason: `keyword hit: "${hitKw}"` });
      }
      continue;
    }
    afterExclusion.push({ raw, question });
  }
  if (Object.keys(kwHitCounts).length > 0) {
    console.log(`[PoolScan] Exclusion breakdown: ${Object.entries(kwHitCounts).map(([k,v]) => `"${k}"=${v}`).join(', ')}`);
  }
  result.total_after_exclusion_filter = afterExclusion.length;

  // === Step 3: Liquidity filter (volume_24h >= $100) ===
  const afterLiquidity = [];
  const excludedByLiquidity = []; // sample up to 1

  for (const item of afterExclusion) {
    const volume_24h = parseFloat(item.raw.volume24hr || 0);
    const spread = parseFloat(item.raw.spread || 0);

    if (volume_24h < VOLUME_24H_MIN) {
      if (excludedByLiquidity.length < 1) {
        excludedByLiquidity.push({ question: item.question, reason: `vol ${volume_24h.toFixed(0)} < ${VOLUME_24H_MIN}` });
      }
      continue;
    }
    afterLiquidity.push({ ...item, volume_24h, spread });
  }

  // Collect exclusion samples for terminal output
  result._excluded_samples = [...excludedByKeyword, ...excludedByLiquidity];

  result.total_after_liquidity_filter = afterLiquidity.length;

  // === Step 4: Build output ===
  result.markets = afterLiquidity.map(item => ({
    id: item.raw.conditionId || item.raw.id || '',
    question: item.question,
    end_date: item.raw.endDate || item.raw.endDateIso || '',
    volume_24h: parseFloat(item.volume_24h.toFixed(2)),
    spread: parseFloat(item.spread.toFixed(4)),
  }));

  writeOutput(result);
}

function writeOutput(result) {
  const outPath = path.resolve('data', `pool_scan_${TASK_ID}.json`);
  const dir = path.dirname(outPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2) + '\n', 'utf8');
  console.log(`[PoolScan] Wrote ${outPath}`);

  // Strip internal field before writing JSON
  const excludedSamples = result._excluded_samples || [];
  delete result._excluded_samples;

  const liq = result.liquidity_data_available ? '' : ' (liquidity unavailable)';
  console.log('');
  console.log('=== Pool Scan Summary ===');
  console.log(`Total Fetched:          ${result.total_fetched}`);
  console.log(`After Exclusion Filter: ${result.total_after_exclusion_filter}`);
  console.log(`After Liquidity Filter: ${result.total_after_liquidity_filter}${liq}`);
  console.log('=========================');

  // Print excluded samples (up to 3)
  if (excludedSamples.length > 0) {
    console.log('');
    console.log('--- Excluded Samples ---');
    for (const s of excludedSamples.slice(0, 3)) {
      console.log(`  X  "${s.question}"`);
      console.log(`     Reason: ${s.reason}`);
    }
    console.log('------------------------');
  }
}

main().catch(err => {
  console.error(`[PoolScan] Fatal: ${err.message}`);
  const outPath = path.resolve('data', `pool_scan_${TASK_ID}.json`);
  const dir = path.dirname(outPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify({
    task_id: TASK_ID,
    scanned_at: new Date().toISOString(),
    error: err.message,
    total_fetched: 0,
    total_after_exclusion_filter: 0,
    total_after_liquidity_filter: 0,
    liquidity_data_available: false,
    markets: [],
  }, null, 2) + '\n', 'utf8');
  console.log(`[PoolScan] Error output written to ${outPath}`);
  process.exit(0);
});
