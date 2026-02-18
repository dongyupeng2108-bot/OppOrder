const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const args = process.argv.slice(2);
const taskIdArgIndex = args.indexOf('--task_id');
const taskId = taskIdArgIndex !== -1 ? args[taskIdArgIndex + 1] : null;

if (!taskId) {
    console.error('Usage: node ci_watch_pr.mjs --task_id <TASK_ID>');
    process.exit(1);
}

// Ensure run directory exists for logs
// We use a generic location or task specific
const repoRoot = path.join(__dirname, '..');
const runDir = path.join(repoRoot, 'rules', 'task-reports', 'runs', taskId, 'autopr');

// Ensure parent dir exists
if (!fs.existsSync(path.dirname(runDir))) {
    // Attempt to find where task runs are stored based on YYYY-MM
    // But since we might not know the date, we check if the directory structure assumes date.
    // run_task.ps1 creates 'rules/task-reports/runs/TASKID/TIMESTAMP_SHA'.
    // We'll just put it in rules/task-reports/autopr_logs/TASKID for simplicity if the run structure is complex.
    // Or just use the temp dir.
}
// Actually, let's just use a temp file or local logging.
// The caller (run_task.ps1) handles logging to Transcript.
// We just need to output to stdout/stderr.

console.log(`[CI Watch] Task: ${taskId}`);

try {
    // 1. Git Push
    console.log('[CI Watch] Pushing changes...');
    // Use --force-with-lease is safer, but --force is requested for dev iteration
    execSync('git push origin HEAD --force', { stdio: 'inherit' });

    // 2. Check/Create PR
    console.log('[CI Watch] Checking for existing PR...');
    let prInfo;
    try {
        const prJson = execSync('gh pr view --json number,url,state', { encoding: 'utf8' });
        prInfo = JSON.parse(prJson);
        console.log(`[CI Watch] Found PR #${prInfo.number}: ${prInfo.url}`);
        if (prInfo.state === 'CLOSED' || prInfo.state === 'MERGED') {
             console.log('[CI Watch] PR is closed/merged. Reopening...');
             execSync(`gh pr reopen ${prInfo.number}`, { stdio: 'inherit' });
        }
    } catch (e) {
        console.log('[CI Watch] No PR found. Creating new PR...');
        try {
            execSync(`gh pr create --fill --title "TraeTask_${taskId}: AutoPR" --body "Automated PR for Task ${taskId}"`, { stdio: 'inherit' });
            const prJson = execSync('gh pr view --json number,url,state', { encoding: 'utf8' });
            prInfo = JSON.parse(prJson);
            console.log(`[CI Watch] Created PR #${prInfo.number}: ${prInfo.url}`);
        } catch (createErr) {
            console.error(`[CI Watch] Failed to create PR: ${createErr.message}`);
            process.exit(1);
        }
    }

    // 3. Watch Loop
    const startTime = Date.now();
    const timeoutMs = 15 * 60 * 1000; // 15 minutes timeout

    console.log('[CI Watch] Waiting for CI checks...');
    
    while (Date.now() - startTime < timeoutMs) {
        try {
            // Fetch checks
            // Note: gh pr checks uses different field names than gh run list in some versions.
            // We use name,state,link instead of name,status,conclusion,url.
            const checksJson = execSync(`gh pr checks ${prInfo.number} --json name,state,link,startedAt,completedAt`, { encoding: 'utf8' });
            const checks = JSON.parse(checksJson);
            
            if (checks.length === 0) {
                console.log('[CI Watch] No checks reported yet. Waiting...');
            } else {
                // Map state to status/conclusion for consistency if needed, or use raw state
                // Common states: PENDING, SUCCESS, FAILURE, ERROR, CANCELLED, SKIPPED
                
                const pending = checks.filter(c => c.state === 'PENDING' || c.state === 'IN_PROGRESS' || c.state === 'QUEUED');
                const failed = checks.filter(c => c.state === 'FAILURE' || c.state === 'ERROR' || c.state === 'TIMED_OUT' || c.state === 'CANCELLED');
                const success = checks.filter(c => c.state === 'SUCCESS');

                console.log(`[CI Watch] Status: ${success.length} Pass, ${failed.length} Fail, ${pending.length} Pending`);

                if (failed.length > 0) {
                    console.error('[CI Watch] CI FAILED.');
                    failed.forEach(f => console.error(`  - ${f.name}: ${f.state} (${f.link})`));
                    process.exit(2); // CI Failure
                }

                if (pending.length === 0 && checks.length > 0) {
                    console.log('[CI Watch] CI PASSED.');
                    process.exit(0); // Success
                }
            }
        } catch (e) {
            // gh pr checks returns non-zero if no checks found sometimes?
            // Or if network error.
            console.log(`[CI Watch] Polling error (retrying): ${e.message}`);
        }

        // Wait 15s
        execSync('powershell -c Start-Sleep -Seconds 15');
    }

    console.error('[CI Watch] TIMEOUT waiting for CI.');
    process.exit(1); // Infra/Timeout Error

} catch (err) {
    console.error(`[CI Watch] Infrastructure Error: ${err.message}`);
    process.exit(1);
}
