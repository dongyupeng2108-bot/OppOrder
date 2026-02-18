import fs from 'fs';
import path from 'path';

const SCRIPTS_DIR = 'scripts';
const BANNED_TOKENS = [
    { token: '&&', hint: 'Use "; if ($LASTEXITCODE -eq 0) { ... }"' },
    { token: '||', hint: 'Use "; if ($LASTEXITCODE -ne 0) { ... }"' },
    { token: '< NUL', hint: 'Use $ProgressPreference="SilentlyContinue" or specific -NonInteractive flags' },
    { token: '2>nul', hint: 'Use 2>$null' },
    { token: '1>nul', hint: 'Use >$null' },
    { token: '>nul', hint: 'Use >$null' },
    { token: '> nul', hint: 'Use >$null' }
];

// Recursively get all .ps1 files
function getPsFiles(dir) {
    let results = [];
    const list = fs.readdirSync(dir);
    list.forEach(file => {
        file = path.join(dir, file);
        const stat = fs.statSync(file);
        if (stat && stat.isDirectory()) {
            results = results.concat(getPsFiles(file));
        } else {
            if (file.endsWith('.ps1')) {
                results.push(file);
            }
        }
    });
    return results;
}

console.log('Starting static scan for banned cmd syntax in .ps1 files...');

let hasError = false;
const psFiles = getPsFiles(SCRIPTS_DIR);

psFiles.forEach(file => {
    const content = fs.readFileSync(file, 'utf8');
    const lines = content.split('\n');
    
    lines.forEach((line, index) => {
        // Skip comments (simple check)
        const trimmed = line.trim();
        if (trimmed.startsWith('#')) return;

        BANNED_TOKENS.forEach(({ token, hint }) => {
            if (line.includes(token)) {
                // Double check it's not in a string or comment (heuristic)
                // This is a simple scanner, might have false positives, but "safe" approach for now
                // We can refine if needed.
                console.error(`[FAIL] Banned token "${token}" found in ${file}:${index + 1}`);
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
