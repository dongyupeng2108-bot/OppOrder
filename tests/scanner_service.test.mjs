/**
 * scanner_service.test.mjs
 * M5.5-S3 (260305_003) tests: scanner service + snapshot store.
 *
 * Run: node tests/scanner_service.test.mjs
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

console.log('[TEST] scanner_service.test.mjs — running...');

const { runUniverse } = await import('../OppRadar/universe_service.mjs');
const { runScanner } = await import('../OppRadar/scanner_service.mjs');
const {
  getCoreSnapshot,
  getLatestCoreSnapshot,
  getScannerRun,
  getScannerRuns,
} = await import('../OppRadar/snapshot_store.mjs');

try {
  // First get a universe run to feed into scanner
  const universeRun = await runUniverse();

  // ── Test 1: runScanner returns ScannerRun with required fields ───────────
  let scannerRun;
  await test('1. runScanner returns ScannerRun with all required fields', async () => {
    scannerRun = await runScanner({ universeRun });
    assert.ok(scannerRun.scanner_run_id, 'must have scanner_run_id');
    assert.ok(scannerRun.scanner_run_id.startsWith('sr_'), 'ID must start with sr_');
    assert.equal(scannerRun.universe_run_id, universeRun.universe_run_id);
    assert.ok(scannerRun.ts_start, 'must have ts_start');
    assert.ok(scannerRun.ts_end, 'must have ts_end');
    assert.equal(typeof scannerRun.wall_time_ms, 'number');
    assert.equal(typeof scannerRun.core_success_count, 'number');
    assert.equal(typeof scannerRun.core_fail_count, 'number');
  });

  // ── Test 2: core_success_count matches universe market count ─────────────
  await test('2. core_success_count = universe market_count (mock mode)', async () => {
    assert.equal(
      scannerRun.core_success_count,
      universeRun.market_count,
      `success ${scannerRun.core_success_count} should equal market_count ${universeRun.market_count}`
    );
    assert.equal(scannerRun.core_fail_count, 0, 'no failures in mock mode');
  });

  // ── Test 3: pack_coverage shows SKIPPED for disabled packs ───────────────
  await test('3. pack_coverage shows SKIPPED for disabled packs', async () => {
    assert.ok(scannerRun.pack_coverage, 'pack_coverage must exist');
    assert.equal(scannerRun.pack_coverage.ORDERBOOK_L10, 'SKIPPED');
    assert.equal(scannerRun.pack_coverage.TRADE_STATS, 'SKIPPED');
  });

  // ── Test 4: getScannerRun retrieves from DB ──────────────────────────────
  await test('4. getScannerRun retrieves stored run', async () => {
    const stored = await getScannerRun(scannerRun.scanner_run_id);
    assert.ok(stored, 'should find stored run');
    assert.equal(stored.scanner_run_id, scannerRun.scanner_run_id);
    assert.equal(stored.core_success_count, scannerRun.core_success_count);
  });

  // ── Test 5: getLatestCoreSnapshot returns snapshot for a market ──────────
  await test('5. getLatestCoreSnapshot returns snapshot with correct fields', async () => {
    const marketId = universeRun.market_list[0];
    const snap = await getLatestCoreSnapshot(marketId);
    assert.ok(snap, `should find snapshot for market ${marketId}`);
    assert.equal(snap.market_id, marketId);
    assert.equal(typeof snap.best_bid, 'number');
    assert.equal(typeof snap.best_ask, 'number');
    assert.equal(typeof snap.mid_price, 'number');
    assert.equal(typeof snap.spread, 'number');
    assert.ok(snap.best_bid <= snap.best_ask, 'bid <= ask');
    // mid_price = (bid + ask) / 2 (frozen formula)
    const expectedMid = (snap.best_bid + snap.best_ask) / 2;
    assert.ok(Math.abs(snap.mid_price - expectedMid) < 0.0001,
      `mid_price ${snap.mid_price} should equal (bid+ask)/2 = ${expectedMid}`);
  });

  // ── Test 6: getCoreSnapshot by ID ────────────────────────────────────────
  await test('6. getCoreSnapshot retrieves by snapshot_id', async () => {
    const marketId = universeRun.market_list[0];
    const latest = await getLatestCoreSnapshot(marketId);
    const byId = await getCoreSnapshot(latest.snapshot_id);
    assert.ok(byId, 'should find by snapshot_id');
    assert.equal(byId.snapshot_id, latest.snapshot_id);
    assert.equal(byId.market_id, marketId);
  });

  // ── Test 7: getScannerRuns returns paginated list ────────────────────────
  await test('7. getScannerRuns returns paginated list', async () => {
    const { runs, total } = await getScannerRuns(10, 0);
    assert.ok(total >= 1, `total should be >= 1, got ${total}`);
    assert.ok(Array.isArray(runs), 'runs must be array');
    assert.ok(runs[0].scanner_run_id, 'run must have scanner_run_id');
  });

  // ── Test 8: ScannerRun validates against schema ──────────────────────────
  await test('8. ScannerRun matches schema required fields', async () => {
    const schemaPath = path.resolve('OppRadar/contracts/scanner_run.schema.json');
    const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
    for (const field of schema.required) {
      assert.ok(scannerRun[field] !== undefined,
        `required field "${field}" must be present, got ${scannerRun[field]}`);
    }
  });

  // ── Test 9: CoreSnapshot validates against schema ────────────────────────
  await test('9. CoreSnapshot matches schema required fields', async () => {
    const schemaPath = path.resolve('OppRadar/contracts/core_snapshot.schema.json');
    const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
    const snap = await getLatestCoreSnapshot(universeRun.market_list[0]);
    for (const field of schema.required) {
      assert.ok(snap[field] !== undefined,
        `required field "${field}" must be present`);
    }
  });

  // ── Test 10: runScanner without universeRun throws ───────────────────────
  await test('10. runScanner without universeRun throws error', async () => {
    try {
      await runScanner();
      assert.fail('should have thrown');
    } catch (err) {
      assert.ok(err.message.includes('universeRun'), `error should mention universeRun: ${err.message}`);
    }
  });

} finally {
  // no cleanup needed
}

if (failed > 0) {
  console.error(`\n[FAIL] ${failed} test(s) failed, ${passed} passed`);
  process.exit(1);
} else {
  console.log(`\n[ALL PASS] ${passed}/10 tests passed`);
}
