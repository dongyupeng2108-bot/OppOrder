/**
 * Static Smoke Test for Workspace Healer (scripts/reset_workspace.ps1)
 * 
 * Purpose:
 * Verify safety constraints of reset_workspace.ps1 without executing it (avoiding cross-platform issues).
 * 
 * Checks:
 * 1. Script exists.
 * 2. Uses pathspec whitelist (no bare `git clean -fd`).
 * 3. Contains fail-fast logic.
 */

import fs from 'fs';
import path from 'path';

const SCRIPT_PATH = path.join(process.cwd(), 'scripts', 'reset_workspace.ps1');

function main() {
    console.log('[Smoke] Checking scripts/reset_workspace.ps1...');

    if (!fs.existsSync(SCRIPT_PATH)) {
        console.error('[Smoke] FAILED: Script not found.');
        process.exit(1);
    }

    const content = fs.readFileSync(SCRIPT_PATH, 'utf8');

    // Check 1: No bare git clean -fd (must have -- <path> or be variable based)
    // We look for `git clean -fd` followed immediately by newline or pipe without arguments?
    // Actually, checking for the presence of the whitelist variable usage is better.
    // The script uses `git clean -fd -- $path`.
    
    if (!content.includes('git clean -fd --')) {
        console.error('[Smoke] FAILED: Script does not appear to use "git clean -fd -- <path>" pattern.');
        console.error('  Must use pathspec whitelist for safety.');
        process.exit(1);
    }

    // Check 2: Configuration whitelist
    const requiredPaths = [
        'rules/task-reports',
        'rules/reports',
        'data/opps_ledger'
    ];
    
    const missingPaths = requiredPaths.filter(p => !content.includes(p));
    if (missingPaths.length > 0) {
        console.error(`[Smoke] FAILED: Script missing required whitelist paths: ${missingPaths.join(', ')}`);
        process.exit(1);
    }

    // Check 3: Fail-fast logic (exit 1)
    if (!content.includes('exit 1')) {
        console.error('[Smoke] FAILED: Script missing "exit 1" fail-fast logic.');
        process.exit(1);
    }

    console.log('[Smoke] PASS: Static checks passed.');
}

main();
