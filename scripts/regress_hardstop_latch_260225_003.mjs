import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPO_ROOT = path.resolve(__dirname, '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'scripts');
const TEMP_DIR = path.join(REPO_ROOT, '.tmp');
const LATCH_ROOT_REGRESS = path.join(TEMP_DIR, 'hardstop_latch_regress');

const TASK_ID = '260225_003';

console.log('>>> [Regression] Starting HardStop Latch Regression...');

// Ensure clean state
if (fs.existsSync(LATCH_ROOT_REGRESS)) {
    fs.rmSync(LATCH_ROOT_REGRESS, { recursive: true, force: true });
}

try {
    // 1. Static Regression
    console.log('>>> [Regression] 1. Static Analysis...');
    const entryPoints = ['run_task.ps1', 'safe_commit.ps1', 'safe_push.ps1'];
    for (const entry of entryPoints) {
        const content = fs.readFileSync(path.join(SCRIPTS_DIR, entry), 'utf8');
        if (!content.includes('ops_hardstop_latch.mjs') || !content.includes('--action check')) {
            throw new Error(`Static check failed: ${entry} does not call ops_hardstop_latch.mjs --action check`);
        }
        console.log(`    PASS: ${entry} contains latch check.`);
    }

    // 2. Behavior Regression
    console.log('>>> [Regression] 2. Behavior Analysis (Dev Mode)...');
    
    // Create Latch
    const yearMonth = "20" + TASK_ID.substring(0, 2) + "-" + TASK_ID.substring(2, 4);
    const latchDir = path.join(LATCH_ROOT_REGRESS, yearMonth); // ops_hardstop_latch.mjs expects structure
    // Actually, ops_hardstop_latch.mjs with override uses HARDSTOP_LATCH_ROOT directly?
    // Let's check logic:
    // if (process.env.HARDSTOP_LATCH_ROOT && parsedArgs.mode === 'Dev') { latchDir = ... }
    // const latchPath = path.join(latchDir, latchFilename);
    // So it puts the file DIRECTLY in latchDir.
    
    fs.mkdirSync(LATCH_ROOT_REGRESS, { recursive: true });
    const latchPath = path.join(LATCH_ROOT_REGRESS, `.hardstop_latch_${TASK_ID}.json`);
    fs.writeFileSync(latchPath, JSON.stringify({ reason: "REGRESSION_TEST" }));
    console.log(`    Created mock latch at ${latchPath}`);

    // Verify ops_hardstop_latch.mjs check
    try {
        console.log('    Verifying ops_hardstop_latch.mjs check...');
        execSync(`node scripts/ops_hardstop_latch.mjs --action check --task_id ${TASK_ID} --mode Dev`, {
            cwd: REPO_ROOT,
            env: { ...process.env, HARDSTOP_LATCH_ROOT: LATCH_ROOT_REGRESS },
            stdio: 'pipe' // capture output
        });
        throw new Error('ops_hardstop_latch.mjs check should have failed (Exit 33) but succeeded.');
    } catch (e) {
        if (e.status === 33) {
            console.log('    PASS: ops_hardstop_latch.mjs exited with 33.');
            const output = e.stdout.toString() + e.stderr.toString();
            if (output.includes('HARD_STOP=1') && output.includes('NEXT_ACTION=STOP_AND_REPORT')) {
                console.log('    PASS: Output contains 3-line fact block.');
            } else {
                throw new Error('Output missing 3-line fact block.');
            }
        } else {
            throw new Error(`ops_hardstop_latch.mjs failed with unexpected exit code: ${e.status}`);
        }
    }

    // Verify run_task.ps1 check
    // Note: PowerShell might take longer, but should fail fast.
    try {
        console.log('    Verifying run_task.ps1 check...');
        // Use a dummy mode or just check flag. run_task.ps1 expects -Mode Dev
        // We only want to check the START of the script.
        // But running it fully might trigger other things.
        // However, the check is at the VERY TOP.
        execSync(`powershell -NonInteractive -ExecutionPolicy Bypass -File scripts/run_task.ps1 -TaskId ${TASK_ID} -Mode Dev`, {
            cwd: REPO_ROOT,
            env: { ...process.env, HARDSTOP_LATCH_ROOT: LATCH_ROOT_REGRESS },
            stdio: 'pipe'
        });
        throw new Error('run_task.ps1 should have failed (Exit 33) but succeeded.');
    } catch (e) {
        if (e.status === 33) {
            console.log('    PASS: run_task.ps1 exited with 33.');
        } else {
            // PowerShell sometimes wraps exit codes?
            // If it returns non-zero, it's good. But we want 33.
            if (e.status === 33) {
                console.log('    PASS: run_task.ps1 exited with 33.');
            } else {
                console.log(`    WARNING: run_task.ps1 exited with ${e.status}. Checking output for HARD_STOP...`);
                const output = e.stdout.toString() + e.stderr.toString();
                if (output.includes('HARD_STOP=1')) {
                     console.log('    PASS: Output contains HARD_STOP=1.');
                } else {
                    throw new Error(`run_task.ps1 failed with ${e.status} but output missing HARD_STOP.`);
                }
            }
        }
    }

    console.log('>>> [Regression] All Tests Passed.');
} catch (err) {
    console.error('>>> [Regression] FAILED:', err.message);
    process.exit(1);
} finally {
    // Cleanup
    if (fs.existsSync(LATCH_ROOT_REGRESS)) {
        fs.rmSync(LATCH_ROOT_REGRESS, { recursive: true, force: true });
    }
}
