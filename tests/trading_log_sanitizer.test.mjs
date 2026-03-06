import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sanitize, safeLog, sanitizeError } from '../OppRadar/trading_log_sanitizer.mjs';

describe('trading_log_sanitizer', () => {
  it('T1: sanitize redacts headers field, preserves order_id', () => {
    const input = { order_id: 'x', headers: { 'POLY-SIGNATURE': '0xabc' } };
    const result = sanitize(input);
    assert.equal(result.order_id, 'x');
    assert.equal(result.headers, '[REDACTED]');
  });

  it('T2: sanitize redacts private key pattern in strings', () => {
    const hex64 = '0x' + 'a1b2c3d4e5f6'.repeat(11); // 66 hex chars after 0x
    const input = `Key is ${hex64} end`;
    const result = sanitize(input);
    assert.ok(!result.includes(hex64), 'private key should be redacted');
    assert.ok(result.includes('[REDACTED]'), 'should contain [REDACTED]');
    assert.ok(result.includes('Key is'), 'prefix text preserved');
  });

  it('T3: sanitize does not modify original object (immutable)', () => {
    const original = { secret: 'my-secret-value', name: 'test' };
    const result = sanitize(original);
    assert.equal(original.secret, 'my-secret-value', 'original must not change');
    assert.equal(result.secret, '[REDACTED]');
    assert.equal(result.name, 'test');
  });

  it('T4: sanitize handles nested objects', () => {
    const input = { a: { secret: 'abc123' }, b: 'safe' };
    const result = sanitize(input);
    assert.equal(result.a.secret, '[REDACTED]');
    assert.equal(result.b, 'safe');
  });

  it('T5: sanitizeError returns only message and name', () => {
    const err = new Error('something broke');
    err.stack = 'Error: something broke\n    at test.mjs:1:1';
    const result = sanitizeError(err);
    assert.equal(result.message, 'something broke');
    assert.equal(result.name, 'Error');
    assert.equal(result.stack, undefined, 'stack must not be present');
    assert.equal(Object.keys(result).length, 2, 'only message and name');
  });

  it('T6: safeLog does not throw', () => {
    assert.doesNotThrow(() => {
      safeLog('info', 'test', { order_id: '123' });
    });
  });
});
