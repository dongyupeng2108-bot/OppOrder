import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const args = process.argv.slice(2);
let taskId = null;
let runDir = null;
let mode = null;

for (let i = 0; i < args.length; i++) {
    if (args[i] === '--task_id') taskId = args[i + 1];
    if (args[i] === '--run_dir') runDir = args[i + 1];
    if (args[i] === '--mode') mode = args[i + 1];
}

if (!taskId || !runDir || !mode) {
    console.error('Usage: node scripts/ci_autofix_pack.mjs --task_id <id> --run_dir <dir> --mode <mode>');
    process.exit(1);
}

console.log(`[AutoFix] Task: ${taskId}, RunDir: ${runDir}, Mode: ${mode}`);

try {
    // 1. Fetch Latest Main
    console.log('[AutoFix] Fetching origin/main...');
    execSync('git fetch origin main', { stdio: 'inherit' });

    // 2. Recompute CI Parity
    console.log('[AutoFix] Recomputing CI Parity...');
    execSync(`node scripts/ci_parity_probe.mjs --task_id ${taskId}`, { stdio: 'inherit' });

    // 3. Reassemble Evidence
    console.log('[AutoFix] Reassembling Evidence...');
    execSync(`node scripts/assemble_evidence.mjs --task_id=${taskId} --mode=${mode}`, { stdio: 'inherit' });

    // 4. Verify Gate Light (Local)
    console.log('[AutoFix] Verifying Local Gate Light...');
    execSync(`node scripts/gate_light_ci.mjs --task_id=${taskId}`, { stdio: 'inherit' });

    // 5. Commit & Push
    console.log('[AutoFix] Committing & Pushing fixes...');
    
    // Check if there are changes to commit
    const status = execSync('git status --porcelain', { encoding: 'utf8' });
    if (status.trim() === '') {
        console.log('[AutoFix] No changes to commit. Skipping push.');
    } else {
        execSync('git add rules/task-reports/', { stdio: 'inherit' });
        try {
            execSync('git commit -m "fix(auto): recompute ci parity and evidence"', { stdio: 'inherit' });
            execSync('git push', { stdio: 'inherit' });
            console.log('[AutoFix] Fixes pushed successfully.');
        } catch (e) {
            console.warn(`[AutoFix] Warning: Commit/Push failed (maybe empty commit or network issue): ${e.message}`);
        }
    }

} catch (e) {
    console.error(`[AutoFix] Fatal Error: ${e.message}`);
    process.exit(1);
}
