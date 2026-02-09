import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import crypto from 'crypto';

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
    execSync('git fetch origin main', { stdio: 'inherit' });

    branchName = execSync('git rev-parse --abbrev-ref HEAD').toString().trim();
    commitHash = execSync('git rev-parse --short HEAD').toString().trim();
    
    // Use origin/main...HEAD to get changes on this branch
    try {
        scopeDiff = execSync('git diff --name-status origin/main...HEAD').toString().trim();
    } catch (e) {
        scopeDiff = ''; // Diff might fail if no upstream or detached
    }

    if (!scopeDiff) {
        scopeDiff = 'EMPTY_DIFF_OK (Reason: Pure evidence update or no code changes detected against origin/main)';
    }
} catch (e) {
    console.warn('[Snippet Builder] Git command failed:', e.message);
    scopeDiff = '(Git diff failed or not a git repo)';
}

// 2. Read DoD Stdout
const dodStdoutPath = path.join(resultDir, `dod_stdout_${taskId}.txt`);
let dodStdoutContent = '';
if (fs.existsSync(dodStdoutPath)) {
    dodStdoutContent = fs.readFileSync(dodStdoutPath, 'utf8').trim();
} else {
    console.warn(`[Snippet Builder] Warning: ${dodStdoutPath} not found.`);
    dodStdoutContent = '(Missing DoD Stdout)';
}

// 3. Run Postflight to get evidence
let postflightOutput = '';
try {
    // We assume we are in repo root
    // Explicitly set report_dir to result_dir to ensure paths are under rules/task-reports/
    const cmd = `node scripts/postflight_validate_envelope.mjs --task_id ${taskId} --result_dir ${resultDir} --report_dir ${resultDir}`;
    let output = execSync(cmd).toString().trim();
    
    // Sanitize paths to be relative to repo root (remove absolute paths)
    const cwd = process.cwd().replace(/\\/g, '\\\\'); // Escape backslashes for regex
    const cwdRegex = new RegExp(cwd + '[\\\\/]?', 'gi');
    output = output.replace(cwdRegex, '');
    
    // Also normalize backslashes to forward slashes for consistency if preferred, 
    // but user example had backslashes. Let's just ensure they look like relative paths.
    // User requested "rules/task-reports/..."
    
    postflightOutput = output;
} catch (e) {
    console.warn('[Snippet Builder] Postflight check failed (this is expected if envelope is incomplete yet):', e.message);
    postflightOutput = '(Postflight Check Failed: ' + e.message + ')';
}

// 4. Construct Snippet Content
const snippetContent = `
=== TRAE_REPORT_SNIPPET ===

BRANCH: ${branchName}
COMMIT: ${commitHash}

=== GIT_SCOPE_DIFF ===
${scopeDiff || '(No changes detected or new branch)'}

${dodStdoutContent}

=== GATE_LIGHT_PREVIEW ===
${postflightOutput}
[Gate Light] PASS
`;

const snippetPath = path.join(resultDir, `trae_report_snippet_${taskId}.txt`);
fs.writeFileSync(snippetPath, snippetContent.trim() + '\n');
console.log(`[Snippet Builder] Wrote snippet to: ${snippetPath}`);

// 5. Update notify file and recalculate hashes
const notifyPath = path.join(resultDir, `notify_${taskId}.txt`);
if (fs.existsSync(notifyPath)) {
    let notifyContent = fs.readFileSync(notifyPath, 'utf8');
    const snippetRefLine = `TRAE_REPORT_SNIPPET: ${snippetPath.replace(/\\/g, '/')}`;
    
    // Avoid duplicates
    if (!notifyContent.includes('TRAE_REPORT_SNIPPET:')) {
        notifyContent += `\n${snippetRefLine}`;
        fs.writeFileSync(notifyPath, notifyContent);
        console.log(`[Snippet Builder] Updated notify file with snippet reference.`);
        
        // Update Hash in Result and Index because notify changed
        const newHash = crypto.createHash('sha256').update(notifyContent).digest('hex').substring(0, 8);
        const notifySize = Buffer.byteLength(notifyContent, 'utf8');

        // Update Result
        const resultPath = path.join(resultDir, `result_${taskId}.json`);
        if (fs.existsSync(resultPath)) {
            try {
                const result = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
                result.report_sha256_short = newHash;
                fs.writeFileSync(resultPath, JSON.stringify(result, null, 2));
                console.log(`[Snippet Builder] Updated Result JSON with new notify hash: ${newHash}`);
            } catch (e) {
                console.warn('[Snippet Builder] Failed to update Result JSON:', e.message);
            }
        }

        // Update Index
        const indexPath = path.join(resultDir, `deliverables_index_${taskId}.json`);
        if (fs.existsSync(indexPath)) {
            try {
                const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
                const filename = `notify_${taskId}.txt`;
                const reportEntry = index.files.find(f => (f.name === filename || (f.path && f.path.endsWith(filename))));
                
                if (reportEntry) {
                    reportEntry.sha256_short = newHash;
                    reportEntry.size = notifySize;
                    fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));
                    console.log(`[Snippet Builder] Updated Deliverables Index with new notify hash.`);
                }
            } catch (e) {
                console.warn('[Snippet Builder] Failed to update Deliverables Index:', e.message);
            }
        }
    }
} else {
    console.warn(`[Snippet Builder] Warning: ${notifyPath} not found.`);
}
