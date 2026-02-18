import fs from 'fs';
import path from 'path';

/**
 * Error Digest Generator (M-G1)
 * Parses various logs to extract structured error information and generates a summary.
 */

const ARGS = process.argv.slice(2);

let taskId = null;
let mode = null;
let commit = 'unknown';
let outDir = `rules/task-reports/${new Date().toISOString().slice(0, 7)}`;
let isSelfTest = false;
const sourceLogs = [];

for (let i = 0; i < ARGS.length; i++) {
    const arg = ARGS[i];
    if (arg === '--task_id') {
        taskId = ARGS[++i];
    } else if (arg.startsWith('--task_id=')) {
        taskId = arg.split('=')[1];
    } else if (arg === '--mode') {
        mode = ARGS[++i];
    } else if (arg.startsWith('--mode=')) {
        mode = arg.split('=')[1];
    } else if (arg === '--commit') {
        commit = ARGS[++i];
    } else if (arg.startsWith('--commit=')) {
        commit = arg.split('=')[1];
    } else if (arg === '--out_dir') {
        outDir = ARGS[++i];
    } else if (arg.startsWith('--out_dir=')) {
        outDir = arg.split('=')[1];
    } else if (arg === '--selftest') {
        isSelfTest = true;
    } else if (arg.startsWith('--source_logs=')) {
        sourceLogs.push(arg.split('=')[1]);
    } else if (arg === '--source_logs') {
        sourceLogs.push(ARGS[++i]);
    }
}

const norm = (v) => (v ?? '').toString().trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
taskId = norm(taskId);
mode = norm(mode);
commit = norm(commit);
outDir = norm(outDir);

if (!taskId && !isSelfTest) {
    console.error('Usage: node scripts/error_digest.mjs --task_id=<id> --mode=<mode> [--commit=<hash>] [--out_dir=<path>] [--source_logs=<path>...] [--selftest]');
    process.exit(1);
}

const resolvePath = (p) => path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);
const errorsJsonlPath = path.join(outDir, `errors_${taskId}.jsonl`);
const summaryPath = path.join(outDir, `errors_summary_${taskId}.txt`);

// Ensure output directory exists
if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
}

let errors = [];

if (isSelfTest) {
    console.log('[ErrorDigest] Running in Self-Test Mode...');
    errors.push({
        task_id: taskId || 'selftest_task',
        mode: mode || 'Dev',
        step: 'SelfTest',
        error_class: 'TEST_ERROR',
        exit_code: 1,
        command: 'node error_digest.mjs --selftest',
        ts: new Date().toISOString(),
        stdout_tail: 'Self test stdout',
        stderr_tail: 'Self test stderr',
        is_test: true
    });
} else {
    // 1. Scan for FAIL_ROOT_CAUSE_BLOCK in logs
    // 2. Scan Gate Light logs for "FAIL" or "Exit Code"
    // 3. Scan command_audit for exit_code != 0
    
    // Helper to extract FAIL_ROOT_CAUSE_BLOCK
    const extractFailBlock = (content) => {
        const match = content.match(/FAIL_ROOT_CAUSE_BLOCK_START([\s\S]*?)FAIL_ROOT_CAUSE_BLOCK_END/);
        if (match) {
            try {
                return JSON.parse(match[1]);
            } catch (e) {
                return null;
            }
        }
        return null;
    };

    sourceLogs.forEach(logPath => {
        const fullPath = resolvePath(logPath);
        if (!fs.existsSync(fullPath)) return;

        const content = fs.readFileSync(fullPath, 'utf8');
        const filename = path.basename(logPath);

        // Priority 1: FAIL_ROOT_CAUSE_BLOCK
        const failBlock = extractFailBlock(content);
        if (failBlock) {
            errors.push({
                task_id: taskId,
                mode: mode,
                step: 'FailBlockExtraction',
                error_class: failBlock.ERROR_CLASS || 'UNKNOWN_BLOCK_ERROR',
                exit_code: failBlock.EXIT_CODE || 1,
                command: 'N/A', // Block usually doesn't have command context directly unless embedded
                ts: new Date().toISOString(),
                stdout_tail: JSON.stringify(failBlock).slice(0, 500),
                stderr_tail: '',
                is_test: false,
                source: filename
            });
        }

        // Priority 2: Gate Light Logs (regex for FAIL)
        if (filename.startsWith('gate_light')) {
            const lines = content.split('\n');
            lines.forEach(line => {
                if (line.includes('[Gate Light]') && (line.includes('FAIL') || line.includes('Exit Code') && !line.includes('Exit Code 0'))) {
                    // Simple extraction
                     errors.push({
                        task_id: taskId,
                        mode: mode,
                        step: 'GateLightCheck',
                        error_class: 'GATE_LIGHT_FAILURE',
                        exit_code: 1,
                        command: 'gate_light_ci.mjs',
                        ts: new Date().toISOString(),
                        stdout_tail: line.trim().slice(0, 200),
                        stderr_tail: '',
                        is_test: false,
                        source: filename
                    });
                }
            });
        }

        // Priority 3: Command Audit (JSONL)
        if (filename.startsWith('command_audit') && filename.endsWith('.jsonl')) {
            const lines = content.split('\n');
            lines.forEach(line => {
                if (!line.trim()) return;
                try {
                    const entry = JSON.parse(line);
                    if (entry.exit_code !== 0) {
                         errors.push({
                            task_id: taskId,
                            mode: mode,
                            step: 'CommandExecution',
                            error_class: 'SHELL_EXIT_NONZERO',
                            exit_code: entry.exit_code,
                            command: entry.command,
                            ts: entry.timestamp,
                            stdout_tail: (entry.stdout || '').slice(-500),
                            stderr_tail: (entry.stderr || '').slice(-500),
                            is_test: false,
                            source: filename
                        });
                    }
                } catch (e) {}
            });
        }
    });
}

// Deduplicate errors (simple strategy: same error_class and source)
// For now, keep all, but limit total count to avoid explosion?
// Requirement says "limit length", implies tail.
// Let's just write them out.

// Write JSONL
if (errors.length === 0) {
    const noErrorEntry = {
        task_id: taskId,
        mode: mode,
        step: 'Digest',
        error_class: 'NO_ERROR',
        exit_code: 0,
        command: 'check_errors',
        ts: new Date().toISOString(),
        stdout_tail: 'No errors found.',
        stderr_tail: '',
        is_test: false
    };
    fs.writeFileSync(errorsJsonlPath, JSON.stringify(noErrorEntry) + '\n');
    console.log(`[ErrorDigest] Wrote NO_ERROR record to ${errorsJsonlPath}`);
} else {
    const jsonlContent = errors.map(e => JSON.stringify(e)).join('\n');
    fs.writeFileSync(errorsJsonlPath, jsonlContent);
    console.log(`[ErrorDigest] Wrote ${errors.length} errors to ${errorsJsonlPath}`);
}

// Generate Summary
const errorCounts = {};
errors.forEach(e => {
    const cls = e.error_class || 'UNKNOWN';
    errorCounts[cls] = (errorCounts[cls] || 0) + 1;
});

const topErrors = Object.entries(errorCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([cls, count]) => `- ${cls}: ${count}`)
    .join('\n');

const summaryContent = `TASK_ID: ${taskId}
COMMIT: ${commit}
TOTAL_ERRORS: ${errors.length}
MODE: ${mode}

TOP ERROR CLASSES:
${topErrors || 'None'}

Errors (First 5):
${errors.slice(0, 5).map(e => `[${e.ts}] ${e.error_class} (Exit ${e.exit_code}) - ${e.source || 'Unknown'}`).join('\n')}
`;

fs.writeFileSync(summaryPath, summaryContent);
console.log(`[ErrorDigest] Wrote summary to ${summaryPath}`);
