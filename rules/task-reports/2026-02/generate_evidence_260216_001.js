
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const TASK_ID = '260216_001';
const REPO_ROOT = path.resolve(__dirname, '../../../');
const REPORT_DIR = path.join(REPO_ROOT, 'rules/task-reports/2026-02');
const OUTPUT_FILE = path.join(REPORT_DIR, `dod_evidence_${TASK_ID}.txt`);

console.log(`>>> Generating Evidence for Task ${TASK_ID}`);

try {
    // Run smoke tests
    console.log('Running smoke tests...');
    const smokeScript = path.join(REPO_ROOT, 'scripts/smoke_open_pr_guard.mjs');
    const smokeOutput = execSync(`node "${smokeScript}"`, { encoding: 'utf8' });

    // Verify smoke tests passed
    if (!smokeOutput.includes('ALL SMOKE TESTS PASSED')) {
        throw new Error('Smoke tests failed');
    }

    // Write evidence file
    const evidenceContent = `=== SMOKE TEST OUTPUT ===
${smokeOutput}
=========================
Status: PASS
Timestamp: ${new Date().toISOString()}
`;
    fs.writeFileSync(OUTPUT_FILE, evidenceContent);
    console.log(`Created evidence file: ${OUTPUT_FILE}`);

} catch (error) {
    console.error('Evidence generation failed:', error.message);
    process.exit(1);
}
