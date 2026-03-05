/**
 * universe_service.mjs
 * M5.5-S2: Universe extraction service.
 *
 * Loads a UniverseSpec, fetches markets, applies eligible filters,
 * records filter_counts per layer, writes UniverseRun to SQLite.
 *
 * Exports:
 *   runUniverse(specPath?) -> Promise<UniverseRun>
 *   getUniverseRuns(limit?, offset?) -> Promise<{ runs, total }>
 */

import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { applyEligibleFilter } from './polymarket_eligible_filter.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

const require = createRequire(import.meta.url);
let sqlite3;
try { sqlite3 = require('sqlite3'); } catch (_) {}

const DB_DIR  = path.join(process.cwd(), 'data', 'runtime');
const DB_PATH = path.join(DB_DIR, 'oppradar.sqlite');

let _db = null;
let _tableReady = false;

function getDb() {
  if (_db) return _db;
  if (!sqlite3) return null;
  if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
  _db = new sqlite3.Database(DB_PATH);
  return _db;
}

async function ensureTable() {
  if (_tableReady) return;
  await runAsync(`CREATE TABLE IF NOT EXISTS universe_runs (
    universe_run_id TEXT PRIMARY KEY,
    universe_id     TEXT NOT NULL,
    config_hash     TEXT NOT NULL,
    ts_start        TEXT NOT NULL,
    ts_end          TEXT NOT NULL,
    source          TEXT,
    filter_counts   TEXT NOT NULL,
    market_list     TEXT NOT NULL,
    market_count    INTEGER NOT NULL,
    list_digest     TEXT NOT NULL
  )`);
  await runAsync(`CREATE INDEX IF NOT EXISTS idx_universe_runs_universe_ts ON universe_runs(universe_id, ts_start)`);
  _tableReady = true;
}

function runAsync(sql, params = []) {
  const db = getDb();
  if (!db) return Promise.resolve({ changes: 0 });
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function allAsync(sql, params = []) {
  const db = getDb();
  if (!db) return Promise.resolve([]);
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function getAsync(sql, params = []) {
  const db = getDb();
  if (!db) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row || null);
    });
  });
}

/**
 * Compute config_hash: sort filter keys, SHA256 hex.
 */
function computeConfigHash(filters) {
  const sorted = Object.fromEntries(
    Object.keys(filters).sort().map(k => [k, filters[k]])
  );
  return crypto.createHash('sha256').update(JSON.stringify(sorted)).digest('hex');
}

/**
 * Compute list_digest: { first3, last3, count, list_hash }.
 */
function computeListDigest(marketList) {
  const list_hash = crypto.createHash('sha256')
    .update(JSON.stringify(marketList))
    .digest('hex');
  return {
    first3: marketList.slice(0, 3),
    last3:  marketList.slice(-3),
    count:  marketList.length,
    list_hash,
  };
}

/**
 * Generate universe_run_id: ur_<timestamp>_<4hex>.
 */
function generateRunId() {
  const hex4 = crypto.randomBytes(2).toString('hex');
  return `ur_${Date.now()}_${hex4}`;
}

/**
 * Fetch markets. In mock/test mode, uses a deterministic set.
 */
async function fetchMarkets() {
  try {
    const { fetchMarkets: polyFetch } = await import('./providers/polymarket_provider.mjs');
    return await polyFetch({ limit: 100, maxPages: 5 });
  } catch (err) {
    console.warn('[universe_service] polymarket_provider unavailable, using mock markets:', err.message);
    return generateMockMarkets();
  }
}

/**
 * Generate deterministic mock markets for testing/offline mode.
 */
function generateMockMarkets() {
  const now = new Date();
  const markets = [];
  for (let i = 0; i < 60; i++) {
    const daysAhead = Math.floor(i * 0.5) + 1;
    const eventDate = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);
    const price = 0.1 + (i % 40) * 0.02;
    const isNumeric = i < 50;
    const title = isNumeric
      ? `Will metric_${i} exceed ${100 + i} by end of month?`
      : `Will event_${i} happen?`;
    markets.push({
      opp_id: `mock_market_${String(i).padStart(3, '0')}`,
      title,
      question: title,
      market_url: `https://example.com/market/${i}`,
      yes_price: Math.round(price * 100) / 100,
      event_time: eventDate.toISOString(),
      raw: { id: `mock_${i}` },
    });
  }
  return markets;
}

/**
 * Run universe extraction.
 *
 * @param {string} [specPath] - Path to universe spec JSON (relative to project root).
 * @returns {Promise<object>} UniverseRun object.
 */
export async function runUniverse(specPath = 'config/universe_specs/main.json') {
  const tsStart = new Date().toISOString();

  // 1. Load UniverseSpec
  const fullPath = path.resolve(PROJECT_ROOT, specPath);
  const spec = JSON.parse(fs.readFileSync(fullPath, 'utf8'));

  // 2. Compute config_hash
  const config_hash = computeConfigHash(spec.filters);

  // 3. Fetch markets
  const rawMarkets = await fetchMarkets();
  const fetchedTotal = rawMarkets.length;

  // 4. Apply eligible filter (reuse existing logic)
  const { candidates, scan_stats } = applyEligibleFilter(rawMarkets);

  // 5. Build filter_counts from scan_stats breakdown
  const bd = scan_stats.filter_breakdown || {};
  const filter_counts = {
    total: fetchedTotal,
    after_settled:            fetchedTotal - (bd.settled_market || 0),
    after_numeric_threshold:  fetchedTotal - (bd.settled_market || 0) - (bd.no_numeric_threshold || 0),
    after_event_time:         fetchedTotal - (bd.settled_market || 0) - (bd.no_numeric_threshold || 0) - (bd.no_event_time || 0),
    after_ttl:                fetchedTotal - (bd.settled_market || 0) - (bd.no_numeric_threshold || 0) - (bd.no_event_time || 0) - (bd.ttl_exceeded || 0),
    after_price:              fetchedTotal - (bd.settled_market || 0) - (bd.no_numeric_threshold || 0) - (bd.no_event_time || 0) - (bd.ttl_exceeded || 0) - (bd.price_out_of_range || 0),
    final:                    candidates.length,
  };

  // 6. Build market_list (opp_ids of candidates)
  const market_list = candidates.map(c => c.opp_id);

  // 7. Compute list_digest
  const list_digest = computeListDigest(market_list);

  const tsEnd = new Date().toISOString();
  const universe_run_id = generateRunId();

  const universeRun = {
    universe_run_id,
    universe_id:  spec.universe_id || 'main',
    config_hash,
    ts_start:     tsStart,
    ts_end:       tsEnd,
    source:       'polymarket_api',
    filter_counts,
    market_list,
    market_count: market_list.length,
    list_digest,
  };

  // 8. Write to SQLite
  try {
    await ensureTable();
    await runAsync(`INSERT INTO universe_runs (
      universe_run_id, universe_id, config_hash, ts_start, ts_end,
      source, filter_counts, market_list, market_count, list_digest
    ) VALUES (?,?,?,?,?, ?,?,?,?,?)`, [
      universeRun.universe_run_id,
      universeRun.universe_id,
      universeRun.config_hash,
      universeRun.ts_start,
      universeRun.ts_end,
      universeRun.source,
      JSON.stringify(universeRun.filter_counts),
      JSON.stringify(universeRun.market_list),
      universeRun.market_count,
      JSON.stringify(universeRun.list_digest),
    ]);
  } catch (err) {
    console.error('[universe_service] DB write failed:', err.message);
  }

  console.log(`[universe_service] Run ${universe_run_id}: ${market_list.length} markets (from ${fetchedTotal} fetched)`);
  return universeRun;
}

/**
 * Get universe run history.
 *
 * @param {number} [limit=20]
 * @param {number} [offset=0]
 * @returns {Promise<{ runs: object[], total: number }>}
 */
export async function getUniverseRuns(limit = 20, offset = 0) {
  await ensureTable();
  const countRow = await getAsync(`SELECT COUNT(*) as cnt FROM universe_runs`);
  const total = countRow?.cnt || 0;

  const rows = await allAsync(
    `SELECT * FROM universe_runs ORDER BY ts_start DESC LIMIT ? OFFSET ?`,
    [limit, offset]
  );

  const runs = rows.map(r => ({
    universe_run_id: r.universe_run_id,
    universe_id:     r.universe_id,
    config_hash:     r.config_hash,
    ts_start:        r.ts_start,
    ts_end:          r.ts_end,
    market_count:    r.market_count,
    list_digest:     JSON.parse(r.list_digest || '{}'),
  }));

  return { runs, total };
}
