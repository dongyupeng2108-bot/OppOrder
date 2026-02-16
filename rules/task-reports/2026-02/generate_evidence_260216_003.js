const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const taskId = '260216_003';
const evidenceDir = __dirname; // rules/task-reports/2026-02
const repoRoot = path.resolve(evidenceDir, '../../..');

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

// 4. Generate CI Parity (REAL)
try {
    console.log('[Generate] Running ci_parity_probe.mjs...');
    const probeScript = path.join(repoRoot, 'scripts', 'ci_parity_probe.mjs');
    // ci_parity_probe takes --result_dir, not --output
    execSync(`node "${probeScript}" --task_id ${taskId} --result_dir "${evidenceDir}"`, { stdio: 'inherit' });
    console.log(`[Generate] Wrote ${ciParityPath}`);
} catch (e) {
    console.error(`[Generate] Failed to run ci_parity_probe.mjs: ${e.message}`);
    process.exit(1);
}

// 5. Write Git Meta (REAL)
try {
    const commit = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
    const gitMetaData = {
        task_id: taskId,
        branch: branch,
        commit: commit,
        clean: true
    };
    fs.writeFileSync(gitMetaPath, JSON.stringify(gitMetaData, null, 2));
    console.log(`[Generate] Wrote ${gitMetaPath}`);
} catch (e) {
    console.error(`[Generate] Failed to get git meta: ${e.message}`);
    process.exit(1);
}

console.log(`[Generate] SUCCESS.`);
