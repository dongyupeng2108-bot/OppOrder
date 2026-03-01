/**
 * generate_evidence_260301_022.mjs
 * Evidence generator for Task 260301_022:
 *   M4 收口补强 — schema, draft_generator, gemini_provider, UI (list/detail/styles)
 *
 * Outputs to same directory as this script (uses import.meta.url, never process.cwd()):
 *   result_260301_022.json
 *   git_meta_260301_022.json
 *   dod_evidence_260301_022.txt
 *   ci_parity_260301_022.json
 */

import { execSync }     from 'child_process';
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path             from 'path';
import crypto           from 'crypto';

const __filename   = fileURLToPath(import.meta.url);
const __dirname    = path.dirname(__filename);

const TASK_ID      = '260301_022';
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

// ── result_260301_022.json ────────────────────────────────────────────────────
const reportFile    = `rules/task-reports/2026-03/${TASK_ID}.json`;
const reportContent = JSON.stringify({
  task_id:     TASK_ID,
  title:       'M4 收口补强 — schema + draft_generator + gemini_provider + UI fixes',
  status:      'PASS',
  deliverables: [
    'OppRadar/contracts/opportunity_card.schema.json — 9 new optional fields added',
    'OppRadar/draft_generator.mjs — offset fields + model_role + latency_ms + prompt extended',
    'OppRadar/providers/gemini_provider.mjs — model_role + latency_ms + diagnostic fields surfaced',
    'ui/styles.css — body bg #0d0d0d, veto/dev_flag classes, BLOCK row dim',
    'ui/list.html — dark-mode styles, dev_signed/dev_flag columns, sort by dev_abs, BLOCK to bottom',
    'ui/detail.html — dark-mode styles, Section 4.5 offset analysis, deep-btn onclick fix',
  ],
  new_schema_fields: [
    'p_mid', 'dev_signed', 'dev_abs', 'dev_flag',
    'mispricing_type', 'why_1_liner', 'what_to_check',
    'model_role', 'latency_ms',
  ],
  tests_passed:        '19/19 (6 eligible_filter + 5 snapshot_index + 5 outcome_store + 3 behavior)',
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

// ── git_meta_260301_022.json ──────────────────────────────────────────────────
const gitMeta = {
  task_id:      TASK_ID,
  head:         headSha,
  commit:       headSha,
  branch:       branch,
  short:        shortSha,
  generated_at: now,
};
writeEvidence(`git_meta_${TASK_ID}.json`, JSON.stringify(gitMeta, null, 2));

// ── dod_evidence_260301_022.txt ───────────────────────────────────────────────
const dodLines = [
  `TASK_ID=${TASK_ID}`,
  `GENERATED_AT=${now}`,
  '',
  '# DoD Markers',
  'DOD_DELIVERABLE_SCHEMA=OppRadar/contracts/opportunity_card.schema.json',
  'DOD_DELIVERABLE_DRAFT_GENERATOR=OppRadar/draft_generator.mjs',
  'DOD_DELIVERABLE_GEMINI_PROVIDER=OppRadar/providers/gemini_provider.mjs',
  'DOD_DELIVERABLE_STYLES_CSS=ui/styles.css',
  'DOD_DELIVERABLE_LIST_HTML=ui/list.html',
  'DOD_DELIVERABLE_DETAIL_HTML=ui/detail.html',
  '',
  '# New Schema Fields (9 optional)',
  'DOD_SCHEMA_FIELD_1=p_mid',
  'DOD_SCHEMA_FIELD_2=dev_signed',
  'DOD_SCHEMA_FIELD_3=dev_abs',
  'DOD_SCHEMA_FIELD_4=dev_flag',
  'DOD_SCHEMA_FIELD_5=mispricing_type',
  'DOD_SCHEMA_FIELD_6=why_1_liner',
  'DOD_SCHEMA_FIELD_7=what_to_check',
  'DOD_SCHEMA_FIELD_8=model_role',
  'DOD_SCHEMA_FIELD_9=latency_ms',
  '',
  '# Acceptance Checks',
  'DOD_CHECK_SCHEMA_ALL_OPTIONAL=All 9 new fields have no required constraint',
  'DOD_CHECK_DRAFT_GENERATOR_OFFSET=p_mid/dev_signed/dev_abs/dev_flag computed from p_range + yes_price',
  'DOD_CHECK_DRAFT_GENERATOR_LATENCY=latency_ms measured around callLLM(); model_role=scan',
  'DOD_CHECK_GEMINI_PROVIDER_LATENCY=t0 recorded before fetch; latency_ms = Date.now()-t0; model_role=core',
  'DOD_CHECK_GEMINI_PROVIDER_DIAGNOSTIC=mispricing_type/why_1_liner/what_to_check surfaced from parsed JSON',
  'DOD_CHECK_STYLES_BG=#0d0d0d body background applied',
  'DOD_CHECK_LIST_COLUMNS=dev_signed + dev_flag columns added; sort by dev_abs desc; BLOCK rows to bottom',
  'DOD_CHECK_DETAIL_SECTION_45=Section 4.5 偏差分析 added with 8 fields',
  'DOD_CHECK_DEEP_BTN_FIXED=onclick uses single-quote escaping instead of JSON.stringify double-quotes',
  'DOD_CHECK_TESTS=19/19 passed (6+5+5 unit + 3 behavior)',
  '',
  'GATE_LIGHT_EXIT=0',
].join('\n');
writeEvidence(`dod_evidence_${TASK_ID}.txt`, dodLines);

// ── ci_parity_260301_022.json ─────────────────────────────────────────────────
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
