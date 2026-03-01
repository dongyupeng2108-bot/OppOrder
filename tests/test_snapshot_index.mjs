/**
 * test_snapshot_index.mjs
 * Unit tests for snapshot_index.mjs (appendSnapshot, getIndex, getByOppId).
 *
 * data/snapshots/ is gitignored — writes here are safe from git tracking.
 * Uses backup/restore + per-test reset to avoid cross-test contamination.
 * Run: node tests/test_snapshot_index.mjs
 */
import { strict as assert } from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// Mirror the path resolution inside snapshot_index.mjs
const OPP_RADAR_DIR = path.resolve(__dirname, '../OppRadar');
const PROJECT_ROOT  = path.resolve(OPP_RADAR_DIR, '..');
const SNAPSHOTS_DIR = path.join(PROJECT_ROOT, 'data', 'snapshots');
const INDEX_PATH    = path.join(SNAPSHOTS_DIR, 'index.json');
const BACKUP_PATH   = INDEX_PATH + '.test_backup';

// Backup any pre-existing index so we don't pollute production data
let hadPreexisting = false;
if (fs.existsSync(INDEX_PATH)) {
  fs.copyFileSync(INDEX_PATH, BACKUP_PATH);
  fs.unlinkSync(INDEX_PATH);
  hadPreexisting = true;
}

// Import AFTER backup (module init does no file I/O — safe with static import)
import { appendSnapshot, getIndex, getByOppId } from '../OppRadar/snapshot_index.mjs';

console.log('[TEST] Running test_snapshot_index...');

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  [PASS] ${name}`);
    passed++;
  } catch (err) {
    console.error(`  [FAIL] ${name}: ${err.message}`);
    failed++;
  }
}

// Delete the index file so each test starts from a clean slate
function resetIndex() {
  if (fs.existsSync(INDEX_PATH)) {
    fs.unlinkSync(INDEX_PATH);
  }
}

try {
  // ── Test 1: getIndex() returns empty structure when no file exists ───────────
  await test('1. getIndex() returns empty structure when no index file', () => {
    resetIndex();

    const idx = getIndex();

    assert(Array.isArray(idx.entries),       'entries must be an array');
    assert.equal(idx.entries.length, 0,      'entries must be empty');
    assert.equal(idx.total_snapshots, 0,     'total_snapshots must be 0');
    assert(typeof idx.updated_at === 'string', 'updated_at must be a string');
  });

  // ── Test 2: appendSnapshot same opp_id twice → 2 snapshot records (append-only) ─
  await test('2. appendSnapshot same opp_id twice → 2 records, first not overwritten', () => {
    resetIndex();

    appendSnapshot({
      opp_id: 'op_test_aaa',
      title:  'Test Opp A',
      file:   'snap_v1.json',
      snapshot_type: 'draft',
      model_used:    'mock',
      created_at:    '2026-03-01T10:00:00Z',
    });
    appendSnapshot({
      opp_id: 'op_test_aaa',
      title:  'Test Opp A v2',
      file:   'snap_v2.json',
      snapshot_type: 'final',
      model_used:    'mock',
      created_at:    '2026-03-01T11:00:00Z',
    });

    const idx = getIndex();
    const entry = idx.entries.find(e => e.opp_id === 'op_test_aaa');

    assert(entry, 'entry for op_test_aaa must exist');
    assert.equal(entry.snapshots.length, 2, 'must have 2 snapshot records');

    // First record must still be present (append-only, not overwritten)
    assert.equal(entry.snapshots[0].file, 'snap_v1.json', 'first snapshot file must be snap_v1.json');
    assert.equal(entry.snapshots[1].file, 'snap_v2.json', 'second snapshot file must be snap_v2.json');
  });

  // ── Test 3: appendSnapshot two different opp_ids → 2 separate entries ────────
  await test('3. appendSnapshot two different opp_ids → 2 distinct entries', () => {
    resetIndex();

    appendSnapshot({ opp_id: 'op_test_bbb', title: 'Opp B', file: 'b.json', created_at: '2026-03-01T09:00:00Z' });
    appendSnapshot({ opp_id: 'op_test_ccc', title: 'Opp C', file: 'c.json', created_at: '2026-03-01T09:30:00Z' });

    const idx = getIndex();

    assert.equal(idx.entries.length, 2, 'must have exactly 2 entries');

    const entryB = idx.entries.find(e => e.opp_id === 'op_test_bbb');
    const entryC = idx.entries.find(e => e.opp_id === 'op_test_ccc');

    assert(entryB, 'entry for op_test_bbb must exist');
    assert(entryC, 'entry for op_test_ccc must exist');
    assert.equal(entryB.snapshots.length, 1, 'op_test_bbb must have 1 snapshot');
    assert.equal(entryC.snapshots.length, 1, 'op_test_ccc must have 1 snapshot');
  });

  // ── Test 4: getByOppId — existing and non-existing ───────────────────────────
  await test('4. getByOppId: returns correct entry / returns null for missing', () => {
    resetIndex();

    appendSnapshot({ opp_id: 'op_test_ddd', title: 'Opp D', file: 'd.json', created_at: '2026-03-01T08:00:00Z' });

    // Existing
    const found = getByOppId('op_test_ddd');
    assert(found !== null && found !== undefined, 'must return entry for existing opp_id');
    assert.equal(found.opp_id, 'op_test_ddd', 'opp_id must match');
    assert.equal(found.title, 'Opp D', 'title must match');

    // Non-existing
    const notFound = getByOppId('op_test_zzz_nonexistent');
    assert(notFound === null || notFound === undefined, 'must return null/undefined for missing opp_id');
  });

  // ── Test 5: total_snapshots count after 3 appends ────────────────────────────
  await test('5. total_snapshots === 3 after 3 appendSnapshot calls', () => {
    resetIndex();

    appendSnapshot({ opp_id: 'op_test_eee', title: 'Opp E', file: 'e1.json', created_at: '2026-03-01T07:00:00Z' });
    appendSnapshot({ opp_id: 'op_test_fff', title: 'Opp F', file: 'f1.json', created_at: '2026-03-01T07:10:00Z' });
    appendSnapshot({ opp_id: 'op_test_eee', title: 'Opp E', file: 'e2.json', created_at: '2026-03-01T07:20:00Z' });

    const idx = getIndex();
    assert.equal(idx.total_snapshots, 3, 'total_snapshots must equal 3 after 3 appends');
  });

} finally {
  // Clean up test index file
  if (fs.existsSync(INDEX_PATH)) {
    fs.unlinkSync(INDEX_PATH);
  }
  // Restore pre-existing production index if there was one
  if (hadPreexisting && fs.existsSync(BACKUP_PATH)) {
    fs.copyFileSync(BACKUP_PATH, INDEX_PATH);
    fs.unlinkSync(BACKUP_PATH);
  } else if (fs.existsSync(BACKUP_PATH)) {
    fs.unlinkSync(BACKUP_PATH);
  }
}

// ── Summary ───────────────────────────────────────────────────────────────────
if (failed > 0) {
  console.error(`\n[FAIL] ${failed} test(s) failed, ${passed} passed`);
  process.exit(1);
} else {
  console.log(`\n[ALL PASS] ${passed} tests passed`);
}
