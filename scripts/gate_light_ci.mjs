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

    // --- News Pull Contract Check (Task 260208_028) ---
    console.log('[Gate Light] Checking News Pull API Contract...');
    try {
        execSync('node scripts/check_news_pull_contract.mjs', { stdio: 'inherit' });
    } catch (e) {
        console.error('[Gate Light] News Pull Contract Check FAILED.');
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

    // --- DoD Evidence Excerpt Check (Task 260208_030) ---
    // Only enforce for tasks >= 260208_030
    if (task_id >= '260208_030') {
        console.log('[Gate Light] Checking DoD Evidence Excerpts...');
        
        const notifyFile = path.join(result_dir, `notify_${task_id}.txt`);
        const resultFile = path.join(result_dir, `result_${task_id}.json`);
        
        if (!fs.existsSync(notifyFile) || !fs.existsSync(resultFile)) {
             console.error(`[Gate Light] FAILED: Notify or Result file missing for DoD check.`);
             process.exit(1);
        }
        
        const notifyContent = fs.readFileSync(notifyFile, 'utf8');
        const resultData = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
        
        // Check Notify
        const rootRegex = /DOD_EVIDENCE_HEALTHCHECK_ROOT:.*=>.*HTTP\/\d\.\d\s+200\s+OK/;
        const pairsRegex = /DOD_EVIDENCE_HEALTHCHECK_PAIRS:.*=>.*HTTP\/\d\.\d\s+200\s+OK/;
        
        if (!rootRegex.test(notifyContent)) {
            console.error('[Gate Light] FAILED: Notify file missing or invalid DoD Root Evidence.');
            console.error('Expected format: DOD_EVIDENCE_HEALTHCHECK_ROOT: <path> => HTTP/1.1 200 OK');
            process.exit(1);
        }
        
        if (!pairsRegex.test(notifyContent)) {
            console.error('[Gate Light] FAILED: Notify file missing or invalid DoD Pairs Evidence.');
            console.error('Expected format: DOD_EVIDENCE_HEALTHCHECK_PAIRS: <path> => HTTP/1.1 200 OK');
            process.exit(1);
        }
        
        // Check Result JSON
        if (!resultData.dod_evidence || !Array.isArray(resultData.dod_evidence.healthcheck) || resultData.dod_evidence.healthcheck.length < 2) {
             console.error('[Gate Light] FAILED: Result JSON missing dod_evidence.healthcheck field.');
             process.exit(1);
        }
        
        console.log('[Gate Light] DoD Evidence Excerpts verified.');
    } else {
        console.log(`[Gate Light] Skipping DoD Evidence Check for legacy task ${task_id}`);
    }

    // --- Scan Cache DoD Check (Task 260209_002) ---
    if (task_id >= '260209_002') {
        console.log('[Gate Light] Checking Scan Cache DoD Evidence...');
        
        const notifyFile = path.join(result_dir, `notify_${task_id}.txt`);
        const resultFile = path.join(result_dir, `result_${task_id}.json`);
        
        // Files existence already checked above
        const notifyContent = fs.readFileSync(notifyFile, 'utf8');
        const resultData = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
        
        // Check Notify
        const hasMiss = notifyContent.match(/DOD_EVIDENCE_SCAN_CACHE_MISS:.+cached=false/);
        const hasHit = notifyContent.match(/DOD_EVIDENCE_SCAN_CACHE_HIT:.+cached=true/);
        
        if (!hasMiss || !hasHit) {
            console.error('[Gate Light] FAILED: Notify file missing valid Scan Cache DoD Evidence.');
            console.error('Expected: DOD_EVIDENCE_SCAN_CACHE_MISS (cached=false) and DOD_EVIDENCE_SCAN_CACHE_HIT (cached=true).');
            process.exit(1);
        }
        
        // Check Result JSON
        if (!resultData.dod_evidence || !Array.isArray(resultData.dod_evidence.scan_cache) || resultData.dod_evidence.scan_cache.length < 2) {
             console.error('[Gate Light] FAILED: Result JSON missing dod_evidence.scan_cache field (len >= 2).');
             process.exit(1);
        }
        
        // Deep check JSON content matches required patterns
        const jsonMiss = resultData.dod_evidence.scan_cache.find(l => l.includes('cached=false'));
        const jsonHit = resultData.dod_evidence.scan_cache.find(l => l.includes('cached=true'));
        
        if (!jsonMiss || !jsonHit) {
             console.error('[Gate Light] FAILED: Result JSON scan_cache evidence does not contain both Miss and Hit.');
             process.exit(1);
        }
        
        console.log('[Gate Light] Scan Cache DoD Evidence verified.');
    }

    // --- DoD Stdout Mechanism Check (Task 260209_003) ---
    if (task_id >= '260209_003') {
        console.log('[Gate Light] Checking DoD Stdout Mechanism...');

        const notifyFile = path.join(result_dir, `notify_${task_id}.txt`);
        const dodStdoutFile = path.join(result_dir, `dod_stdout_${task_id}.txt`);
        
        // 1. Check dod_stdout file existence
        if (!fs.existsSync(dodStdoutFile)) {
            console.error(`[Gate Light] FAILED: dod_stdout_${task_id}.txt missing.`);
            process.exit(1);
        }

        const notifyContent = fs.readFileSync(notifyFile, 'utf8');
        const dodStdoutContent = fs.readFileSync(dodStdoutFile, 'utf8');

        // 2. Check for Stdout Block in Notify
        const marker = "=== DOD_EVIDENCE_STDOUT ===";
        if (!notifyContent.includes(marker)) {
             console.error(`[Gate Light] FAILED: Notify file missing '${marker}' block.`);
             process.exit(1);
        }

        // 3. Check dod_stdout content
        if (!dodStdoutContent.includes(marker)) {
             console.error(`[Gate Light] FAILED: dod_stdout file missing '${marker}' header.`);
             process.exit(1);
        }

        const dodLines = dodStdoutContent.split('\n')
            .map(l => l.trim())
            .filter(l => l.startsWith('DOD_EVIDENCE_'));

        if (dodLines.length < 2) {
             console.error(`[Gate Light] FAILED: dod_stdout file has fewer than 2 DOD_EVIDENCE_ lines.`);
             process.exit(1);
        }

        // 4. Validate Format (=>)
        const invalidLines = dodLines.filter(l => !l.includes('=>'));
        if (invalidLines.length > 0) {
             console.error(`[Gate Light] FAILED: DOD_EVIDENCE_ lines must contain '=>'. Invalid lines:`);
             invalidLines.forEach(l => console.error(`  ${l}`));
             process.exit(1);
        }

        // 5. Consistency Check (Notify vs dod_stdout)
        // Ensure all DoD lines in dod_stdout are present in notify
        for (const line of dodLines) {
            if (!notifyContent.includes(line)) {
                console.error(`[Gate Light] FAILED: Notify file missing DoD line from dod_stdout:`);
                console.error(`  ${line}`);
                process.exit(1);
            }
        }

        console.log('[Gate Light] DoD Stdout Mechanism verified.');
    }

    // --- Concurrent Scan DoD Check (Task 260209_004) ---
    if (task_id >= '260209_004') {
        console.log('[Gate Light] Checking Concurrent Scan DoD Evidence...');
        
        // Re-derive evidenceDir if needed, but it should be available from above
        // Format: YYMMDD_XXX. 26->2026, 02->02
        const match = task_id.match(/^(\d{2})(\d{2})\d{2}_/);
        if (match) {
            const year = '20' + match[1];
            const month = match[2];
            const monthDir = `${year}-${month}`;
            const evidenceDirLocal = path.join('rules', 'task-reports', monthDir);
            
            const logFile = path.join(evidenceDirLocal, `M4_PR2_concurrent_log_${task_id}.txt`);
            
            if (!fs.existsSync(logFile)) {
                console.error(`[Gate Light] FAILED: Concurrent Scan Log missing: ${logFile}`);
                process.exit(1);
            }
            
            const content = fs.readFileSync(logFile, 'utf8');
            if (!content.includes('PASS: Concurrent Batch Scan Verified')) {
                console.error('[Gate Light] FAILED: Concurrent Scan Log does not contain PASS message.');
                process.exit(1);
            }
            console.log('[Gate Light] Concurrent Scan DoD Evidence verified.');
        }
    }

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
