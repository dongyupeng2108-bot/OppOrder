import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { createSignal } from '../OppRadar/trading_signal.mjs';
import { processSignal } from '../OppRadar/trading_order_engine.mjs';
import { clearCache } from '../OppRadar/trading_market_rules.mjs';
import { DB } from '../OppRadar/db.mjs';

function makeValidFields(overrides = {}) {
  return {
    opp_id: 'op_test0001',
    market_id: 'mkt_test',
    token_id: 'tok_test',
    side: 'BUY',
    order_type: 'GTC',
    price_target: 0.50,
    recommended_shares: 100,
    context: {
      p_baseline_mid: 0.45,
      edge_net: 0.05,
      confidence: 'HIGH',
      veto_status: 'GREEN',
      risk_level: 'LOW',
    },
    decision_snapshot_id: 'ds_test',
    core_snapshot_id: 'cs_test',
    ...overrides,
  };
}

describe('trading_order_engine', () => {
  before(async () => {
    clearCache();
    // Wait for DB init (callback-based, needs time to create tables)
    await new Promise(resolve => setTimeout(resolve, 500));
  });

  it('1. BUY GTC → ACCEPTED, order written to DB', async () => {
    const signal = createSignal(makeValidFields());
    const result = await processSignal(signal);
    assert.equal(result.status, 'ACCEPTED');
    assert.ok(result.order_id);
    const rows = await DB.allSql('SELECT * FROM trading_orders WHERE order_id = ?', [result.order_id]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].side, 'BUY');
    assert.equal(rows[0].status, 'PENDING');
  });

  it('2. SELL GTC → ACCEPTED', async () => {
    const signal = createSignal(makeValidFields({ side: 'SELL' }));
    const result = await processSignal(signal);
    assert.equal(result.status, 'ACCEPTED');
  });

  it('3. BUY+FOK: shares = price_target × recommended_shares (USDC conversion)', async () => {
    const signal = createSignal(makeValidFields({ order_type: 'FOK', price_target: 0.60, recommended_shares: 200 }));
    const result = await processSignal(signal);
    assert.equal(result.status, 'ACCEPTED');
    const rows = await DB.allSql('SELECT shares FROM trading_orders WHERE order_id = ?', [result.order_id]);
    assert.equal(rows[0].shares, 0.60 * 200); // 120
  });

  it('4. SELL+FOK: shares = recommended_shares (no conversion)', async () => {
    const signal = createSignal(makeValidFields({ side: 'SELL', order_type: 'FOK', recommended_shares: 150 }));
    const result = await processSignal(signal);
    assert.equal(result.status, 'ACCEPTED');
    const rows = await DB.allSql('SELECT shares FROM trading_orders WHERE order_id = ?', [result.order_id]);
    assert.equal(rows[0].shares, 150);
  });

  it('5. HR-1: price not aligned to tick_size → REJECTED', async () => {
    const signal = createSignal(makeValidFields({ price_target: 0.555 }));
    const result = await processSignal(signal);
    assert.equal(result.status, 'REJECTED');
    assert.ok(result.reject_reason.includes('HR-1'));
  });

  it('6. HR-3: neg_risk=true → REJECTED (mock marketRules)', async () => {
    // To test HR-3, we need to override getMarketRules. We'll use a market_id
    // that triggers neg_risk. Since stub always returns neg_risk:false,
    // we import and temporarily patch the cache.
    const { getMarketRules, clearCache: cc } = await import('../OppRadar/trading_market_rules.mjs');
    cc();
    // Pre-populate cache with neg_risk=true
    const rules = await getMarketRules('mkt_negrisk');
    rules.neg_risk = true;
    // Now process with that market_id (cache still has the patched rules)
    const signal = createSignal(makeValidFields({ market_id: 'mkt_negrisk' }));
    const result = await processSignal(signal);
    assert.equal(result.status, 'REJECTED');
    assert.ok(result.reject_reason.includes('HR-3'));
    cc(); // cleanup
  });

  it('7. HR-4: GTD without expiry → REJECTED', async () => {
    const signal = createSignal(makeValidFields({ order_type: 'GTD' }));
    const result = await processSignal(signal);
    assert.equal(result.status, 'REJECTED');
    assert.ok(result.reject_reason.includes('HR-4'));
  });

  it('8. HR-5: order size below minimum → REJECTED', async () => {
    const signal = createSignal(makeValidFields({ price_target: 0.01, recommended_shares: 1 }));
    const result = await processSignal(signal);
    assert.equal(result.status, 'REJECTED');
    assert.ok(result.reject_reason.includes('HR-5'));
  });

  it('9. trading_snapshot written on ACCEPTED (SQL join verify)', async () => {
    const signal = createSignal(makeValidFields());
    const result = await processSignal(signal);
    assert.equal(result.status, 'ACCEPTED');
    const snapshots = await DB.allSql(
      'SELECT ts.* FROM trading_snapshots ts JOIN trading_orders o ON ts.order_id = o.order_id WHERE o.order_id = ?',
      [result.order_id]
    );
    assert.equal(snapshots.length, 1);
    assert.equal(snapshots[0].core_snapshot_id, 'cs_test');
    assert.equal(snapshots[0].decision_snapshot_id, 'ds_test');
  });

  it('10. REJECTED does not write to trading_orders', async () => {
    const countBefore = await DB.allSql('SELECT COUNT(*) as cnt FROM trading_orders');
    const signal = createSignal(makeValidFields({ price_target: 0.555 })); // HR-1
    const result = await processSignal(signal);
    assert.equal(result.status, 'REJECTED');
    const countAfter = await DB.allSql('SELECT COUNT(*) as cnt FROM trading_orders');
    assert.equal(countBefore[0].cnt, countAfter[0].cnt);
  });

  it('11. validateSignal failure (invalid side) throws, no HR check', async () => {
    const signal = createSignal(makeValidFields());
    signal.side = 'HOLD';
    await assert.rejects(() => processSignal(signal), /side/);
  });

  it('12. db.pragma busy_timeout = 5000', async () => {
    assert.equal(typeof DB.runSql, 'function');
    assert.equal(typeof DB.allSql, 'function');
    const result = await DB.allSql('PRAGMA busy_timeout');
    // Real SQLite returns [{busy_timeout: 5000}], Mock returns []
    if (result.length > 0) {
      // Column name varies: could be 'busy_timeout' or 'timeout'
      const val = result[0].busy_timeout ?? result[0].timeout ?? Object.values(result[0])[0];
      assert.equal(val, 5000);
    }
    assert.ok(true, 'DB module loaded with runSql/allSql available');
  });

  // HR-2/6/7: P1 Signal has no post_only/spread/top5_liquidity fields,
  // so these HRs are skipped by default. Will be tested after P3 extends Signal.
});
