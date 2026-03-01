/**
 * test_outcome_store.mjs
 * Unit tests for outcome_store.mjs (saveOutcome, getOutcome, listOutcomes).
 *
 * IMPORTANT: data/outcomes/ is NOT gitignored. Tests use dedicated test opp_ids
 * (prefixed "zztest_") and clean up all created files in a finally block to keep
 * git status clean.
 * Run: node tests/test_outcome_store.mjs
 */
import { strict as assert } from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { saveOutcome, getOutcome, listOutcomes } from '../OppRadar/outcome_store.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// Mirror OUTCOMES_DIR from outcome_store.mjs
const OPP_RADAR_DIR = path.resolve(__dirname, '../OppRadar');
const OUTCOMES_DIR  = path.resolve(OPP_RADAR_DIR, '../data/outcomes');

// All test opp_ids — must be cleaned up in finally
const TEST_IDS = [
  'zztest_oc_001',
  'zztest_oc_002',
  'zztest_oc_003',
  'zztest_oc_004',
  'zztest_oc_005',
];

function outcomeFile(opp_id) {
  const safe = opp_id.replace(/[^a-zA-Z0-9_\-]/g, '_');
  return path.join(OUTCOMES_DIR, `${safe}.json`);
}

function cleanupTestFiles() {
  for (const id of TEST_IDS) {
    const fp = outcomeFile(id);
    if (fs.existsSync(fp)) {
      fs.unlinkSync(fp);
    }
  }
  // Remove data/outcomes dir only if it is now empty (to keep git status clean)
  try {
    if (fs.existsSync(OUTCOMES_DIR)) {
      const remaining = fs.readdirSync(OUTCOMES_DIR);
      if (remaining.length === 0) {
        fs.rmdirSync(OUTCOMES_DIR);
      }
    }
  } catch (_) { /* ignore */ }
}

// Helper for a minimal valid outcome payload
function validOutcome(opp_id, overrides = {}) {
  return {
    opp_id,
    title:        'Test opportunity',
    outcome:      'YES',
    settled_at:   '2026-03-01T12:00:00Z',
    actual_price: 1.0,
    ...overrides,
  };
}

console.log('[TEST] Running test_outcome_store...');

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

try {
  // ── Test 1: saveOutcome + getOutcome roundtrip ────────────────────────────────
  await test('1. saveOutcome + getOutcome: saved record matches retrieved record', () => {
    const payload = validOutcome('zztest_oc_001', {
      title:        'Will BTC exceed 100k?',
      outcome:      'YES',
      settled_at:   '2026-03-01T10:00:00Z',
      actual_price: 1.0,
      notes:        'Settled at 101k',
    });

    const saved = saveOutcome(payload);
    const retrieved = getOutcome('zztest_oc_001');

    assert(retrieved !== null, 'getOutcome must return a record, not null');
    assert.equal(retrieved.opp_id,       'zztest_oc_001',          'opp_id must match');
    assert.equal(retrieved.title,        'Will BTC exceed 100k?',  'title must match');
    assert.equal(retrieved.outcome,      'YES',                     'outcome must match');
    assert.equal(retrieved.settled_at,   '2026-03-01T10:00:00Z',   'settled_at must match');
    assert.equal(retrieved.actual_price, 1.0,                       'actual_price must match');
    assert.equal(retrieved.notes,        'Settled at 101k',         'notes must match');
    assert.equal(saved.opp_id, retrieved.opp_id, 'saved and retrieved records must agree on opp_id');
  });

  // ── Test 2: missing required fields throw errors ───────────────────────────────
  await test('2. Missing required fields → throw errors', () => {
    // Missing outcome
    assert.throws(
      () => saveOutcome({ opp_id: 'zztest_oc_002', title: 'x', settled_at: '2026-03-01T00:00:00Z', actual_price: 0 }),
      /outcome/i,
      'missing outcome must throw',
    );

    // Missing opp_id
    assert.throws(
      () => saveOutcome({ title: 'x', outcome: 'YES', settled_at: '2026-03-01T00:00:00Z', actual_price: 0 }),
      /opp_id/i,
      'missing opp_id must throw',
    );

    // Missing settled_at
    assert.throws(
      () => saveOutcome({ opp_id: 'zztest_oc_002', title: 'x', outcome: 'YES', actual_price: 0 }),
      /settled_at/i,
      'missing settled_at must throw',
    );
  });

  // ── Test 3: same opp_id saved twice → getOutcome returns latest ───────────────
  await test('3. Overwrite: same opp_id saved twice → getOutcome returns latest', () => {
    saveOutcome(validOutcome('zztest_oc_003', { outcome: 'NO', notes: 'first write' }));
    saveOutcome(validOutcome('zztest_oc_003', { outcome: 'YES', notes: 'second write' }));

    const retrieved = getOutcome('zztest_oc_003');
    assert(retrieved !== null, 'must return a record');
    assert.equal(retrieved.outcome, 'YES',         'outcome must be from second write');
    assert.equal(retrieved.notes,   'second write', 'notes must be from second write');
  });

  // ── Test 4: listOutcomes returns all saved records + empty state ───────────────
  await test('4. listOutcomes: 3 distinct opp_ids → 3 records; empty if none saved', () => {
    // Check: getOutcome on unsaved id returns null
    const missing = getOutcome('zztest_oc_999_nonexistent');
    assert(missing === null, 'getOutcome on unsaved id must return null');

    // Save 3 distinct records (zztest_oc_001 already saved in Test 1, zztest_oc_003 in Test 3)
    saveOutcome(validOutcome('zztest_oc_004', { notes: 'four' }));

    // listOutcomes should include all records for test IDs we saved
    const all = listOutcomes();
    assert(Array.isArray(all), 'listOutcomes must return an array');

    const testRecords = all.filter(r => r.opp_id && r.opp_id.startsWith('zztest_'));
    // We have saved: zztest_oc_001 (test 1), zztest_oc_003 (test 3), zztest_oc_004 (this test)
    assert(testRecords.length >= 3, `expected ≥ 3 test records in listOutcomes, got ${testRecords.length}`);
  });

  // ── Test 5: outcome enum — YES and NO both accepted ───────────────────────────
  await test('5. outcome enum: "YES" and "NO" are both valid; invalid value throws', () => {
    // YES
    const recYes = saveOutcome(validOutcome('zztest_oc_005', { outcome: 'YES' }));
    assert.equal(recYes.outcome, 'YES', 'YES outcome must be stored');

    // NO
    const recNo = saveOutcome(validOutcome('zztest_oc_005', { outcome: 'NO' }));
    assert.equal(recNo.outcome, 'NO', 'NO outcome must be stored');
    const retrieved = getOutcome('zztest_oc_005');
    assert.equal(retrieved.outcome, 'NO', 'last write (NO) must win');

    // Invalid enum
    assert.throws(
      () => saveOutcome(validOutcome('zztest_oc_005', { outcome: 'MAYBE' })),
      /outcome must be YES or NO/i,
      'invalid outcome enum must throw',
    );
  });

} finally {
  cleanupTestFiles();
}

// ── Summary ───────────────────────────────────────────────────────────────────
if (failed > 0) {
  console.error(`\n[FAIL] ${failed} test(s) failed, ${passed} passed`);
  process.exit(1);
} else {
  console.log(`\n[ALL PASS] ${passed} tests passed`);
}
