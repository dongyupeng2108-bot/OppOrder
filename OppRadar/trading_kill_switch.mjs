// M8-P4 | trading_kill_switch.mjs

import { DB } from './db.mjs';

let activated = false;

export function activate() {
  activated = true;
  console.log('[KillSwitch] ACTIVATED — rejecting new orders, cancelling open orders');
  cancelAllPending().catch(err => console.error('[KillSwitch] cancelAllPending error:', err.message));
}

export function isActivated() {
  return activated;
}

export function reset() {
  activated = false;
}

export async function cancelAllPending() {
  const now = new Date().toISOString();
  const pending = await DB.allSql("SELECT order_id FROM trading_orders WHERE status = 'PENDING'");
  if (pending.length === 0) return { cancelled: 0 };
  for (const row of pending) {
    await DB.runSql(
      "UPDATE trading_orders SET status = 'CANCELLED', updated_at = ? WHERE order_id = ?",
      [now, row.order_id]
    );
  }
  return { cancelled: pending.length };
}
