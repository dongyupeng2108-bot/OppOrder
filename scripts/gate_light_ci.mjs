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
    
    // --- Doc Path Standards Check (Task 260208_025) ---
    console.log('[Gate Light] Checking doc path standards...');
    const canonicalDocs = [
        'rules/rules/WORKFLOW.md',
        'rules/rules/PROJECT_RULES.md',
        'rules/rules/PROJECT_MASTER_PLAN.md'
    ];
    const legacyDocs = [
        'rules/WORKFLOW.md',
        'rules/PROJECT_RULES.md',
        'rules/PROJECT_MASTER_PLAN.md'
    ];

    // 1. Check for missing canonical docs
    const missingDocs = canonicalDocs.filter(f => !fs.existsSync(path.resolve(f)));
    if (missingDocs.length > 0) {
        console.error(`[Gate Light] FAILED: Missing canonical documents in rules/rules/:`);
        missingDocs.forEach(d => console.error(`  - ${d}`));
        console.error(`Fix Suggestion: Move these documents to rules/rules/ and update references.`);
        process.exit(1);
    }

    // 2. Check for existence of legacy docs (Fail if found)
    const existingLegacyDocs = legacyDocs.filter(f => fs.existsSync(path.resolve(f)));
    if (existingLegacyDocs.length > 0) {
        console.error(`[Gate Light] FAILED: Found legacy documents in rules/ (Must be removed/migrated):`);
        existingLegacyDocs.forEach(d => console.error(`  - ${d}`));
        console.error(`Fix Suggestion: Move content to rules/rules/ and delete these files to prevent fork.`);
        process.exit(1);
    }
    console.log('[Gate Light] Doc path standards verified.');

    // --- Doc Path Reference Check (Task 260208_026) ---
    console.log('[Gate Light] Checking for legacy doc path references...');
    try {
        execSync('node scripts/check_doc_path_refs.mjs', { stdio: 'inherit' });
    } catch (e) {
        console.error('[Gate Light] Doc Path Reference Check FAILED.');
        process.exit(1);
    }

    // --- Global Artifact Guard (Task 260208_029) ---
    console.log('[Gate Light] Checking for global healthcheck artifacts...');
    try {
        // Use pathspecs directly with git ls-files
        // Note: We use forward slashes for git pathspecs which work on Windows too
        const forbiddenPatterns = [
            'reports/healthcheck_*.txt',
            'rules/task-reports/*/reports/healthcheck_*.txt'
        ];
        const cmd = `git ls-files ${forbiddenPatterns.join(' ')}`;
        // If no files match, git ls-files returns empty string (exit code 0)
        // If match, it returns file paths
        const output = execSync(cmd, { encoding: 'utf8' }).trim();
        
        if (output.length > 0) {
            console.error('[Gate Light] FAILED: Global healthcheck artifacts found in git index:');
            console.error(output);
            console.error('Fix Suggestion: run "git rm --cached <file>" and ensure .gitignore includes them.');
            process.exit(1);
        }
        console.log('[Gate Light] Global Artifact Guard verified.');
    } catch (e) {
        // If git fails, treat as error
        console.error(`[Gate Light] Global Artifact Guard execution error: ${e.message}`);
        process.exit(1);
    }

    // --- Strict Healthcheck Validation (Task 260208_023) ---
    console.log('[Gate Light] Checking healthcheck evidence...');

    // 1. Derive month dir from task_id (e.g. 260208_XXX => 2026-02)
    // Format: YYMMDD_XXX. 26->2026, 02->02
    const match = task_id.match(/^(\d{2})(\d{2})\d{2}_/);
    if (!match) {
        // Fallback or error? Strict mode implies error if we can't parse.
        // But let's be safe, if regex fails, maybe just use result_dir if it matches pattern?
        // Requirement says: "以 rules/LATEST.json 解析得到 task_id，并据此推导月份目录"
        console.error(`[Gate Light] Invalid task_id format for date derivation: ${task_id}`);
        process.exit(1);
    }
    const year = '20' + match[1];
    const month = match[2];
    const monthDir = `${year}-${month}`;
    // Path: rules/task-reports/YYYY-MM/
    const evidenceDir = path.join('rules', 'task-reports', monthDir);

    const rootFile = path.join(evidenceDir, `${task_id}_healthcheck_53122_root.txt`);
    const pairsFile = path.join(evidenceDir, `${task_id}_healthcheck_53122_pairs.txt`);

    const checkFile = (filePath) => {
        if (!fs.existsSync(filePath)) {
            throw new Error(`Missing healthcheck file: ${filePath}`);
        }
        const buffer = fs.readFileSync(filePath);
        if (buffer.includes(0)) { // Check for NUL byte
             throw new Error(`File contains NUL bytes (binary/UTF-16 issue): ${filePath}`);
        }
        const content = buffer.toString('utf8');
        // Regex for HTTP 200: HTTP/1.1 200 or HTTP/1.0 200
        if (!/HTTP\/\d\.\d\s+200/.test(content)) {
            // Show snippet
            const snippet = content.substring(0, 100).replace(/\r/g, '').replace(/\n/g, ' ');
            throw new Error(`File does not contain 'HTTP/x.x 200': ${filePath}. Content snippet: "${snippet}..."`);
        }
    };

    try {
        checkFile(rootFile);
        checkFile(pairsFile);
        console.log('[Gate Light] Healthcheck evidence verified (Path + Content).');
    } catch (e) {
        console.error(`[Gate Light] Healthcheck Verification FAILED: ${e.message}`);
        console.error('Fix Suggestion: Use `curl.exe -s -i ... --output <path>` to generate readable ASCII text evidence.');
        process.exit(1);
    }
    // -------------------------------------------------------

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
