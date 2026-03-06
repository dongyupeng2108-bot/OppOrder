// M8-P7 | backfill_pnl.mjs

import { DB } from '../OppRadar/db.mjs';
import { getPostmortem, insertPostmortem } from '../OppRadar/postmortem_store.mjs';

async function main() {
  // Wait for DB init
  await new Promise(resolve => setTimeout(resolve, 500));

  const fills = await DB.allSql(
    'SELECT * FROM trading_fills WHERE pnl_settlement IS NOT NULL'
  );

  let processed = 0;
  let updated = 0;
  let skipped = 0;

  for (const fill of fills) {
    processed++;
    // Find opp_id via trading_orders
    const orders = await DB.allSql(
      'SELECT opp_id FROM trading_orders WHERE order_id = ?',
      [fill.order_id]
    );
    if (orders.length === 0) {
      skipped++;
      continue;
    }
    const opp_id = orders[0].opp_id;
    const pm = await getPostmortem(opp_id);
    if (!pm) {
      skipped++;
      continue;
    }
    // Idempotent: skip if already equal
    if (pm.pnl_simulated === fill.pnl_settlement) {
      skipped++;
      continue;
    }
    // Insert new revision with updated pnl_simulated
    const newRecord = { ...pm };
    delete newRecord.postmortem_id;
    newRecord.pnl_simulated = fill.pnl_settlement;
    await insertPostmortem(newRecord);
    updated++;
  }

  const summary = { processed, updated, skipped };
  console.log(JSON.stringify(summary));
  return summary;
}

const result = await main();
export default result;
