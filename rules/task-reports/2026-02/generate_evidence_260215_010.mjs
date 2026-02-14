import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const TASK_ID = '260215_010';
const REPO_ROOT = path.resolve('E:/OppRadar');
const REPORT_DIR = path.join(REPO_ROOT, 'rules', 'task-reports', '2026-02');

// Ensure report dir exists
if (!fs.existsSync(REPORT_DIR)) fs.mkdirSync(REPORT_DIR, { recursive: true });

const evidenceFile = path.join(REPORT_DIR, `dod_evidence_${TASK_ID}.txt`);

// 1. Verify Scripts Existence
const scripts = [
    'scripts/preflight.ps1',
    'scripts/assemble_evidence.mjs',
    'scripts/run_task.ps1',
    'scripts/gate_light_ci.mjs'
];

let content = '';

scripts.forEach(script => {
    const fullPath = path.join(REPO_ROOT, script);
    if (fs.existsSync(fullPath)) {
        content += `EXIST: ${script}\n`;
    } else {
        content += `MISSING: ${script}\n`;
        console.error(`Missing script: ${script}`);
        process.exit(1);
    }
});

// 2. Verify Gate Light Upgrades
const gateLightPath = path.join(REPO_ROOT, 'scripts', 'gate_light_ci.mjs');
const gateLightContent = fs.readFileSync(gateLightPath, 'utf8');

if (gateLightContent.includes('CheckReportBlocks') && gateLightContent.includes('CheckPreflightAttestation')) {
    content += `GATE_LIGHT_UPGRADE: Verified (CheckReportBlocks + CheckPreflightAttestation present)\n`;
} else {
    content += `GATE_LIGHT_UPGRADE: FAILED (Missing checks)\n`;
    console.error('Gate Light upgrade verification failed.');
    process.exit(1);
}

// 3. Generate CI Parity
try {
    const ciParityFile = path.join(REPORT_DIR, `ci_parity_${TASK_ID}.json`);
    // Ensure we are in repo
    process.chdir(REPO_ROOT);
    
    const base = execSync('git rev-parse origin/main', { encoding: 'utf8' }).trim();
    const head = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
    const mergeBase = execSync('git merge-base origin/main HEAD', { encoding: 'utf8' }).trim();
    
    // Calculate diff for files list
    let filesList = [];
    try {
        const diffOutput = execSync('git diff --name-only origin/main...HEAD', { encoding: 'utf8' }).trim();
        filesList = diffOutput ? diffOutput.split('\n').map(l => l.trim()).filter(Boolean) : [];
    } catch (e) {}

    const ciData = {
        task_id: TASK_ID,
        base,
        head,
        merge_base: mergeBase,
        files_count: filesList.length,
        files_list: filesList,
        timestamp: new Date().toISOString()
    };
    fs.writeFileSync(ciParityFile, JSON.stringify(ciData, null, 2));
    content += `CI_PARITY: Generated ${ciParityFile}\n`;
} catch (e) {
    console.error('Failed to generate CI Parity:', e);
    process.exit(1);
}

// 4. Generate Git Meta (Optional, useful for assemble)
try {
    const gitMetaFile = path.join(REPORT_DIR, `git_meta_${TASK_ID}.json`);
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
    const commit = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
    
    // Calculate diff
    let diff = [];
    try {
        const diffOutput = execSync('git diff --name-only origin/main...HEAD', { encoding: 'utf8' }).trim();
        diff = diffOutput ? diffOutput.split('\n').map(l => l.trim()).filter(Boolean) : [];
    } catch (e) {}

    const metaData = {
        branch,
        commit,
        scope_diff: diff
    };
    fs.writeFileSync(gitMetaFile, JSON.stringify(metaData, null, 2));
    content += `GIT_META: Generated ${gitMetaFile}\n`;
} catch (e) {
    console.error('Failed to generate Git Meta:', e);
}

fs.writeFileSync(evidenceFile, content, 'utf8');
console.log(`DoD Evidence written to ${evidenceFile}`);
