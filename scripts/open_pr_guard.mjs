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

function parseArgs() {
    const args = {};
    for (let i = 0; i < ARGS.length; i++) {
        if (ARGS[i] === TASK_ID_FLAG) {
            args.taskId = ARGS[i + 1];
            i++;
        }
    }
    return args;
}

function getOpenPRs() {
    const mockPath = process.env.OPEN_PR_GUARD_MOCK_JSON;
    if (mockPath) {
        if (!fs.existsSync(mockPath)) {
            console.error(`[OpenPRGuard] Mock file not found: ${mockPath}`);
            process.exit(1);
        }
        try {
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
        // If gh fails (e.g. auth, network), we treat it as blocking or risk?
        // Requirement says "risk point: gh unavailable". 
        // For fail-fast, if we can't verify, we should probably fail safe (block) or warn.
        // User said "Guard 失败时：必须 fail-fast 退出". 
        // We will throw and let main catch it.
        console.error(`[OpenPRGuard] Failed to fetch PR list: ${err.message}`);
        process.exit(1);
    }
}

function main() {
    const { taskId } = parseArgs();
    if (!taskId) {
        console.error(`[OpenPRGuard] Usage: node scripts/open_pr_guard.mjs --task_id <id>`);
        process.exit(1);
    }

    console.log(`[OpenPRGuard] Checking open PRs for Task ID: ${taskId}...`);

    const openPRs = getOpenPRs();
    
    // Filter logic
    // Allowed: headRefName contains taskId OR title contains taskId
    const blockingPRs = [];
    
    for (const pr of openPRs) {
        const head = pr.headRefName || '';
        const title = pr.title || '';
        
        const isRelated = head.includes(taskId) || title.includes(taskId);
        
        if (!isRelated) {
            blockingPRs.push(pr);
        }
    }

    const result = {
        checked_at: new Date().toISOString(),
        task_id: taskId,
        open_prs_raw_count: openPRs.length,
        open_prs_blocking_count: blockingPRs.length,
        blocking_prs: blockingPRs.map(p => ({
            number: p.number,
            title: p.title,
            head: p.headRefName,
            url: p.url
        }))
    };

    // Output JSON to stdout (or file? Requirement says "write to result_dir")
    // Requirement 2: "run_task.ps1 ... output JSON written to result_dir"
    // This script itself should probably just output result JSON to stdout or return it?
    // Requirement 1 says: "Output OPEN_PR_GUARD_PASS, and generate structured JSON"
    // Requirement 2 says: "Preflight ... saves output JSON to result_dir"
    // Let's print JSON to stdout so run_task can capture it, or just write it if we know where.
    // Usually scripts here print logs to stdout.
    // Let's print the BLOCK info to stderr/stdout and exit 1 if blocking.
    // If pass, print OPEN_PR_GUARD_PASS.
    // Also we need to generate the JSON file. 
    // Maybe we accept an output path arg? Or run_task handles it?
    // "run_task.ps1 ... 将 open_pr_guard 输出 JSON 写入 result_dir"
    // It's better if this script writes the file if provided an output path, OR run_task captures stdout.
    // Given run_task.ps1 structure, it's easier if this script writes the file.
    // But the prompt doesn't explicitly ask for an output path argument.
    // "Input: --task_id <id>"
    // "Behavior: ... generate structured JSON"
    // Let's default to printing JSON to stdout if no other instruction, but run_task in PS is tricky to capture pure JSON if logs are mixed.
    // Let's add an optional --output <path> argument.
    
    // Check for --output arg
    let outputPath = null;
    for (let i = 0; i < ARGS.length; i++) {
        if (ARGS[i] === '--output') {
            outputPath = ARGS[i + 1];
            i++;
        }
    }

    if (blockingPRs.length > 0) {
        console.error(`[OpenPRGuard] BLOCK: Found ${blockingPRs.length} unrelated open PRs.`);
        blockingPRs.forEach(pr => {
            console.error(` - #${pr.number} "${pr.title}" (${pr.headRefName}) ${pr.url}`);
        });
        
        // Even on failure, we might want to write the JSON record?
        // "Guard 失败时：必须 fail-fast 退出；不得继续写入/改动 LATEST.json ... 与后续证据文件"
        // But maybe we want the evidence of *why* it failed?
        // Requirement 2: "Guard 失败时：必须 fail-fast 退出"
        // Let's write the JSON if output path is provided, so we can see it.
        if (outputPath) {
            fs.writeFileSync(outputPath, JSON.stringify(result, null, 2), 'utf8');
        }
        
        process.exit(1);
    } else {
        console.log('OPEN_PR_GUARD_PASS');
        if (outputPath) {
            fs.writeFileSync(outputPath, JSON.stringify(result, null, 2), 'utf8');
        }
    }
}

main();
