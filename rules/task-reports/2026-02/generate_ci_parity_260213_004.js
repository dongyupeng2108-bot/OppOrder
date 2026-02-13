const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const taskId = '260213_004';

try {
    console.log('Fetching origin/main to ensure CI Parity...');
    execSync('git fetch origin main');
} catch (e) {
    console.warn('Warning: git fetch origin main failed. Parity calculation might be stale if origin/main is outdated.');
}

// Base must be the full hash of origin/main to match what Gate Light calculates
const base = execSync('git rev-parse origin/main').toString().trim();

try {
    const head = execSync('git rev-parse HEAD').toString().trim();
    const mergeBase = execSync(`git merge-base HEAD ${base}`).toString().trim();
    
    // Get diff from base to HEAD (Committed files)
    const diffCommitted = execSync(`git diff --name-only ${base}...HEAD`).toString().trim();
    const committedFiles = diffCommitted.split('\n').filter(f => f.trim() !== '');

    // Get Staged files (to support pre-commit generation)
    let stagedFiles = [];
    try {
        const diffStaged = execSync('git diff --name-only --cached').toString().trim();
        stagedFiles = diffStaged.split('\n').filter(f => f.trim() !== '');
    } catch (e) {
        console.warn('Could not get staged files', e.message);
    }

    // Get staged files (Evidence to be committed next)
    // Note: If this script is run BEFORE git add, this will be empty.
    // So we should run git add . before running this script, or manually add known evidence files.
    // The safest way for "Two-Pass" is to include the evidence files that WE KNOW we are generating.
    
    const evidenceFiles = [
        `rules/task-reports/2026-02/notify_${taskId}.txt`,
        `rules/task-reports/2026-02/result_${taskId}.json`,
        `rules/task-reports/2026-02/${taskId}_healthcheck_53122_root.txt`,
        `rules/task-reports/2026-02/${taskId}_healthcheck_53122_pairs.txt`,
        `rules/task-reports/2026-02/${taskId}_test_log.txt`,
        `rules/task-reports/2026-02/trae_report_snippet_${taskId}.txt`,
        `rules/task-reports/2026-02/deliverables_index_${taskId}.json`,
        `rules/task-reports/2026-02/envelope_${taskId}.json`,
        `rules/task-reports/2026-02/ci_parity_${taskId}.json`,
        `rules/task-reports/2026-02/ui_copy_details_${taskId}.json`,
        `rules/task-reports/2026-02/generate_evidence_${taskId}.js`,
        `rules/task-reports/2026-02/generate_index_${taskId}.js`,
        `rules/task-reports/2026-02/generate_ci_parity_${taskId}.js`
    ];

    // Combine and Deduplicate
    const allFiles = new Set([...committedFiles, ...stagedFiles, ...evidenceFiles]);
    const scopeFiles = Array.from(allFiles).sort();

    const parity = {
        task_id: taskId,
        base: base,
        head: head,
        merge_base: mergeBase,
        scope_files: scopeFiles,
        scope_count: scopeFiles.length
    };

    fs.writeFileSync(path.join(__dirname, `ci_parity_${taskId}.json`), JSON.stringify(parity, null, 2));
    console.log(`CI Parity file generated. Scope Count: ${scopeFiles.length}`);
} catch (e) {
    console.error('Error generating CI parity:', e);
}
