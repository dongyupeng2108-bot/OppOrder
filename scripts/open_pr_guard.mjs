import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

/**
 * Open PR Guard
 * 
 * Enforces "One Task at a Time" workflow by checking for open PRs.
 * 
 * Usage: node scripts/open_pr_guard.mjs --task_id <task_id>
 * 
 * Environment Variables:
 * - OPEN_PR_GUARD_MOCK_JSON: Path to a JSON file containing mock PR list.
 *   Mock Format: Same as `gh pr list --json number,title,headRefName,url`
 */

const ARGS = process.argv.slice(2);
const TASK_ID_FLAG = '--task_id';
const MODE_FLAG = '--mode';
const OUTPUT_FLAG = '--output';

function parseArgs() {
    const args = {};
    for (let i = 0; i < ARGS.length; i++) {
        if (ARGS[i] === TASK_ID_FLAG) {
            args.taskId = ARGS[i + 1];
            i++;
        } else if (ARGS[i] === MODE_FLAG) {
            args.mode = ARGS[i + 1];
            i++;
        } else if (ARGS[i] === OUTPUT_FLAG) {
            args.output = ARGS[i + 1];
            i++;
        }
    }
    return args;
}

function getOpenPRs(mode) {
    const mockPath = process.env.OPEN_PR_GUARD_MOCK_JSON;
    
    // Strict Mock Restriction: Only allowed in Dev mode
    if (mockPath) {
        if (mode !== 'Dev') {
            console.error(`[OpenPRGuard] FAILED: OPEN_PR_GUARD_MOCK_JSON is strictly prohibited in ${mode} mode.`);
            process.exit(1);
        }

        if (!fs.existsSync(mockPath)) {
            console.error(`[OpenPRGuard] Mock file not found: ${mockPath}`);
            process.exit(1);
        }
        try {
            console.log(`[OpenPRGuard] Using Mock PR list from: ${mockPath} (Dev Mode Only)`);
            const content = fs.readFileSync(mockPath, 'utf8');
            return JSON.parse(content);
        } catch (err) {
            console.error(`[OpenPRGuard] Failed to parse mock JSON: ${err.message}`);
            process.exit(1);
        }
    }

    try {
        // limit <= 50, fail-fast
        const cmd = 'gh pr list --state open --limit 50 --json number,title,headRefName,url';
        const stdout = execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
        return JSON.parse(stdout);
    } catch (err) {
        console.error(`[OpenPRGuard] Failed to fetch PR list: ${err.message}`);
        process.exit(1);
    }
}

function extractTaskId(text) {
    // Look for pattern like 260216_006
    const match = text.match(/(\d{6}_\d{3})/);
    return match ? match[1] : null;
}

function main() {
    const { taskId, mode, output } = parseArgs();
    
    if (!taskId) {
        console.error(`[OpenPRGuard] Usage: node scripts/open_pr_guard.mjs --task_id <id> [--mode <Dev|Integrate>] [--output <file>]`);
        process.exit(1);
    }
    
    // --- BYPASS LOGIC FOR TEST TASKS ---
    if (taskId.includes('_TEST_') || taskId.startsWith('TEST_')) {
        console.log(`[OpenPRGuard] SKIP: Test Task ID '${taskId}' detected. Bypassing Open PR Guard.`);
        if (output) {
             const result = {
                checked_at: new Date().toISOString(),
                task_id: taskId,
                run_mode: mode || 'Integrate',
                open_prs_raw_count: 0,
                open_prs_blocking_count: 0,
                blocking_prs: []
            };
            fs.writeFileSync(output, JSON.stringify(result, null, 2));
        }
        process.exit(0);
    }

    // Default mode to Integrate if not specified, to be safe? Or Dev?
    // Requirement implies fail-fast. If mode not provided, assume strictest?
    // But existing calls might not provide it yet? 
    // run_task.ps1 provides it.
    const runMode = mode || 'Integrate';

    console.log(`[OpenPRGuard] Checking open PRs for Task ID: ${taskId} (Mode: ${runMode})...`);

    const openPRs = getOpenPRs(runMode);
    
    // Parse Ignore/Supersede configs
    const ignorePRsEnv = process.env.OPEN_PR_GUARD_IGNORE_PR_NUMBERS || '';
    const ignorePRs = new Set(ignorePRsEnv.split(',').map(s => s.trim()).filter(s => s).map(Number));
    
    const supersedeTasksEnv = process.env.OPEN_PR_GUARD_SUPERSEDE_TASK_IDS || '';
    const supersedeTasks = new Set(supersedeTasksEnv.split(',').map(s => s.trim()).filter(s => s));

    // Filter logic
    const blockingPRs = [];
    
    for (const pr of openPRs) {
        const head = pr.headRefName || '';
        const title = pr.title || '';
        const prNum = pr.number;
        
        // 1. Check if it's the current task itself (Always Allowed)
        const isSelf = head.includes(taskId) || title.includes(taskId);
        if (isSelf) continue;

        // 2. Check Exemption (Ignore + Supersede)
        let exempted = false;
        if (ignorePRs.has(prNum)) {
            // Must validate supersede
            const prTaskId = extractTaskId(head) || extractTaskId(title);
            
            if (prTaskId) {
                // Condition: 
                // 1. Task ID in whitelist
                // 2. Current Task ID != Pr Task ID (Self-check handled above, but good to be explicit)
                if (supersedeTasks.has(prTaskId) && prTaskId !== taskId) {
                    exempted = true;
                    console.log(`[OpenPRGuard] Exempting PR #${prNum} (Task ${prTaskId}) due to Explicit Supersede.`);
                } else {
                    console.warn(`[OpenPRGuard] Warning: PR #${prNum} is in IGNORE list but Task ID '${prTaskId}' is NOT in SUPERSEDE list (or matches current). Treated as BLOCKING.`);
                }
            } else {
                console.warn(`[OpenPRGuard] Warning: PR #${prNum} is in IGNORE list but could not extract Task ID. Treated as BLOCKING.`);
            }
        }

        if (!exempted) {
            blockingPRs.push(pr);
        }
    }

    const result = {
        checked_at: new Date().toISOString(),
        task_id: taskId,
        run_mode: runMode,
        open_prs_raw_count: openPRs.length,
        open_prs_blocking_count: blockingPRs.length,
        blocking_prs: blockingPRs.map(p => ({
            number: p.number,
            title: p.title,
            head: p.headRefName,
            url: p.url
        }))
    };
    
    if (output) {
        fs.writeFileSync(output, JSON.stringify(result, null, 2));
    }

    if (blockingPRs.length > 0) {
        console.error(`[OpenPRGuard] BLOCKING: Found ${blockingPRs.length} unrelated open PRs violating 'One Task at a Time'.`);
        blockingPRs.forEach(p => {
            console.error(`  - PR #${p.number}: ${p.title} (${p.headRefName})`);
        });
        console.error(`[OpenPRGuard] Fix: Merge or Close blocking PRs before starting Task ${taskId}.`);
        console.error(`[OpenPRGuard] For Supersede: Set OPEN_PR_GUARD_IGNORE_PR_NUMBERS=${blockingPRs.map(p=>p.number).join(',')} AND OPEN_PR_GUARD_SUPERSEDE_TASK_IDS=<task_id>`);
        process.exit(1);
    }

    console.log(`[OpenPRGuard] PASS: No blocking PRs found.`);
}

main();
