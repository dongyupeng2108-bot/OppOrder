import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const args = process.argv.slice(2);
const taskIdArg = args.find(arg => arg.startsWith('--task_id=') || arg === '--task_id');
const resultDirArg = args.find(arg => arg.startsWith('--result_dir=') || arg === '--result_dir');
const detectionSourceArg = args.find(arg => arg.startsWith('--detection_source=') || arg === '--detection_source');

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
const detectionSource = getArgValue('--detection_source', 'unknown');

if (!taskId) {
    console.error('Error: --task_id required');
    process.exit(1);
}

function runGit(cmd) {
    try {
        return execSync(cmd, { encoding: 'utf8' }).trim();
    } catch (e) {
        return `ERROR: ${e.message.replace(/\n/g, ' ')}`;
    }
}

console.log(`[CI Parity Probe] Running for task ${taskId}...`);

// 1. Gather Git Context
const originMain = runGit('git rev-parse origin/main');
const head = runGit('git rev-parse HEAD');
let mergeBase = 'unknown';
try {
    mergeBase = runGit(`git merge-base origin/main HEAD`);
} catch (e) {
    mergeBase = 'ERROR: No merge base found';
}

const diffScope = runGit('git diff --name-only origin/main...HEAD');
const fileCount = diffScope ? diffScope.split('\n').filter(Boolean).length : 0;

// 2. Build Report Content
const outputLines = [];
outputLines.push(`CI Parity Probe Report`);
outputLines.push(`Task ID: ${taskId}`);
outputLines.push(`Timestamp: ${new Date().toISOString()}`);
outputLines.push(`----------------------------------------`);
outputLines.push(`Git Context:`);
outputLines.push(`  Origin/Main: ${originMain}`);
outputLines.push(`  HEAD:        ${head}`);
outputLines.push(`  Merge Base:  ${mergeBase}`);
outputLines.push(`----------------------------------------`);
outputLines.push(`Task Detection:`);
outputLines.push(`  Source:      ${detectionSource}`);
outputLines.push(`----------------------------------------`);
outputLines.push(`Scope (Diff origin/main...HEAD):`);
outputLines.push(`  File Count:  ${fileCount}`);
if (fileCount > 0) {
    outputLines.push(diffScope.split('\n').map(l => `  - ${l}`).join('\n'));
} else {
    outputLines.push(`  (No changes detected)`);
}
outputLines.push(`----------------------------------------`);
outputLines.push(``);
outputLines.push(`=== CI_PARITY_PREVIEW ===`);
outputLines.push(`Base: ${originMain.substring(0, 7)}`);
outputLines.push(`Head: ${head.substring(0, 7)}`);
outputLines.push(`MergeBase: ${mergeBase.substring(0, 7)}`);
outputLines.push(`Source: ${detectionSource}`);
outputLines.push(`Scope: ${fileCount} files`);
outputLines.push(`=========================`);

// 3. Write to File
const outputFile = path.join(resultDir, `ci_parity_${taskId}.txt`);
// Ensure directory exists
if (!fs.existsSync(resultDir)) {
    fs.mkdirSync(resultDir, { recursive: true });
}

fs.writeFileSync(outputFile, outputLines.join('\n'));
console.log(`[CI Parity Probe] Report written to: ${outputFile}`);
console.log(outputLines.join('\n'));
