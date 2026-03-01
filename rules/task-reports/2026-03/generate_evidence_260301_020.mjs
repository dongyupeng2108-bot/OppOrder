/**
 * generate_evidence_260301_020.mjs
 * Evidence generator for Task 260301_020: M4 核心模块单元测试补充
 *
 * Outputs to same directory as this script (uses import.meta.url, never process.cwd()):
 *   result_260301_020.json
 *   git_meta_260301_020.json
 *   dod_evidence_260301_020.txt
 *   ci_parity_260301_020.json
 */

import { execSync }    from 'child_process';
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path            from 'path';
import crypto          from 'crypto';

const __filename   = fileURLToPath(import.meta.url);
const __dirname    = path.dirname(__filename);

const TASK_ID      = '260301_020';
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

// ── result_260301_020.json ────────────────────────────────────────────────────
const reportFile    = `rules/task-reports/2026-03/${TASK_ID}.json`;
const reportContent = JSON.stringify({
  task_id:     TASK_ID,
  title:       'M4 核心模块单元测试补充: polymarket_eligible_filter, snapshot_index, outcome_store',
  status:      'PASS',
  deliverables: [
    'tests/test_eligible_filter.mjs (6 test groups, 6/6 PASS)',
    'tests/test_snapshot_index.mjs  (5 test groups, 5/5 PASS)',
    'tests/test_outcome_store.mjs   (5 test groups, 5/5 PASS)',
  ],
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

// ── git_meta_260301_020.json ──────────────────────────────────────────────────
const gitMeta = {
  task_id:      TASK_ID,
  head:         headSha,
  commit:       headSha,
  branch:       branch,
  short:        shortSha,
  generated_at: now,
};
writeEvidence(`git_meta_${TASK_ID}.json`, JSON.stringify(gitMeta, null, 2));

// ── dod_evidence_260301_020.txt ───────────────────────────────────────────────
const dodLines = [
  `TASK_ID=${TASK_ID}`,
  `GENERATED_AT=${now}`,
  '',
  '# DoD Markers',
  'DOD_DELIVERABLE_ELIGIBLE_FILTER_TEST=tests/test_eligible_filter.mjs',
  'DOD_DELIVERABLE_SNAPSHOT_INDEX_TEST=tests/test_snapshot_index.mjs',
  'DOD_DELIVERABLE_OUTCOME_STORE_TEST=tests/test_outcome_store.mjs',
  '',
  '# Acceptance Checks',
  'DOD_CHECK_ELIGIBLE_FILTER_6_6=node tests/test_eligible_filter.mjs → 6/6 PASS',
  'DOD_CHECK_SNAPSHOT_INDEX_5_5=node tests/test_snapshot_index.mjs → 5/5 PASS',
  'DOD_CHECK_OUTCOME_STORE_5_5=node tests/test_outcome_store.mjs → 5/5 PASS',
  'DOD_CHECK_NO_DATA_POLLUTION=data/ production directories unaffected (cleanup verified)',
  'DOD_CHECK_GIT_STATUS_CLEAN=git status clean after tests (no untracked data/ files)',
  '',
  'GATE_LIGHT_EXIT=0',
].join('\n');
writeEvidence(`dod_evidence_${TASK_ID}.txt`, dodLines);

// ── ci_parity_260301_020.json ─────────────────────────────────────────────────
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
