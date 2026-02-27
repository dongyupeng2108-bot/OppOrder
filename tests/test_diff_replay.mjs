/**
 * test_diff_replay.mjs
 * Self-contained tests for /diff and /replay routes.
 *
 * Uses an in-process test server (port 53124) with a mock DB — no external server needed.
 * Run: node tests/test_diff_replay.mjs
 */
import { strict as assert } from 'assert';
import { createServer } from '../OppRadar/app.mjs';
import { handleDiff } from '../OppRadar/routes/diff.mjs';
import { handleReplay } from '../OppRadar/routes/replay.mjs';

console.log('[TEST] Running test_diff_replay...');

// ---------------------------------------------------------------------------
// Mock DB — deterministic, no SQLite dependency
// ---------------------------------------------------------------------------
const SCAN_A = 'test_scan_aaa';
const SCAN_B = 'test_scan_bbb';

const MOCK_STORE = {
    [SCAN_A]: [
        { id: 'op_001', score: 0.8, topic_key: 'topic_1', snapshot_ref: 'snap_fingerprint_abc' },
        { id: 'op_002', score: 0.6, topic_key: 'topic_1', snapshot_ref: null }
    ],
    [SCAN_B]: [
        { id: 'op_002', score: 0.7, topic_key: 'topic_1', snapshot_ref: null },  // score changed
        { id: 'op_003', score: 0.5, topic_key: 'topic_2', snapshot_ref: null }   // new
    ]
};

const mockDb = {
    async getOpportunitiesByRun(run_id, limit) {
        const opps = MOCK_STORE[run_id] || [];
        return opps.slice(0, limit);
    }
};

// ---------------------------------------------------------------------------
// Start test server with injected handlers
// ---------------------------------------------------------------------------
const TEST_PORT = 53124;
const server = createServer({
    diff:   (query) => handleDiff(query, mockDb),
    replay: (query) => handleReplay(query, mockDb)
});

await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(TEST_PORT, resolve);
});

const BASE = `http://localhost:${TEST_PORT}`;

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

// ---------------------------------------------------------------------------
// Test 1: positive diff — returns 200 with required fields
// ---------------------------------------------------------------------------
await test('diff positive — 200 with added/removed/changed', async () => {
    const res = await fetch(`${BASE}/diff?from_scan=${SCAN_A}&to_scan=${SCAN_B}`);
    assert.equal(res.status, 200, `expected 200, got ${res.status}`);
    const body = await res.json();

    assert(Array.isArray(body.added_opp_ids),   'missing added_opp_ids');
    assert(Array.isArray(body.removed_opp_ids), 'missing removed_opp_ids');
    assert(Array.isArray(body.changed),         'missing changed');
    assert.equal(body.from_scan, SCAN_A, 'from_scan mismatch');
    assert.equal(body.to_scan,   SCAN_B, 'to_scan mismatch');

    // op_003 added, op_001 removed, op_002 changed (score differs)
    assert(body.added_opp_ids.includes('op_003'),   'op_003 should be in added_opp_ids');
    assert(body.removed_opp_ids.includes('op_001'), 'op_001 should be in removed_opp_ids');
    assert(body.changed.length > 0,                 'op_002 score change should appear in changed');

    const changedOp002 = body.changed.find(c => c.opp_id === 'op_002');
    assert(changedOp002,                       'op_002 should be in changed');
    assert('from' in changedOp002,             'changed entry must have from');
    assert('to'   in changedOp002,             'changed entry must have to');
});

// ---------------------------------------------------------------------------
// Test 2: positive replay — returns 200 with scan_id/snapshot_fingerprint/replay_events
// ---------------------------------------------------------------------------
await test('replay positive — 200 with required fields', async () => {
    const res = await fetch(`${BASE}/replay?scan_id=${SCAN_A}`);
    assert.equal(res.status, 200, `expected 200, got ${res.status}`);
    const body = await res.json();

    assert.equal(body.scan_id, SCAN_A, 'scan_id mismatch');
    assert(typeof body.snapshot_fingerprint === 'string', 'snapshot_fingerprint must be string');
    assert.equal(body.snapshot_fingerprint, 'snap_fingerprint_abc', 'snapshot_fingerprint value mismatch');
    assert(Array.isArray(body.replay_events), 'replay_events must be array');
    assert(body.replay_events.length > 0,     'replay_events must be non-empty');

    const ev = body.replay_events[0];
    assert(typeof ev.opp_id === 'string', 'event.opp_id must be string');
    assert(typeof ev.score  === 'number', 'event.score must be number');
    assert(typeof ev.title  === 'string', 'event.title must be string');
});

// ---------------------------------------------------------------------------
// Test 3: diff missing parameter → 400
// ---------------------------------------------------------------------------
await test('diff missing to_scan → 400', async () => {
    const res = await fetch(`${BASE}/diff?from_scan=abc`);
    assert.equal(res.status, 400, `expected 400, got ${res.status}`);
    const body = await res.json();
    assert(body.error, 'error field must be present');
});

// ---------------------------------------------------------------------------
// Test 4: replay nonexistent scan_id → 404
// ---------------------------------------------------------------------------
await test('replay nonexistent scan_id → 404', async () => {
    const res = await fetch(`${BASE}/replay?scan_id=nonexistent_id_999`);
    assert.equal(res.status, 404, `expected 404, got ${res.status}`);
    const body = await res.json();
    assert(body.error, 'error field must be present');
});

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------
await new Promise(resolve => server.close(resolve));

if (failed > 0) {
    console.error(`\n[FAIL] ${failed} test(s) failed, ${passed} passed`);
    process.exit(1);
} else {
    console.log(`\n[ALL PASS] ${passed} tests passed`);
}
