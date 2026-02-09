
import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';

function parseArgs() {
    const args = process.argv.slice(2);
    const params = {};
    for (let i = 0; i < args.length; i++) {
        if (args[i].startsWith('--')) {
            const key = args[i].substring(2);
            const value = args[i + 1];
            params[key] = value;
            i++;
        }
    }
    return params;
}

function checkDuplicate(taskId) {
    try {
        console.log(`[PrePRCheck] Checking for duplicate task_id: ${taskId} in origin/main...`);
        
        // 1. Force Fetch origin main to ensure we have latest state
        try {
            execSync('git fetch origin main', { stdio: 'inherit' });
        } catch (e) {
            console.error('[PrePRCheck] FAILED: Could not fetch origin main. Cannot verify uniqueness.');
            console.error('REJECT_REASON: git fetch failed');
            process.exit(1); // Fail-fast on fetch error
        }

        let isDuplicate = false;
        let rejectReason = '';

        // 2. Check rules/task-reports/** in origin/main
        // We search for any file containing the task_id in rules/task-reports (including subdirs like envelopes)
        try {
            // git ls-tree -r origin/main rules/task-reports
            // We filter for filename containing task_id
            const cmd = `git ls-tree -r --name-only origin/main rules/task-reports`;
            const output = execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
            
            const existingFiles = output.split('\n')
                .map(l => l.trim())
                .filter(l => l.length > 0)
                .filter(f => path.basename(f).includes(taskId));
            
            if (existingFiles.length > 0) {
                isDuplicate = true;
                rejectReason = `task_id already exists in origin/main (Found ${existingFiles.length} files, e.g., ${existingFiles[0]})`;
            }

        } catch (e) {
            // If rules/task-reports doesn't exist in origin/main, it might be a new repo or path change.
            // But we should assume it exists for this project.
            // If command fails, it might be because path not found. We can ignore that specific error implies no files.
        }

        // 3. Check LATEST.json in origin/main
        if (!isDuplicate) {
            try {
                const latestContent = execSync('git show origin/main:rules/LATEST.json', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
                const latest = JSON.parse(latestContent);
                if (latest.task_id === taskId) {
                    isDuplicate = true;
                    rejectReason = `task_id already exists in origin/main (Occupied in rules/LATEST.json)`;
                }
            } catch (e) {
                // LATEST.json might not exist or be parseable in origin/main
            }
        }

        if (isDuplicate) {
            console.log(`REJECT_DUPLICATE_TASK_ID: ${taskId}`);
            console.log(`REJECT_REASON: ${rejectReason}`);
            console.log(`EXECUTION_ABORTED=1`);
            process.exit(21);
        } else {
            console.log('[PrePRCheck] No duplicates found. PASS.');
            process.exit(0);
        }

    } catch (error) {
        console.error('[PrePRCheck] Unexpected error:', error);
        process.exit(1);
    }
}

const args = parseArgs();
const taskId = args.task_id;

if (!taskId) {
    console.error('Usage: node scripts/pre_pr_check.mjs --task_id <id>');
    process.exit(1);
}

checkDuplicate(taskId);
