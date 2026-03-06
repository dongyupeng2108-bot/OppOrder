// M8-P4 | trading_heartbeat.mjs

import { DB } from './db.mjs';
import * as killSwitch from './trading_kill_switch.mjs';

const MAX_FAILURES = 3;

let _interval = null;
let _failCount = 0;
let _lastCheckAt = null;

export function startHeartbeat(intervalMs = 30000) {
  if (_interval) return; // idempotent
  _interval = setInterval(() => tick(), intervalMs);
  // Prevent the interval from keeping the process alive if it's the only ref
  if (_interval.unref) _interval.unref();
}

export function stopHeartbeat() {
  if (_interval) {
    clearInterval(_interval);
    _interval = null;
  }
  _failCount = 0;
}

export function getStatus() {
  return {
    running: _interval !== null,
    failCount: _failCount,
    lastCheckAt: _lastCheckAt,
  };
}

export async function pingLive() {
  // stub: P4 Live integration will replace with real order status check
  console.log('[Heartbeat] ping stub — OK');
  return true;
}

async function tick() {
  _lastCheckAt = new Date().toISOString();
  try {
    const pending = await DB.allSql(
      "SELECT COUNT(*) as cnt FROM trading_orders WHERE status = 'PENDING' AND executor_type = 'LIVE'"
    );
    const count = pending[0]?.cnt || 0;
    if (count === 0) {
      stopHeartbeat();
      return;
    }
    await pingLive();
    _failCount = 0;
  } catch (err) {
    _failCount++;
    console.error(`[Heartbeat] ping failed (${_failCount}/${MAX_FAILURES}):`, err.message);
    if (_failCount >= MAX_FAILURES) {
      killSwitch.activate();
      stopHeartbeat();
    }
  }
}

// Export tick for testing
export { tick as _tick };
