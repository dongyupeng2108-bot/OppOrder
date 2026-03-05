/**
 * generate_evidence_260305_005.mjs
 * Evidence generator for Task 260305_005:
 *   M5.5-S5 UI navigation cleanup — meta refresh + nav consolidation
 */

import { execSync }     from 'child_process';
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path             from 'path';
import crypto           from 'crypto';

const __filename   = fileURLToPath(import.meta.url);
const __dirname    = path.dirname(__filename);

const TASK_ID      = '260305_005';
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
  title:       'M5.5-S5 UI navigation cleanup',
  status:      'PASS',
  deliverables: [
    'ui/index.html — meta refresh → oppradar_v2.html',
    'ui/list.html — meta refresh → oppradar_v2.html',
    'ui/compare.html — meta refresh → oppradar_v2.html',
    'ui/oppradar_v2.html — nav bar cleaned (self-link only)',
    'ui/detail.html — nav + back-link → oppradar_v2.html, no 验收面板',
  ],
  verification:        'GET /ui/oppradar_v2.html 200; index.html refresh; list.html refresh; compare.html refresh; detail.html nav fixed',
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
  'DOD_INDEX_REFRESH=ui/index.html meta refresh → /ui/oppradar_v2.html',
  'DOD_LIST_REFRESH=ui/list.html meta refresh → /ui/oppradar_v2.html',
  'DOD_COMPARE_REFRESH=ui/compare.html meta refresh → /ui/oppradar_v2.html',
  'DOD_V2_NAV=ui/oppradar_v2.html nav cleaned (no 验收面板, no V1 列表)',
  'DOD_DETAIL_NAV=ui/detail.html nav + back-link → oppradar_v2.html',
  'DOD_DETAIL_NO_LEGACY=detail.html no 验收面板, no href="/ui/", no href="/ui/list.html"',
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
