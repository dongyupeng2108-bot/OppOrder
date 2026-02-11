import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const args = process.argv.slice(2);
const taskIdArg = args.find(arg => arg.startsWith('--task_id='));
const resultDirArg = args.find(arg => arg.startsWith('--result_dir='));

if (!taskIdArg || !resultDirArg) {
    console.error('Usage: node scripts/build_trae_report_snippet.mjs --task_id=<id> --result_dir=<dir>');
    process.exit(1);
}

const taskId = taskIdArg.split('=')[1];
const resultDir = resultDirArg.split('=')[1];

console.log(`[Snippet Builder] Building report snippet for task ${taskId}...`);

// 1. Get Git Info
let branchName = 'unknown';
let commitHash = 'unknown';
let scopeDiff = '';

try {
    // Fail-fast fetch to ensure we have origin/main
    try {
        execSync('git fetch origin main', { stdio: 'inherit' });
    } catch (e) {
        console.warn('[Snippet Builder] WARNING: Could not fetch origin main. Using local cache if available.');
    }

    branchName = execSync('git rev-parse --abbrev-ref HEAD').toString().trim();
    commitHash = execSync('git rev-parse --short HEAD').toString().trim();
    
    try {
        scopeDiff = execSync('git diff --name-status origin/main...HEAD').toString().trim();
    } catch (e) {
        scopeDiff = ''; 
    }

    if (!scopeDiff) {
        scopeDiff = 'EMPTY_DIFF_OK\nReason: No code changes detected against origin/main (Evidence/Docs update only)';
    }
} catch (e) {
    console.warn('[Snippet Builder] Git command failed:', e.message);
    scopeDiff = '(Git diff failed or not a git repo)';
}

// 2. Read DoD Stdout
const notifyPath = path.join(resultDir, `notify_${taskId}.txt`);
let dodContent = '(Missing DoD Evidence)';

const dodStdoutPath = path.join(resultDir, `dod_stdout_${taskId}.txt`);
if (fs.existsSync(dodStdoutPath)) {
    dodContent = fs.readFileSync(dodStdoutPath, 'utf8').trim();
} else if (fs.existsSync(notifyPath)) {
    const notifyContent = fs.readFileSync(notifyPath, 'utf8');
    const marker = '=== DOD_EVIDENCE_STDOUT ===';
    if (notifyContent.includes(marker)) {
        const parts = notifyContent.split(marker);
        if (parts.length > 1) {
            dodContent = marker + '\n' + parts[1].trim();
        }
    }
}

// 2.5. CI Parity Probe (Task 260211_002)
let ciParityContent = '';
if (taskId >= '260210_009') {
    const probeJson = path.join(resultDir, `ci_parity_${taskId}.json`);
    const probeTxt = path.join(resultDir, `ci_parity_${taskId}.txt`);

    if (fs.existsSync(probeJson)) {
        try {
            const data = JSON.parse(fs.readFileSync(probeJson, 'utf8'));
            ciParityContent = `=== CI_PARITY_PREVIEW ===
Base: ${data.base ? data.base.substring(0, 7) : 'N/A'}
Head: ${data.head ? data.head.substring(0, 7) : 'N/A'}
MergeBase: ${data.merge_base ? data.merge_base.substring(0, 7) : 'N/A'}
Source: JSON (Evidence-as-Code)
Scope: ${data.scope_count} files
Files (Top 3):
${data.scope_files ? data.scope_files.slice(0, 3).map(f => `  - ${f}`).join('\n') : ''}
${data.scope_files && data.scope_files.length > 3 ? '  ... (truncated)' : ''}
=========================`;
        } catch (e) {
            console.warn(`[Snippet Builder] Warning: Failed to parse CI Parity JSON: ${e.message}`);
        }
    } else if (fs.existsSync(probeTxt)) {
        const content = fs.readFileSync(probeTxt, 'utf8');
        const marker = '=== CI_PARITY_PREVIEW ===';
        if (content.includes(marker)) {
            const parts = content.split(marker);
            ciParityContent = marker + parts[1];
        }
    } else {
        console.warn(`[Snippet Builder] Warning: CI Parity Probe file missing.`);
    }
}

// 3. Gate Light Preview (Two-Pass Mechanism - Task 260211_007)
// MUST read from gate_light_preview_<task_id>.txt
const previewPath = path.join(resultDir, `gate_light_preview_${taskId}.txt`);
let gateLightContent = '';

if (taskId >= '260211_007') {
    if (!fs.existsSync(previewPath)) {
        console.error(`[Snippet Builder] ERROR: Two-Pass Evidence Truth requires ${previewPath}.`);
        console.error(`[Snippet Builder] Please run: node scripts/gate_light_ci.mjs ... > log.txt AND node scripts/extract_gate_light_preview.mjs ...`);
        process.exit(61);
    }
    gateLightContent = fs.readFileSync(previewPath, 'utf8').trim();
} else {
    // Fallback for old tasks
    gateLightContent = `=== GATE_LIGHT_PREVIEW ===
(Pending Gate Light Execution...)
[Gate Light] STATUS_PENDING

GATE_LIGHT_EXIT=__PENDING__`;
}

// 4. Construct Snippet Content
const snippetContent = `
=== TRAE_REPORT_SNIPPET ===

BRANCH: ${branchName}
COMMIT: ${commitHash}

=== GIT_SCOPE_DIFF ===
${scopeDiff || '(No changes detected or new branch)'}

${dodContent}

${ciParityContent}

${gateLightContent}
`;

const snippetPath = path.join(resultDir, `trae_report_snippet_${taskId}.txt`);
fs.writeFileSync(snippetPath, snippetContent.trim() + '\n');
console.log(`[Snippet Builder] Wrote snippet to: ${snippetPath}`);
console.log(`[Snippet Builder] NOTE: Notify/Result/Index updates must be handled by the caller (dev_batch_mode).`);
