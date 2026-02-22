import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Argument parsing
const args = process.argv.slice(2);
const getArg = (name) => {
    const index = args.indexOf(name);
    return index !== -1 && index + 1 < args.length ? args[index + 1] : null;
};

const taskId = getArg('--task_id');
const attempt = getArg('--attempt') || '1';
const maxAttempts = getArg('--max_attempts') || '1';
const resultDir = getArg('--result_dir');

if (!taskId) {
    console.error('Usage: node ci_watch_pr.mjs --task_id <TASK_ID> [--attempt <N>] [--max_attempts <M>]');
    process.exit(1);
}

const repoRoot = path.join(__dirname, '..');
const evidenceDir = resultDir || path.join(repoRoot, 'rules', 'task-reports', '2026-02');
const evidenceFile = path.join(evidenceDir, `auto_pr_${taskId}.json`);

console.log(`[CI Watch] Task: ${taskId} (Attempt ${attempt}/${maxAttempts})`);

// Helper to write evidence
function writeEvidence(prInfo, state, checksSummary, errorMessage, errorClass, failReason) {
    const evidence = {
        task_id: taskId,
        branch: '', 
        pr_number: prInfo ? prInfo.number : null,
        pr_url: prInfo ? prInfo.url : 'unknown',
        head: prInfo ? prInfo.headRefName : null,
        base: prInfo ? prInfo.baseRefName : null,
        attempt: parseInt(attempt),
        autofix_max: parseInt(maxAttempts) - 1,
        status: prInfo ? prInfo.state : null,
        final_state: state,
        timestamp: new Date().toISOString(),
        checks_summary: checksSummary || {},
        error: errorMessage || null,
        error_class: errorClass || null,
        fail_reason: failReason || null
    };
    
    try {
        const branch = execSync('git branch --show-current', { encoding: 'utf8' }).trim();
        evidence.branch = branch;
    } catch (e) {
        evidence.branch = 'unknown';
    }

    fs.writeFileSync(evidenceFile, JSON.stringify(evidence, null, 2));
    console.log(`[CI Watch] Evidence written to: ${evidenceFile}`);
}

let prInfo = null;

try {
    // 1. Git Push
    console.log('[CI Watch] Pushing changes...');
    execSync('git push origin HEAD --force', { stdio: 'inherit' });

    // 2. Check/Create PR
    console.log('[CI Watch] Checking for existing PR...');
    
    try {
        const prJson = execSync('gh pr view --json number,url,state,headRefName,baseRefName', { encoding: 'utf8' });
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
            const prJson = execSync('gh pr view --json number,url,state,headRefName,baseRefName', { encoding: 'utf8' });
            prInfo = JSON.parse(prJson);
            console.log(`[CI Watch] Created PR #${prInfo.number}: ${prInfo.url}`);
        } catch (createErr) {
            console.error(`[CI Watch] Failed to create PR: ${createErr.message}`);
            writeEvidence(null, 'INFRA_FAIL', { error: createErr.message }, createErr.message, 'AUTO_PR_INFRA_FAIL', 'PR_CREATE_FAILED');
            process.exit(1);
        }
    }

    // 3. Watch Loop
    const startTime = Date.now();
    const timeoutMs = 15 * 60 * 1000; // 15 minutes timeout

    console.log('[CI Watch] Waiting for CI checks...');
    
    while (Date.now() - startTime < timeoutMs) {
        let checks = [];
        try {
            // Fetch checks
            // Note: 'url' in gh pr checks output gives the details link
            const checksJson = execSync(`gh pr checks ${prInfo.number} --json name,state,link,startedAt,completedAt`, { encoding: 'utf8' });
            checks = JSON.parse(checksJson);
        } catch (e) {
            console.log(`[CI Watch] Error fetching checks (retrying): ${e.message}`);
            // Don't exit, just retry loop
        }
            
        if (checks.length === 0) {
            console.log('[CI Watch] No checks reported yet. Waiting...');
        } else {
            const pending = checks.filter(c => c.state === 'PENDING' || c.state === 'IN_PROGRESS' || c.state === 'QUEUED');
            const failed = checks.filter(c => c.state === 'FAILURE' || c.state === 'ERROR' || c.state === 'TIMED_OUT' || c.state === 'CANCELLED');
            const success = checks.filter(c => c.state === 'SUCCESS');

            console.log(`[CI Watch] Status: ${success.length} Pass, ${failed.length} Fail, ${pending.length} Pending`);

            const summary = {
                total: checks.length,
                success: success.length,
                failed: failed.length,
                pending: pending.length,
                details: failed.length > 0 ? failed.map(f => `${f.name}: ${f.state}`) : ['All Passed']
            };

            if (failed.length > 0) {
                console.error('[CI Watch] CI FAILED.');
                failed.forEach(f => console.error(`  - ${f.name}: ${f.state} (${f.link})`));
                const failedNames = failed.map(f => (f.name || '').toLowerCase());
                const isGateLight = failedNames.some(n => n.includes('gate-light') || n.includes('gate light') || n.includes('gate_light'));
                const errorClass = isGateLight ? 'GATE_LIGHT_FAILURE' : 'AUTO_PR_CI_FAIL';
                const failReason = isGateLight ? 'CI_CHECK_GATE_LIGHT_FAILED' : 'CI_CHECKS_FAILED';
                writeEvidence(prInfo, 'FAIL', summary, null, errorClass, failReason);
                process.exit(2); // CI Failure
            }

            if (pending.length === 0 && checks.length > 0) {
                console.log('[CI Watch] CI PASSED.');
            writeEvidence(prInfo, 'PASS', summary, null, null, null);
                process.exit(0); // Success
            }
        }

        // Wait 15s
        try {
            execSync('powershell -c Start-Sleep -Seconds 15');
        } catch (e) {
            // ignore
        }
    }

    console.error('[CI Watch] TIMEOUT waiting for CI.');
    writeEvidence(prInfo, 'TIMEOUT', { error: 'Timeout waiting for CI checks' }, 'Timeout waiting for CI checks', 'AUTO_PR_TIMEOUT', 'CI_CHECK_TIMEOUT');
    process.exit(1); // Infra/Timeout Error

} catch (err) {
    console.error(`[CI Watch] Unexpected Error: ${err.message}`);
    writeEvidence(prInfo, 'INFRA_FAIL', { error: err.message }, err.message, 'AUTO_PR_INFRA_FAIL', 'CI_WATCH_EXCEPTION');
    process.exit(1);
}
