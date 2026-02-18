import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const args = process.argv.slice(2);
const taskIdArgIndex = args.indexOf('--task_id');
const taskId = taskIdArgIndex !== -1 ? args[taskIdArgIndex + 1] : null;

if (!taskId) {
    console.error('Usage: node ci_watch_pr.mjs --task_id <TASK_ID>');
    process.exit(1);
}

// Ensure run directory exists for logs
const repoRoot = path.join(__dirname, '..');
const runDir = path.join(repoRoot, 'rules', 'task-reports', 'runs', taskId, 'autopr');

// Ensure parent dir exists
if (!fs.existsSync(path.dirname(runDir))) {
    // Just a placeholder check
}

console.log(`[CI Watch] Task: ${taskId}`);

try {
    // 1. Git Push
    console.log('[CI Watch] Pushing changes...');
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
            const checksJson = execSync(`gh pr checks ${prInfo.number} --json name,state,link,startedAt,completedAt`, { encoding: 'utf8' });
            const checks = JSON.parse(checksJson);
            
            if (checks.length === 0) {
                console.log('[CI Watch] No checks reported yet. Waiting...');
            } else {
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
