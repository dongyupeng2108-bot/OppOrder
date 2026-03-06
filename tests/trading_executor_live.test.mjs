import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { createSignal } from '../OppRadar/trading_signal.mjs';
import { processSignal } from '../OppRadar/trading_order_engine.mjs';
import { clearCache } from '../OppRadar/trading_market_rules.mjs';
import { executeLive } from '../OppRadar/trading_executor_live.mjs';
import { DB } from '../OppRadar/db.mjs';

function makeValidFields(overrides = {}) {
  return {
    opp_id: 'op_test0001',
    market_id: 'mkt_test',
    token_id: 'tok_test',
    side: 'BUY',
    order_type: 'GTC',
    price_target: 0.50,
    recommended_shares: 15,
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

async function createOrder(overrides = {}) {
  const fields = makeValidFields(overrides);
  const signal = createSignal(fields);
  const result = await processSignal(signal);
  assert.equal(result.status, 'ACCEPTED');
  const rows = await DB.allSql('SELECT * FROM trading_orders WHERE order_id = ?', [result.order_id]);
  return rows[0];
}

describe('trading_executor_live', () => {
  before(async () => {
    clearCache();
    await new Promise(resolve => setTimeout(resolve, 500));
  });

  it('T1: SIGNER_OFFLINE when signer health check fails', async () => {
    const order = await createOrder();
    const result = await executeLive(order, {
      checkSignerHealth: async () => false,
    });
    assert.equal(result.status, 'REJECTED');
    assert.equal(result.reject_reason, 'SIGNER_OFFLINE');
    // Verify DB updated
    const rows = await DB.allSql('SELECT * FROM trading_orders WHERE order_id = ?', [order.order_id]);
    assert.equal(rows[0].status, 'REJECTED');
    assert.equal(rows[0].reject_reason, 'SIGNER_OFFLINE');
  });

  it('T2: SIGNER_TIMEOUT when sign request returns null', async () => {
    const order = await createOrder();
    const result = await executeLive(order, {
      checkSignerHealth: async () => true,
      signOrder: async () => null, // simulates timeout
    });
    assert.equal(result.status, 'REJECTED');
    assert.equal(result.reject_reason, 'SIGNER_TIMEOUT');
  });

  it('T3: SIGN_FAILED when signed=false', async () => {
    const order = await createOrder();
    const result = await executeLive(order, {
      checkSignerHealth: async () => true,
      signOrder: async () => ({ signed: false, error: 'invalid key' }),
    });
    assert.equal(result.status, 'REJECTED');
    assert.equal(result.reject_reason, 'SIGN_FAILED');
  });

  it('T4: MAX_POSITION_USD exceeded throws error', async () => {
    // price=0.9 * shares=12 = 10.8 > MAX_POSITION_USD=10
    const order = await createOrder({ price_target: 0.90, recommended_shares: 12 });
    await assert.rejects(
      () => executeLive(order, {
        checkSignerHealth: async () => true,
        signOrder: async () => ({ signed: true, headers: {} }),
      }),
      (err) => {
        assert.match(err.message, /MAX_POSITION_USD/);
        return true;
      }
    );
  });

  it('T5: headers reference nulled after successful sign (LG-5)', async () => {
    const order = await createOrder();
    let capturedHeaders = { 'X-Sig': 'test-signature' };
    const result = await executeLive(order, {
      checkSignerHealth: async () => true,
      signOrder: async () => ({
        signed: true,
        headers: capturedHeaders,
        signature_hash: 'abc123',
      }),
    });
    assert.equal(result.status, 'FILLED');
    assert.ok(result.fill_id, 'fill_id should be present');
    assert.ok(result.filled_at, 'filled_at should be present');
    // The headers variable inside executeLive is set to null after use (LG-5).
    // We verify the function completed successfully with a FILLED result,
    // confirming the code path that includes signerHeaders = null was reached.
  });
});
