
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const taskIds = [
    '260212_001',
    '260213_002',
    '260213_003',
    '260213_004',
    '260214_005',
    '260214_006',
    '260214_007'
];

const reportDir = path.resolve('rules/task-reports/2026-02');
const envelopeDir = path.resolve('rules/task-reports/envelopes');

const results = [];

taskIds.forEach(taskId => {
    const info = {
        taskId,
        status: 'UNKNOWN',
        branch: 'UNKNOWN',
        commit: 'UNKNOWN',
        gateLightExit: 'UNKNOWN',
        evidencePath: `rules/task-reports/2026-02/notify_${taskId}.txt`, // Default guess
        isMerged: false
    };

    // 1. Try to read result json
    const resultJsonPath = path.join(reportDir, `result_${taskId}.json`);
    if (fs.existsSync(resultJsonPath)) {
        try {
            const data = JSON.parse(fs.readFileSync(resultJsonPath, 'utf8'));
            if (data.status) info.status = data.status;
            // Some result files might have different structure, check for git info if available
            if (data.git_context) {
                 if (data.git_context.branch) info.branch = data.git_context.branch;
                 if (data.git_context.commit) info.commit = data.git_context.commit;
            }
        } catch (e) {}
    }

    // 2. Try to read snippet for more reliable info
    const snippetPath = path.join(reportDir, `trae_report_snippet_${taskId}.txt`);
    if (fs.existsSync(snippetPath)) {
        const content = fs.readFileSync(snippetPath, 'utf8');
        
        const branchMatch = content.match(/Branch:\s*(.+)/);
        if (branchMatch) info.branch = branchMatch[1].trim();

        const commitMatch = content.match(/COMMIT:\s*([a-f0-9]+)/); // Uppercase COMMIT per snippet format
        if (commitMatch) info.commit = commitMatch[1].trim();
        
        const exitMatch = content.match(/GATE_LIGHT_EXIT=(\d+)/);
        if (exitMatch) info.gateLightExit = exitMatch[1];
    }
    
    // 3. Try to read notify for Status/Gate Exit if missing
    const notifyPath = path.join(reportDir, `notify_${taskId}.txt`);
    if (fs.existsSync(notifyPath)) {
        const content = fs.readFileSync(notifyPath, 'utf8');
         if (info.gateLightExit === 'UNKNOWN') {
            const exitMatch = content.match(/GATE_LIGHT_EXIT=(\d+)/);
            if (exitMatch) info.gateLightExit = exitMatch[1];
        }
    }

    // 4. Git verification for Merged Status
    if (info.commit !== 'UNKNOWN') {
        try {
            // Check if commit is reachable from origin/main
            // We use git branch -r --contains <commit> to see if origin/main is there
            // Or simpler: git merge-base --is-ancestor <commit> origin/main
            try {
                execSync(`git merge-base --is-ancestor ${info.commit} origin/main`, { stdio: 'ignore' });
                info.status = 'MERGED';
                info.isMerged = true;
            } catch (e) {
                // Not merged yet, or fetch needed. 
                // Status remains as found (DONE/FAILED) or UNKNOWN
            }
        } catch (e) {}
    }
    
    // Fallback status logic
    if (info.status === 'UNKNOWN' && info.gateLightExit === '0') {
        info.status = 'DONE'; // Assume done if gate light passed
    }
    
    // Special check for envelope existence
    const envelopePath = path.join(envelopeDir, `${taskId}.envelope.json`);
    if (fs.existsSync(envelopePath)) {
        // Confirm evidence existence
    } else {
        // Maybe evidence is missing?
    }

    results.push(info);
});

console.log(JSON.stringify(results, null, 2));
