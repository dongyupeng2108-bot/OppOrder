const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const taskId = '260213_003';
// Base must be the full hash of origin/main to match what Gate Light calculates
const base = execSync('git rev-parse origin/main').toString().trim();

try {
    const head = execSync('git rev-parse HEAD').toString().trim();
    const mergeBase = execSync(`git merge-base HEAD ${base}`).toString().trim();
    
    // Get diff from base to HEAD (Committed files)
    const diffCommitted = execSync(`git diff --name-only ${base}...HEAD`).toString().trim();
    const committedFiles = diffCommitted.split('\n').filter(f => f.trim() !== '');

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
        `rules/task-reports/2026-02/ui_copy_details_${taskId}.json`
    ];

    // Combine and Deduplicate
    const allFiles = new Set([...committedFiles, ...evidenceFiles]);
    const scopeFiles = Array.from(allFiles).sort();

    const parity = {
        task_id: taskId,
        base: base,
        head: head, // This is the Code Commit Head. When we commit Evidence, Head will move. 
                    // BUT Gate Light checks ci_parity against CURRENT HEAD. 
                    // If we commit Evidence, HEAD moves. 
                    // So we must predict the NEXT HEAD? No, that's impossible (hash changes).
                    // Gate Light Logic:
                    // 1. Calc Head = git rev-parse HEAD
                    // 2. Read ciJson.head
                    // 3. If mismatch, check if it's "Evidence-only update".
                    //    If yes, ACCEPT.
                    //    If no (Code changes), REJECT.
                    
        // So, if we set head: <Code Commit Hash>, and then commit Evidence.
        // Gate Light will see Mismatch (Evidence Commit Hash vs Code Commit Hash).
        // It checks diff: only evidence files changed? YES.
        // So it accepts.
        
        // THEN it checks scope_count.
        // scopeFilesCalc = git diff origin/main...HEAD (Evidence Commit).
        // This includes Code + Evidence.
        // So ciJson.scope_count MUST equal Code + Evidence count.
        
        merge_base: mergeBase,
        scope_files: scopeFiles,
        scope_count: scopeFiles.length
    };

    fs.writeFileSync(path.join(__dirname, `ci_parity_${taskId}.json`), JSON.stringify(parity, null, 2));
    console.log(`CI Parity file generated. Scope Count: ${scopeFiles.length}`);
} catch (e) {
    console.error('Error generating CI parity:', e);
}
