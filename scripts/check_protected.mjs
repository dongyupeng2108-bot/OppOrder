import { execSync } from 'child_process';
import process from 'process';

const forbidden = [
    'scripts/ops_hardstop_latch.mjs',
    'scripts/run_task.ps1',
    'scripts/safe_commit.ps1',
    'scripts/safe_push.ps1',
    'scripts/postflight_validate_envelope.mjs',
];

try {
    // Get list of changed files against origin/main
    const diffOutput = execSync('git diff origin/main --name-only', { encoding: 'utf-8' });
    const changedFiles = diffOutput.split('\n').filter(line => line.trim() !== '');

    const violations = changedFiles.filter(file => forbidden.includes(file));

    if (violations.length > 0) {
        console.error('[PROTECTED] 以下文件在保护区，不得在普通任务中修改：');
        violations.forEach(file => console.error(`- ${file}`));
        process.exit(1);
    } else {
        console.log('[PROTECTED CHECK] PASS');
        process.exit(0);
    }
} catch (error) {
    console.error('[PROTECTED CHECK] ERROR:', error.message);
    process.exit(1);
}
