/**
 * outcome_store.mjs
 * M4-T6 (260301_019) + C1 (260302_011): Persistent storage for opportunity outcome records.
 *
 * Storage:  data/outcomes/<opp_id>.json  (one file per opportunity)
 * Semantics: append-only per-opp_id (same opp_id overwrites the single file —
 *            last-write wins; full history is not required by spec)
 *
 * C1 extension: added optional fields (predicted_price, entry_price, score,
 *   filter_label, risk_level) — backward compatible, all optional.
 *   Added queryOutcomes(filter) for conditional retrieval.
 *
 * Exports:
 *   saveOutcome({ opp_id, title, outcome, settled_at, actual_price, notes,
 *                 predicted_price?, entry_price?, score?, filter_label?, risk_level? })
 *   getOutcome(opp_id)
 *   listOutcomes()
 *   queryOutcomes(filter)
 */

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const OUTCOMES_DIR = path.resolve(__dirname, '../data/outcomes');

function ensureDir() {
  if (!fs.existsSync(OUTCOMES_DIR)) {
    fs.mkdirSync(OUTCOMES_DIR, { recursive: true });
  }
}

function outcomePath(opp_id) {
  // Sanitize opp_id: only allow alphanum, _, -
  const safe = String(opp_id).replace(/[^a-zA-Z0-9_\-]/g, '_');
  return path.join(OUTCOMES_DIR, `${safe}.json`);
}

/**
 * Save (or overwrite) an outcome record for the given opp_id.
 * C1 extension: optional fields (predicted_price, entry_price, score,
 *   filter_label, risk_level) are persisted if provided.
 *
 * @param {{ opp_id: string, title: string, outcome: 'YES'|'NO',
 *           settled_at: string, actual_price: number, notes?: string,
 *           predicted_price?: number, entry_price?: number,
 *           score?: number, filter_label?: string, risk_level?: string }} param0
 * @returns {object} The saved record.
 */
export function saveOutcome({ opp_id, title, outcome, settled_at, actual_price, notes,
                              predicted_price, entry_price, score, filter_label, risk_level }) {
  if (!opp_id)       throw new Error('saveOutcome: opp_id is required');
  if (!outcome)      throw new Error('saveOutcome: outcome is required');
  if (outcome !== 'YES' && outcome !== 'NO') {
    throw new Error('saveOutcome: outcome must be YES or NO');
  }
  if (!settled_at)   throw new Error('saveOutcome: settled_at is required');
  if (actual_price == null) throw new Error('saveOutcome: actual_price is required');

  ensureDir();

  const record = {
    opp_id,
    title:        title || '',
    outcome,
    settled_at,
    actual_price: parseFloat(actual_price),
    notes:        notes || '',
    recorded_at:  new Date().toISOString()
  };

  // C1 optional fields — only include if provided
  if (predicted_price != null) record.predicted_price = parseFloat(predicted_price);
  if (entry_price != null)     record.entry_price = parseFloat(entry_price);
  if (score != null)           record.score = parseFloat(score);
  if (filter_label != null)    record.filter_label = String(filter_label);
  if (risk_level != null)      record.risk_level = String(risk_level);

  fs.writeFileSync(outcomePath(opp_id), JSON.stringify(record, null, 2) + '\n', { encoding: 'utf8' });
  return record;
}

/**
 * Retrieve the outcome record for a specific opp_id.
 *
 * @param {string} opp_id
 * @returns {object|null} The record, or null if not found.
 */
export function getOutcome(opp_id) {
  ensureDir();
  const fp = outcomePath(opp_id);
  if (!fs.existsSync(fp)) return null;
  try {
    return JSON.parse(fs.readFileSync(fp, 'utf8'));
  } catch (_) {
    return null;
  }
}

/**
 * List all saved outcome records.
 *
 * @returns {object[]} Array of outcome records, sorted by recorded_at DESC.
 */
export function listOutcomes() {
  ensureDir();
  try {
    const files = fs.readdirSync(OUTCOMES_DIR).filter(f => f.endsWith('.json'));
    const records = [];
    for (const f of files) {
      try {
        const content = fs.readFileSync(path.join(OUTCOMES_DIR, f), 'utf8');
        records.push(JSON.parse(content));
      } catch (_) { /* skip corrupt files */ }
    }
    records.sort((a, b) => (b.recorded_at || '').localeCompare(a.recorded_at || ''));
    return records;
  } catch (_) {
    return [];
  }
}

/**
 * Query outcomes with optional filters.
 * C1 extension: supports filtering by outcome, filter_label, risk_level.
 *
 * @param {{ outcome?: 'YES'|'NO', filter_label?: string, risk_level?: string }} filter
 * @returns {object[]} Matching records, sorted by recorded_at DESC.
 */
export function queryOutcomes(filter = {}) {
  const all = listOutcomes();
  return all.filter(r => {
    if (filter.outcome && r.outcome !== filter.outcome) return false;
    if (filter.filter_label && r.filter_label !== filter.filter_label) return false;
    if (filter.risk_level && r.risk_level !== filter.risk_level) return false;
    return true;
  });
}
