import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const args = process.argv.slice(2);
let taskId = null;
let runDir = null;

for (let i = 0; i < args.length; i++) {
    if (args[i] === '--task_id') taskId = args[i + 1];
    if (args[i] === '--run_dir') runDir = args[i + 1];
}

if (!taskId || !runDir) {
    console.error('Usage: node scripts/ci_watch_pr.mjs --task_id <id> --run_dir <dir>');
    process.exit(1);
}

console.log(`[CI Watch] Task: ${taskId}, RunDir: ${runDir}`);

try {
    // 1. Get Current Branch
    const branch = execSync('git branch --show-current', { encoding: 'utf8' }).trim();
    console.log(`[CI Watch] Current Branch: ${branch}`);

    // 2. Find or Create PR
    console.log('[CI Watch] Checking for existing PR...');
    let prInfo = null;
    try {
        const prListJson = execSync(`gh pr list --head ${branch} --json number,url,headRefName,baseRefName,state`, { encoding: 'utf8' });
        const prList = JSON.parse(prListJson);
        if (prList.length > 0) {
            prInfo = prList[0];
            console.log(`[CI Watch] Found existing PR #${prInfo.number}: ${prInfo.url}`);
        } else {
            console.log('[CI Watch] No PR found. Creating new PR...');
            // gh pr create outputs the URL on stdout, but does not support --json flag directly in all versions
            const createUrl = execSync(`gh pr create --fill`, { encoding: 'utf8' }).trim();
            console.log(`[CI Watch] PR Created: ${createUrl}`);
            
            // Fetch the full JSON details
            const prInfoJson = execSync(`gh pr view "${createUrl}" --json number,url,headRefName,baseRefName,state`, { encoding: 'utf8' });
            prInfo = JSON.parse(prInfoJson);
        }
    } catch (e) {
        console.error(`[CI Watch] Failed to find/create PR: ${e.message}`);
        process.exit(1);
    }

    // 3. Save PR Meta Evidence
    const prMetaFile = path.join(runDir, `pr_meta_${taskId}.json`);
    fs.writeFileSync(prMetaFile, JSON.stringify(prInfo, null, 2));
    console.log(`[CI Watch] Saved PR Meta: ${prMetaFile}`);

    // 4. Watch Checks
    console.log('[CI Watch] Waiting for CI checks to complete (timeout: 10m)...');
    try {
        execSync(`gh pr checks ${prInfo.number} --watch --interval 10`, { stdio: 'inherit' });
    } catch (e) {
        console.warn(`[CI Watch] Warning: gh pr checks returned non-zero (checks likely failed). Proceeding to capture details.`);
    }

    // 5. Capture Check Results
    const checksJson = execSync(`gh pr checks ${prInfo.number} --json name,status,conclusion,url,startedAt,completedAt`, { encoding: 'utf8' });
    const checks = JSON.parse(checksJson);
    const checksFile = path.join(runDir, `ci_checks_${taskId}.json`);
    fs.writeFileSync(checksFile, JSON.stringify(checks, null, 2));
    console.log(`[CI Watch] Saved CI Checks: ${checksFile}`);

    // 6. Analyze Results & Capture Logs if Failed
    const failedChecks = checks.filter(c => c.conclusion === 'failure' || c.conclusion === 'timed_out' || c.conclusion === 'cancelled');
    
    if (failedChecks.length > 0) {
        console.error(`[CI Watch] FAILED: ${failedChecks.length} checks failed.`);
        failedChecks.forEach(c => console.error(`  - ${c.name}: ${c.conclusion} (${c.url})`));

        // Attempt to capture logs
        // We need the Run ID. 'gh pr checks' gives check runs, but 'gh run view' needs workflow run ID.
        // Sometimes check run URL contains the run ID or we can find it via 'gh run list'.
        console.log('[CI Watch] Attempting to capture failure logs...');
        
        try {
            const runsJson = execSync(`gh run list --branch ${branch} --json databaseId,conclusion,status`, { encoding: 'utf8' });
            const runs = JSON.parse(runsJson);
            // Get the most recent failed run
            const latestRun = runs[0]; // Assumes sorted by date desc
            
            if (latestRun && (latestRun.conclusion === 'failure' || latestRun.status === 'in_progress')) { // Capture even if in progress? No, only if failed.
                 const logFile = path.join(runDir, `ci_failed_${latestRun.databaseId}.log`);
                 console.log(`[CI Watch] Downloading logs for Run ${latestRun.databaseId}...`);
                 try {
                    execSync(`gh run view ${latestRun.databaseId} --log-failed > "${logFile}"`, { stdio: 'inherit' });
                    console.log(`[CI Watch] Logs saved to: ${logFile}`);
                 } catch (le) {
                     console.warn(`[CI Watch] Failed to download logs: ${le.message}`);
                 }
            }
        } catch (re) {
            console.warn(`[CI Watch] Failed to list runs: ${re.message}`);
        }

        process.exit(2); // Fail with code 2 (CI Failed) so caller knows to retry/autofix
    } else {
        console.log('[CI Watch] SUCCESS: All checks passed.');
        process.exit(0);
    }

} catch (e) {
    console.error(`[CI Watch] Fatal Error: ${e.message}`);
    process.exit(1);
}
