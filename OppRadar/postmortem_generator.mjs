/**
 * postmortem_generator.mjs
 * M6-A2 (260302_015): Auto-generate postmortem card from outcome + opportunity context.
 *
 * Given an outcome record and the opportunity's context data (from opportunity_event
 * and snapshot_index), generates a postmortem record and inserts it via postmortem_store.
 *
 * Key rules:
 *   - outcome YES → actual 1.0, NO → actual 0.0
 *   - decision_snapshot_id / decision_b5_run_id are frozen: on revision > 0,
 *     values are carried forward from revision 0.
 *   - Idempotent: if a postmortem already exists for the opp_id with same outcome,
 *     skip generation (return existing).
 *
 * Exports:
 *   generatePostmortem({ opp_id, outcome, settled_at, actual_price, title })
 *   backfillPostmortems()
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
 * Look up opportunity_event row by opp_id (id column).
 */
async function getOppEvent(opp_id) {
  const row = await getAsync(
    `SELECT * FROM opportunity_event WHERE id = ?`,
    [opp_id]
  );
  if (!row) return null;
  return {
    ...row,
    score_breakdown: JSON.parse(row.score_breakdown_json || '{}'),
    features: JSON.parse(row.features_json || '{}'),
    news_refs: JSON.parse(row.news_refs_json || '[]'),
    refs: JSON.parse(row.refs_json || '{}'),
  };
}

/**
 * Look up snapshot_index entry for opp_id.
 */
function getSnapshotEntry(opp_id) {
  try {
    const indexPath = path.join(process.cwd(), 'data', 'snapshots', 'index.json');
    if (!fs.existsSync(indexPath)) return null;
    const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    return index.entries.find(e => e.opp_id === opp_id) || null;
  } catch (_) {
    return null;
  }
}

/**
 * Map opportunity card confidence (High/Med/Low) to postmortem confidence (HIGH/MEDIUM/LOW).
 */
function mapConfidence(cardConf) {
  if (!cardConf) return 'LOW';
  const map = { 'High': 'HIGH', 'Med': 'MEDIUM', 'Low': 'LOW' };
  return map[cardConf] || cardConf.toUpperCase() || 'LOW';
}

/**
 * Map veto decision to veto_status.
 */
function mapVetoStatus(veto) {
  if (!veto || !veto.decision) return 'GREEN';
  const map = { 'BLOCK': 'RED', 'DEGRADE': 'YELLOW', 'ALLOW': 'GREEN' };
  return map[veto.decision] || 'GREEN';
}

/**
 * Auto-generate a postmortem card from outcome + opportunity context.
 *
 * Idempotent: if postmortem already exists for opp_id with same outcome, returns existing.
 * Frozen fields: decision_snapshot_id and decision_b5_run_id are carried forward
 * from the earliest revision (revision 0) when creating a new revision.
 *
 * @param {{ opp_id: string, outcome: 'YES'|'NO', settled_at: string, actual_price: number, title?: string }} params
 * @returns {Promise<{ postmortem_id: string, revision: number, skipped: boolean }>}
 */
export async function generatePostmortem({ opp_id, outcome, settled_at, actual_price, title }) {
  const { getPostmortem, insertPostmortem } = await import('./postmortem_store.mjs');

  // Idempotent check: if postmortem exists with same outcome, skip
  const existing = await getPostmortem(opp_id);
  if (existing && existing.outcome === outcome) {
    return { postmortem_id: existing.postmortem_id, revision: existing.revision, skipped: true };
  }

  // Map outcome to actual
  const actual = outcome === 'YES' ? 1.0 : 0.0;

  // Gather context from opportunity_event
  const oppEvent = await getOppEvent(opp_id);
  const snapEntry = getSnapshotEntry(opp_id);

  // Determine frozen fields: if prior revision exists, carry forward
  let decision_snapshot_id = oppEvent?.snapshot_ref || 'unknown';
  let decision_b5_run_id = oppEvent?.build_run_id || null;

  if (existing) {
    // Frozen: carry forward from existing (earliest) revision
    const firstRevision = await getAsync(
      `SELECT decision_snapshot_id, decision_b5_run_id FROM postmortem WHERE opp_id = ? ORDER BY revision ASC LIMIT 1`,
      [opp_id]
    );
    if (firstRevision) {
      decision_snapshot_id = firstRevision.decision_snapshot_id;
      decision_b5_run_id = firstRevision.decision_b5_run_id;
    }
  }

  // Extract probability data from refs/features
  const refs = oppEvent?.refs || {};
  const features = oppEvent?.features || {};
  const scoreBreakdown = oppEvent?.score_breakdown || {};

  // Determine snapshot types
  const snapshots = snapEntry?.snapshots || [];
  const hasDraft = snapshots.some(s => s.snapshot_type === 'draft');
  const hasDeep = snapshots.some(s => s.snapshot_type === 'deep');
  const draftSnap = snapshots.find(s => s.snapshot_type === 'draft');
  const deepSnap = snapshots.find(s => s.snapshot_type === 'deep');

  // Build p_baseline from refs or features
  const p_mid = refs.p_mid ?? features.p_mid ?? oppEvent?.score ?? 0.5;
  const p_range_low = refs.p_range?.low ?? features.p_range?.low ?? Math.max(0, p_mid - 0.1);
  const p_range_high = refs.p_range?.high ?? features.p_range?.high ?? Math.min(1, p_mid + 0.1);

  const record = {
    opp_id,
    outcome,
    outcome_ts: settled_at,
    market_price_at_scan: actual_price,
    market_price_at_settlement: actual_price,
    p_baseline_low: p_range_low,
    p_baseline_mid: p_mid,
    p_baseline_high: p_range_high,
    confidence: mapConfidence(features.confidence || refs.confidence),
    veto_status: mapVetoStatus(features.veto || refs.veto),
    veto_reason: features.veto?.labels?.join(', ') || refs.veto?.labels?.join(', ') || null,
    risk_level: features.risk_level || refs.risk_level || 'LOW',
    risk_reason: null,
    filter_type: features.filter_type || refs.filter_type || null,
    filter_reason: features.filter_reason || refs.filter_reason || null,
    edge_buy_net: null,
    edge_sell_net: null,
    edge_net: null,
    predicted_direction: null,
    direction_correct: null,
    pnl_simulated: null,
    snapshot_draft_id: draftSnap?.file || null,
    snapshot_deep_id: deepSnap?.file || null,
    active_snapshot_type: hasDeep ? 'DEEP' : 'DRAFT',
    decision_snapshot_id,
    decision_b5_run_id,
    strategy_id: features.strategy_id || refs.strategy_id || null,
    is_topn: false,
    topn_rank: null,
    attribution_label: null,
    attribution_reason: null,
    attribution_confirmed: null,
    actual,
    virtual_notional: 100.0,
  };

  const result = await insertPostmortem(record);
  return { postmortem_id: result.postmortem_id, revision: result.revision, skipped: false };
}

/**
 * Backfill postmortems for all outcomes that don't have one yet.
 * Idempotent: skips outcomes that already have a postmortem with same outcome.
 *
 * @returns {Promise<{ processed: number, created: number, skipped: number, errors: string[] }>}
 */
export async function backfillPostmortems() {
  const outcomesDir = path.join(process.cwd(), 'data', 'outcomes');
  if (!fs.existsSync(outcomesDir)) {
    return { processed: 0, created: 0, skipped: 0, errors: [] };
  }

  const files = fs.readdirSync(outcomesDir).filter(f => f.endsWith('.json'));
  let processed = 0;
  let created = 0;
  let skipped = 0;
  const errors = [];

  for (const file of files) {
    processed++;
    try {
      const content = JSON.parse(fs.readFileSync(path.join(outcomesDir, file), 'utf8'));
      const result = await generatePostmortem({
        opp_id: content.opp_id,
        outcome: content.outcome,
        settled_at: content.settled_at,
        actual_price: content.actual_price,
        title: content.title,
      });
      if (result.skipped) {
        skipped++;
      } else {
        created++;
      }
    } catch (err) {
      errors.push(`${file}: ${err.message}`);
    }
  }

  return { processed, created, skipped, errors };
}

/**
 * Close DB connection (for test cleanup).
 */
export function closeDb() {
  if (_db) {
    _db.close();
    _db = null;
  }
}
