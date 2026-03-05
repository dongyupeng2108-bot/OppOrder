/**
 * postmortem_store.test.mjs
 * M6-A1 tests: postmortem_store CRUD, nullable fields, revision mechanism,
 * and outcome_store join.
 *
 * Run: node tests/postmortem_store.test.mjs
 */
import { strict as assert } from 'assert';
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const sqlite3 = require('sqlite3').verbose();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_DIR = path.join(process.cwd(), 'data', 'runtime');
const DB_PATH = path.join(DB_DIR, 'oppradar_test_pm.sqlite');
const OUTCOMES_DIR = path.join(process.cwd(), 'data', 'outcomes');

// Ensure dirs
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

// Remove stale test DB
if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);

const db = new sqlite3.Database(DB_PATH);

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) { err ? reject(err) : resolve(this); });
  });
}
function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => { err ? reject(err) : resolve(rows); });
  });
}
function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => { err ? reject(err) : resolve(row || null); });
  });
}

// ── Setup: create tables ──────────────────────────────────────────────────────
async function setup() {
  await run(`CREATE TABLE IF NOT EXISTS postmortem (
    postmortem_id TEXT PRIMARY KEY,
    opp_id TEXT NOT NULL,
    outcome TEXT NOT NULL,
    outcome_ts DATETIME NOT NULL,
    market_price_at_scan REAL NOT NULL,
    market_price_at_settlement REAL,
    p_baseline_low REAL NOT NULL,
    p_baseline_mid REAL NOT NULL,
    p_baseline_high REAL NOT NULL,
    confidence TEXT NOT NULL,
    veto_status TEXT NOT NULL,
    veto_reason TEXT,
    risk_level TEXT NOT NULL,
    risk_reason TEXT,
    filter_type TEXT,
    filter_reason TEXT,
    edge_buy_net REAL,
    edge_sell_net REAL,
    edge_net REAL,
    predicted_direction TEXT,
    direction_correct INTEGER,
    pnl_simulated REAL,
    snapshot_draft_id TEXT,
    snapshot_deep_id TEXT,
    active_snapshot_type TEXT NOT NULL,
    decision_snapshot_id TEXT NOT NULL,
    decision_b5_run_id TEXT,
    strategy_id TEXT,
    is_topn INTEGER NOT NULL,
    topn_rank REAL,
    attribution_label TEXT,
    attribution_reason TEXT,
    attribution_confirmed INTEGER,
    actual REAL NOT NULL,
    virtual_notional REAL NOT NULL,
    revision INTEGER NOT NULL DEFAULT 0,
    is_latest INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL
  )`);

  await run(`CREATE TABLE IF NOT EXISTS postmortem_notes (
    note_id TEXT PRIMARY KEY,
    opp_id TEXT NOT NULL,
    note_text TEXT NOT NULL,
    created_at DATETIME NOT NULL
  )`);

  await run(`CREATE INDEX IF NOT EXISTS idx_pm_opp_id ON postmortem(opp_id)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_pm_is_latest ON postmortem(is_latest)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_pm_notes_opp_id ON postmortem_notes(opp_id)`);
}

// ── Helper: minimal valid postmortem record ───────────────────────────────────
function validPm(opp_id, overrides = {}) {
  return {
    postmortem_id: `pm_${opp_id}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    opp_id,
    outcome: 'YES',
    outcome_ts: '2026-03-05T10:00:00Z',
    market_price_at_scan: 0.65,
    market_price_at_settlement: null,
    p_baseline_low: 0.5,
    p_baseline_mid: 0.6,
    p_baseline_high: 0.7,
    confidence: 'MEDIUM',
    veto_status: 'GREEN',
    veto_reason: null,
    risk_level: 'LOW',
    risk_reason: null,
    filter_type: null,
    filter_reason: null,
    edge_buy_net: null,
    edge_sell_net: null,
    edge_net: null,
    predicted_direction: null,
    direction_correct: null,
    pnl_simulated: null,
    snapshot_draft_id: null,
    snapshot_deep_id: null,
    active_snapshot_type: 'DRAFT',
    decision_snapshot_id: 'sn_abc12345',
    decision_b5_run_id: null,
    strategy_id: null,
    is_topn: 0,
    topn_rank: null,
    attribution_label: null,
    attribution_reason: null,
    attribution_confirmed: null,
    actual: 1.0,
    virtual_notional: 100.0,
    revision: 0,
    is_latest: 1,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

async function insertPm(record) {
  await run(`INSERT INTO postmortem (
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
    record.postmortem_id, record.opp_id, record.outcome, record.outcome_ts,
    record.market_price_at_scan, record.market_price_at_settlement,
    record.p_baseline_low, record.p_baseline_mid, record.p_baseline_high,
    record.confidence, record.veto_status, record.veto_reason,
    record.risk_level, record.risk_reason, record.filter_type, record.filter_reason,
    record.edge_buy_net, record.edge_sell_net, record.edge_net,
    record.predicted_direction, record.direction_correct, record.pnl_simulated,
    record.snapshot_draft_id, record.snapshot_deep_id,
    record.active_snapshot_type, record.decision_snapshot_id, record.decision_b5_run_id,
    record.strategy_id, record.is_topn, record.topn_rank,
    record.attribution_label, record.attribution_reason, record.attribution_confirmed,
    record.actual, record.virtual_notional,
    record.revision, record.is_latest, record.created_at,
  ]);
}

// ── Revision helper (mirrors store logic) ─────────────────────────────────────
async function insertWithRevision(record) {
  const existing = await get(
    `SELECT revision FROM postmortem WHERE opp_id = ? AND is_latest = 1`,
    [record.opp_id]
  );
  const newRevision = existing ? existing.revision + 1 : 0;
  if (existing) {
    await run(`UPDATE postmortem SET is_latest = 0 WHERE opp_id = ? AND is_latest = 1`, [record.opp_id]);
  }
  const pm = validPm(record.opp_id, { ...record, revision: newRevision, is_latest: 1 });
  await insertPm(pm);
  return { postmortem_id: pm.postmortem_id, revision: newRevision };
}

// ── Tests ─────────────────────────────────────────────────────────────────────
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

console.log('[TEST] postmortem_store.test.mjs — running...');

try {
  await setup();

  // ── Test 1: Basic insert and query ──────────────────────────────────────────
  await test('1. Insert postmortem + query by opp_id', async () => {
    const pm = validPm('zztest_pm_001');
    await insertPm(pm);

    const row = await get(`SELECT * FROM postmortem WHERE opp_id = ? AND is_latest = 1`, ['zztest_pm_001']);
    assert(row !== null, 'row must exist');
    assert.equal(row.opp_id, 'zztest_pm_001');
    assert.equal(row.outcome, 'YES');
    assert.equal(row.market_price_at_scan, 0.65);
    assert.equal(row.p_baseline_mid, 0.6);
    assert.equal(row.confidence, 'MEDIUM');
    assert.equal(row.veto_status, 'GREEN');
    assert.equal(row.risk_level, 'LOW');
    assert.equal(row.active_snapshot_type, 'DRAFT');
    assert.equal(row.actual, 1.0);
    assert.equal(row.virtual_notional, 100.0);
    assert.equal(row.revision, 0);
    assert.equal(row.is_latest, 1);
  });

  // ── Test 2: Nullable fields accept null ─────────────────────────────────────
  await test('2. All nullable fields accept null without error', async () => {
    const pm = validPm('zztest_pm_002', {
      market_price_at_settlement: null,
      veto_reason: null,
      risk_reason: null,
      filter_type: null,
      filter_reason: null,
      edge_buy_net: null,
      edge_sell_net: null,
      edge_net: null,
      predicted_direction: null,
      direction_correct: null,
      pnl_simulated: null,
      snapshot_draft_id: null,
      snapshot_deep_id: null,
      decision_b5_run_id: null,
      strategy_id: null,
      topn_rank: null,
      attribution_label: null,
      attribution_reason: null,
      attribution_confirmed: null,
    });
    await insertPm(pm);

    const row = await get(`SELECT * FROM postmortem WHERE opp_id = ?`, ['zztest_pm_002']);
    assert(row !== null, 'row must exist');
    assert.equal(row.market_price_at_settlement, null);
    assert.equal(row.veto_reason, null);
    assert.equal(row.risk_reason, null);
    assert.equal(row.filter_type, null);
    assert.equal(row.filter_reason, null);
    assert.equal(row.edge_buy_net, null);
    assert.equal(row.edge_sell_net, null);
    assert.equal(row.edge_net, null);
    assert.equal(row.predicted_direction, null);
    assert.equal(row.direction_correct, null);
    assert.equal(row.pnl_simulated, null);
    assert.equal(row.snapshot_draft_id, null);
    assert.equal(row.snapshot_deep_id, null);
    assert.equal(row.decision_b5_run_id, null);
    assert.equal(row.strategy_id, null);
    assert.equal(row.topn_rank, null);
    assert.equal(row.attribution_label, null);
    assert.equal(row.attribution_reason, null);
    assert.equal(row.attribution_confirmed, null);
  });

  // ── Test 3: Revision mechanism ──────────────────────────────────────────────
  await test('3. Revision: same opp_id twice → is_latest auto-switches', async () => {
    const opp_id = 'zztest_pm_003';

    // First insert
    const r1 = await insertWithRevision({ opp_id, outcome: 'YES', actual: 1.0 });
    assert.equal(r1.revision, 0);

    // Second insert (revision)
    const r2 = await insertWithRevision({ opp_id, outcome: 'NO', actual: 0.0 });
    assert.equal(r2.revision, 1);

    // Only latest should have is_latest=1
    const latest = await get(`SELECT * FROM postmortem WHERE opp_id = ? AND is_latest = 1`, [opp_id]);
    assert(latest !== null, 'must have a latest record');
    assert.equal(latest.revision, 1);
    assert.equal(latest.is_latest, 1);
    assert.equal(latest.outcome, 'NO');
    assert.equal(latest.actual, 0.0);

    // Old revision should be is_latest=0
    const old = await get(`SELECT * FROM postmortem WHERE opp_id = ? AND revision = 0`, [opp_id]);
    assert(old !== null, 'old revision must exist');
    assert.equal(old.is_latest, 0);

    // Total count for this opp_id
    const allRows = await all(`SELECT * FROM postmortem WHERE opp_id = ?`, [opp_id]);
    assert.equal(allRows.length, 2, 'should have exactly 2 revisions');
  });

  // ── Test 4: postmortem_notes insert and query ───────────────────────────────
  await test('4. Notes: insert + query by opp_id', async () => {
    const opp_id = 'zztest_pm_001';
    await run(`INSERT INTO postmortem_notes (note_id, opp_id, note_text, created_at) VALUES (?,?,?,?)`,
      ['pn_001', opp_id, 'First observation', '2026-03-05T12:00:00Z']);
    await run(`INSERT INTO postmortem_notes (note_id, opp_id, note_text, created_at) VALUES (?,?,?,?)`,
      ['pn_002', opp_id, 'Follow-up note', '2026-03-05T13:00:00Z']);

    const notes = await all(`SELECT * FROM postmortem_notes WHERE opp_id = ? ORDER BY created_at ASC`, [opp_id]);
    assert.equal(notes.length, 2);
    assert.equal(notes[0].note_text, 'First observation');
    assert.equal(notes[1].note_text, 'Follow-up note');
  });

  // ── Test 5: Join postmortem with outcome_store ──────────────────────────────
  await test('5. Join: postmortem + outcome via opp_id', async () => {
    const opp_id = 'zztest_pm_join';

    // Write a test outcome file
    if (!fs.existsSync(OUTCOMES_DIR)) fs.mkdirSync(OUTCOMES_DIR, { recursive: true });
    const outcomeFile = path.join(OUTCOMES_DIR, `${opp_id}.json`);
    fs.writeFileSync(outcomeFile, JSON.stringify({
      opp_id,
      title: 'Join test',
      outcome: 'YES',
      settled_at: '2026-03-05T14:00:00Z',
      actual_price: 1.0,
    }) + '\n', 'utf8');

    // Insert postmortem
    const pm = validPm(opp_id);
    await insertPm(pm);

    // Query both
    const pmRow = await get(`SELECT * FROM postmortem WHERE opp_id = ? AND is_latest = 1`, [opp_id]);
    assert(pmRow !== null, 'postmortem must exist');

    let outcomeData = null;
    if (fs.existsSync(outcomeFile)) {
      outcomeData = JSON.parse(fs.readFileSync(outcomeFile, 'utf8'));
    }
    assert(outcomeData !== null, 'outcome must exist');
    assert.equal(pmRow.opp_id, outcomeData.opp_id, 'opp_id must match between postmortem and outcome');
    assert.equal(pmRow.outcome, outcomeData.outcome, 'outcome must match');

    // Cleanup outcome file
    if (fs.existsSync(outcomeFile)) fs.unlinkSync(outcomeFile);
    try {
      if (fs.existsSync(OUTCOMES_DIR) && fs.readdirSync(OUTCOMES_DIR).length === 0) {
        fs.rmdirSync(OUTCOMES_DIR);
      }
    } catch (_) {}
  });

  // ── Test 6: Non-null fields with populated values ───────────────────────────
  await test('6. Populated nullable fields stored correctly', async () => {
    const pm = validPm('zztest_pm_006', {
      market_price_at_settlement: 0.95,
      veto_reason: 'Too volatile',
      edge_buy_net: 0.12,
      edge_sell_net: 0.08,
      edge_net: 0.12,
      predicted_direction: 'BUY_YES',
      direction_correct: 1,
      pnl_simulated: 12.0,
      snapshot_draft_id: 'sn_draft001',
      snapshot_deep_id: 'sn_deep001',
      decision_b5_run_id: 'run_b5_001',
      strategy_id: 'st_abc00001',
      is_topn: 1,
      topn_rank: 3.0,
      filter_type: 'RULE',
      filter_reason: 'Low volume',
    });
    await insertPm(pm);

    const row = await get(`SELECT * FROM postmortem WHERE opp_id = ?`, ['zztest_pm_006']);
    assert.equal(row.market_price_at_settlement, 0.95);
    assert.equal(row.veto_reason, 'Too volatile');
    assert.equal(row.edge_buy_net, 0.12);
    assert.equal(row.predicted_direction, 'BUY_YES');
    assert.equal(row.direction_correct, 1);
    assert.equal(row.pnl_simulated, 12.0);
    assert.equal(row.is_topn, 1);
    assert.equal(row.topn_rank, 3.0);
    assert.equal(row.filter_type, 'RULE');
  });

} finally {
  db.close();
  // Cleanup test DB
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
}

if (failed > 0) {
  console.error(`\n[FAIL] ${failed} test(s) failed, ${passed} passed`);
  process.exit(1);
} else {
  console.log(`\n[ALL PASS] ${passed}/6 tests passed`);
}
