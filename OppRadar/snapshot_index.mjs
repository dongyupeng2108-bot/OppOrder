/**
 * snapshot_index.mjs
 * Maintains a global append-only index of all snapshots at data/snapshots/index.json.
 *
 * Exports:
 *   appendSnapshot({ opp_id, title, file, snapshot_type, model_used, created_at })
 *   getIndex()
 *   getByOppId(opp_id)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Project root: OppRadar/ → root
const PROJECT_ROOT = path.resolve(__dirname, '..');
const SNAPSHOTS_DIR = path.join(PROJECT_ROOT, 'data', 'snapshots');
const INDEX_PATH = path.join(SNAPSHOTS_DIR, 'index.json');

function emptyIndex() {
  return {
    updated_at: new Date().toISOString(),
    total_snapshots: 0,
    entries: []
  };
}

function readIndex() {
  if (!fs.existsSync(INDEX_PATH)) {
    // Initialize the file on first access so it always exists on disk
    const init = emptyIndex();
    writeIndex(init);
    return init;
  }
  try {
    return JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'));
  } catch (_) {
    return emptyIndex();
  }
}

function writeIndex(index) {
  if (!fs.existsSync(SNAPSHOTS_DIR)) {
    fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true });
  }
  fs.writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2) + '\n', { encoding: 'utf8' });
}

/**
 * Append a snapshot record to the index (append-only).
 * If the opp_id already has an entry, appends to its snapshots list.
 * If not, creates a new entry.
 *
 * @param {{ opp_id: string, title: string, file: string, snapshot_type: string, model_used: string, created_at: string }} param0
 */
export function appendSnapshot({ opp_id, title, file, snapshot_type, model_used, created_at }) {
  const index = readIndex();

  const snapRecord = {
    file: file || '',
    snapshot_type: snapshot_type || 'draft',
    model_used: model_used || 'unknown',
    created_at: created_at || new Date().toISOString()
  };

  const existing = index.entries.find(e => e.opp_id === opp_id);
  if (existing) {
    existing.snapshots.push(snapRecord);
    if (title) existing.title = title;
  } else {
    index.entries.push({
      opp_id,
      title: title || '',
      snapshots: [snapRecord]
    });
  }

  index.updated_at = new Date().toISOString();
  index.total_snapshots = index.entries.reduce((sum, e) => sum + e.snapshots.length, 0);

  writeIndex(index);
}

/**
 * Return the full index object.
 */
export function getIndex() {
  return readIndex();
}

/**
 * Return the entry for a specific opp_id, or null if not found.
 */
export function getByOppId(opp_id) {
  const index = readIndex();
  return index.entries.find(e => e.opp_id === opp_id) || null;
}
