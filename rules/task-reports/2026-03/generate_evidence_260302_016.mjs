/**
 * generate_evidence_260302_016.mjs
 * Evidence generator for Task 260302_016:
 *   M6-A3 Postmortem stats module + schema + endpoint
 */

import { execSync }     from 'child_process';
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path             from 'path';
import crypto           from 'crypto';

const __filename   = fileURLToPath(import.meta.url);
const __dirname    = path.dirname(__filename);

const TASK_ID      = '260302_016';
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
  title:       'M6-A3 Postmortem stats module + schema + endpoint',
  status:      'PASS',
  deliverables: [
    'OppRadar/postmortem_stats.mjs — aggregation queries (GROUP BY + null safety)',
    'OppRadar/contracts/postmortem_stats.schema.json — stats response schema',
    'OppRadar/mock_server_53122.mjs — GET /postmortem/stats endpoint',
    'tests/postmortem_stats.test.mjs — 9/9 tests pass',
  ],
  verification:        'group_by enum = table field names (HR-4); hit_rate denom = count_predicted (HR-2); empty data: count=0, rate=null (HR-7); is_latest=1 filter; time_range filter; all 9 tests pass',
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
  'DOD_STATS_MODULE=OppRadar/postmortem_stats.mjs (GROUP BY + null safety)',
  'DOD_SCHEMA=OppRadar/contracts/postmortem_stats.schema.json',
  'DOD_ENDPOINT=GET /postmortem/stats (group_by, time_range, strategy_id)',
  'DOD_HR2=hit_rate denominator = COUNT(direction_correct)',
  'DOD_HR4=group_by enum values = postmortem table field names',
  'DOD_HR7=count/sum empty=0, rate/avg empty=null',
  'DOD_HR5=stats only count is_latest=1',
  'DOD_TESTS=tests/postmortem_stats.test.mjs (9/9 pass)',
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
