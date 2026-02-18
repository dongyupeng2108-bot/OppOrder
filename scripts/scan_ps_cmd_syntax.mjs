import fs from 'fs';
import path from 'path';

// B1. Converge scan scope to mandatory files only
const TARGET_FILES = [
    'scripts/run_task.ps1',
    'scripts/test_fail_budget.ps1',
    'scripts/ps/Invoke-Step.ps1'
];

const BANNED_TOKENS = [
    { token: '&&', hint: 'Use "; if ($LASTEXITCODE -eq 0) { ... }"' },
    { token: '||', hint: 'Use "; if ($LASTEXITCODE -ne 0) { ... }"' },
    { token: '< NUL', hint: 'Use $ProgressPreference="SilentlyContinue" or specific -NonInteractive flags' },
    { token: '2>nul', hint: 'Use 2>$null' },
    { token: '1>nul', hint: 'Use >$null' },
    { token: '>nul', hint: 'Use >$null' },
    { token: '> nul', hint: 'Use >$null' }
];

console.log('Starting static scan for banned cmd syntax in .ps1 files...');
console.log(`Scanning targets: ${TARGET_FILES.join(', ')}`);

let hasError = false;

TARGET_FILES.forEach(relativePath => {
    // Resolve absolute path or use relative from cwd
    const file = path.resolve(process.cwd(), relativePath);
    
    if (!fs.existsSync(file)) {
        console.warn(`[WARN] Target file not found: ${relativePath}`);
        return;
    }

    const content = fs.readFileSync(file, 'utf8');
    const lines = content.split('\n');
    let inHereString = false;

    lines.forEach((line, index) => {
        const trimmed = line.trim();
        
        // B2. Ignore definition lines and scanner logic itself
        // Skip lines defining the ban list or containing the banned token variable name context
        if (trimmed.includes('$Banned = @(') || trimmed.includes('Banned cmd syntax')) {
            return;
        }

        // Simple Here-String detection (Start)
        if (!inHereString && (trimmed.endsWith('@"') || trimmed.endsWith("@'"))) {
            inHereString = true;
            return;
        }

        // Simple Here-String detection (End)
        if (inHereString) {
            if (line.trimStart().startsWith('"@') || line.trimStart().startsWith("'@")) {
                inHereString = false;
            }
            return; // Skip content inside Here-String
        }

        // Skip comments
        if (trimmed.startsWith('#')) return;

        BANNED_TOKENS.forEach(({ token, hint }) => {
            if (line.includes(token)) {
                // Double check it's not in a string or comment (heuristic)
                // For now, with limited scope and definition skipping, this should be safe.
                console.error(`[FAIL] Banned token "${token}" found in ${relativePath}:${index + 1}`);
                console.error(`       Line: ${trimmed}`);
                console.error(`       Hint: ${hint}`);
                hasError = true;
            }
        });
    });
});

if (hasError) {
    console.error('Static scan FAILED. Please remove cmd syntax from PowerShell scripts.');
    process.exit(1);
} else {
    console.log('Static scan PASSED.');
    process.exit(0);
}
