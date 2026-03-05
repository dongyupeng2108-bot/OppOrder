/**
 * postmortem_store.mjs
 * M6-A1: CRUD for postmortem and postmortem_notes tables.
 *
 * Exports:
 *   insertPostmortem(record)   — insert with auto revision management
 *   getPostmortem(opp_id)      — latest revision (is_latest=1)
 *   getAllRevisions(opp_id)    — all revisions for an opp_id
 *   insertNote(note)           — append a note
 *   getNotes(opp_id)           — all notes for an opp_id
 *   getPostmortemWithOutcome(opp_id) — join postmortem + outcome_store
 */

import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';

const require = createRequire(import.meta.url);
let sqlite3;
try { sqlite3 = require('sqlite3'); } catch (_) {}

const DB_DIR = path.join(process.cwd(), 'data', 'runtime');
const DB_PATH = path.join(DB_DIR, 'oppradar.sqlite');

let _db = null;

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

/**
 * Insert a postmortem record with automatic revision management.
 * If opp_id already has records, sets old is_latest=0 and increments revision.
 */
export async function insertPostmortem(record) {
  if (!record.opp_id) throw new Error('insertPostmortem: opp_id is required');
  if (!record.outcome) throw new Error('insertPostmortem: outcome is required');

  // Find current latest revision for this opp_id
  const existing = await getAsync(
    `SELECT revision FROM postmortem WHERE opp_id = ? AND is_latest = 1`,
    [record.opp_id]
  );

  const newRevision = existing ? existing.revision + 1 : 0;

  // M6-A2 (260302_015): Frozen fields — decision_snapshot_id and decision_b5_run_id
  // are immutable once set in revision 0. Carry forward from earliest revision.
  if (existing) {
    const first = await getAsync(
      `SELECT decision_snapshot_id, decision_b5_run_id FROM postmortem WHERE opp_id = ? ORDER BY revision ASC LIMIT 1`,
      [record.opp_id]
    );
    if (first) {
      record.decision_snapshot_id = first.decision_snapshot_id;
      record.decision_b5_run_id = first.decision_b5_run_id;
    }
  }

  // Mark old revisions as not latest
  if (existing) {
    await runAsync(
      `UPDATE postmortem SET is_latest = 0 WHERE opp_id = ? AND is_latest = 1`,
      [record.opp_id]
    );
  }

  const id = record.postmortem_id || `pm_${record.opp_id}_${Date.now()}`;
  const now = record.created_at || new Date().toISOString();

  await runAsync(`INSERT INTO postmortem (
    postmortem_id, opp_id, outcome, outcome_ts,
    market_price_at_scan, market_price_at_settlement,
    p_baseline_low, p_baseline_mid, p_baseline_high,
    confidence, veto_status, veto_reason,
    risk_level, risk_reason, filter_type, filter_reason,
    edge_buy_net, edge_sell_net, edge_net,
    predicted_direction, direction_correct, pnl_simulated,
    snapshot_draft_id, snapshot_deep_id,
    active_snapshot_type, decision_snapshot_id, decision_b5_run_id,
    strategy_id, is_topn, topn_rank,
    attribution_label, attribution_reason, attribution_confirmed,
    actual, virtual_notional,
    revision, is_latest, created_at
  ) VALUES (?,?,?,?, ?,?, ?,?,?, ?,?,?, ?,?,?,?, ?,?,?, ?,?,?, ?,?, ?,?,?, ?,?,?, ?,?,?, ?,?, ?,?,?)`, [
    id,
    record.opp_id,
    record.outcome,
    record.outcome_ts,
    record.market_price_at_scan,
    record.market_price_at_settlement ?? null,
    record.p_baseline_low,
    record.p_baseline_mid,
    record.p_baseline_high,
    record.confidence,
    record.veto_status,
    record.veto_reason ?? null,
    record.risk_level,
    record.risk_reason ?? null,
    record.filter_type ?? null,
    record.filter_reason ?? null,
    record.edge_buy_net ?? null,
    record.edge_sell_net ?? null,
    record.edge_net ?? null,
    record.predicted_direction ?? null,
    record.direction_correct ?? null,
    record.pnl_simulated ?? null,
    record.snapshot_draft_id ?? null,
    record.snapshot_deep_id ?? null,
    record.active_snapshot_type,
    record.decision_snapshot_id,
    record.decision_b5_run_id ?? null,
    record.strategy_id ?? null,
    record.is_topn ? 1 : 0,
    record.topn_rank ?? null,
    record.attribution_label ?? null,
    record.attribution_reason ?? null,
    record.attribution_confirmed ?? null,
    record.actual,
    record.virtual_notional,
    newRevision,
    1,
    now
  ]);

  return { postmortem_id: id, revision: newRevision };
}

/**
 * Get latest postmortem for an opp_id (is_latest=1).
 */
export async function getPostmortem(opp_id) {
  return getAsync(
    `SELECT * FROM postmortem WHERE opp_id = ? AND is_latest = 1`,
    [opp_id]
  );
}

/**
 * Get all revisions for an opp_id, ordered by revision ASC.
 */
export async function getAllRevisions(opp_id) {
  return allAsync(
    `SELECT * FROM postmortem WHERE opp_id = ? ORDER BY revision ASC`,
    [opp_id]
  );
}

/**
 * Insert a postmortem note (append-only).
 */
export async function insertNote(note) {
  if (!note.opp_id) throw new Error('insertNote: opp_id is required');
  if (!note.note_text) throw new Error('insertNote: note_text is required');

  const id = note.note_id || `pn_${note.opp_id}_${Date.now()}`;
  const now = note.created_at || new Date().toISOString();

  await runAsync(
    `INSERT INTO postmortem_notes (note_id, opp_id, note_text, created_at) VALUES (?,?,?,?)`,
    [id, note.opp_id, note.note_text, now]
  );

  return { note_id: id };
}

/**
 * Get all notes for an opp_id, ordered by created_at ASC.
 */
export async function getNotes(opp_id) {
  return allAsync(
    `SELECT * FROM postmortem_notes WHERE opp_id = ? ORDER BY created_at ASC`,
    [opp_id]
  );
}

/**
 * Get postmortem with associated outcome data (join via opp_id file lookup).
 * Returns { postmortem, outcome } or null.
 */
export async function getPostmortemWithOutcome(opp_id) {
  const pm = await getPostmortem(opp_id);
  if (!pm) return null;

  // Read outcome from outcome_store (file-based)
  let outcome = null;
  try {
    const outcomePath = path.join(process.cwd(), 'data', 'outcomes', `${opp_id}.json`);
    if (fs.existsSync(outcomePath)) {
      outcome = JSON.parse(fs.readFileSync(outcomePath, 'utf8'));
    }
  } catch (_) {}

  return { postmortem: pm, outcome };
}

/**
 * Close the DB connection (for test cleanup).
 */
export function closeDb() {
  if (_db) {
    _db.close();
    _db = null;
  }
}
