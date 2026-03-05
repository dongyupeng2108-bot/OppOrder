/**
 * snapshot_store.mjs
 * M5.5-S3: CRUD for core_snapshots and scanner_runs tables.
 *
 * Exports:
 *   insertCoreSnapshot(snapshotData) -> snapshot_id
 *   getCoreSnapshot(snapshotId) -> row | null
 *   getLatestCoreSnapshot(marketId) -> row | null
 *   insertScannerRun(runData) -> scanner_run_id
 *   updateScannerRun(scannerRunId, updates) -> void
 *   getScannerRun(scannerRunId) -> row | null
 *   getScannerRuns(limit, offset) -> { runs, total }
 */

import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';

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

async function ensureTables() {
  if (_tableReady) return;

  await runAsync(`CREATE TABLE IF NOT EXISTS scanner_runs (
    scanner_run_id           TEXT PRIMARY KEY,
    universe_run_id          TEXT,
    scan_profile_id          TEXT NOT NULL,
    effective_packs          TEXT,
    ts_start                 TEXT NOT NULL,
    ts_end                   TEXT,
    wall_time_ms             REAL,
    universe_fetch_ms        REAL,
    snapshot_core_ms         REAL,
    rate_limiter_sleep_ms    REAL,
    core_success_count       INTEGER DEFAULT 0,
    core_fail_count          INTEGER DEFAULT 0,
    per_market_timeout_count INTEGER DEFAULT 0,
    retry_count              INTEGER DEFAULT 0,
    pack_coverage            TEXT,
    api_calls_count          INTEGER DEFAULT 0
  )`);
  await runAsync(`CREATE INDEX IF NOT EXISTS idx_scanner_runs_universe_ts ON scanner_runs(universe_run_id, ts_start)`);

  await runAsync(`CREATE TABLE IF NOT EXISTS core_snapshots (
    snapshot_id      TEXT PRIMARY KEY,
    ts               TEXT NOT NULL,
    scanner_run_id   TEXT NOT NULL,
    market_id        TEXT NOT NULL,
    token_id         TEXT NOT NULL,
    best_bid         REAL NOT NULL,
    best_ask         REAL NOT NULL,
    mid_price        REAL NOT NULL,
    spread           REAL NOT NULL,
    tick_size        REAL,
    accepting_orders INTEGER NOT NULL,
    end_time         TEXT,
    volume_24h       REAL,
    neg_risk         INTEGER,
    min_order_size   REAL
  )`);
  await runAsync(`CREATE INDEX IF NOT EXISTS idx_core_snapshots_market_ts ON core_snapshots(market_id, ts)`);
  await runAsync(`CREATE INDEX IF NOT EXISTS idx_core_snapshots_scanner_run ON core_snapshots(scanner_run_id)`);

  await runAsync(`CREATE TABLE IF NOT EXISTS feature_pack_records (
    id               TEXT PRIMARY KEY,
    pack_id          TEXT NOT NULL,
    snapshot_id      TEXT NOT NULL,
    scanner_run_id   TEXT NOT NULL,
    status           TEXT NOT NULL,
    ts               TEXT NOT NULL,
    data             TEXT
  )`);
  await runAsync(`CREATE INDEX IF NOT EXISTS idx_fpr_snapshot ON feature_pack_records(snapshot_id)`);

  _tableReady = true;
}

export async function insertCoreSnapshot(data) {
  await ensureTables();
  const id = data.snapshot_id;
  await runAsync(`INSERT INTO core_snapshots (
    snapshot_id, ts, scanner_run_id, market_id, token_id,
    best_bid, best_ask, mid_price, spread, tick_size,
    accepting_orders, end_time, volume_24h, neg_risk, min_order_size
  ) VALUES (?,?,?,?,?, ?,?,?,?,?, ?,?,?,?,?)`, [
    id, data.ts, data.scanner_run_id, data.market_id, data.token_id,
    data.best_bid, data.best_ask, data.mid_price, data.spread, data.tick_size ?? null,
    data.accepting_orders ? 1 : 0, data.end_time ?? null, data.volume_24h ?? null,
    data.neg_risk != null ? (data.neg_risk ? 1 : 0) : null, data.min_order_size ?? null,
  ]);
  return id;
}

export async function getCoreSnapshot(snapshotId) {
  await ensureTables();
  const row = await getAsync(`SELECT * FROM core_snapshots WHERE snapshot_id = ?`, [snapshotId]);
  if (!row) return null;
  return { ...row, accepting_orders: !!row.accepting_orders, neg_risk: row.neg_risk != null ? !!row.neg_risk : null };
}

export async function getLatestCoreSnapshot(marketId) {
  await ensureTables();
  const row = await getAsync(`SELECT * FROM core_snapshots WHERE market_id = ? ORDER BY ts DESC LIMIT 1`, [marketId]);
  if (!row) return null;
  return { ...row, accepting_orders: !!row.accepting_orders, neg_risk: row.neg_risk != null ? !!row.neg_risk : null };
}

export async function insertScannerRun(data) {
  await ensureTables();
  const id = data.scanner_run_id;
  await runAsync(`INSERT INTO scanner_runs (
    scanner_run_id, universe_run_id, scan_profile_id, effective_packs,
    ts_start, ts_end, wall_time_ms, universe_fetch_ms, snapshot_core_ms,
    rate_limiter_sleep_ms, core_success_count, core_fail_count,
    per_market_timeout_count, retry_count, pack_coverage, api_calls_count
  ) VALUES (?,?,?,?, ?,?,?,?,?, ?,?,?, ?,?,?,?)`, [
    id, data.universe_run_id ?? null, data.scan_profile_id, data.effective_packs ? JSON.stringify(data.effective_packs) : null,
    data.ts_start, data.ts_end ?? null, data.wall_time_ms ?? null, data.universe_fetch_ms ?? null, data.snapshot_core_ms ?? null,
    data.rate_limiter_sleep_ms ?? null, data.core_success_count ?? 0, data.core_fail_count ?? 0,
    data.per_market_timeout_count ?? 0, data.retry_count ?? 0,
    data.pack_coverage ? JSON.stringify(data.pack_coverage) : null, data.api_calls_count ?? 0,
  ]);
  return id;
}

export async function updateScannerRun(scannerRunId, updates) {
  await ensureTables();
  const fields = [];
  const values = [];
  for (const [k, v] of Object.entries(updates)) {
    fields.push(`${k} = ?`);
    values.push(typeof v === 'object' && v !== null ? JSON.stringify(v) : v);
  }
  if (fields.length === 0) return;
  values.push(scannerRunId);
  await runAsync(`UPDATE scanner_runs SET ${fields.join(', ')} WHERE scanner_run_id = ?`, values);
}

export async function getScannerRun(scannerRunId) {
  await ensureTables();
  const row = await getAsync(`SELECT * FROM scanner_runs WHERE scanner_run_id = ?`, [scannerRunId]);
  if (!row) return null;
  return {
    ...row,
    effective_packs: row.effective_packs ? JSON.parse(row.effective_packs) : [],
    pack_coverage: row.pack_coverage ? JSON.parse(row.pack_coverage) : {},
  };
}

export async function getScannerRuns(limit = 20, offset = 0) {
  await ensureTables();
  const countRow = await getAsync(`SELECT COUNT(*) as cnt FROM scanner_runs`);
  const total = countRow?.cnt || 0;
  const rows = await allAsync(
    `SELECT * FROM scanner_runs ORDER BY ts_start DESC LIMIT ? OFFSET ?`,
    [limit, offset]
  );
  const runs = rows.map(r => ({
    ...r,
    effective_packs: r.effective_packs ? JSON.parse(r.effective_packs) : [],
    pack_coverage: r.pack_coverage ? JSON.parse(r.pack_coverage) : {},
  }));
  return { runs, total };
}

export async function insertFeaturePackRecord(data) {
  await ensureTables();
  await runAsync(`INSERT INTO feature_pack_records (id, pack_id, snapshot_id, scanner_run_id, status, ts, data)
    VALUES (?,?,?,?,?,?,?)`, [
    data.id, data.pack_id, data.snapshot_id, data.scanner_run_id, data.status, data.ts, data.data ?? null,
  ]);
}
