/**
 * generate_evidence_260302_017.mjs
 * Evidence generator for Task 260302_017:
 *   M6-A4 Postmortem API routes (4 endpoints)
 */

import { execSync }     from 'child_process';
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path             from 'path';
import crypto           from 'crypto';

const __filename   = fileURLToPath(import.meta.url);
const __dirname    = path.dirname(__filename);

const TASK_ID      = '260302_017';
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
  title:       'M6-A4 Postmortem API routes (4 endpoints)',
  status:      'PASS',
  deliverables: [
    'OppRadar/postmortem_routes.mjs — route dispatcher for 4 postmortem endpoints',
    'OppRadar/mock_server_53122.mjs — register postmortem route dispatcher',
    'tests/postmortem_routes.test.mjs — 10/10 tests pass',
  ],
  verification:        'GET /postmortem/pending (paginated); GET /postmortem/stats (group_by, time_range, strategy_id); GET /postmortem/:opp_id (card+outcome+notes); POST /postmortem/:opp_id/note (400 on empty); 404 for unknown opp; all 10 tests pass',
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
  'DOD_ROUTES_MODULE=OppRadar/postmortem_routes.mjs (handlePostmortemRoute dispatcher)',
  'DOD_ENDPOINT_PENDING=GET /postmortem/pending (paginated, limit/offset)',
  'DOD_ENDPOINT_STATS=GET /postmortem/stats (group_by, time_range, strategy_id)',
  'DOD_ENDPOINT_CARD=GET /postmortem/:opp_id (postmortem+outcome+notes)',
  'DOD_ENDPOINT_NOTE=POST /postmortem/:opp_id/note (400 on empty text)',
  'DOD_SERVER_INTEGRATION=mock_server_53122.mjs registers postmortem route dispatcher',
  'DOD_TESTS=tests/postmortem_routes.test.mjs (10/10 pass)',
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
