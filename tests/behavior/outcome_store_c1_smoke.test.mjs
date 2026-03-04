/**
 * outcome_store_c1_smoke.test.mjs
 * Smoke test for C1 extensions:
 *   1. saveOutcome with new fields persists correctly
 *   2. queryOutcomes filters by outcome
 *   3. tracking_interface_v1 exports return stub structures
 *
 * Usage: node tests/behavior/outcome_store_c1_smoke.test.mjs
 */

import { strict as assert } from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { saveOutcome, getOutcome, queryOutcomes } from '../../OppRadar/outcome_store.mjs';
import { getTrackingStatus, getTrackingHistory } from '../../OppRadar/tracking_interface_v1.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTCOMES_DIR = path.resolve(__dirname, '../../data/outcomes');

const TEST_IDS = ['zztest_c1_001', 'zztest_c1_002', 'zztest_c1_003'];

function outcomeFile(opp_id) {
  const safe = opp_id.replace(/[^a-zA-Z0-9_\-]/g, '_');
  return path.join(OUTCOMES_DIR, `${safe}.json`);
}

function cleanup() {
  for (const id of TEST_IDS) {
    const fp = outcomeFile(id);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  }
  try {
    if (fs.existsSync(OUTCOMES_DIR) && fs.readdirSync(OUTCOMES_DIR).length === 0) {
      fs.rmdirSync(OUTCOMES_DIR);
    }
  } catch (_) {}
}

console.log('[TEST] outcome_store_c1_smoke — running...');

let passed = 0;

try {
  // ── Test 1: saveOutcome with C1 new fields ─────────────────────────────────
  const rec = saveOutcome({
    opp_id: 'zztest_c1_001',
    title: 'Test C1 fields',
    outcome: 'YES',
    settled_at: '2026-03-04T10:00:00Z',
    actual_price: 1.0,
    notes: 'C1 smoke',
    predicted_price: 0.72,
    entry_price: 0.55,
    score: 0.18,
    filter_label: 'UNKNOWN',
    risk_level: 'LOW',
  });

  assert.equal(rec.predicted_price, 0.72, 'predicted_price persisted');
  assert.equal(rec.entry_price, 0.55, 'entry_price persisted');
  assert.equal(rec.score, 0.18, 'score persisted');
  assert.equal(rec.filter_label, 'UNKNOWN', 'filter_label persisted');
  assert.equal(rec.risk_level, 'LOW', 'risk_level persisted');

  // Verify disk roundtrip
  const retrieved = getOutcome('zztest_c1_001');
  assert(retrieved !== null, 'getOutcome returns record');
  assert.equal(retrieved.predicted_price, 0.72, 'predicted_price survives roundtrip');
  assert.equal(retrieved.entry_price, 0.55, 'entry_price survives roundtrip');
  assert.equal(retrieved.score, 0.18, 'score survives roundtrip');
  assert.equal(retrieved.filter_label, 'UNKNOWN', 'filter_label survives roundtrip');
  assert.equal(retrieved.risk_level, 'LOW', 'risk_level survives roundtrip');
  console.log('  [PASS] 1. saveOutcome with C1 fields + disk roundtrip');
  passed++;

  // ── Test 2: backward compat — save without new fields ──────────────────────
  const recOld = saveOutcome({
    opp_id: 'zztest_c1_002',
    title: 'Old-style record',
    outcome: 'NO',
    settled_at: '2026-03-04T11:00:00Z',
    actual_price: 0.0,
  });
  assert.equal(recOld.outcome, 'NO');
  assert.equal(recOld.predicted_price, undefined, 'no predicted_price when not provided');
  assert.equal(recOld.filter_label, undefined, 'no filter_label when not provided');
  console.log('  [PASS] 2. backward compatibility — old-style save works');
  passed++;

  // ── Test 3: queryOutcomes by outcome filter ────────────────────────────────
  saveOutcome({
    opp_id: 'zztest_c1_003',
    title: 'Another YES',
    outcome: 'YES',
    settled_at: '2026-03-04T12:00:00Z',
    actual_price: 1.0,
    filter_label: 'SLOW',
  });

  const yesResults = queryOutcomes({ outcome: 'YES' });
  const testYes = yesResults.filter(r => r.opp_id && r.opp_id.startsWith('zztest_c1_'));
  assert(testYes.length >= 2, `queryOutcomes(YES) should find >=2 test records, got ${testYes.length}`);
  assert(testYes.every(r => r.outcome === 'YES'), 'all filtered records must be YES');

  const noResults = queryOutcomes({ outcome: 'NO' });
  const testNo = noResults.filter(r => r.opp_id && r.opp_id.startsWith('zztest_c1_'));
  assert.equal(testNo.length, 1, 'queryOutcomes(NO) should find exactly 1 test record');
  assert.equal(testNo[0].opp_id, 'zztest_c1_002');

  // queryOutcomes by filter_label
  const slowResults = queryOutcomes({ filter_label: 'SLOW' });
  const testSlow = slowResults.filter(r => r.opp_id && r.opp_id.startsWith('zztest_c1_'));
  assert(testSlow.length >= 1, 'queryOutcomes(SLOW) should find >=1 test record');
  assert(testSlow.every(r => r.filter_label === 'SLOW'), 'filtered by filter_label=SLOW');
  console.log('  [PASS] 3. queryOutcomes filters correctly');
  passed++;

  // ── Test 4: tracking_interface_v1 stub functions ───────────────────────────
  const status = getTrackingStatus('any_opp_id');
  assert.equal(status.status, 'stub', 'getTrackingStatus returns stub status');
  assert.equal(status.message, 'M6 接入点', 'getTrackingStatus returns M6 message');

  const history = getTrackingHistory('any_opp_id');
  assert.equal(history.status, 'stub', 'getTrackingHistory returns stub status');
  assert(Array.isArray(history.records), 'getTrackingHistory returns records array');
  assert.equal(history.records.length, 0, 'getTrackingHistory records is empty');
  console.log('  [PASS] 4. tracking_interface_v1 stub functions');
  passed++;

} finally {
  cleanup();
}

console.log(`\n[PASS] outcome_store_c1_smoke | ${passed}/4 tests passed`);
