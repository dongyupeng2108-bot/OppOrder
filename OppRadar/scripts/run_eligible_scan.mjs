/**
 * run_eligible_scan.mjs
 * Fetches Polymarket markets, applies eligible filter, writes results to disk.
 *
 * Output: data/scans/eligible_<YYYYMMDD>.json
 *
 * Usage:
 *   node OppRadar/scripts/run_eligible_scan.mjs
 * Or import:
 *   import { runEligibleScan } from './run_eligible_scan.mjs';
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { fetchMarkets } from '../providers/polymarket_provider.mjs';
import { applyEligibleFilter } from '../polymarket_eligible_filter.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Project root: OppRadar/scripts/ -> OppRadar/ -> project root
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const SCANS_DIR = path.join(PROJECT_ROOT, 'data', 'scans');

/**
 * Format date as YYYYMMDD for filename.
 */
function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

/**
 * Fetch markets, filter, and write results to data/scans/eligible_<YYYYMMDD>.json.
 *
 * @returns {Promise<{ scan_date, scan_stats, candidates }>}
 */
export async function runEligibleScan() {
  // Ensure output directory exists
  if (!fs.existsSync(SCANS_DIR)) {
    fs.mkdirSync(SCANS_DIR, { recursive: true });
  }

  const now = new Date();
  const scan_date = now.toISOString();

  // Fetch from Polymarket (500 max: 5 pages × 100)
  const markets = await fetchMarkets({ limit: 100, maxPages: 5 });

  // Apply eligible filter
  const { candidates, scan_stats } = applyEligibleFilter(markets);

  const result = {
    scan_date,
    scan_stats,
    candidates,
  };

  // Write to disk (no > redirection — use fs.writeFileSync)
  const filename = `eligible_${formatDate(now)}.json`;
  const outPath = path.join(SCANS_DIR, filename);
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2) + '\n', { encoding: 'utf8' });
  console.log(`[run_eligible_scan] Written: ${outPath}`);
  console.log(`[run_eligible_scan] fetched=${scan_stats.fetched_total} passed=${scan_stats.passed_eligible} filtered=${scan_stats.filtered_out}`);

  return result;
}

// Allow direct execution: node OppRadar/scripts/run_eligible_scan.mjs
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  runEligibleScan()
    .then(r => {
      console.log('[run_eligible_scan] Done. candidates:', r.candidates.length);
    })
    .catch(err => {
      console.error('[run_eligible_scan] Error:', err.message);
      process.exit(1);
    });
}
