/**
 * test_eligible_filter.mjs
 * Unit tests for polymarket_eligible_filter.mjs (applyEligibleFilter).
 * Pure function — no file I/O, no cleanup needed.
 * Run: node tests/test_eligible_filter.mjs
 */
import { strict as assert } from 'assert';
import { applyEligibleFilter } from '../OppRadar/polymarket_eligible_filter.mjs';

console.log('[TEST] Running test_eligible_filter...');

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

// Helper: build a valid market that passes all 5 filters by default
function validMarket(overrides = {}) {
  const soon = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(); // 10 days out
  return {
    title: 'Will inflation be above 5%?',
    question: '',
    event_time: soon,
    yes_price: 0.5,
    ...overrides,
  };
}

// ── Test 1: Numeric threshold proposition ─────────────────────────────────────
await test('1. Numeric threshold: PASS (title "above 5%") / FAIL (no numeric comparison)', () => {
  // PASS
  const pass = validMarket({ title: 'Will rate be above 5%?' });
  const { candidates: c1 } = applyEligibleFilter([pass]);
  assert.equal(c1.length, 1, 'numeric-match title should pass');

  // FAIL
  const fail = validMarket({ title: 'Will the president resign?', question: '' });
  const { candidates: c2, scan_stats: s2 } = applyEligibleFilter([fail]);
  assert.equal(c2.length, 0, 'no numeric comparison should be filtered');
  assert.equal(s2.filter_breakdown.no_numeric_threshold, 1, 'no_numeric_threshold counter must be 1');
});

// ── Test 2: event_time filter ─────────────────────────────────────────────────
await test('2. event_time: PASS (valid ISO8601) / FAIL (null) / FAIL (empty string)', () => {
  const soon = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();

  // PASS
  const pass = validMarket({ event_time: soon });
  const { candidates: c1 } = applyEligibleFilter([pass]);
  assert.equal(c1.length, 1, 'valid ISO8601 event_time should pass');

  // FAIL: null
  const failNull = validMarket({ event_time: null });
  const { candidates: c2, scan_stats: s2 } = applyEligibleFilter([failNull]);
  assert.equal(c2.length, 0, 'null event_time should be filtered');
  assert.equal(s2.filter_breakdown.no_event_time, 1, 'no_event_time counter for null');

  // FAIL: empty string
  const failEmpty = validMarket({ event_time: '' });
  const { candidates: c3, scan_stats: s3 } = applyEligibleFilter([failEmpty]);
  assert.equal(c3.length, 0, 'empty event_time should be filtered');
  assert.equal(s3.filter_breakdown.no_event_time, 1, 'no_event_time counter for empty string');
});

// ── Test 3: TTL30d filter ─────────────────────────────────────────────────────
await test('3. TTL30d: PASS (within 30 days) / FAIL (exceeds 30 days)', () => {
  // PASS: 10 days out
  const within = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
  const pass = validMarket({ event_time: within });
  const { candidates: c1 } = applyEligibleFilter([pass]);
  assert.equal(c1.length, 1, 'event within 30d should pass');

  // FAIL: 60 days out
  const far = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString();
  const fail = validMarket({ event_time: far });
  const { candidates: c2, scan_stats: s2 } = applyEligibleFilter([fail]);
  assert.equal(c2.length, 0, 'event > 30d should be filtered');
  assert.equal(s2.filter_breakdown.ttl_exceeded, 1, 'ttl_exceeded counter must be 1');
});

// ── Test 4: yes_price range filter ────────────────────────────────────────────
await test('4. yes_price: PASS (0.5) / FAIL (0.02 < 0.05) / FAIL (0.98 > 0.95)', () => {
  // PASS
  const pass = validMarket({ yes_price: 0.5 });
  const { candidates: c1 } = applyEligibleFilter([pass]);
  assert.equal(c1.length, 1, 'yes_price=0.5 should pass');

  // FAIL: too low
  const failLow = validMarket({ yes_price: 0.02 });
  const { candidates: c2, scan_stats: s2 } = applyEligibleFilter([failLow]);
  assert.equal(c2.length, 0, 'yes_price=0.02 should be filtered (< 0.05)');
  assert.equal(s2.filter_breakdown.price_out_of_range, 1, 'price_out_of_range counter (low)');

  // FAIL: too high
  const failHigh = validMarket({ yes_price: 0.98 });
  const { candidates: c3, scan_stats: s3 } = applyEligibleFilter([failHigh]);
  assert.equal(c3.length, 0, 'yes_price=0.98 should be filtered (> 0.95)');
  assert.equal(s3.filter_breakdown.price_out_of_range, 1, 'price_out_of_range counter (high)');
});

// ── Test 5: candidate cap ─────────────────────────────────────────────────────
await test('5. Candidate cap: 60 valid markets → output ≤ 50', () => {
  // All markets pass all 4 hard filters; cap should limit to 50
  const markets = Array.from({ length: 60 }, (_, i) => validMarket({
    title: `Will rate exceed ${i + 1}%?`,
    yes_price: 0.1 + (i % 40) * 0.02, // range 0.10..0.88, all within (0.05, 0.95)
  }));
  const { candidates, scan_stats } = applyEligibleFilter(markets);
  assert(candidates.length <= 50, `expected ≤ 50 candidates, got ${candidates.length}`);
  assert.equal(scan_stats.fetched_total, 60, 'fetched_total must be 60');
  assert(scan_stats.passed_eligible <= 50, 'passed_eligible must be ≤ 50 after cap');
});

// ── Test 6: scan_stats structure verification ─────────────────────────────────
await test('6. scan_stats: filter_breakdown four keys + numeric counters correct', () => {
  const markets = [
    validMarket(),                                               // passes all filters
    validMarket({ title: 'Will peace arrive?', question: '' }), // filtered: no_numeric_threshold
    validMarket({ event_time: null }),                           // filtered: no_event_time
    validMarket({ yes_price: 0.01 }),                           // filtered: price_out_of_range
  ];
  const { candidates, scan_stats } = applyEligibleFilter(markets);

  const fb = scan_stats.filter_breakdown;
  assert('no_numeric_threshold' in fb, 'filter_breakdown.no_numeric_threshold missing');
  assert('no_event_time'        in fb, 'filter_breakdown.no_event_time missing');
  assert('ttl_exceeded'         in fb, 'filter_breakdown.ttl_exceeded missing');
  assert('price_out_of_range'   in fb, 'filter_breakdown.price_out_of_range missing');

  assert.equal(typeof scan_stats.fetched_total,   'number', 'fetched_total must be number');
  assert.equal(typeof scan_stats.passed_eligible, 'number', 'passed_eligible must be number');
  assert.equal(typeof scan_stats.filtered_out,    'number', 'filtered_out must be number');

  assert.equal(scan_stats.fetched_total,   4,                 'fetched_total should be 4');
  assert.equal(scan_stats.passed_eligible, candidates.length, 'passed_eligible === candidates.length');
  assert.equal(
    scan_stats.filtered_out,
    scan_stats.fetched_total - scan_stats.passed_eligible,
    'filtered_out === fetched_total - passed_eligible',
  );
});

// ── Summary ───────────────────────────────────────────────────────────────────
if (failed > 0) {
  console.error(`\n[FAIL] ${failed} test(s) failed, ${passed} passed`);
  process.exit(1);
} else {
  console.log(`\n[ALL PASS] ${passed} tests passed`);
}
