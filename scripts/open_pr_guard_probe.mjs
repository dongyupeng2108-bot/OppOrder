import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

// Parse arguments
const args = process.argv.slice(2);
let taskId = null;
let mode = 'Dev';
let ignorePrs = [];
let supersedeTaskIds = [];
let outputFile = null;

for (let i = 0; i < args.length; i++) {
    if (args[i] === '--task_id') taskId = args[i + 1];
    if (args[i] === '--mode') mode = args[i + 1];
    if (args[i] === '--output') outputFile = args[i + 1];
    if (args[i] === '--ignore_pr_numbers') ignorePrs = args[i + 1].split(',').map(n => parseInt(n.trim())).filter(n => !isNaN(n));
    if (args[i] === '--supersede_task_ids') supersedeTaskIds = args[i + 1].split(',').map(t => t.trim()).filter(Boolean);
}

if (!taskId) {
    console.error('Error: --task_id is required');
    process.exit(1);
}

// Data structure
const result = {
    queried_at: new Date().toISOString(),
    mode: mode,
    open_prs: [],
    ignored_pr_numbers: ignorePrs,
    supersede_task_ids: supersedeTaskIds,
    blocking_prs: [],
    decision: 'PASS',
    exit_code: 0
};

try {
    // Fetch Open PRs
    // Use --json number,title,headRefName,url,state,isDraft
    // Filter out draft PRs if necessary? Usually blocking applies to all Open PRs.
    const ghOutput = execSync('gh pr list --state open --json number,title,headRefName,url,state,isDraft', { encoding: 'utf8' });
    const prs = JSON.parse(ghOutput);

    // Current PR check (try to find PR for current task_id to exclude it)
    // We assume the current task's PR might be open.
    // Logic: Exclude PR if headRefName contains taskId OR title contains taskId
    
    for (const pr of prs) {
        const isCurrentTask = pr.headRefName.includes(taskId) || pr.title.includes(taskId);
        
        if (isCurrentTask) {
            // Skip current task's own PR
            continue;
        }

        result.open_prs.push({
            number: pr.number,
            title: pr.title,
            headRefName: pr.headRefName,
            url: pr.url
        });

        // Check if ignored
        if (ignorePrs.includes(pr.number)) {
            continue;
        }

        // Check if superseded
        // Extract task_id from PR branch or title
        const branchMatch = pr.headRefName.match(/(\d{6}_\d{3})/);
        const titleMatch = pr.title.match(/(\d{6}_\d{3})/);
        const prTaskId = branchMatch ? branchMatch[1] : (titleMatch ? titleMatch[1] : null);

        if (prTaskId && supersedeTaskIds.includes(prTaskId)) {
            continue;
        }

        // If we get here, it's blocking
        result.blocking_prs.push({
            number: pr.number,
            reason: 'Open PR not ignored or superseded'
        });
    }

        if (result.blocking_prs.length > 0) {
            result.decision = 'BLOCK';
            result.exit_code = 1;
        }
        result.open_prs_blocking_count = result.blocking_prs.length;

    } catch (e) {
        console.error(`Error querying GitHub PRs: ${e.message}`);
        result.error = e.message;
        result.decision = 'FAIL_SYSTEM';
        result.exit_code = 1;
        result.open_prs_blocking_count = -1; // Indicate error
    }

    if (outputFile) {
        fs.writeFileSync(outputFile, JSON.stringify(result, null, 2));
        console.log(`Wrote Open PR Guard evidence to ${outputFile}`);
    } else {
        console.log(JSON.stringify(result, null, 2));
    }
