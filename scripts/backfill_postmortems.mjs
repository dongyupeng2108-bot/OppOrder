#!/usr/bin/env node
/**
 * backfill_postmortems.mjs
 * M6-A2 (260302_015): Idempotent backfill script for outcomes without postmortems.
 *
 * Usage: node scripts/backfill_postmortems.mjs [--dry-run]
 */

import { backfillPostmortems, closeDb } from '../OppRadar/postmortem_generator.mjs';

const dryRun = process.argv.includes('--dry-run');

async function main() {
  console.log(`[backfill_postmortems] Starting${dryRun ? ' (DRY RUN)' : ''}...`);

  if (dryRun) {
    // In dry-run mode, just list outcomes without postmortems
    const fs = await import('fs');
    const path = await import('path');
    const outcomesDir = path.join(process.cwd(), 'data', 'outcomes');
    if (!fs.existsSync(outcomesDir)) {
      console.log('[backfill_postmortems] No outcomes directory found. Nothing to do.');
      return;
    }
    const files = fs.readdirSync(outcomesDir).filter(f => f.endsWith('.json'));
    console.log(`[backfill_postmortems] Found ${files.length} outcome file(s).`);
    for (const f of files) {
      try {
        const content = JSON.parse(fs.readFileSync(path.join(outcomesDir, f), 'utf8'));
        console.log(`  - ${content.opp_id}: outcome=${content.outcome}`);
      } catch (_) {
        console.log(`  - ${f}: (unreadable)`);
      }
    }
    console.log('[backfill_postmortems] Dry run complete. No changes made.');
    return;
  }

  const result = await backfillPostmortems();

  console.log(`[backfill_postmortems] Done.`);
  console.log(`  processed: ${result.processed}`);
  console.log(`  created:   ${result.created}`);
  console.log(`  skipped:   ${result.skipped}`);
  if (result.errors.length > 0) {
    console.error(`  errors:`);
    for (const e of result.errors) {
      console.error(`    - ${e}`);
    }
    process.exitCode = 1;
  }
}

try {
  await main();
} finally {
  closeDb();
}
