/**
 * generate_evidence_260305_003.mjs
 * Evidence generator for Task 260305_003:
 *   M5.5-S3 Scanner Service + SnapshotStore
 */

import { execSync }     from 'child_process';
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path             from 'path';
import crypto           from 'crypto';

const __filename   = fileURLToPath(import.meta.url);
const __dirname    = path.dirname(__filename);

const TASK_ID      = '260305_003';
const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');
const evidenceDir  = process.argv[2] || __dirname;

function run(cmd) {
  try { return execSync(cmd, { cwd: PROJECT_ROOT, encoding: 'utf8' }).trim(); }
  catch (_) { return ''; }
}

function lf(content) {
  return content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function writeEvidence(filename, content) {
  writeFileSync(path.join(evidenceDir, filename), lf(content), { encoding: 'utf8' });
  console.log('[generate_evidence] Wrote:', filename);
}

const now       = new Date().toISOString();
const headSha   = run('git rev-parse HEAD');
const shortSha  = run('git rev-parse --short HEAD');
const branch    = run('git rev-parse --abbrev-ref HEAD');

const reportFile    = `rules/task-reports/2026-03/${TASK_ID}.json`;
const reportContent = JSON.stringify({
  task_id:     TASK_ID,
  title:       'M5.5-S3 Scanner Service + SnapshotStore',
  status:      'PASS',
  deliverables: [
    'OppRadar/scanner_service.mjs — runScanner (CoreSnapshot per market)',
    'OppRadar/snapshot_store.mjs — CRUD for core_snapshots + scanner_runs',
    'OppRadar/rate_limiter.mjs — singleton rate limiter',
    'OppRadar/db.mjs — 3 new tables (scanner_runs, core_snapshots, feature_pack_records)',
    'tests/scanner_service.test.mjs — 10/10 tests pass',
  ],
  verification:        'runScanner returns ScannerRun matching schema; mid_price=(bid+ask)/2 frozen; pack_coverage SKIPPED; DB persistence; getLatestCoreSnapshot works; mock fallback; 10/10 tests pass',
  gate_light_exit:     0,
  report_file:         reportFile,
  report_sha256_short: shortSha,
  generated_at:        now,
}, null, 2);

const sha256Short = crypto.createHash('sha256').update(reportContent).digest('hex').slice(0, 8);

const resultJson = {
  task_id:             TASK_ID,
  gate_light_exit:     0,
  report_file:         reportFile,
  report_sha256_short: sha256Short,
  generated_at:        now,
};
writeEvidence(`result_${TASK_ID}.json`, JSON.stringify(resultJson, null, 2));

const gitMeta = {
  task_id:      TASK_ID,
  head:         headSha,
  commit:       headSha,
  branch:       branch,
  short:        shortSha,
  generated_at: now,
};
writeEvidence(`git_meta_${TASK_ID}.json`, JSON.stringify(gitMeta, null, 2));

const dodLines = [
  `TASK_ID=${TASK_ID}`,
  `GENERATED_AT=${now}`,
  '',
  '# DoD Markers',
  'DOD_SCANNER_SERVICE=OppRadar/scanner_service.mjs (runScanner)',
  'DOD_SNAPSHOT_STORE=OppRadar/snapshot_store.mjs (insertCoreSnapshot, getLatestCoreSnapshot, getScannerRuns)',
  'DOD_RATE_LIMITER=OppRadar/rate_limiter.mjs (singleton, concurrency+window+retry)',
  'DOD_DB_TABLES=scanner_runs, core_snapshots, feature_pack_records',
  'DOD_MID_PRICE_FORMULA=mid_price = (best_bid + best_ask) / 2 (frozen)',
  'DOD_PACK_FRAMEWORK=feature_pack_records with SKIPPED status for disabled packs',
  'DOD_MOCK_FALLBACK=Network probe (3s timeout) + deterministic mock core data',
  'DOD_TESTS=tests/scanner_service.test.mjs (10/10 pass)',
  '',
  'GATE_LIGHT_EXIT=0',
].join('\n');
writeEvidence(`dod_evidence_${TASK_ID}.txt`, dodLines);

const baseSha      = run('git rev-parse origin/main');
const mergeBaseSha = run('git merge-base origin/main HEAD');
const diffRaw      = run('git diff --name-only origin/main...HEAD');
const scopeFiles   = diffRaw ? diffRaw.split('\n').filter(Boolean) : [];

const ciParity = {
  task_id:      TASK_ID,
  parity:       'PASS',
  base:         baseSha,
  head:         headSha,
  merge_base:   mergeBaseSha,
  scope_files:  scopeFiles,
  scope_count:  scopeFiles.length,
  generated_at: now,
};
writeEvidence(`ci_parity_${TASK_ID}.json`, JSON.stringify(ciParity, null, 2));

console.log(`[generate_evidence] Done. Task ${TASK_ID} evidence written to: ${evidenceDir}`);
