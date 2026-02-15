import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const MOCK_PASS = [
    { number: 1, title: 'Task 001 Fix', headRefName: 'feat/task-001', url: 'http://gh/1' }
];

const MOCK_FAIL = [
    { number: 2, title: 'Task 002 Fix', headRefName: 'feat/task-002', url: 'http://gh/2' }
];

const MOCK_EMPTY = [];

const MOCK_FILE = 'scripts/temp_mock_open_pr.json';
const OUTPUT_FILE = 'scripts/temp_output_open_pr.json';

function runTest(mockData, expectedExitCode, expectedMsg) {
    fs.writeFileSync(MOCK_FILE, JSON.stringify(mockData), 'utf8');
    
    let exitCode = 0;
    let stdout = '';
    let stderr = '';
    
    try {
        stdout = execSync(`node scripts/open_pr_guard.mjs --task_id 001 --output ${OUTPUT_FILE}`, {
            env: { ...process.env, OPEN_PR_GUARD_MOCK_JSON: MOCK_FILE },
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe']
        });
    } catch (err) {
        exitCode = err.status;
        stdout = err.stdout;
        stderr = err.stderr;
    }

    if (exitCode !== expectedExitCode) {
        console.error(`FAIL: Expected exit code ${expectedExitCode}, got ${exitCode}`);
        console.error(`STDOUT: ${stdout}`);
        console.error(`STDERR: ${stderr}`);
        return false;
    }

    if (expectedMsg && !stdout.includes(expectedMsg) && !stderr.includes(expectedMsg)) {
        console.error(`FAIL: Expected output to include "${expectedMsg}"`);
        console.error(`STDOUT: ${stdout}`);
        console.error(`STDERR: ${stderr}`);
        return false;
    }

    if (fs.existsSync(OUTPUT_FILE)) {
        const json = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8'));
        if (expectedExitCode === 0 && json.blocking_prs.length > 0) {
            console.error('FAIL: Expected 0 blocking PRs for success case');
            return false;
        }
        if (expectedExitCode === 1 && json.blocking_prs.length === 0) {
            console.error('FAIL: Expected blocking PRs for failure case');
            return false;
        }
    }

    return true;
}

function main() {
    console.log('Running Smoke Test for Open PR Guard...');
    
    // Case 1: Empty list -> PASS
    if (!runTest(MOCK_EMPTY, 0, 'OPEN_PR_GUARD_PASS')) {
        console.error('Case 1 (Empty) FAILED');
        process.exit(1);
    }
    console.log('Case 1 (Empty) PASSED');

    // Case 2: Related PR -> PASS
    if (!runTest(MOCK_PASS, 0, 'OPEN_PR_GUARD_PASS')) {
        console.error('Case 2 (Related) FAILED');
        process.exit(1);
    }
    console.log('Case 2 (Related) PASSED');

    // Case 3: Unrelated PR -> FAIL (Exit 1)
    if (!runTest(MOCK_FAIL, 1, 'BLOCK: Found 1 unrelated open PRs')) {
        console.error('Case 3 (Unrelated) FAILED');
        process.exit(1);
    }
    console.log('Case 3 (Unrelated) PASSED');

    // Cleanup
    if (fs.existsSync(MOCK_FILE)) fs.unlinkSync(MOCK_FILE);
    if (fs.existsSync(OUTPUT_FILE)) fs.unlinkSync(OUTPUT_FILE);

    console.log('ALL SMOKE TESTS PASSED');
}

main();
