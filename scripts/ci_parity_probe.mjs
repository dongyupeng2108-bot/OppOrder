import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const args = process.argv.slice(2);

// Handle both --key=value and --key value
function getArgValue(key, fallback) {
    const index = args.indexOf(key);
    if (index !== -1 && index + 1 < args.length) return args[index + 1];
    const prefix = key + '=';
    const arg = args.find(a => a.startsWith(prefix));
    return arg ? arg.substring(prefix.length) : fallback;
}

const taskId = getArgValue('--task_id');
const resultDir = getArgValue('--result_dir', process.cwd());
// No longer used in JSON structure but kept for compat if needed, though not required by spec
// const detectionSource = getArgValue('--detection_source', 'unknown');

if (!taskId) {
    console.error('Error: --task_id required');
    process.exit(1);
}

function runGit(cmd) {
    try {
        return execSync(cmd, { encoding: 'utf8' }).trim();
    } catch (e) {
        throw new Error(`Git command failed: ${cmd}\n${e.message}`);
    }
}

console.log(`[CI Parity Probe] Running for task ${taskId} (JSON Mode)...`);

// 0. Fail-fast origin/main check
try {
    runGit('git fetch origin main');
} catch (e) {
    console.error('[CI Parity Probe] FATAL: git fetch origin main failed.');
    console.error(e.message);
    process.exit(1);
}

// 1. Gather Git Context
let originMain;
try {
    originMain = runGit('git rev-parse origin/main');
} catch (e) {
    console.error('[CI Parity Probe] FATAL: origin/main not found after fetch.');
    process.exit(1);
}

const head = runGit('git rev-parse HEAD');
let mergeBase;
try {
    mergeBase = runGit(`git merge-base origin/main HEAD`);
} catch (e) {
    console.error('[CI Parity Probe] FATAL: git merge-base failed.');
    process.exit(1);
}

const diffScope = runGit('git diff --name-only origin/main...HEAD');
const scopeFiles = diffScope ? diffScope.split('\n').filter(Boolean) : [];
const scopeCount = scopeFiles.length;

// 2. Build JSON Content
const evidence = {
    task_id: taskId,
    base: originMain,
    head: head,
    merge_base: mergeBase,
    scope_files: scopeFiles,
    scope_count: scopeCount,
    generated_at: new Date().toISOString()
};

// 3. Write to File
const outputFile = path.join(resultDir, `ci_parity_${taskId}.json`);

// Ensure directory exists
if (!fs.existsSync(resultDir)) {
    fs.mkdirSync(resultDir, { recursive: true });
}

fs.writeFileSync(outputFile, JSON.stringify(evidence, null, 2));
console.log(`[CI Parity Probe] Evidence written to: ${outputFile}`);
