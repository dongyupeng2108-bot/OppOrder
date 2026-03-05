/**
 * postmortem_routes.test.mjs
 * M6-A4 (260302_017) tests: HTTP integration tests for 4 postmortem endpoints.
 *
 * Prereq: server must be running on port 53122.
 * Run: node tests/postmortem_routes.test.mjs
 */
import { strict as assert } from 'assert';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const PORT = 53122;
const BASE = `http://127.0.0.1:${PORT}`;

// Test opp_id with unique prefix to avoid collision
const TEST_OPP = `opp_routes_test_${Date.now()}`;
const OUTCOMES_DIR = path.join(process.cwd(), 'data', 'outcomes');

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

console.log('[TEST] postmortem_routes.test.mjs — running...');

// ── Check server is reachable ──────────────────────────────────────────────
try {
  await fetch(`${BASE}/`);
} catch (err) {
  console.error(`[SKIP] Server not reachable on port ${PORT}. Start server first.`);
  process.exit(0);
}

// ── Seed test outcome file ─────────────────────────────────────────────────
if (!fs.existsSync(OUTCOMES_DIR)) fs.mkdirSync(OUTCOMES_DIR, { recursive: true });
const outcomeFile = path.join(OUTCOMES_DIR, `${TEST_OPP}.json`);
fs.writeFileSync(outcomeFile, JSON.stringify({
  opp_id: TEST_OPP,
  title: 'Routes test outcome',
  outcome: 'YES',
  settled_at: '2026-03-05T12:00:00Z',
  actual_price: 1.05,
  recorded_at: new Date().toISOString(),
}), 'utf8');

// ── Seed test postmortem via outcome recording endpoint (if available) ──────
// Or seed directly into DB. We'll use the store directly.
let sqlite3;
try { sqlite3 = require('sqlite3').verbose(); } catch (_) {}

const DB_DIR = path.join(process.cwd(), 'data', 'runtime');
const DB_PATH = path.join(DB_DIR, 'oppradar.sqlite');
let db = null;

function runSql(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) { err ? reject(err) : resolve(this); });
  });
}

if (sqlite3 && fs.existsSync(DB_PATH)) {
  db = new sqlite3.Database(DB_PATH);
}

try {
  // ── Test 1: GET /postmortem/pending returns paginated list ────────────────
  await test('1. GET /postmortem/pending returns items array', async () => {
    const { status, body } = await fetchJson('/postmortem/pending');
    assert.equal(status, 200);
    assert.ok(Array.isArray(body.items), 'items must be an array');
    assert.equal(typeof body.total, 'number');
    assert.equal(typeof body.limit, 'number');
    assert.equal(typeof body.offset, 'number');
  });

  // ── Test 2: GET /postmortem/pending respects limit/offset ────────────────
  await test('2. GET /postmortem/pending respects limit param', async () => {
    const { status, body } = await fetchJson('/postmortem/pending?limit=1&offset=0');
    assert.equal(status, 200);
    assert.ok(body.items.length <= 1, 'limit=1 should return at most 1 item');
    assert.equal(body.limit, 1);
    assert.equal(body.offset, 0);
  });

  // ── Test 3: GET /postmortem/stats returns stats structure ─────────────────
  await test('3. GET /postmortem/stats returns groups+total', async () => {
    const { status, body } = await fetchJson('/postmortem/stats');
    assert.equal(status, 200);
    assert.ok(Array.isArray(body.groups), 'groups must be an array');
    assert.equal(typeof body.total, 'object');
    assert.ok(body.meta, 'meta must be present');
  });

  // ── Test 4: GET /postmortem/stats with group_by ──────────────────────────
  await test('4. GET /postmortem/stats?group_by=veto_status works', async () => {
    const { status, body } = await fetchJson('/postmortem/stats?group_by=veto_status');
    assert.equal(status, 200);
    assert.ok(Array.isArray(body.groups));
    for (const g of body.groups) {
      assert.ok(g.group_key !== undefined, 'each group must have group_key');
    }
  });

  // ── Test 5: GET /postmortem/stats with invalid group_by → 400 ────────────
  await test('5. GET /postmortem/stats?group_by=invalid_field → 400', async () => {
    const { status, body } = await fetchJson('/postmortem/stats?group_by=invalid_field');
    assert.equal(status, 400, 'invalid group_by should return 400');
    assert.ok(body.error, 'should have error message');
  });

  // ── Seed a postmortem for card + note tests ──────────────────────────────
  if (db) {
    try {
      await runSql(`INSERT OR IGNORE INTO postmortem (
        postmortem_id, opp_id, outcome, outcome_ts,
        market_price_at_scan, market_price_at_settlement,
        p_baseline_low, p_baseline_mid, p_baseline_high,
        confidence, veto_status, veto_reason,
        risk_level, risk_reason, filter_type, filter_reason,
        edge_buy_net, edge_sell_net, edge_net,
        predicted_direction, direction_correct, pnl_simulated,
        snapshot_draft_id, snapshot_deep_id,
        active_snapshot_type, decision_snapshot_id, decision_b5_run_id,
        strategy_id, is_topn, topn_rank,
        attribution_label, attribution_reason, attribution_confirmed,
        actual, virtual_notional,
        revision, is_latest, created_at
      ) VALUES (?,?,?,?, ?,?, ?,?,?, ?,?,?, ?,?,?,?, ?,?,?, ?,?,?, ?,?, ?,?,?, ?,?,?, ?,?,?, ?,?, ?,?,?)`, [
        `pm_${TEST_OPP}_0`, TEST_OPP, 'YES', '2026-03-05T12:00:00Z',
        0.65, null,
        0.5, 0.6, 0.7,
        'MEDIUM', 'GREEN', null,
        'LOW', null, null, null,
        null, null, null,
        null, null, null,
        null, null,
        'DRAFT', 'sn_test001', null,
        null, 0, null,
        null, null, null,
        1.0, 100.0,
        0, 1, new Date().toISOString(),
      ]);
    } catch (_) { /* table may not exist yet if server hasn't created it */ }
  }

  // ── Test 6: GET /postmortem/:opp_id returns card ─────────────────────────
  await test('6. GET /postmortem/:opp_id returns postmortem card', async () => {
    if (!db) { console.log('    (skipped — no sqlite3)'); passed--; return; }
    const { status, body } = await fetchJson(`/postmortem/${TEST_OPP}`);
    assert.equal(status, 200);
    assert.ok(body.postmortem, 'response must have postmortem');
    assert.ok(Array.isArray(body.notes), 'response must have notes array');
    assert.equal(body.postmortem.opp_id, TEST_OPP);
  });

  // ── Test 7: GET /postmortem/:opp_id for unknown → 404 ───────────────────
  await test('7. GET /postmortem/nonexistent_opp → 404', async () => {
    const { status, body } = await fetchJson('/postmortem/nonexistent_opp_xyz');
    assert.equal(status, 404);
    assert.ok(body.error, 'should have error message');
  });

  // ── Test 8: POST /postmortem/:opp_id/note — success ─────────────────────
  await test('8. POST /postmortem/:opp_id/note appends note', async () => {
    if (!db) { console.log('    (skipped — no sqlite3)'); passed--; return; }
    const { status, body } = await fetchJson(`/postmortem/${TEST_OPP}/note`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note_text: 'Test note from routes test' }),
    });
    assert.equal(status, 200);
    assert.ok(body.note_id, 'should return note_id');
    assert.equal(body.opp_id, TEST_OPP);
  });

  // ── Test 9: POST /postmortem/:opp_id/note — empty text → 400 ────────────
  await test('9. POST /postmortem/:opp_id/note with empty text → 400', async () => {
    const { status, body } = await fetchJson(`/postmortem/${TEST_OPP}/note`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note_text: '' }),
    });
    assert.equal(status, 400);
    assert.ok(body.error, 'should have error message');
  });

  // ── Test 10: Verify note appears in card ─────────────────────────────────
  await test('10. Note appears in GET /postmortem/:opp_id response', async () => {
    if (!db) { console.log('    (skipped — no sqlite3)'); passed--; return; }
    const { status, body } = await fetchJson(`/postmortem/${TEST_OPP}`);
    assert.equal(status, 200);
    assert.ok(body.notes.length > 0, 'should have at least one note');
    const found = body.notes.some(n => n.note_text === 'Test note from routes test');
    assert.ok(found, 'note text should match');
  });

} finally {
  // Cleanup: remove test outcome file
  try { if (fs.existsSync(outcomeFile)) fs.unlinkSync(outcomeFile); } catch (_) {}

  // Cleanup: remove test postmortem and notes from DB
  if (db) {
    try {
      await runSql(`DELETE FROM postmortem_notes WHERE opp_id = ?`, [TEST_OPP]);
      await runSql(`DELETE FROM postmortem WHERE opp_id = ?`, [TEST_OPP]);
    } catch (_) {}
    db.close();
  }
}

if (failed > 0) {
  console.error(`\n[FAIL] ${failed} test(s) failed, ${passed} passed`);
  process.exit(1);
} else {
  console.log(`\n[ALL PASS] ${passed}/10 tests passed`);
}
