import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const LATEST_JSON_PATH = path.join('rules', 'LATEST.json');

if (!fs.existsSync(LATEST_JSON_PATH)) {
    console.error('Error: rules/LATEST.json not found. Cannot determine latest task.');
    process.exit(1);
}

try {
    const latest = JSON.parse(fs.readFileSync(LATEST_JSON_PATH, 'utf8'));
    const { task_id, result_dir } = latest;

    if (!task_id || !result_dir) {
        console.error('Error: Invalid LATEST.json format. Missing task_id or result_dir.');
        process.exit(1);
    }

    console.log('[Gate Light] Verifying latest task: ' + task_id);
    
    // Construct postflight command
    // Note: Assuming scripts/postflight_validate_envelope.mjs exists relative to CWD
    const cmd = 'node scripts/postflight_validate_envelope.mjs --task_id ' + task_id + ' --result_dir ' + result_dir + ' --report_dir ' + result_dir;
    
    console.log('[Gate Light] Executing: ' + cmd);
    execSync(cmd, { stdio: 'inherit' });
    
    console.log('[Gate Light] PASS');
} catch (error) {
    console.error('[Gate Light] FAILED');
    // If execSync fails, it throws. We can exit 1 here.
    process.exit(1);
}
