import fs from 'fs';
import path from 'path';

// Configuration
const TARGET_EXTENSIONS = ['.md', '.mjs', '.js', '.ts', '.ps1', '.yml', '.yaml', '.json'];
const EXCLUDED_DIRS = ['node_modules', 'rules/task-reports', 'data', '.git'];
const EXCLUDED_FILES = [
    'scripts/check_doc_path_refs.mjs',
    'scripts/gate_light_ci.mjs'
];
const LEGACY_PATTERNS = [
    'rules/WORKFLOW.md',
    'rules/PROJECT_RULES.md',
    'rules/PROJECT_MASTER_PLAN.md'
];

// Helper to check if a path is excluded
function isExcluded(filePath) {
    // Normalize path separators to forward slashes for checking
    const normalizedPath = filePath.replace(/\\/g, '/');
    
    // Check files relative to CWD (since normalizedPath is absolute or relative depending on scanDirectory)
    // Actually scanDirectory joins dir + file. If dir is absolute, filePath is absolute.
    // Let's assume we want to check relative to root.
    const relativePath = path.relative(process.cwd(), filePath).replace(/\\/g, '/');

    if (EXCLUDED_FILES.includes(relativePath)) {
        return true;
    }

    return EXCLUDED_DIRS.some(excluded => normalizedPath.includes(excluded));
}

// Recursive file scanner
function scanDirectory(dir, fileList = []) {
    const files = fs.readdirSync(dir);

    for (const file of files) {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);

        if (stat.isDirectory()) {
            if (!isExcluded(filePath)) {
                scanDirectory(filePath, fileList);
            }
        } else {
            const ext = path.extname(file).toLowerCase();
            if (TARGET_EXTENSIONS.includes(ext) && !isExcluded(filePath)) {
                fileList.push(filePath);
            }
        }
    }
    return fileList;
}

function main() {
    console.log('[CheckDocPathRefs] Scanning for legacy doc path references...');
    const startTime = Date.now();
    const rootDir = process.cwd();
    
    // We explicitly scan from root, respecting exclusions
    const allFiles = scanDirectory(rootDir);
    
    let failureCount = 0;

    for (const file of allFiles) {
        try {
            const content = fs.readFileSync(file, 'utf8');
            const lines = content.split(/\r?\n/);
            
            lines.forEach((line, index) => {
                for (const pattern of LEGACY_PATTERNS) {
                    if (line.includes(pattern)) {
                        // Double check it's not a false positive (e.g. rules/rules/WORKFLOW.md contains rules/WORKFLOW.md)
                        // But wait, "rules/rules/WORKFLOW.md" DOES contain "rules/WORKFLOW.md".
                        // We need to ensure it's NOT preceded by "rules/".
                        // Actually, the requirement is "rules/WORKFLOW.md" -> "rules/rules/WORKFLOW.md".
                        // If the text is ALREADY "rules/rules/WORKFLOW.md", then `line.includes('rules/WORKFLOW.md')` is true.
                        // We must check if the match is strictly `rules/WORKFLOW.md` (legacy) or `rules/rules/WORKFLOW.md` (canonical).
                        
                        // Regex approach: Look for `rules/WORKFLOW.md` NOT preceded by `rules/`.
                        // But JS lookbehind support might vary? Node usually supports it.
                        // Let's use a simpler check: if matches "rules/rules/WORKFLOW.md", ignore it.
                        
                        // Find all indices of the pattern
                        let pos = line.indexOf(pattern);
                        while (pos !== -1) {
                            // Check characters before
                            const preceding = pos >= 6 ? line.substring(pos - 6, pos) : '';
                            if (preceding !== 'rules/') {
                                console.error(`[FAIL] Found legacy reference in: ${path.relative(rootDir, file)}:${index + 1}`);
                                console.error(`       Match: "...${line.substring(Math.max(0, pos - 20), Math.min(line.length, pos + pattern.length + 20))}..."`);
                                console.error(`       Fix: Change "${pattern}" to "rules/${pattern}"`);
                                failureCount++;
                            }
                            pos = line.indexOf(pattern, pos + 1);
                        }
                    }
                }
            });
        } catch (err) {
            console.error(`[WARN] Could not read file ${file}: ${err.message}`);
        }
    }

    const duration = Date.now() - startTime;
    console.log(`[CheckDocPathRefs] Scan completed in ${duration}ms.`);

    if (failureCount > 0) {
        console.error(`[CheckDocPathRefs] FAILED: Found ${failureCount} legacy doc path references.`);
        process.exit(1);
    } else {
        console.log('[CheckDocPathRefs] PASS: No legacy doc path references found.');
        process.exit(0);
    }
}

main();
