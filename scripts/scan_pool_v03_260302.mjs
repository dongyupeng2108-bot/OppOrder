/**
 * scan_pool_v03_260302.mjs
 * Pool Scanner v03 — fetches ALL active markets from Polymarket Gamma API
 * (paginated until exhausted), applies category + liquidity + expiry filters.
 *
 * Strategy: Gamma markets API has no tags. Tags live on the events API.
 *   Phase 1: Fetch all events (with tags) → build event_id → tag_labels map
 *   Phase 2: Fetch all markets → join with event tags via market.events[].id
 *   Phase 3: Apply filters A/C/E
 *
 * Filters:
 *   A) Category: Tech / Politics / Economics / Finance / Culture (fuzzy, case-insensitive)
 *   B) 24h volume: no limit
 *   C) Orderbook liquidity: ask_top5 + bid_top5 >= $500 (skip if data unavailable)
 *   D) Created time: no limit
 *   E) End time: within 30 days from today
 *   F) Historical avg volume: disabled
 *
 * Output: data/pool_scan_v03_260302.json
 * Usage:  HTTPS_PROXY=http://127.0.0.1:51081 node scripts/scan_pool_v03_260302.mjs
 */

import fs from 'fs';
import path from 'path';
import { fetch as undiciFetch, ProxyAgent } from 'undici';

const GAMMA_MARKETS_BASE = 'https://gamma-api.polymarket.com/markets';
const GAMMA_EVENTS_BASE  = 'https://gamma-api.polymarket.com/events';
const PAGE_SIZE = 100;
const OUT_FILE = 'data/pool_scan_v03_260302.json';

// --- Proxy ---
const PROXY_URL = process.env.HTTPS_PROXY || process.env.https_proxy || '';
const proxyDispatcher = PROXY_URL ? new ProxyAgent(PROXY_URL) : undefined;
if (PROXY_URL) console.log(`[PoolScan] Using proxy: ${PROXY_URL}`);

function pfetch(url, opts = {}) {
  if (proxyDispatcher) opts.dispatcher = proxyDispatcher;
  return undiciFetch(url, opts);
}

// --- Category patterns (fuzzy, case-insensitive) ---
const CATEGORIES = [
  { name: 'Tech',       re: /tech/i },
  { name: 'Politics',   re: /politic/i },
  { name: 'Economics',  re: /econom/i },
  { name: 'Finance',    re: /financ/i },
  { name: 'Culture',    re: /cultur/i },
];

function matchCategoriesFromLabels(tagLabels) {
  const text = tagLabels.join(' ');
  const matched = [];
  for (const cat of CATEGORIES) {
    if (cat.re.test(text)) matched.push(cat.name);
  }
  return matched;
}

// --- Helpers ---
async function fetchJson(url) {
  const resp = await pfetch(url, { headers: { Accept: 'application/json' } });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${url}`);
  return resp.json();
}

function parseDate(val) {
  if (!val) return null;
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
}

async function fetchAllPages(baseUrl, label) {
  const all = [];
  let page = 0;
  while (true) {
    const offset = page * PAGE_SIZE;
    const sep = baseUrl.includes('?') ? '&' : '?';
    const url = `${baseUrl}${sep}limit=${PAGE_SIZE}&offset=${offset}`;
    let records;
    try {
      const data = await fetchJson(url);
      records = Array.isArray(data) ? data : (Array.isArray(data.data) ? data.data : []);
    } catch (err) {
      console.error(`[PoolScan] ${label} page ${page} error: ${err.message}`);
      break;
    }
    if (records.length === 0) break;
    all.push(...records);
    page++;
    if (page % 50 === 0) console.log(`[PoolScan]   ${label}: ${all.length} fetched (page ${page})`);
    if (records.length < PAGE_SIZE) break;
  }
  return all;
}

// ===================== main =====================
async function main() {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const deadline = new Date(today.getTime() + 15 * 24 * 60 * 60 * 1000);

  console.log(`[PoolScan] Start: ${now.toISOString()}`);
  console.log(`[PoolScan] Expiry window: ${today.toISOString().slice(0,10)} ~ ${deadline.toISOString().slice(0,10)}`);

  // === Phase 1: Fetch all events → build event_id → tag_labels map ===
  console.log('[PoolScan] Phase 1: Fetching all active events (for tags)...');
  const allEvents = await fetchAllPages(`${GAMMA_EVENTS_BASE}?active=true&closed=false`, 'Events');
  console.log(`[PoolScan] Events fetched: ${allEvents.length}`);

  const eventTagMap = new Map(); // event_id → string[]
  for (const ev of allEvents) {
    const eid = String(ev.id);
    const labels = [];
    if (Array.isArray(ev.tags)) {
      for (const t of ev.tags) {
        const lbl = typeof t === 'object' ? (t.label || t.slug || '') : String(t);
        if (lbl) labels.push(lbl);
      }
    }
    eventTagMap.set(eid, labels);
  }
  console.log(`[PoolScan] Event tag map: ${eventTagMap.size} events with tags`);

  // === Phase 2: Fetch all markets ===
  console.log('[PoolScan] Phase 2: Fetching all active markets...');
  const allRaw = await fetchAllPages(`${GAMMA_MARKETS_BASE}?active=true&closed=false`, 'Markets');
  const totalFetched = allRaw.length;
  console.log(`[PoolScan] Total markets fetched: ${totalFetched}`);

  // === Phase 3: Join & Filter ===

  // Step A — Category filter (via event tags)
  const afterCat = [];
  let noEventCount = 0;
  for (const m of allRaw) {
    // Get event IDs from market's events array
    const eventIds = [];
    if (Array.isArray(m.events)) {
      for (const e of m.events) {
        if (e && e.id) eventIds.push(String(e.id));
      }
    }
    if (eventIds.length === 0) { noEventCount++; }

    // Collect all tag labels from all events
    const allLabels = [];
    for (const eid of eventIds) {
      const labels = eventTagMap.get(eid);
      if (labels) allLabels.push(...labels);
    }

    // Also check question/slug/description for category keywords as fallback
    const fallbackText = [m.question || '', m.slug || '', m.description || ''].join(' ');
    allLabels.push(fallbackText);

    const cats = matchCategoriesFromLabels(allLabels);
    if (cats.length > 0) {
      afterCat.push({ raw: m, cats, eventIds });
    }
  }
  const totalAfterA = afterCat.length;
  if (noEventCount > 0) console.log(`[PoolScan] Markets with no event link: ${noEventCount}`);

  // Step C — Orderbook liquidity >= $500
  let liquidityAvailable = false;
  const afterLiq = [];
  for (const item of afterCat) {
    const m = item.raw;
    const ask5 = parseFloat(m.ask_top5_usd || m.askTop5Usd || 0);
    const bid5 = parseFloat(m.bid_top5_usd || m.bidTop5Usd || 0);
    if (ask5 > 0 || bid5 > 0) liquidityAvailable = true;
    const liq = ask5 + bid5;
    // If liquidity data exists for this market but < 500, exclude
    if ((ask5 > 0 || bid5 > 0) && liq < 500) continue;
    afterLiq.push({ ...item, liquidity_usd: liq });
  }
  const totalAfterC = afterLiq.length;

  // Step E — End time within 30 days
  const afterExp = [];
  for (const item of afterLiq) {
    const m = item.raw;
    const endDate = parseDate(m.endDate || m.endDateIso || m.end_date_iso);
    if (!endDate) continue;
    if (endDate < today || endDate > deadline) continue;
    afterExp.push({ ...item, end_date: endDate.toISOString() });
  }
  const totalAfterE = afterExp.length;

  // === Build output ===
  const markets = afterExp.map(item => {
    const m = item.raw;
    return {
      id: m.conditionId || m.id || '',
      slug: m.slug || '',
      question: m.question || m.title || '',
      categories: item.cats,
      end_date: item.end_date,
      volume_24h: parseFloat(parseFloat(m.volume24hr || m.volume24h || 0).toFixed(2)),
      liquidity_usd: parseFloat(item.liquidity_usd.toFixed(2)),
      spread: parseFloat(parseFloat(m.spread || 0).toFixed(4)),
    };
  });

  // Final category counts
  const finalCatCounts = { Tech: 0, Politics: 0, Economics: 0, Finance: 0, Culture: 0 };
  for (const m of markets) {
    for (const c of m.categories) finalCatCounts[c]++;
  }

  const output = {
    scanned_at: now.toISOString(),
    expiry_window: { from: today.toISOString().slice(0,10), to: deadline.toISOString().slice(0,10) },
    filters: {
      A_category: 'Tech|Politics|Economics|Finance|Culture (fuzzy via event tags + question fallback)',
      B_volume_24h: 'no limit',
      C_liquidity: 'ask_top5+bid_top5 >= $500 (skip if unavailable)',
      D_created: 'no limit',
      E_end_time: 'within 30 days',
      F_hist_volume: 'disabled',
    },
    summary: {
      total_fetched: totalFetched,
      events_fetched: allEvents.length,
      after_category_filter: totalAfterA,
      after_liquidity_filter: totalAfterC,
      after_expiry_filter: totalAfterE,
      final_pool: markets.length,
      liquidity_data_available: liquidityAvailable,
      category_distribution: finalCatCounts,
    },
    markets,
  };

  const outPath = path.resolve(OUT_FILE);
  const dir = path.dirname(outPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2) + '\n', 'utf8');
  console.log(`[PoolScan] Wrote ${outPath}`);

  // === Terminal summary ===
  console.log('');
  console.log('=== Pool Scan v03 Summary ===');
  console.log(`Total fetched:            ${totalFetched}`);
  console.log(`A) Category filter:       ${totalAfterA}`);
  console.log(`C) Liquidity filter:      ${totalAfterC}${liquidityAvailable ? '' : ' (data unavailable, skipped)'}`);
  console.log(`E) Expiry filter (30d):   ${totalAfterE}`);
  console.log(`Final pool:               ${markets.length}`);
  console.log('');
  console.log('--- Category Distribution (final) ---');
  for (const [cat, cnt] of Object.entries(finalCatCounts)) {
    console.log(`  ${cat}: ${cnt}`);
  }
  console.log('============================');
}

main().catch(err => {
  console.error(`[PoolScan] Fatal: ${err.message}`);
  process.exit(1);
});
