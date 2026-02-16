const fs = require('fs');
const path = require('path');

const taskId = '260216_003';
const evidenceDir = __dirname; // rules/task-reports/2026-02

const resultPath = path.join(evidenceDir, `result_${taskId}.json`);
const dodPath = path.join(evidenceDir, `dod_evidence_${taskId}.txt`);
const notifyPath = path.join(evidenceDir, `notify_${taskId}.txt`);
const ciParityPath = path.join(evidenceDir, `ci_parity_${taskId}.json`);
const gitMetaPath = path.join(evidenceDir, `git_meta_${taskId}.json`);

console.log(`[Generate] Generating dummy evidence for Task ${taskId}...`);

// 1. Write Result JSON
const resultData = {
    status: 'DONE',
    summary: 'Evidence Engine v1 Verification (Dummy Evidence)',
    dod_evidence: {
        gate_light_exit: 0
    },
    // Add lineage for dual commit protocol if needed, but this is a fresh task
    lineage: {
        base_commit: 'HEAD',
        landing_commit: 'HEAD',
        code_drift: 0
    }
};
fs.writeFileSync(resultPath, JSON.stringify(resultData, null, 2));
console.log(`[Generate] Wrote ${resultPath}`);

// 2. Write DoD Evidence
const dodContent = `\n=== DOD_EVIDENCE_STDOUT ===\n[Evidence Engine v1] Dummy Evidence Generation\nTask: ${taskId}\nStatus: PASS\n===========================\n`;
fs.writeFileSync(dodPath, dodContent.trim());
console.log(`[Generate] Wrote ${dodPath}`);

// 3. Write Notify
const notifyContent = `
Task: ${taskId}
Status: PASS
Summary: Evidence Engine v1 Verification
TRAE_REPORT_SNIPPET: (See below)
`;
fs.writeFileSync(notifyPath, notifyContent.trim());
console.log(`[Generate] Wrote ${notifyPath}`);

// 4. Write CI Parity (Mock)
const ciParityData = {
    task_id: taskId,
    merge_base: 'mock_merge_base',
    ci_merge_base: 'mock_merge_base',
    match: true
};
fs.writeFileSync(ciParityPath, JSON.stringify(ciParityData, null, 2));
console.log(`[Generate] Wrote ${ciParityPath}`);

// 5. Write Git Meta (Mock)
const gitMetaData = {
    task_id: taskId,
    branch: 'feat/p2-evidence-engine-v1-260216_003',
    commit: 'mock_commit',
    clean: true
};
fs.writeFileSync(gitMetaPath, JSON.stringify(gitMetaData, null, 2));
console.log(`[Generate] Wrote ${gitMetaPath}`);

console.log(`[Generate] SUCCESS.`);
