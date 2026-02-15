
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TASK_ID = '260216_001';
const REPO_ROOT = path.resolve(__dirname, '../../../');
const REPORT_DIR = path.join(REPO_ROOT, 'rules/task-reports/2026-02');

// Output Files
const OUTPUT_DOD = path.join(REPORT_DIR, `dod_evidence_${TASK_ID}.txt`);
const OUTPUT_GIT_META = path.join(REPORT_DIR, `git_meta_${TASK_ID}.json`);
const OUTPUT_CI_PARITY = path.join(REPORT_DIR, `ci_parity_${TASK_ID}.json`);
const OUTPUT_RESULT = path.join(REPORT_DIR, `result_${TASK_ID}.json`);

console.log(`>>> Generating Evidence for Task ${TASK_ID}`);

try {
    // 1. Run Smoke Tests (DOD Evidence)
    console.log('Running smoke tests...');
    const smokeScript = path.join(REPO_ROOT, 'scripts/smoke_open_pr_guard.mjs');
    const smokeOutput = execSync(`node "${smokeScript}"`, { encoding: 'utf8' });

    if (!smokeOutput.includes('ALL SMOKE TESTS PASSED')) {
        throw new Error('Smoke tests failed');
    }

    const dodContent = `=== SMOKE TEST OUTPUT ===
${smokeOutput}
=========================
Status: PASS
Timestamp: ${new Date().toISOString()}
`;
    fs.writeFileSync(OUTPUT_DOD, dodContent);
    console.log(`Generated: ${OUTPUT_DOD}`);

    // 2. Generate Git Meta
    console.log('Generating Git Meta...');
    const branch = execSync('git branch --show-current', { encoding: 'utf8' }).trim();
    const commit = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
    const status = execSync('git status --porcelain', { encoding: 'utf8' }).trim();
    
    const gitMetaData = {
        branch,
        commit,
        status: status ? 'dirty' : 'clean',
        generated_at: new Date().toISOString()
    };
    fs.writeFileSync(OUTPUT_GIT_META, JSON.stringify(gitMetaData, null, 2));
    console.log(`Generated: ${OUTPUT_GIT_META}`);

    // 3. Generate CI Parity
    console.log('Generating CI Parity...');
    const ciParityScript = path.join(REPO_ROOT, 'scripts/ci_parity_probe.mjs');
    execSync(`node "${ciParityScript}" --task_id ${TASK_ID} --result_dir "${REPORT_DIR}"`, { stdio: 'inherit' });
    
    // Verify CI Parity file exists
    if (!fs.existsSync(OUTPUT_CI_PARITY)) {
        throw new Error(`CI Parity file not generated: ${OUTPUT_CI_PARITY}`);
    }
    console.log(`Verified: ${OUTPUT_CI_PARITY}`);

    // 4. Generate Result JSON
    console.log('Generating Result JSON...');
    const resultData = {
        task_id: TASK_ID,
        status: 'success', // Will be updated by assemble_evidence.mjs
        generated_at: new Date().toISOString(),
        dod_evidence: {
            smoke_tests: 'PASS',
            stdout_path: `rules/task-reports/2026-02/dod_evidence_${TASK_ID}.txt`
        }
    };
    fs.writeFileSync(OUTPUT_RESULT, JSON.stringify(resultData, null, 2));
    console.log(`Generated: ${OUTPUT_RESULT}`);

    console.log('Evidence Generation Completed Successfully.');

} catch (error) {
    console.error('Evidence generation failed:', error.message);
    process.exit(1);
}
