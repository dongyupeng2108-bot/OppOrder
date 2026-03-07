import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

const BASE = 'http://localhost:53122';

async function fetchJson(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, opts);
  const body = await res.json();
  return { status: res.status, body };
}

describe('trading_account', () => {

  it('T1: GET /trading/account → 200, contains mode/balance/currency', async () => {
    const { status, body } = await fetchJson('/trading/account');
    assert.equal(status, 200);
    assert.equal(body.mode, 'paper');
    assert.equal(typeof body.balance, 'number');
    assert.equal(body.currency, 'USD');
  });

  it('T2: GET /trading/account balance is a number type', async () => {
    const { body } = await fetchJson('/trading/account');
    assert.equal(typeof body.balance, 'number');
    assert.ok(body.balance >= 0);
  });

  it('T3: POST /trading/virtual_deposit { amount: 500 } → 200, ok+balance', async () => {
    const { status, body } = await fetchJson('/trading/virtual_deposit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 500 }),
    });
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.balance, 500);
  });

  it('T4: after deposit, GET /trading/account balance=500', async () => {
    const { body } = await fetchJson('/trading/account');
    assert.equal(body.balance, 500);
  });

  it('T5: POST /trading/virtual_deposit { amount: -1 } → 400', async () => {
    const { status } = await fetchJson('/trading/virtual_deposit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: -1 }),
    });
    assert.equal(status, 400);
  });

  it('T6: POST /trading/virtual_deposit { amount: 9999999 } → 400 (exceeds max)', async () => {
    const { status } = await fetchJson('/trading/virtual_deposit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 9999999 }),
    });
    assert.equal(status, 400);
  });
});
