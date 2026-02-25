import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../../..');

const taskId = '260225_003';
const reportDir = __dirname; // rules/task-reports/2026-02

// 1. Run Regression Script -> dod_evidence
const regressionScript = path.join(REPO_ROOT, 'scripts', `regress_hardstop_latch_${taskId}.mjs`);
const dodEvidenceFile = path.join(reportDir, `dod_evidence_${taskId}.txt`);

console.log(`[GenerateEvidence] Running regression script: ${regressionScript}`);
let regressionOutput = '';
let regressionPassed = false;
try {
    regressionOutput = execSync(`node "${regressionScript}"`, { 
        cwd: REPO_ROOT, 
        encoding: 'utf8',
        stdio: 'pipe' 
    });
    if (regressionOutput.includes('All tests PASSED')) {
        regressionPassed = true;
        console.log('[GenerateEvidence] Regression PASSED.');
    } else {
        console.warn('[GenerateEvidence] Regression finished but "ALL TESTS PASSED" not found.');
    }
} catch (e) {
    console.error('[GenerateEvidence] Regression FAILED.');
    regressionOutput = (e.stdout || '') + '\n' + (e.stderr || '') + '\n' + (e.message || '');
    // Don't exit yet, capture failure in evidence
}

fs.writeFileSync(dodEvidenceFile, regressionOutput);
console.log(`[GenerateEvidence] Wrote dod_evidence to: ${dodEvidenceFile}`);

// 2. Generate git_meta
const gitMetaFile = path.join(reportDir, `git_meta_${taskId}.json`);
let gitMeta = {};
try {
    const gitBranch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
    const gitHash = execSync('git rev-parse HEAD', { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
    // const gitStatus = execSync('git status --porcelain', { cwd: REPO_ROOT, encoding: 'utf8' }).trim(); 
    // git status might be noisy if we have untracked files, but usually required.
    // Let's keep it simple.
    
    gitMeta = {
        branch: gitBranch,
        hash: gitHash,
        // status: gitStatus,
        timestamp: new Date().toISOString()
    };
} catch (e) {
    console.error('Failed to get git meta:', e.message);
    gitMeta = { error: e.message };
}

fs.writeFileSync(gitMetaFile, JSON.stringify(gitMeta, null, 2));
console.log(`[GenerateEvidence] Wrote git_meta to: ${gitMetaFile}`);

// 3. Generate result
const resultFile = path.join(reportDir, `result_${taskId}.json`);
const result = {
    task_id: taskId,
    status: regressionPassed ? 'success' : 'failure',
    timestamp: new Date().toISOString(),
    details: 'HardStop Latch Regression Evidence',
    regression_passed: regressionPassed
};

fs.writeFileSync(resultFile, JSON.stringify(result, null, 2));
console.log(`[GenerateEvidence] Wrote result to: ${resultFile}`);

if (!regressionPassed) {
    console.error('[GenerateEvidence] Regression failed. Exiting with 1.');
    process.exit(1);
}
