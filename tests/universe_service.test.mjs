/**
 * universe_service.test.mjs
 * M5.5-S2 (260305_002) tests: universe extraction service.
 *
 * Run: node tests/universe_service.test.mjs
 */
import { strict as assert } from 'assert';
import fs from 'fs';
import path from 'path';

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

console.log('[TEST] universe_service.test.mjs — running...');

// Import the module (will use mock markets since no network in test)
const { runUniverse, getUniverseRuns } = await import('../OppRadar/universe_service.mjs');

try {
  // ── Test 1: runUniverse returns correct structure ──────────────────────────
  let universeRun;
  await test('1. runUniverse returns UniverseRun with required fields', async () => {
    universeRun = await runUniverse();
    assert.ok(universeRun.universe_run_id, 'must have universe_run_id');
    assert.ok(universeRun.universe_run_id.startsWith('ur_'), 'ID must start with ur_');
    assert.equal(universeRun.universe_id, 'main');
    assert.ok(universeRun.config_hash, 'must have config_hash');
    assert.ok(universeRun.ts_start, 'must have ts_start');
    assert.ok(universeRun.ts_end, 'must have ts_end');
    assert.equal(typeof universeRun.market_count, 'number');
    assert.ok(Array.isArray(universeRun.market_list), 'market_list must be array');
    assert.equal(universeRun.market_count, universeRun.market_list.length);
  });

  // ── Test 2: filter_counts has expected layers ─────────────────────────────
  await test('2. filter_counts has all layer fields', async () => {
    const fc = universeRun.filter_counts;
    assert.ok(fc, 'filter_counts must exist');
    assert.equal(typeof fc.total, 'number');
    assert.equal(typeof fc.after_settled, 'number');
    assert.equal(typeof fc.after_numeric_threshold, 'number');
    assert.equal(typeof fc.after_event_time, 'number');
    assert.equal(typeof fc.after_ttl, 'number');
    assert.equal(typeof fc.after_price, 'number');
    assert.equal(typeof fc.final, 'number');
    assert.ok(fc.total >= fc.final, 'total >= final');
  });

  // ── Test 3: list_digest structure ─────────────────────────────────────────
  await test('3. list_digest has first3, last3, count, list_hash', async () => {
    const ld = universeRun.list_digest;
    assert.ok(ld, 'list_digest must exist');
    assert.ok(Array.isArray(ld.first3), 'first3 must be array');
    assert.ok(Array.isArray(ld.last3), 'last3 must be array');
    assert.equal(ld.count, universeRun.market_count);
    assert.ok(ld.list_hash, 'list_hash must exist');
    assert.equal(ld.list_hash.length, 64, 'list_hash must be SHA256 hex (64 chars)');
  });

  // ── Test 4: config_hash is deterministic ──────────────────────────────────
  await test('4. config_hash is deterministic (same spec = same hash)', async () => {
    const run2 = await runUniverse();
    assert.equal(run2.config_hash, universeRun.config_hash,
      'same spec should produce same config_hash');
  });

  // ── Test 5: candidate_limit enforced (max 50) ────────────────────────────
  await test('5. candidate_limit enforced (market_count <= 50)', async () => {
    assert.ok(universeRun.market_count <= 50,
      `market_count ${universeRun.market_count} should be <= 50`);
  });

  // ── Test 6: source field is polymarket_api ────────────────────────────────
  await test('6. source field is polymarket_api', async () => {
    assert.equal(universeRun.source, 'polymarket_api');
  });

  // ── Test 7: getUniverseRuns returns runs from DB ──────────────────────────
  await test('7. getUniverseRuns returns stored runs', async () => {
    const { runs, total } = await getUniverseRuns();
    assert.ok(total >= 2, `total should be >= 2 (we ran twice), got ${total}`);
    assert.ok(Array.isArray(runs), 'runs must be array');
    assert.ok(runs.length > 0, 'should have at least 1 run');
    assert.ok(runs[0].universe_run_id, 'run must have universe_run_id');
    assert.ok(runs[0].list_digest, 'run must have list_digest (parsed)');
  });

  // ── Test 8: universe_run validates against schema ─────────────────────────
  await test('8. UniverseRun matches schema required fields', async () => {
    const schemaPath = path.resolve('OppRadar/contracts/universe_run.schema.json');
    const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
    for (const field of schema.required) {
      assert.ok(universeRun[field] !== undefined,
        `required field "${field}" must be present`);
    }
  });

} finally {
  // no cleanup needed
}

if (failed > 0) {
  console.error(`\n[FAIL] ${failed} test(s) failed, ${passed} passed`);
  process.exit(1);
} else {
  console.log(`\n[ALL PASS] ${passed}/8 tests passed`);
}
