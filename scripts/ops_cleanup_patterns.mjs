import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

// Usage: node scripts/ops_cleanup_patterns.mjs [--max N] [--dry-run] [--force] <pattern1> <pattern2> ...
// Example: node scripts/ops_cleanup_patterns.mjs --max 200 --dry-run "rules/task-reports/2026-02/*990b*" "temp/*.log"

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OPS_DELETE_SCRIPT = path.join(__dirname, 'ops_delete.mjs');

const args = process.argv.slice(2);
let maxFiles = 50;
let dryRun = false;
let force = false;
const patterns = [];

// Parse arguments
for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--max') {
        maxFiles = parseInt(args[i + 1], 10);
        i++;
    } else if (arg === '--dry-run') {
        dryRun = true;
    } else if (arg === '--force') {
        force = true;
    } else if (!arg.startsWith('--')) {
        patterns.push(arg);
    }
}

if (patterns.length === 0) {
    console.error(JSON.stringify({ error: "No patterns provided", usage: "node scripts/ops_cleanup_patterns.mjs [--max N] [--dry-run] [--force] <pattern>..." }));
    process.exit(1);
}

// Helper to run ops_delete.mjs for a single pattern
function runOpsDelete(pattern) {
    return new Promise((resolve, reject) => {
        const childArgs = [OPS_DELETE_SCRIPT, pattern];
        if (dryRun) childArgs.push('--dry-run');
        if (force) childArgs.push('--force');
        if (maxFiles) {
            childArgs.push('--max');
            childArgs.push(maxFiles.toString());
        }
        // Always recurse for cleanup patterns to ensure directories are handled
        childArgs.push('--recurse');

        const child = spawn('node', childArgs, { stdio: ['ignore', 'pipe', 'pipe'] });

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (data) => stdout += data.toString());
        child.stderr.on('data', (data) => stderr += data.toString());

        child.on('close', (code) => {
            if (code !== 0) {
                reject({ code, stdout, stderr, pattern });
            } else {
                try {
                    const json = JSON.parse(stdout.trim());
                    resolve(json);
                } catch (e) {
                    reject({ code, stdout, stderr, pattern, error: "Failed to parse JSON output" });
                }
            }
        });
    });
}

async function main() {
    const results = [];
    let exitCode = 0;

    console.log(JSON.stringify({ op: "cleanup_batch", patterns_count: patterns.length, dry_run: dryRun }));

    for (const pattern of patterns) {
        try {
            const result = await runOpsDelete(pattern);
            results.push(result);
            // Output short summary line
            console.log(JSON.stringify({ pattern, matched: result.matched, deleted: result.deleted, ok: result.ok }));
        } catch (err) {
            console.error(JSON.stringify({ pattern, error: "Failed", details: err }));
            exitCode = 1;
        }
    }

    if (exitCode !== 0) {
        process.exit(exitCode);
    }
}

main();
