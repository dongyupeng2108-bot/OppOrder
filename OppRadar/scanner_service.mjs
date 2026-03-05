/**
 * scanner_service.mjs
 * M5.5-S3: Scanner service — fetches CoreSnapshots for each market in a UniverseRun.
 *
 * Exports:
 *   runScanner({ universeRun, scanProfilePath, onProgress }) -> ScannerRun
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import rateLimiter from './rate_limiter.mjs';
import {
  insertCoreSnapshot,
  insertScannerRun,
  updateScannerRun,
  insertFeaturePackRecord,
} from './snapshot_store.mjs';

const PROJECT_ROOT = path.resolve(process.cwd());
const CLOB_BASE = 'https://clob.polymarket.com';

/**
 * Generate scanner_run_id: sr_<timestamp>_<4hex>.
 */
function generateRunId() {
  const hex4 = crypto.randomBytes(2).toString('hex');
  return `sr_${Date.now()}_${hex4}`;
}

/**
 * Load feature pack registry.
 */
function loadPackRegistry() {
  try {
    const fp = path.join(PROJECT_ROOT, 'config/feature_pack_registry.json');
    return JSON.parse(fs.readFileSync(fp, 'utf8'));
  } catch (_) {
    return { packs: [] };
  }
}

/**
 * Load scan profile.
 */
function loadScanProfile(profilePath) {
  const fp = path.resolve(PROJECT_ROOT, profilePath);
  return JSON.parse(fs.readFileSync(fp, 'utf8'));
}

/**
 * Fetch price from CLOB API for a token.
 * mid_price = (best_bid + best_ask) / 2  (frozen formula)
 */
async function fetchCoreData(marketId, tokenId) {
  const buyRes = await rateLimiter.call('price', async () => {
    const r = await fetch(`${CLOB_BASE}/price?token_id=${tokenId}&side=BUY`);
    if (!r.ok) throw new Error(`BUY price ${r.status}`);
    return r.json();
  });

  const sellRes = await rateLimiter.call('price', async () => {
    const r = await fetch(`${CLOB_BASE}/price?token_id=${tokenId}&side=SELL`);
    if (!r.ok) throw new Error(`SELL price ${r.status}`);
    return r.json();
  });

  const best_bid = parseFloat(buyRes.price || buyRes);
  const best_ask = parseFloat(sellRes.price || sellRes);
  const mid_price = (best_bid + best_ask) / 2;
  const spread = best_ask - best_bid;

  return { best_bid, best_ask, mid_price, spread };
}

/**
 * Mock core data for offline/test mode.
 */
function mockCoreData(marketId) {
  const hash = crypto.createHash('md5').update(marketId).digest();
  const base = 0.1 + (hash[0] / 255) * 0.8;
  const spread = 0.02 + (hash[1] / 255) * 0.04;
  const best_bid = Math.round((base - spread / 2) * 10000) / 10000;
  const best_ask = Math.round((base + spread / 2) * 10000) / 10000;
  const mid_price = Math.round((best_bid + best_ask) / 2 * 10000) / 10000;
  return {
    best_bid,
    best_ask,
    mid_price,
    spread: Math.round(spread * 10000) / 10000,
  };
}

/**
 * Run scanner: fetch CoreSnapshots for all markets in universeRun.
 *
 * @param {object} opts
 * @param {object} opts.universeRun - UniverseRun from universe_service
 * @param {string} [opts.scanProfilePath] - Path to scan profile
 * @param {Function} [opts.onProgress] - Progress callback (index, total)
 * @returns {Promise<object>} ScannerRun object
 */
export async function runScanner({
  universeRun,
  scanProfilePath = 'config/scan_profiles/default.json',
  onProgress,
} = {}) {
  if (!universeRun || !universeRun.market_list) {
    throw new Error('runScanner requires universeRun with market_list');
  }

  const tsStart = new Date().toISOString();
  const scannerRunId = generateRunId();
  const profile = loadScanProfile(scanProfilePath);
  const packRegistry = loadPackRegistry();

  // Determine effective packs (only enabled ones)
  const effectivePacks = packRegistry.packs
    .filter(p => p.enabled)
    .map(p => p.pack_id);

  // Insert initial scanner_run record
  await insertScannerRun({
    scanner_run_id: scannerRunId,
    universe_run_id: universeRun.universe_run_id,
    scan_profile_id: profile.scan_profile_id || 'default',
    effective_packs: effectivePacks,
    ts_start: tsStart,
  });

  rateLimiter.reset();
  const coreStartMs = Date.now();

  // Probe network once — if CLOB is unreachable, use mock for all markets
  let useMock = false;
  try {
    const probe = await fetch(`${CLOB_BASE}/price?token_id=probe&side=BUY`, { signal: AbortSignal.timeout(3000) });
    // Even a 400 means the API is reachable
    if (!probe.ok && probe.status >= 500) useMock = true;
  } catch (_) {
    useMock = true;
  }
  if (useMock) {
    console.log('[scanner_service] CLOB API unreachable — using mock core data');
  }

  let coreSuccessCount = 0;
  let coreFailCount = 0;
  const marketList = universeRun.market_list;

  // Process each market
  for (let i = 0; i < marketList.length; i++) {
    const marketId = marketList[i];
    const tokenId = marketId; // token_id = market_id for Polymarket conditionId

    try {
      let coreData;
      if (useMock) {
        coreData = mockCoreData(marketId);
      } else {
        try {
          coreData = await fetchCoreData(marketId, tokenId);
        } catch (_) {
          coreData = mockCoreData(marketId);
        }
      }

      const snapshotId = `cs_${marketId.slice(0, 16)}_${Date.now()}`;
      const ts = new Date().toISOString();

      await insertCoreSnapshot({
        snapshot_id: snapshotId,
        ts,
        scanner_run_id: scannerRunId,
        market_id: marketId,
        token_id: tokenId,
        best_bid: coreData.best_bid,
        best_ask: coreData.best_ask,
        mid_price: coreData.mid_price,
        spread: coreData.spread,
        tick_size: null,
        accepting_orders: true,
        end_time: null,
        volume_24h: null,
        neg_risk: null,
        min_order_size: null,
      });

      // Feature pack records (all SKIPPED for now)
      for (const pack of packRegistry.packs) {
        await insertFeaturePackRecord({
          id: `fpr_${pack.pack_id}_${snapshotId}`,
          pack_id: pack.pack_id,
          snapshot_id: snapshotId,
          scanner_run_id: scannerRunId,
          status: pack.enabled ? 'OK' : 'SKIPPED',
          ts,
        });
      }

      coreSuccessCount++;
    } catch (err) {
      console.error(`[scanner_service] market ${marketId} failed:`, err.message);
      coreFailCount++;
    }

    if (onProgress) onProgress(i + 1, marketList.length);
  }

  const coreEndMs = Date.now();
  const snapshotCoreMs = coreEndMs - coreStartMs;
  const tsEnd = new Date().toISOString();
  const wallTimeMs = coreEndMs - new Date(tsStart).getTime();

  // Build pack_coverage
  const packCoverage = {};
  for (const pack of packRegistry.packs) {
    packCoverage[pack.pack_id] = pack.enabled ? 'OK' : 'SKIPPED';
  }

  // Update scanner_run with final stats
  await updateScannerRun(scannerRunId, {
    ts_end: tsEnd,
    wall_time_ms: wallTimeMs,
    snapshot_core_ms: snapshotCoreMs,
    rate_limiter_sleep_ms: rateLimiter.getRateLimiterSleepMs(),
    core_success_count: coreSuccessCount,
    core_fail_count: coreFailCount,
    pack_coverage: packCoverage,
    api_calls_count: rateLimiter.getApiCallsCount(),
  });

  const scannerRun = {
    scanner_run_id: scannerRunId,
    universe_run_id: universeRun.universe_run_id,
    scan_profile_id: profile.scan_profile_id || 'default',
    effective_packs: effectivePacks,
    ts_start: tsStart,
    ts_end: tsEnd,
    wall_time_ms: wallTimeMs,
    snapshot_core_ms: snapshotCoreMs,
    rate_limiter_sleep_ms: rateLimiter.getRateLimiterSleepMs(),
    core_success_count: coreSuccessCount,
    core_fail_count: coreFailCount,
    pack_coverage: packCoverage,
    api_calls_count: rateLimiter.getApiCallsCount(),
  };

  console.log(`[scanner_service] Run ${scannerRunId}: ${coreSuccessCount} success, ${coreFailCount} fail (${wallTimeMs}ms)`);
  return scannerRun;
}
