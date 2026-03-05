/**
 * scanner_routes.test.mjs
 * M5.5-S4 (260305_004) tests: scanner/universe HTTP endpoints.
 *
 * Prereq: server must be running on port 53122.
 * Run: node tests/scanner_routes.test.mjs
 */
import { strict as assert } from 'assert';

const PORT = 53122;
const BASE = `http://127.0.0.1:${PORT}`;

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

async function fetchJson(urlPath, opts = {}) {
  const res = await fetch(`${BASE}${urlPath}`, opts);
  const body = await res.json();
  return { status: res.status, body };
}

console.log('[TEST] scanner_routes.test.mjs — running...');

// Check server is reachable
try {
  await fetch(`${BASE}/`);
} catch (err) {
  console.error(`[SKIP] Server not reachable on port ${PORT}. Start server first.`);
  process.exit(0);
}

try {
  // ── Test 1: POST /scanner/run → 200 with correct response ───────────────
  let scannerRunId;
  await test('1. POST /scanner/run → 200 with scanner_run_id, counts, wall_time_ms', async () => {
    const { status, body } = await fetchJson('/scanner/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(status, 200, `expected 200, got ${status}: ${JSON.stringify(body)}`);
    assert.ok(body.scanner_run_id, 'must have scanner_run_id');
    assert.equal(typeof body.core_success_count, 'number');
    assert.equal(typeof body.core_fail_count, 'number');
    assert.equal(typeof body.wall_time_ms, 'number');
    scannerRunId = body.scanner_run_id;
  });

  // ── Test 2: GET /scanner/runs → 200 with runs + total ──────────────────
  await test('2. GET /scanner/runs → 200 with runs array and total', async () => {
    const { status, body } = await fetchJson('/scanner/runs');
    assert.equal(status, 200);
    assert.ok(Array.isArray(body.runs), 'runs must be array');
    assert.equal(typeof body.total, 'number');
  });

  // ── Test 3: GET /universe/runs → 200 with runs + total ─────────────────
  await test('3. GET /universe/runs → 200 with runs array and total', async () => {
    const { status, body } = await fetchJson('/universe/runs');
    assert.equal(status, 200);
    assert.ok(Array.isArray(body.runs), 'runs must be array');
    assert.equal(typeof body.total, 'number');
  });

  // ── Test 4: GET /snapshots/core/nonexistent → 404 ──────────────────────
  await test('4. GET /snapshots/core/nonexistent_market_id_12345 → 404', async () => {
    const { status, body } = await fetchJson('/snapshots/core/nonexistent_market_id_12345');
    assert.equal(status, 404);
    assert.ok(body.error, 'should have error message');
  });

  // ── Test 5: POST /scans/run → 200 (backward compatibility) ─────────────
  await test('5. POST /scans/run → 200 (original endpoint still works)', async () => {
    const res = await fetch(`${BASE}/scans/run`, { method: 'POST' });
    assert.equal(res.status, 200, `expected 200, got ${res.status}`);
  });

  // ── Test 6: GET / → 200 (UI page) ──────────────────────────────────────
  await test('6. GET / → 200 (UI page normal)', async () => {
    const res = await fetch(`${BASE}/`);
    assert.equal(res.status, 200);
  });

} finally {
  // no cleanup
}

if (failed > 0) {
  console.error(`\n[FAIL] ${failed} test(s) failed, ${passed} passed`);
  process.exit(1);
} else {
  console.log(`\n[ALL PASS] ${passed}/6 tests passed`);
}
