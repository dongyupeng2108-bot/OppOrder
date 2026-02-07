
import { execSync } from 'child_process';
import path from 'path';

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
        
        // Ensure origin is up to date (User workflow implies fetch done, but we assume we can access origin/main refs)
        // We use git ls-tree which requires the ref to exist locally (remote-tracking branch)
        
        const patterns = [
            `result_${taskId}.json`,
            `deliverables_index_${taskId}.json`,
            `notify_${taskId}.txt`
        ];

        // Use git ls-tree to find files in origin/main under rules/task-reports
        const cmd = 'git ls-tree -r --name-only origin/main rules/task-reports';
        let output = '';
        try {
            output = execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
        } catch (e) {
            // If origin/main doesn't exist or other error
             console.error('[PrePRCheck] Error querying git (is origin/main fetched?):', e.message);
             // We fail open or closed? Requirement says "If found: exit(2)".
             // If we can't check, we should probably warn and proceed or fail?
             // Let's assume fail to be safe, or exit 1.
             process.exit(1);
        }

        const files = output.split('\n').filter(line => line.trim() !== '');
        let foundFiles = [];

        for (const file of files) {
            const basename = path.basename(file);
            // Check if basename matches any of our patterns
            // patterns are just the filenames we look for
            if (patterns.includes(basename)) {
                foundFiles.push(file);
            }
        }

        if (foundFiles.length > 0) {
            console.error(`[PrePRCheck] FOUND DUPLICATE EVIDENCE in origin/main:`);
            foundFiles.forEach(f => console.error(` - ${f}`));
            console.error('[PrePRCheck] Duplicate task_id detected. Aborting PR.');
            process.exit(2);
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
    console.error('Usage: node pre_pr_check.mjs --task_id <id>');
    process.exit(1);
}

checkDuplicate(taskId);
