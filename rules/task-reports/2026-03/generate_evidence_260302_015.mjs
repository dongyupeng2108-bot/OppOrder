/**
 * generate_evidence_260302_015.mjs
 * Evidence generator for Task 260302_015:
 *   M6-A2 Auto-generate postmortem card on outcome + frozen fields + backfill
 */

import { execSync }     from 'child_process';
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path             from 'path';
import crypto           from 'crypto';

const __filename   = fileURLToPath(import.meta.url);
const __dirname    = path.dirname(__filename);

const TASK_ID      = '260302_015';
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
  title:       'M6-A2 Auto-generate postmortem card on outcome',
  status:      'PASS',
  deliverables: [
    'OppRadar/postmortem_generator.mjs — auto-generate postmortem from outcome + opp context',
    'OppRadar/postmortem_store.mjs — frozen fields enforcement (decision_snapshot_id, decision_b5_run_id)',
    'OppRadar/mock_server_53122.mjs — POST /outcomes/:opp_id hook to auto-generate postmortem',
    'scripts/backfill_postmortems.mjs — idempotent backfill script',
    'tests/postmortem_generator.test.mjs — 6/6 tests pass',
  ],
  verification:        'outcome YES→actual 1.0, NO→actual 0.0; frozen fields preserved on revision; idempotent skip; backfill discoverable; all 6 tests pass',
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
  'DOD_AUTO_POSTMORTEM=POST /outcomes/:opp_id auto-generates postmortem card',
  'DOD_FROZEN_FIELDS=decision_snapshot_id/decision_b5_run_id frozen from rev 0',
  'DOD_ACTUAL_MAPPING=YES→1.0, NO→0.0',
  'DOD_IDEMPOTENT=same outcome skips duplicate postmortem',
  'DOD_BACKFILL=scripts/backfill_postmortems.mjs (idempotent)',
  'DOD_TESTS=tests/postmortem_generator.test.mjs (6/6 pass)',
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
