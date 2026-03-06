import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createSignal, validateSignal } from '../OppRadar/trading_signal.mjs';
import { SignalRouter } from '../OppRadar/trading_signal_router.mjs';

function makeValidFields() {
  return {
    opp_id: 'op_12345678',
    market_id: 'mkt_001',
    token_id: 'tok_001',
    side: 'BUY',
    order_type: 'GTC',
    price_target: 0.65,
    recommended_shares: 100,
    context: {
      p_baseline_mid: 0.5,
      edge_net: 0.15,
      confidence: 'HIGH',
      veto_status: 'GREEN',
      risk_level: 'LOW',
    },
    decision_snapshot_id: 'ds_001',
    core_snapshot_id: 'cs_001',
  };
}

describe('trading_signal', () => {
  it('1. createSignal returns object with signal_id and ts', () => {
    const signal = createSignal(makeValidFields());
    assert.ok(signal.signal_id, 'signal_id should exist');
    assert.ok(signal.ts, 'ts should exist');
    assert.equal(signal.opp_id, 'op_12345678');
    assert.equal(signal.side, 'BUY');
    assert.equal(signal.b5_run_id, null);
    assert.equal(signal.strategy_id, null);
  });

  it('2. validateSignal valid object returns true', () => {
    const signal = createSignal(makeValidFields());
    assert.equal(validateSignal(signal), true);
  });

  it('3. validateSignal missing opp_id throws', () => {
    const signal = createSignal(makeValidFields());
    signal.opp_id = '';
    assert.throws(() => validateSignal(signal), /opp_id/);
  });

  it('4. validateSignal invalid side throws', () => {
    const signal = createSignal(makeValidFields());
    signal.side = 'HOLD';
    assert.throws(() => validateSignal(signal), /side/);
  });

  it('5. validateSignal invalid order_type throws', () => {
    const signal = createSignal(makeValidFields());
    signal.order_type = 'MARKET';
    assert.throws(() => validateSignal(signal), /order_type/);
  });

  it('6. validateSignal price_target=0 throws', () => {
    const signal = createSignal(makeValidFields());
    signal.price_target = 0;
    assert.throws(() => validateSignal(signal), /price_target/);
  });

  it('7. validateSignal price_target=1 throws', () => {
    const signal = createSignal(makeValidFields());
    signal.price_target = 1;
    assert.throws(() => validateSignal(signal), /price_target/);
  });

  it('8. validateSignal recommended_shares=0 throws', () => {
    const signal = createSignal(makeValidFields());
    signal.recommended_shares = 0;
    assert.throws(() => validateSignal(signal), /recommended_shares/);
  });

  it('9. SignalRouter routes via processSignal (P2 integration)', async () => {
    // P2 replaced stub with real processSignal; router now returns ACCEPTED
    await new Promise(resolve => setTimeout(resolve, 500)); // wait for DB init
    const router = new SignalRouter();
    const signal = createSignal(makeValidFields());
    const result = await router.route(signal);
    assert.equal(result.status, 'ACCEPTED');
    assert.equal(result.signal_id, signal.signal_id);
  });

  it('10. SignalRouter route returns signal_id in result', async () => {
    const router = new SignalRouter();
    const signal = createSignal(makeValidFields());
    const result = await router.route(signal);
    assert.ok(result.signal_id);
    assert.equal(result.signal_id, signal.signal_id);
  });
});
