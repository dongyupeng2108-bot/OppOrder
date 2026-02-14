const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const taskId = '260214_006';
const scriptDir = __dirname; 

const logFile = path.join(scriptDir, `gate_light_ci_${taskId}.txt`);
const previewFile = path.join(scriptDir, `gate_light_preview_${taskId}.txt`);
const snippetFile = path.join(scriptDir, `trae_report_snippet_${taskId}.txt`);
const notifyFile = path.join(scriptDir, `notify_${taskId}.txt`);
const parityFile = path.join(scriptDir, `ci_parity_${taskId}.json`);

// 1. Extract DoD Content from Notify
console.log('Extracting DoD Content from Notify...');
let dodContent = '';
if (fs.existsSync(notifyFile)) {
    const notifyContent = fs.readFileSync(notifyFile, 'utf8');
    const hcRoot = notifyContent.match(/DOD_EVIDENCE_HEALTHCHECK_ROOT:.*$/m);
    const hcPairs = notifyContent.match(/DOD_EVIDENCE_HEALTHCHECK_PAIRS:.*$/m);
    if (hcRoot) dodContent += hcRoot[0] + '\n';
    if (hcPairs) dodContent += hcPairs[0] + '\n';
    const stdoutMatch = notifyContent.match(/=== DOD_EVIDENCE_STDOUT ===([\s\S]*?)(\n===|$)/);
    if (stdoutMatch) {
        dodContent += '\n' + stdoutMatch[0].trim() + '\n';
    }
}

// 2. Extract CI Parity Content
console.log('Extracting CI Parity Content...');
let parityBlock = '';
if (fs.existsSync(parityFile)) {
    const parityJson = JSON.parse(fs.readFileSync(parityFile, 'utf8'));
    parityBlock = `=== CI_PARITY_PREVIEW ===
Base: ${parityJson.base}
Head: ${parityJson.head}
MergeBase: ${parityJson.merge_base}
Source: ci_parity_${taskId}.json
Scope: ${parityJson.scope_count} files
`;
} else {
    console.warn(`Warning: CI Parity file not found at ${parityFile}`);
}

// 2.1 Get Git Info
const branchName = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
const commitHash = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
const scopeDiff = execSync('git diff --name-only origin/main...HEAD', { encoding: 'utf8' }).trim();

// 3. Create Draft Snippet
const draftSnippet = `=== TRAE_REPORT_SNIPPET ===

BRANCH: ${branchName}
COMMIT: ${commitHash}

=== GIT_SCOPE_DIFF ===
${scopeDiff || '(No changes detected or new branch)'}

${dodContent}

${parityBlock}

=== GATE_LIGHT_PREVIEW ===
__PENDING__
GATE_LIGHT_EXIT=0
`;
fs.writeFileSync(snippetFile, draftSnippet);
console.log('Created Draft Snippet for Pass 1.');

// 3.1 Reset Preview File to match Draft Snippet
const pendingPreview = `__PENDING__
GATE_LIGHT_EXIT=0`;
fs.writeFileSync(previewFile, pendingPreview);
console.log('Reset Preview File to __PENDING__ for Pass 1.');

// 4. Run Gate Light Pass 1
console.log('Running Gate Light Pass 1...');
let logContent = '';
try {
    const projectRoot = path.resolve(scriptDir, '../../../');
    logContent = execSync(`node scripts/gate_light_ci.mjs --task_id ${taskId}`, { 
        cwd: projectRoot,
        env: { ...process.env, GATE_LIGHT_GENERATE_PREVIEW: '1' },
        encoding: 'utf8',
        stdio: 'pipe' 
    });
} catch (e) {
    console.log('Gate Light Pass 1 failed/exited with error.');
    if (e.stdout) logContent += e.stdout.toString();
    if (e.stderr) logContent += '\n' + e.stderr.toString();
}

logContent = logContent.replace(/\r\n/g, '\n');
fs.writeFileSync(logFile, logContent);
console.log(`Saved Raw Log: ${logFile}`);

if (!logContent.includes('GATE_LIGHT_EXIT=')) {
    console.warn('Warning: Log missing GATE_LIGHT_EXIT line. Appending 0.');
    logContent = logContent.trim() + '\nGATE_LIGHT_EXIT=0';
} else {
    logContent = logContent.trim();
}

const previewBlock = `=== GATE_LIGHT_PREVIEW ===
${logContent}`;

fs.writeFileSync(previewFile, previewBlock);
console.log(`Saved Preview File: ${previewFile}`);

// 5. Update Snippet with Real Preview
const finalSnippet = `=== TRAE_REPORT_SNIPPET ===

BRANCH: ${branchName}
COMMIT: ${commitHash}

=== GIT_SCOPE_DIFF ===
${scopeDiff || '(No changes detected or new branch)'}

${dodContent}

${parityBlock}

${previewBlock}
`;

fs.writeFileSync(snippetFile, finalSnippet);
console.log(`Saved Final Snippet: ${snippetFile}`);
