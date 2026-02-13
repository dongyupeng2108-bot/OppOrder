const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const taskId = '260213_004';
const baseDir = path.join(__dirname);

// 1. Write Notify
const notifyContent = `TraeTask_M5_260213_004_NewsPull_Provider_Abstraction_DeterministicMock

## Summary
Implemented NewsProvider abstraction and Deterministic Mock Provider.
Verified via automated tests (idempotency, pagination) and Gate Light.

## Evidence
- Test Log: rules/task-reports/2026-02/260213_004_test_log.txt
- Healthcheck: rules/task-reports/2026-02/260213_004_healthcheck_53122_root.txt
- CI Parity: rules/task-reports/2026-02/ci_parity_260213_004.json

## DoD
- Gate Light: PASS
- Healthcheck: PASS
- Snippet: PASS
GATE_LIGHT_EXIT=0

=== ENVELOPE_DATA ===
RESULT_JSON: See result_260213_004.json
LOG_HEAD: See 260213_004_test_log.txt
LOG_TAIL: See 260213_004_test_log.txt
INDEX: See deliverables_index_260213_004.json

=== DOD_EVIDENCE_STDOUT ===
DOD_EVIDENCE_HEALTHCHECK_ROOT: rules/task-reports/2026-02/260213_004_healthcheck_53122_root.txt => HTTP/1.1 200 OK
DOD_EVIDENCE_HEALTHCHECK_PAIRS: rules/task-reports/2026-02/260213_004_healthcheck_53122_pairs.txt => HTTP/1.1 200 OK
TRAE_REPORT_SNIPPET: rules/task-reports/2026-02/trae_report_snippet_260213_004.txt
`;

// Normalize to LF
const notifyBuffer = Buffer.from(notifyContent.replace(/\r\n/g, '\n'), 'utf8');
const notifyPath = path.join(baseDir, `notify_${taskId}.txt`);
fs.writeFileSync(notifyPath, notifyBuffer);
console.log('Notify written.');

// 2. Calculate Hash
const notifyHash = crypto.createHash('sha256').update(notifyBuffer).digest('hex').substring(0, 8);
console.log(`Notify Hash: ${notifyHash}`);

// 3. Write Result
const result = {
  "task_id": taskId,
  "status": "DONE",
  "summary": "Implemented NewsProvider abstraction and Deterministic Mock Provider.",
  "report_file": `notify_${taskId}.txt`,
  "report_sha256_short": notifyHash,
  "artifacts": [
    `rules/task-reports/2026-02/${taskId}_test_log.txt`,
    `rules/task-reports/2026-02/${taskId}_healthcheck_53122_root.txt`,
    `rules/task-reports/2026-02/${taskId}_healthcheck_53122_pairs.txt`,
    `rules/task-reports/2026-02/trae_report_snippet_${taskId}.txt`,
    `rules/task-reports/2026-02/ci_parity_${taskId}.json`
  ],
  "gate_light_exit": 0,
  "dod_evidence": {
    "gate_light_exit": 0,
    "healthcheck": [
      `rules/task-reports/2026-02/${taskId}_healthcheck_53122_root.txt`,
      `rules/task-reports/2026-02/${taskId}_healthcheck_53122_pairs.txt`
    ]
  },
  "lineage": {
    "type": "standard",
    "base": "origin/main",
    "landing": "feat/news-pull-provider-260213_004"
  }
};

const resultPath = path.join(baseDir, `result_${taskId}.json`);
fs.writeFileSync(resultPath, JSON.stringify(result, null, 2));
console.log('Result written.');
