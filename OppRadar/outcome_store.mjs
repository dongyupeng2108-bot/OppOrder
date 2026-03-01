/**
 * outcome_store.mjs
 * M4-T6 (260301_019): Persistent storage for opportunity outcome records.
 *
 * Storage:  data/outcomes/<opp_id>.json  (one file per opportunity)
 * Semantics: append-only per-opp_id (same opp_id overwrites the single file —
 *            last-write wins; full history is not required by spec)
 *
 * Exports:
 *   saveOutcome({ opp_id, title, outcome, settled_at, actual_price, notes })
 *   getOutcome(opp_id)
 *   listOutcomes()
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
 *
 * @param {{ opp_id: string, title: string, outcome: 'YES'|'NO',
 *           settled_at: string, actual_price: number, notes?: string }} param0
 * @returns {object} The saved record.
 */
export function saveOutcome({ opp_id, title, outcome, settled_at, actual_price, notes }) {
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
